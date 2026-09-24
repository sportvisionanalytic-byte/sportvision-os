// Le parcours complet d'une photo rangée sur Cloudflare R2 (24/09/2026).
//
// Depuis le 24/09, les originaux partent sur R2 et non plus sur Supabase : 19 Mo la photo, 20 Go
// par semaine avec trois clubs, et une sortie de données facturée à chaque téléchargement. Le
// plan gratuit de Supabase a coupé tout l'écosystème cette nuit-là, en pleine relecture Apple.
//
// CE QUE CE TEST VÉRIFIE, ET POURQUOI CHAQUE POINT COMPTE :
//
//   1. Un membre du personnel obtient une adresse de dépôt, et le fichier arrive vraiment.
//   2. Il obtient une adresse de lecture, et le contenu est IDENTIQUE à l'octet près. Une
//      signature acceptée ne prouve rien si le fichier rendu n'est pas le bon.
//   3. Une photo déjà « ready » ne redonne PAS d'adresse de dépôt. Une photo vendue ne doit pas
//      pouvoir être remplacée.
//   4. Un anonyme n'obtient rien. La clé publique est dans le JavaScript du site : « fermé aux
//      familles » doit vouloir dire fermé à la terre entière.
//   5. La suppression efface pour de bon.
//
// Il crée sa ligne dans un vrai album, en statut « uploading » pour qu'elle n'apparaisse dans
// aucune galerie, et il la retire à la fin quoi qu'il arrive — y compris en cas d'échec, sinon
// un test raté laisse une photo fantôme derrière lui.
import { SB, ANON, enTeteAdmin, jeton } from "./_session-os.mjs";

let ok = 0;
const echecs = [];
const t = (nom, condition, detail = "") => {
  if (condition) { ok += 1; console.log("  ok  ", nom); }
  else { echecs.push(`${nom}${detail ? " — " + detail : ""}`); console.log("  KO  ", nom, detail); }
};

const CONTENU = `SportVision, parcours R2 complet, ${new Date().toISOString()}\n`;

async function r2Fichier(acces, assetId, mode) {
  const r = await fetch(`${SB}/functions/v1/r2-fichier`, {
    method: "POST",
    headers: {
      apikey: ANON,
      ...(acces ? { Authorization: `Bearer ${acces}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ asset_id: assetId, mode }),
  });
  return { code: r.status, corps: await r.json().catch(() => null) };
}

const assetId = crypto.randomUUID();
let cree = false;

try {
  // Un album réel, le plus récent : le test doit passer par les mêmes règles que la production.
  const albums = await (await fetch(
    `${SB}/rest/v1/media_albums?select=id,club_id&order=created_at.desc&limit=1`,
    { headers: enTeteAdmin })).json();
  if (!albums?.[0]) throw new Error("aucun album en base pour accrocher le test");
  const album = albums[0];

  const j = await jeton("contact@sportvision-an.fr");
  if (!j) throw new Error("jeton administrateur impossible à obtenir");

  // La ligne, écrite comme l'OS l'écrit : avant le fichier, et en « uploading ».
  const creation = await fetch(`${SB}/rest/v1/media_assets`, {
    method: "POST",
    headers: { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      id: assetId, album_id: album.id, club_id: album.club_id,
      storage_bucket: "r2",
      original_path: `media/${album.id}/${assetId}.txt`,
      original_filename: "essai d'équipe.txt",
      mime_type: "text/plain", status: "uploading", bytes: CONTENU.length,
    }),
  });
  t("la ligne media_assets se crée", creation.ok, creation.ok ? "" : await creation.text());
  if (!creation.ok) throw new Error("création impossible");
  cree = true;

  // 1. Dépôt
  const depot = await r2Fichier(j.acces, assetId, "depot");
  t("le personnel obtient une adresse de dépôt", depot.code === 200 && !!depot.corps?.url,
    JSON.stringify(depot.corps));
  if (depot.corps?.url) {
    const envoi = await fetch(depot.corps.url, {
      method: "PUT", headers: { "Content-Type": "text/plain" }, body: CONTENU,
    });
    t("Cloudflare accepte le fichier", envoi.ok, `HTTP ${envoi.status}`);
  }

  // 2. Lecture, et surtout : le contenu est-il le bon ?
  const lecture = await r2Fichier(j.acces, assetId, "lecture");
  t("le personnel obtient une adresse de lecture", lecture.code === 200 && !!lecture.corps?.url);
  if (lecture.corps?.url) {
    // Aucun en-tête d'authentification, comme le ferait un navigateur : c'est tout l'intérêt.
    const rep = await fetch(lecture.corps.url);
    const texte = await rep.text();
    t("le fichier revient identique", rep.ok && texte === CONTENU,
      rep.ok ? `reçu ${texte.length} octets sur ${CONTENU.length}` : `HTTP ${rep.status}`);
  }

  // 3. Une photo déjà déposée ne se remplace pas.
  await fetch(`${SB}/rest/v1/media_assets?id=eq.${assetId}`, {
    method: "PATCH", headers: { ...enTeteAdmin, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "ready" }),
  });
  const reDepot = await r2Fichier(j.acces, assetId, "depot");
  t("une photo déjà déposée refuse une nouvelle adresse de dépôt", reDepot.code === 409,
    `HTTP ${reDepot.code}`);

  // 4. L'anonyme n'obtient rien, dans aucun mode.
  for (const mode of ["lecture", "depot", "suppression"]) {
    const anon = await r2Fichier(null, assetId, mode);
    t(`un anonyme n'obtient rien en mode ${mode}`,
      anon.code === 401 || anon.code === 403 || anon.code === 404, `HTTP ${anon.code}`);
  }

  // 5. Suppression, et vérification que le fichier est bien parti.
  const adresseAvant = (await r2Fichier(j.acces, assetId, "lecture")).corps?.url;
  const suppression = await r2Fichier(j.acces, assetId, "suppression");
  t("la suppression répond", suppression.code === 200, `HTTP ${suppression.code}`);
  if (adresseAvant) {
    const apres = await fetch(adresseAvant);
    t("le fichier n'existe plus", apres.status === 404, `HTTP ${apres.status}`);
  }
} catch (e) {
  echecs.push(String(e));
  console.log("  KO   exception :", String(e));
} finally {
  // La ligne part quoi qu'il arrive : un test raté ne doit pas laisser de photo fantôme dans un
  // vrai album.
  if (cree) {
    await fetch(`${SB}/rest/v1/media_assets?id=eq.${assetId}`,
      { method: "DELETE", headers: enTeteAdmin });
  }
}

console.log(`\n${ok} vérifications passées, ${echecs.length} échec(s).`);
if (echecs.length) { echecs.forEach((e) => console.log("  ❌ " + e)); process.exit(1); }
