// Supabase Edge Function — envoyer-push
//
// ⚠️  DÉPLOIEMENT : uniquement par `bash livrables/SportVision-TV/scripts/deployer-fonction.sh
//     envoyer-push`. Jamais `supabase functions deploy` nu : huit fonctions tournent
//     volontairement sans vérification JWT et un déploiement nu la réactive.
//
// CE QU'ELLE FAIT. Elle vide `push_outbox` : pour chaque envoi en attente, elle signe un jeton
// avec la clé APNs de l'équipe et pousse la notification sur l'appareil. Le trigger
// `mettre_en_file_push` (migration v372) remplit la file ; cette fonction ne décide de rien.
//
// POURQUOI PARLER À APPLE DIRECTEMENT, ET PAS PAR EXPO. La clé APNs de SportVision existe déjà et
// appartient à l'équipe H2J6ZBKXQD. Passer par les serveurs d'Expo ajouterait un intermédiaire
// entre une proposition de mission et le téléphone d'un opérateur, sans rien apporter.
//
// UN 410 N'EST PAS UNE PANNE, C'EST UNE RÉPONSE. Apple rend 410 Gone quand un jeton est mort —
// application désinstallée, téléphone réinitialisé. On éteint l'appareil et on ne réessaie pas :
// réessayer un jeton mort, c'est se faire limiter par Apple pour les vrais envois.
//
// PAS DE BOUCLE INFINIE. Cinq tentatives, espacées, puis `abandonne`. Un envoi qui échoue pour
// toujours doit se voir dans la table, pas encombrer la file à chaque passage.
//
// Sécurité : `verify_jwt` reste ACTIF. pg_cron présente la clé publique dans `Authorization`
// pour passer la porte de Supabase, et le secret partagé dans l'en-tête `x-sportvision-cle`.
// Secrets requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY
// (le contenu du .p8), DISPATCH_NOTIFICATIONS_SECRET.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LOT = 100;
const MAX_TENTATIVES = 5;

/** L'identifiant de paquet à qui la notification est destinée. Les deux applications ont des
 *  paquets différents : sans ce choix, la mission d'un opérateur partirait sur le téléphone d'une
 *  famille. La bêta de l'OS et sa future version définitive sont deux paquets distincts. */
const TOPIC: Record<string, string> = {
  os: Deno.env.get("APNS_TOPIC_OS") ?? "fr.sportvision.os.beta",
  familles: Deno.env.get("APNS_TOPIC_FAMILLES") ?? "fr.sportvision.app",
};

function base64url(octets: Uint8Array): string {
  return btoa(String.fromCharCode(...octets)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Le jeton d'autorisation APNs : un JWT ES256 signé avec la clé .p8. Apple le tolère jusqu'à une
 *  heure ; on en fabrique un par passage, ce qui est largement dans les clous. */
async function jetonApns(): Promise<string> {
  const kid = Deno.env.get("APNS_KEY_ID")!;
  const iss = Deno.env.get("APNS_TEAM_ID")!;
  const pem = Deno.env.get("APNS_KEY")!.replace(/\\n/g, "\n");

  const corps = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s/g, "");
  const brut = Uint8Array.from(atob(corps), (c) => c.charCodeAt(0));
  const cle = await crypto.subtle.importKey("pkcs8", brut, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);

  const entete = base64url(new TextEncoder().encode(JSON.stringify({ alg: "ES256", kid })));
  const charge = base64url(new TextEncoder().encode(JSON.stringify({ iss, iat: Math.floor(Date.now() / 1000) })));
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    cle,
    new TextEncoder().encode(`${entete}.${charge}`),
  );
  return `${entete}.${charge}.${base64url(new Uint8Array(signature))}`;
}

serve(async (req) => {
  // LE SECRET VOYAGE DANS SON PROPRE EN-TÊTE, PAS DANS `Authorization`. C'est ce qui permet de
  // garder `verify_jwt = true` sur cette fonction : Supabase veut une clé valide dans
  // `Authorization`, et la clé PUBLIQUE suffit à passer sa porte — vérifié le 30/09. Le vrai
  // contrôle, lui, est ci-dessous.
  //
  // Les huit fonctions ouvertes de ce projet le sont parce qu'un service extérieur les appelle
  // sans jeton Supabase (Stripe, Youtrust, un lien reçu par e-mail). Ici l'appelant est notre
  // propre cron : il peut très bien présenter la clé publique, et il n'y avait aucune raison
  // d'ouvrir une neuvième porte.
  const attendu = Deno.env.get("DISPATCH_NOTIFICATIONS_SECRET");
  if (!attendu || req.headers.get("x-sportvision-cle") !== attendu) {
    return new Response("non autorisé", { status: 401 });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: aTraiter, error } = await admin
    .from("push_outbox")
    .select("id, titre, message, donnees, tentatives, appareils_push ( id, jeton, application, actif )")
    .eq("etat", "en_attente")
    .lte("prochaine_tentative_le", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(LOT);

  if (error) return new Response(JSON.stringify({ erreur: error.message }), { status: 500 });
  if (!aTraiter?.length) return new Response(JSON.stringify({ traites: 0 }), { status: 200 });

  const jwt = await jetonApns();
  let envoyes = 0, echecs = 0, eteints = 0;

  for (const ligne of aTraiter) {
    const appareil = ligne.appareils_push as unknown as { id: string; jeton: string; application: string; actif: boolean } | null;

    // L'appareil a pu être éteint entre la mise en file et maintenant. On n'envoie pas, et on ne
    // compte pas ça comme un échec : c'est une file qui a raison d'être vidée.
    if (!appareil || !appareil.actif) {
      await admin.from("push_outbox").update({ etat: "abandonne", derniere_erreur: "appareil inactif" }).eq("id", ligne.id);
      continue;
    }

    const topic = TOPIC[appareil.application];
    if (!topic) {
      await admin.from("push_outbox").update({ etat: "abandonne", derniere_erreur: `application inconnue : ${appareil.application}` }).eq("id", ligne.id);
      continue;
    }

    let reponse: Response;
    try {
      reponse = await fetch(`https://api.push.apple.com/3/device/${appareil.jeton}`, {
        method: "POST",
        headers: {
          authorization: `bearer ${jwt}`,
          "apns-topic": topic,
          "apns-push-type": "alert",
          // 10 = tout de suite. Ces notifications sont datées : une proposition de mission qui
          // arrive avec deux heures de retard ne sert plus à rien.
          "apns-priority": "10",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          aps: { alert: { title: ligne.titre, body: ligne.message }, sound: "default" },
          ...ligne.donnees,
        }),
      });
    } catch (e) {
      await reporter(admin, ligne, `réseau : ${e instanceof Error ? e.message : String(e)}`);
      echecs++;
      continue;
    }

    if (reponse.status === 200) {
      await admin.from("push_outbox").update({ etat: "envoye", envoye_le: new Date().toISOString() }).eq("id", ligne.id);
      envoyes++;
      continue;
    }

    const detail = await reponse.text().catch(() => "");

    // 410 : le jeton est mort. 400 avec BadDeviceToken : il n'a jamais été bon. Dans les deux cas,
    // réessayer est inutile et nuisible — Apple limite les expéditeurs qui s'acharnent.
    if (reponse.status === 410 || detail.includes("BadDeviceToken") || detail.includes("Unregistered")) {
      await admin.from("appareils_push").update({ actif: false, raison_inactif: `APNs ${reponse.status}` }).eq("id", appareil.id);
      await admin.from("push_outbox").update({ etat: "abandonne", derniere_erreur: `jeton mort (${reponse.status})` }).eq("id", ligne.id);
      eteints++;
      continue;
    }

    await reporter(admin, ligne, `APNs ${reponse.status} : ${detail.slice(0, 200)}`);
    echecs++;
  }

  return new Response(JSON.stringify({ traites: aTraiter.length, envoyes, echecs, eteints }), {
    status: 200, headers: { "content-type": "application/json" },
  });
});

/** Réessayer plus tard, en espaçant, et abandonner au bout de cinq fois.
 *
 *  `admin` est typé LARGEMENT et pas par `ReturnType<typeof createClient>` : les génériques du
 *  client changent d'une version du SDK à l'autre, et ce fichier est importé par une URL qui suit
 *  la version 2. Un type qui casse à la prochaine montée de version, sur une fonction dont le seul
 *  rôle est d'écrire quatre colonnes, ne protège de rien. */
async function reporter(
  admin: { from: (t: string) => { update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => PromiseLike<unknown> } } },
  ligne: { id: string; tentatives: number },
  erreur: string,
) {
  const n = (ligne.tentatives ?? 0) + 1;
  const fini = n >= MAX_TENTATIVES;
  await admin.from("push_outbox").update({
    etat: fini ? "abandonne" : "en_attente",
    tentatives: n,
    derniere_erreur: erreur,
    // 1, 4, 9, 16 minutes : assez pour laisser passer une coupure, assez court pour qu'une
    // proposition de mission reste utile.
    prochaine_tentative_le: new Date(Date.now() + n * n * 60_000).toISOString(),
  }).eq("id", ligne.id);
}
