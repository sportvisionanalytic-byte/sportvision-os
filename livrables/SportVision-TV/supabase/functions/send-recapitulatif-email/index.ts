// ⚠️  DÉPLOIEMENT : uniquement par
//     bash livrables/SportVision-TV/scripts/deployer-fonction.sh send-recapitulatif-email
// Jamais `supabase functions deploy` nu : huit fonctions tournent volontairement sans
// vérification JWT (dont stripe-webhook) et un déploiement nu la réactive, ce qui coupe
// silencieusement tous les paiements. Après déploiement, lancer
//     bash livrables/SportVision-TV/tests/fonctions-verification-jwt.test.sh
//
// send-recapitulatif-email — le récapitulatif mensuel de prestations d'un collaborateur freelance.
//
// ══ CE QUE CE DOCUMENT EST, ET CE QU'IL N'EST PAS ════════════════════════════════════════════════
//
// Ce n'est PAS une fiche de paie, et aucun mot de ce fichier ne doit le laisser croire. Les
// collaborateurs de SportVision sont tous en `type_contrat = 'freelance'`, vérifié en base le
// 29/09/2026. Un bulletin de paie est le document d'un employeur à un salarié : en envoyer un à un
// indépendant, c'est produire soi-même la preuve écrite d'un lien de subordination, exactement la
// pièce qu'un contrôle URSSAF demande en premier pour requalifier une prestation en contrat de
// travail. Fouka a été alerté et a tranché : « récapitulatif de prestations ».
//
// TROIS MOTS SONT DONC INTERDITS ICI, et il faut les connaître pour ne pas les réintroduire :
//   « salaire »      → on écrit « montant versé » ;
//   « fiche de paie » → on écrit « récapitulatif de prestations » ;
//   « pénalité »      → on écrit « ajustement ». Le pouvoir de SANCTIONNER est lui aussi un critère
//                       d'employeur ; une retenue est un ajustement prévu au contrat, pas une
//                       punition.
// Et on n'écrit pas « vous êtes payé », qui est la phrase d'un employeur, mais « montant qui vous
// sera versé ».
//
// ══ POURQUOI ELLE NE FAIT PAS QUE POSTER UN E-MAIL ═══════════════════════════════════════════════
//
// Le récapitulatif arrive ici en BROUILLON (v361). C'est cette fonction, et elle seule, qui le
// passe à « envoyé », APRÈS que Resend a accepté le message. L'ordre inverse — marquer puis
// envoyer — laissait la base affirmer un envoi que personne n'avait reçu : le collaborateur
// attendait un virement dont il n'avait pas été prévenu, et Fouka croyait l'avoir prévenu. Personne
// ne pouvait s'en apercevoir avant la réclamation.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Le document vit a part pour pouvoir etre rendu et RELU sans demarrer ce serveur. Voir document.ts.
import { rendreRecapitulatif, moisEnClair, type LigneRecap, type Recap } from "./document.ts";
// La piece que le collaborateur garde et transmet a son comptable. Voir pdf.ts.
import { rendreRecapitulatifPdf, nomFichierPdf } from "./pdf.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (corps: unknown, status = 200) =>
    new Response(JSON.stringify(corps), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentification requise" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // QUI APPELLE. On ne se contente jamais de la présence d'une apikey : la clé anon est publique,
    // elle se lit dans le code de n'importe quelle page.
    const clientAppelant = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u, error: eUser } = await clientAppelant.auth.getUser();
    if (eUser || !u?.user) return json({ error: "Session invalide" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);

    // LA DIRECTION SEULE ENVOIE. Même vérification que `recap_envoyer` côté base : deux couches,
    // parce que celle-ci peut être contournée par un futur appel mal branché et l'autre non.
    const { data: profil } = await admin
      .from("profiles").select("role, actif").eq("id", u.user.id).maybeSingle();
    if (!profil?.actif || profil.role !== "admin") {
      return json({ error: "Seule la direction envoie un récapitulatif." }, 403);
    }

    const corps = await req.json().catch(() => ({}));
    const recapId = String(corps?.recapitulatif_id ?? "");
    if (!recapId) return json({ error: "recapitulatif_id manquant" }, 400);

    const { data: r, error: eRecap } = await admin
      .from("recapitulatifs_remuneration")
      .select("*, collaborateur:profiles!recapitulatifs_remuneration_collaborateur_id_fkey(prenom, nom, email)")
      .eq("id", recapId).maybeSingle();
    if (eRecap || !r) return json({ error: "Récapitulatif introuvable" }, 404);

    // DÉJÀ PARTI : ON NE RENVOIE PAS. Un deuxième e-mail annonce un deuxième virement.
    if (r.statut === "envoye") {
      return json({ error: "Ce récapitulatif a déjà été envoyé.", envoye_le: r.envoye_le }, 409);
    }
    if (r.statut !== "brouillon") {
      return json({ error: `Ce récapitulatif est ${r.statut}, il ne peut pas être envoyé.` }, 409);
    }

    const destinataire = r.destinataire_email || r.collaborateur?.email;
    if (!destinataire) {
      return json({ error: "Ce collaborateur n'a pas d'adresse e-mail renseignée dans son profil." }, 422);
    }

    const { data: lignes } = await admin
      .from("recapitulatifs_remuneration_lignes")
      .select("date_prestation, libelle, montant, nature, motif")
      .eq("recapitulatif_id", recapId)
      .order("nature").order("date_prestation");

    const toutes = lignes ?? [];
    if (toutes.length === 0) {
      return json({ error: "Ce récapitulatif n'a aucune ligne : rien à envoyer." }, 422);
    }

    // `prenom` et `nomComplet` appartiennent au document, qui les echappe lui-meme. Ici on n'a
    // besoin que de la periode, pour l'objet de l'e-mail.
    const periode = moisEnClair(r.mois as string);
    const recap = r as unknown as Recap;
    // `lignesRecap` et non `lignes` : ce nom est deja pris plus haut par la reponse brute de la base.
    const lignesRecap = toutes as unknown as LigneRecap[];
    const html = rendreRecapitulatif(recap, lignesRecap);

    // LE PDF, ET POURQUOI IL S'AJOUTE AU LIEU DE REMPLACER. Fouka voulait « vraiment un PDF, avec le
    // logo », et a ajoute « dans l'ensemble c'est a peu pres ca » du contenu de l'e-mail. On joint
    // donc la piece SANS vider le message : un PDF qui ne s'ouvre pas sur un telephone laisserait
    // quelqu'un devant une annonce de virement sans le detail qui la justifie.
    //
    // ET UN ECHEC DE PDF N'EMPECHE PAS L'ENVOI. Le message porte deja tout ce qu'il faut ; refuser
    // de prevenir quelqu'un de son virement parce qu'une piece jointe n'a pas pu etre fabriquee
    // serait une panne de confort transformee en panne de paiement.
    let piece: { filename: string; content: string } | null = null;
    try {
      const octets = await rendreRecapitulatifPdf(recap, lignesRecap);
      let binaire = "";
      for (const o of octets) binaire += String.fromCharCode(o);
      piece = { filename: nomFichierPdf(recap), content: btoa(binaire) };
    } catch (e) {
      console.error("PDF non genere, l'e-mail part sans piece jointe :", String((e as Error)?.message ?? e));
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("FROM_EMAIL") || "SportVision <contact@sportvision-an.fr>";
    if (!resendApiKey) return json({ error: "RESEND_API_KEY non configurée dans les secrets Supabase." }, 500);

    const envoi = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromEmail,
        to: [destinataire],
        subject: `Votre récapitulatif de prestations — ${periode}`,
        html,
        ...(piece ? { attachments: [piece] } : {}),
      }),
    });
    const reponse = await envoi.json().catch(() => ({}));

    // L'E-MAIL N'EST PAS PARTI : on ne marque rien. Le brouillon reste un brouillon, et l'écran
    // propose de réessayer. C'est tout l'intérêt de la séparation faite en v361.
    if (!envoi.ok) {
      return json({ error: reponse?.message || "Le fournisseur d'e-mail a refusé l'envoi.", details: reponse }, 502);
    }

    const { data: marque, error: eMarque } = await admin
      .rpc("recap_marquer_envoye", { p_recapitulatif_id: recapId, p_reference: reponse?.id ?? null });

    // CAS LE PLUS DÉLICAT, ET IL FAUT LE DIRE EN CLAIR : l'e-mail EST parti, mais la base n'a pas
    // pu l'enregistrer. Ne jamais laisser croire à un échec d'envoi ici — quelqu'un renverrait, et
    // le collaborateur recevrait deux annonces de virement pour un seul mois.
    if (eMarque) {
      return json({
        envoye: true,
        confirme: false,
        destinataire,
        avertissement:
          "L'e-mail est bien parti, mais son enregistrement a échoué. NE PAS RENVOYER : "
          + "confirmez l'envoi à la main, ou signalez-le. Détail : " + eMarque.message,
      }, 200);
    }

    return json({
      envoye: true, confirme: marque !== false, destinataire,
      reference: reponse?.id ?? null,
      // On le DIT quand la piece a manque : l'e-mail est parti, mais pas le document, et c'est une
      // difference que l'ecran doit pouvoir montrer.
      pdf_joint: piece !== null,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
