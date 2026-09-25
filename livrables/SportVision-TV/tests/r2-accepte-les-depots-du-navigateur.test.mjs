// Le stockage des originaux accepte-t-il un dépôt DEPUIS UN NAVIGATEUR ? (25/09/2026)
//
// TROUVÉ EN REPRODUISANT UNE PANNE SIGNALÉE PAR FOUKA : « zéro photo ajoutée, échec ». Tout
// fonctionnait — la signature, les identifiants, le bucket — et un PUT depuis un serveur passait
// en 200. Mais le préambule CORS du navigateur recevait 403, sans en-tête d'autorisation. Le
// navigateur refusait donc d'envoyer AVANT d'essayer, `fetch` levait, et l'écran affichait
// « Réseau indisponible ». Aucune photo ne pouvait entrer, et rien ne disait pourquoi.
//
// POURQUOI LES TESTS EXISTANTS NE L'ONT PAS VU. Ils vérifiaient le dépôt, la lecture et la
// suppression depuis Node — où CORS n'existe pas. Un test qui ne passe pas par le navigateur ne
// peut pas voir un mur qui n'existe QUE dans le navigateur.
//
// CE TEST INTERROGE DONC LE PRÉAMBULE, exactement comme un navigateur le fait avant un PUT : même
// méthode OPTIONS, même en-tête Origin, même méthode demandée. C'est la seule mesure qui dit la
// vérité sans ouvrir un navigateur.
//
// SI CE TEST ÉCHOUE, la politique CORS du bucket R2 est absente ou trop étroite. Elle se pose dans
// le tableau de bord Cloudflare : R2 → le bucket → Settings → CORS Policy. La clé d'accès R2 ne
// suffit pas à la poser : elle a les droits sur les fichiers, pas sur la configuration du bucket.
import { SB, ANON, enTeteAdmin, compte, jeton } from "./_session-os.mjs";

const ORIGINES = [
  "https://bc6m3cgdz.sportvision-an.fr",   // l'OS, d'où la Production verse les photos
  "https://connect.sportvision-an.fr",     // Connect, qui relit un original acheté
];

let ok = 0;
const echecs = [];
const t = (nom, condition, detail = "") => {
  if (condition) { ok += 1; console.log("  ok  ", nom); }
  else { echecs.push(`${nom}${detail ? " — " + detail : ""}`); console.log("  KO  ", nom, detail); }
};

const A = { headers: { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation" } };
const c = await compte("role=eq.prod");
const j = await jeton(c.email);

// Une ligne d'essai, comme l'écran en crée une avant de déposer. Supprimée à la fin.
const alb = (await (await fetch(`${SB}/rest/v1/media_albums?select=id,club_id&limit=1`, { headers: enTeteAdmin })).json())[0];
const assetId = crypto.randomUUID();
await fetch(`${SB}/rest/v1/media_assets`, { ...A, method: "POST", body: JSON.stringify({
  id: assetId, album_id: alb.id, club_id: alb.club_id,
  original_path: `media/${alb.id}/${assetId}.jpg`, original_filename: "essai-cors.jpg",
  mime_type: "image/jpeg", checksum: assetId, width: 10, height: 10, bytes: 7,
  storage_bucket: "r2", status: "uploading", position: 99999 }) });

try {
  const a = await (await fetch(`${SB}/functions/v1/r2-fichier`, { method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${j.acces}`, "Content-Type": "application/json" },
    body: JSON.stringify({ asset_id: assetId, mode: "depot" }) })).json();
  t("une adresse de dépôt est délivrée", !!a?.url, JSON.stringify(a).slice(0, 120));

  if (a?.url) {
    // 1. Le dépôt lui-même marche-t-il ? (sans navigateur, donc sans CORS)
    const put = await fetch(a.url, { method: "PUT",
      headers: { "Content-Type": "image/jpeg" }, body: new Uint8Array([1, 2, 3, 4, 5, 6, 7]) });
    t("le stockage accepte le fichier", put.ok, `HTTP ${put.status}`);

    // 2. Le navigateur serait-il autorisé à l'envoyer ? C'est LA question.
    for (const origine of ORIGINES) {
      const pre = await fetch(a.url, { method: "OPTIONS", headers: {
        Origin: origine,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type" } });
      const autorise = pre.headers.get("access-control-allow-origin");
      t(`un navigateur sur ${origine.replace("https://", "")} peut déposer`,
        pre.ok && (autorise === origine || autorise === "*"),
        `préambule HTTP ${pre.status}, allow-origin ${autorise ?? "absent"}`);
    }
  }
} finally {
  await fetch(`${SB}/rest/v1/media_assets?id=eq.${assetId}`, { method: "DELETE", headers: enTeteAdmin });
}

console.log(`\n${ok} vérifications passées, ${echecs.length} échec(s).`);
if (echecs.length) {
  echecs.forEach((e) => console.log("  ❌ " + e));
  console.log("\nLa politique CORS du bucket se pose dans Cloudflare : R2 → bucket → Settings →");
  console.log("CORS Policy. La clé R2 ne peut pas la poser, elle n'a de droits que sur les fichiers.");
  process.exit(1);
}
