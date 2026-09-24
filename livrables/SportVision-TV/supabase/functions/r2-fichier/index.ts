// Déposer, relire ou supprimer une photo rangée sur Cloudflare R2 (24/09/2026).
//
// POURQUOI UNE SEULE FONCTION POUR LES TROIS
//
// Les trois gestes reposent sur exactement la même question : « cette personne a-t-elle le droit
// de toucher à cette photo ? » Les séparer en trois fonctions, c'est écrire trois fois la réponse
// et découvrir un jour qu'elles ne disent plus la même chose. Ici la règle est écrite une fois.
//
// QUI A LE DROIT — ET POURQUOI ON NE L'ÉCRIT PAS ICI
//
// On ne réécrit AUCUNE règle de permission, c'est le point important. L'OS crée la ligne
// `media_assets` AVANT d'envoyer le fichier : la base a donc déjà tranché avec ses propres règles
// (media_upload_staff, photographe_voit_album, compte désactivé). Cette fonction relit cette ligne
// AVEC LE JETON DE L'APPELANT. Si les règles de la base la lui montrent, c'est qu'elle l'a
// autorisé. L'existence de la ligne, pour lui, EST l'autorisation.
//
// Dupliquer la règle ici, c'était se donner rendez-vous avec le jour où les deux versions
// divergent — et ce jour-là, c'est toujours la plus permissive qui gagne.
//
// Conséquence heureuse : `media_assets` n'est lisible que par le personnel (voir les policies
// massets_staff_all et massets_photographe_perimetre). Une famille ne peut donc rien obtenir
// ici ; elle passe par gallery-download, qui vérifie qu'elle a payé. Deux portes, deux questions
// différentes, et aucune des deux ne répond à la place de l'autre.
//
// POURQUOI DES ADRESSES SIGNÉES ET PAS UN TRANSIT PAR ICI
//
// Une photo pèse 19 Mo, une galerie de match en compte deux à cinq cents. Faire passer tout ça
// par une fonction serveur, c'est des gigaoctets dans un processus qui dispose de quelques
// centaines de mégaoctets, pour un résultat identique. Le navigateur parle donc directement à
// Cloudflare, comme il parlait directement à Supabase avant. Les clés R2 ne quittent jamais le
// serveur : l'adresse signée porte l'autorisation, jamais le secret.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { reglagesR2, signerRequete, urlSigneeR2 } from "../_shared/r2.ts";

// Dix minutes pour déposer : le temps d'un envoi, pas le temps d'une nuit.
const VALIDITE_DEPOT = 600;
// Une heure pour relire : un opérateur qui vérifie une galerie de trois cents photos ne doit pas
// voir les images expirer sous ses yeux au bout de cinq minutes.
const VALIDITE_LECTURE = 3600;

type Mode = "depot" | "lecture" | "suppression";

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (corps: unknown, statut = 200) =>
    new Response(JSON.stringify(corps), {
      status: statut, headers: { ...cors, "Content-Type": "application/json" },
    });

  const jeton = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  if (!jeton) return json({ error: "Connexion requise." }, 401);

  let assetId = "";
  let mode: Mode = "lecture";
  try {
    const corps = await req.json();
    assetId = String(corps?.asset_id ?? "");
    const m = String(corps?.mode ?? "lecture");
    if (m === "depot" || m === "lecture" || m === "suppression") mode = m;
    else return json({ error: "Mode inconnu." }, 400);
  } catch { /* corps illisible : rattrapé par le contrôle ci-dessous */ }
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) return json({ error: "Requête incomplète." }, 400);

  const commeLui = createClient(
    Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${jeton}` } } },
  );

  const { data: photo, error } = await commeLui
    .from("media_assets")
    .select("id, original_path, storage_bucket, status, original_filename")
    .eq("id", assetId)
    .maybeSingle();

  if (error) {
    console.error("[r2-fichier] lecture refusée :", error.message);
    return json({ error: "Opération impossible." }, 500);
  }
  // Invisible pour cet appelant : soit la ligne n'existe pas, soit il n'a pas le droit d'y
  // toucher. Même réponse dans les deux cas — distinguer renseignerait quelqu'un qui cherche à
  // savoir quelles photos existent.
  if (!photo) return json({ error: "Photo introuvable." }, 404);

  if (photo.storage_bucket !== "r2") {
    return json({ error: "Cette photo n'est pas rangée sur R2." }, 409);
  }
  // Le chemin vient de la base, JAMAIS de l'appelant. Sans ça, il suffirait de demander une
  // adresse de dépôt pour le chemin d'une autre photo pour l'écraser.
  const chemin = String(photo.original_path ?? "");
  if (!chemin) return json({ error: "Chemin de fichier manquant." }, 409);

  // Une photo « ready » est vendue : on ne redonne pas le droit de la remplacer. La supprimer
  // reste possible — c'est un geste assumé, tracé, et déjà autorisé par la base.
  if (mode === "depot" && photo.status !== "uploading" && photo.status !== "processing") {
    return json({ error: "Cette photo est déjà déposée." }, 409);
  }

  const r = reglagesR2();
  if (!r) {
    console.error("[r2-fichier] les clés R2 ne sont pas configurées");
    return json({ error: "Stockage momentanément indisponible." }, 500);
  }

  try {
    if (mode === "depot") {
      const url = await urlSigneeR2(r, chemin, VALIDITE_DEPOT, undefined, "PUT");
      return json({ url, valide_secondes: VALIDITE_DEPOT });
    }

    if (mode === "lecture") {
      const url = await urlSigneeR2(
        r, chemin, VALIDITE_LECTURE, photo.original_filename || undefined);
      return json({ url, valide_secondes: VALIDITE_LECTURE });
    }

    // Suppression : faite ici, côté serveur. Une adresse signée de suppression circulerait, et
    // une adresse qui efface n'a rien à faire dans un historique de navigateur.
    const { url, entetes } = await signerRequete(r, "DELETE", chemin);
    const rep = await fetch(url, { method: "DELETE", headers: entetes });
    // 204 quand le fichier part, 404 quand il n'était déjà plus là. Les deux conviennent : le
    // but est qu'il n'existe plus, pas qu'il ait existé.
    if (!rep.ok && rep.status !== 404) {
      console.error("[r2-fichier] suppression refusée :", rep.status, (await rep.text()).slice(0, 200));
      return json({ error: "Suppression impossible." }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    console.error("[r2-fichier] échec :", e);
    return json({ error: "Stockage momentanément indisponible." }, 500);
  }
});
