// Envoyer la capture d'écran de revue des deux Pass Photo à App Store Connect.
//
// POURQUOI ELLE EST NÉCESSAIRE
//
// Les deux produits existent, avec leur type, leur libellé français et leur prix (26/09/2026). Ils
// restent en `MISSING_METADATA`, et la seule chose qui manque est cette capture — vérifié par l'API,
// la relation `appStoreReviewScreenshot` est vide sur les deux. Tant qu'ils sont dans cet état,
// StoreKit ne les rend pas, même en bac à sable, donc le bouton d'achat ne peut pas apparaître.
//
// POURQUOI JE NE LA FABRIQUE PAS
//
// Elle sert à un examinateur d'Apple pour comprendre où l'achat se déclenche. Une image inventée
// serait une fausse déclaration à Apple, sur un point qu'ils vérifient. Elle doit venir de l'app.
//
// USAGE
//   node scripts/envoyer-capture-revue.mjs <chemin de l'image>
//
// L'image : une capture de l'écran d'une galerie dans l'application, prise sur l'iPhone
// (bouton latéral + volume haut), puis déposée sur le Mac. Peu importe qu'elle montre déjà le
// bouton d'achat : la note de revue, déjà posée, explique le parcours.

import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { createHash, createSign } from "node:crypto";

const ISSUER = "299e1e5e-6b69-4964-bf18-b3d9a83ee98a";
const KEY_ID = "M3MM5D8353";
const CLE = "/Users/fouka/Documents/AuthKey_M3MM5D8353.p8";
const PRODUITS = ["6816359189", "6816359076"]; // pass_photo_19_99, pass_photo_39_99
const API = "https://api.appstoreconnect.apple.com";

const image = process.argv[2];
if (!image) {
  console.error(`Il manque le chemin de l'image.

  node scripts/envoyer-capture-revue.mjs ~/Desktop/capture.png

Prends une capture de l'écran d'une galerie dans l'application (bouton latéral + volume haut sur
l'iPhone), envoie-la sur le Mac, et passe son chemin ici.`);
  process.exit(1);
}

const b64url = (b) => Buffer.from(b).toString("base64url");
function jeton() {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: "ES256", kid: KEY_ID, typ: "JWT" }));
  const p = b64url(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 600, aud: "appstoreconnect-v1" }));
  const s = createSign("SHA256");
  s.update(`${h}.${p}`);
  // ieee-p1363 : Node signe en DER par defaut, un JWT ES256 attend r||s brut. Sans ca, 401 muet.
  return `${h}.${p}.${s.sign({ key: readFileSync(CLE, "utf8"), dsaEncoding: "ieee-p1363" }, "base64url")}`;
}
const T = jeton();

async function api(methode, chemin, corps) {
  const r = await fetch(API + chemin, {
    method: methode,
    headers: { Authorization: `Bearer ${T}`, "Content-Type": "application/json" },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const t = await r.text();
  let j = null;
  try { j = t ? JSON.parse(t) : null; } catch { /* non-JSON */ }
  return { ok: r.ok, statut: r.status, j, t };
}
const dire = (r) => r.j?.errors?.[0]
  ? `${r.j.errors[0].title ?? r.statut} — ${r.j.errors[0].detail ?? ""}`.trim()
  : `HTTP ${r.statut} ${r.t.slice(0, 200)}`;

const octets = readFileSync(image);
const taille = statSync(image).size;
const nom = basename(image);
// La somme de contrôle est EXIGÉE à la dernière étape : Apple refuse de valider un envoi dont le
// contenu ne correspond pas à ce qu'il a reçu. C'est aussi ce qui distingue « envoi incomplet » de
// « fichier corrompu », deux pannes qui se ressemblent beaucoup vues d'ici.
const md5 = createHash("md5").update(octets).digest("hex");

let echecs = 0;
for (const id of PRODUITS) {
  // ── 1. Réserver l'emplacement : Apple rend les adresses où déposer les octets ──
  const res = await api("POST", "/v1/inAppPurchaseAppStoreReviewScreenshots", {
    data: {
      type: "inAppPurchaseAppStoreReviewScreenshots",
      attributes: { fileName: nom, fileSize: taille },
      relationships: { inAppPurchaseV2: { data: { type: "inAppPurchases", id } } },
    },
  });
  if (!res.ok) { console.error(`✗ ${id} réservation : ${dire(res)}`); echecs++; continue; }
  const sid = res.j?.data?.id;
  const ops = res.j?.data?.attributes?.uploadOperations ?? [];
  if (!ops.length) { console.error(`✗ ${id} : Apple n'a donné aucune adresse d'envoi.`); echecs++; continue; }

  // ── 2. Déposer les octets, morceau par morceau ──
  // Apple découpe les gros fichiers : on suit SON découpage plutôt que d'envoyer le tout d'un bloc.
  let envoiOk = true;
  for (const op of ops) {
    const part = octets.subarray(op.offset, op.offset + op.length);
    const entetes = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]));
    const up = await fetch(op.url, { method: op.method, headers: entetes, body: part });
    if (!up.ok) { console.error(`✗ ${id} envoi : HTTP ${up.status}`); envoiOk = false; break; }
  }
  if (!envoiOk) { echecs++; continue; }

  // ── 3. Valider : sans cette étape, l'envoi reste invisible côté Apple ──
  const fin = await api("PATCH", `/v1/inAppPurchaseAppStoreReviewScreenshots/${sid}`, {
    data: {
      type: "inAppPurchaseAppStoreReviewScreenshots",
      id: sid,
      attributes: { uploaded: true, sourceFileChecksum: md5 },
    },
  });
  if (!fin.ok) { console.error(`✗ ${id} validation : ${dire(fin)}`); echecs++; continue; }
  console.log(`+ ${id} : capture envoyée (${fin.j?.data?.attributes?.assetDeliveryState?.state ?? "en traitement"})`);
}

// ── Relire l'état, plutôt que de conclure sur l'absence d'erreur ──
const liste = await api("GET", "/v1/apps/6815006638/inAppPurchasesV2?limit=50");
for (const x of liste.j?.data ?? []) {
  console.log(`  ${x.attributes?.productId} → ${x.attributes?.state}`);
}

console.log(
  echecs
    ? `\n${echecs} problème(s). Si Apple parle de dimensions, la capture doit faire une taille `
      + `d'écran iPhone reconnue : réessaie avec une capture prise directement sur l'appareil.`
    : `\nFait. Un produit passé en READY_TO_SUBMIT est servi par StoreKit en bac à sable : le bouton `
      + `d'achat apparaîtra dans l'application, sans nouveau build.`,
);
process.exit(echecs ? 1 : 0);
