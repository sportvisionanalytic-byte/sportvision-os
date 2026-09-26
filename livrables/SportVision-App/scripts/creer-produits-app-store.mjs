// Créer les deux Pass Photo dans App Store Connect, par l'API, sans ouvrir un navigateur.
//
// POURQUOI CE SCRIPT EXISTE
//
// Fouka, 26/09/2026 : « fais en sorte qu'il apparaisse dans App Store Connect alors, qu'est-ce qui
// manque, je comprends pas ». Ce qui manquait n'était pas du travail de ma part : c'était l'Issuer ID
// du compte, un identifiant qui ne s'affiche que dans App Store Connect et qu'aucune API ne permet de
// deviner. Sans lui, impossible de signer la moindre requête.
//
// Tout le reste est ici. Dès que l'Issuer ID est connu, une commande suffit.
//
// USAGE
//   node scripts/creer-produits-app-store.mjs <ISSUER_ID> [chemin du .p8] [KEY_ID]
//
// Par défaut, le script essaie la clé ~/Documents/AuthKey_M3MM5D8353.p8. Si elle n'est pas une clé
// App Store Connect, Apple répond 401 et le script le dit clairement au lieu d'insister.
//
// CE QU'IL CRÉE
//   pass_photo_19_99   consommable, 19,99 €   (SF Villemomble, qui affiche 19,90)
//   pass_photo_39_99   consommable, 39,99 €   (RCP Fontainebleau, qui affiche 39,90)
//
// Les identifiants sont ceux que la base compare déjà (media_products.apple_product_id). Un écart
// d'un caractère fait refuser l'achat côté serveur, donc ils ne sont PAS paramétrables ici : les
// retaper à la main est précisément le risque que ce script supprime.
//
// IL NE CONTOURNE RIEN. Si l'accord « Paid Applications » n'est pas actif, Apple refuse la création
// et le script affiche sa réponse : c'est une signature juridique, elle n'appartient qu'à Fouka.

import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const [issuerId, cheminCle, keyIdArg] = process.argv.slice(2);
const BUNDLE = "fr.sportvision.app";

const PRODUITS = [
  { productId: "pass_photo_19_99", nom: "Pass Photo 19,99", prixCible: 19.99, club: "SF Villemomble" },
  { productId: "pass_photo_39_99", nom: "Pass Photo 39,99", prixCible: 39.99, club: "RCP Fontainebleau" },
];

if (!issuerId) {
  console.error(`Il manque l'Issuer ID.

Où le trouver : appstoreconnect.apple.com → Users and Access → onglet Integrations →
App Store Connect API. C'est l'UUID affiché en haut de la page, à côté de « Issuer ID ».

  node scripts/creer-produits-app-store.mjs <ISSUER_ID>

Deux clés existent sur cette machine. Le script essaie AuthKey_M3MM5D8353.p8 par défaut ; si ce
n'est pas la bonne, passe son chemin en second argument et son Key ID en troisième.`);
  process.exit(1);
}

const cle = cheminCle || join(homedir(), "Documents", "AuthKey_M3MM5D8353.p8");
const keyId = keyIdArg || (cle.match(/AuthKey_([A-Z0-9]+)\.p8/)?.[1] ?? "");
if (!keyId) {
  console.error(`Impossible de déduire le Key ID du nom « ${cle} ». Passe-le en troisième argument.`);
  process.exit(1);
}

const b64url = (b) => Buffer.from(b).toString("base64url");

/** Le jeton ES256 exigé par l'API. Dix minutes de validité : Apple refuse au-delà de vingt. */
function jeton() {
  const pem = readFileSync(cle, "utf8");
  const now = Math.floor(Date.now() / 1000);
  const entete = b64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const corps = b64url(JSON.stringify({
    iss: issuerId, iat: now, exp: now + 600, aud: "appstoreconnect-v1",
  }));
  const s = createSign("SHA256");
  s.update(`${entete}.${corps}`);
  // `dsaEncoding: "ieee-p1363"` n'est PAS cosmétique : Node signe en DER par défaut, et un JWT
  // ES256 attend la forme brute r||s. Avec le DER, Apple répond 401 sans autre explication — et on
  // cherche du côté de la clé alors que la signature seule est en cause.
  return `${entete}.${corps}.${s.sign({ key: pem, dsaEncoding: "ieee-p1363" }, "base64url")}`;
}

const T = jeton();
const API = "https://api.appstoreconnect.apple.com";

async function appel(methode, chemin, corps) {
  const r = await fetch(API + chemin, {
    method: methode,
    headers: { Authorization: `Bearer ${T}`, "Content-Type": "application/json" },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const texte = await r.text();
  let json = null;
  try { json = texte ? JSON.parse(texte) : null; } catch { /* réponse non-JSON */ }
  return { ok: r.ok, statut: r.status, json, texte };
}

function expliquer(r) {
  const e = r.json?.errors?.[0];
  if (!e) return `HTTP ${r.statut} ${r.texte.slice(0, 200)}`;
  return `${e.title ?? r.statut} — ${e.detail ?? ""}`.trim();
}

// ── 1. L'app ──────────────────────────────────────────────────────────────────
const apps = await appel("GET", `/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE)}`);
if (!apps.ok) {
  console.error(`Apple a refusé la première requête : ${expliquer(apps)}`);
  if (apps.statut === 401) {
    console.error(`
401 veut dire l'une de trois choses, et une seule à la fois :
  • la clé ${keyId} n'est pas une clé App Store Connect (c'est peut-être celle des notifications) ;
  • l'Issuer ID est erroné ;
  • la clé a été révoquée.
Vérifie sur la page Integrations que le Key ID ${keyId} y figure bien.`);
  }
  process.exit(1);
}
const app = apps.json?.data?.[0];
if (!app) {
  console.error(`Aucune app avec le bundle ${BUNDLE} sur ce compte. Il faut la créer d'abord.`);
  process.exit(1);
}
console.log(`App trouvée : ${app.attributes?.name} (${app.id})`);

// ── 2. Ce qui existe déjà ─────────────────────────────────────────────────────
// On relit AVANT de créer : relancer ce script ne doit rien casser ni rien dupliquer.
const existants = await appel("GET", `/v1/apps/${app.id}/inAppPurchasesV2?limit=200`);
const deja = new Map(
  (existants.json?.data ?? []).map((p) => [p.attributes?.productId, p.id]),
);
console.log(`${deja.size} achat(s) intégré(s) déjà déclaré(s).`);

let echecs = 0;

for (const p of PRODUITS) {
  if (deja.has(p.productId)) {
    console.log(`= ${p.productId} existe déjà (${deja.get(p.productId)}), rien à faire.`);
    continue;
  }

  // ── 3. Créer le consommable ─────────────────────────────────────────────────
  // CONSUMABLE et non NON_CONSUMABLE : une famille peut racheter un Pass la saison suivante, ou pour
  // un second enfant. Un non-consommable ne s'achète qu'une fois par compte Apple, pour toujours.
  const cree = await appel("POST", "/v2/inAppPurchases", {
    data: {
      type: "inAppPurchases",
      attributes: {
        name: p.nom,
        productId: p.productId,
        inAppPurchaseType: "CONSUMABLE",
        reviewNote:
          "Pass Photo : donne accès aux photos de l'enfant prises par SportVision lors des matchs "
          + "de son club. Pour le tester, ouvrir Mes photos, choisir une galerie, puis « Débloquer "
          + "mon Pass Photo ».",
        availableInAllTerritories: true,
      },
      relationships: { app: { data: { type: "apps", id: app.id } } },
    },
  });
  if (!cree.ok) {
    console.error(`✗ ${p.productId} : ${expliquer(cree)}`);
    echecs++;
    continue;
  }
  const id = cree.json?.data?.id;
  console.log(`+ ${p.productId} créé (${id})`);

  // ── 4. Le nom affiché et la description ─────────────────────────────────────
  const loc = await appel("POST", "/v1/inAppPurchaseLocalizations", {
    data: {
      type: "inAppPurchaseLocalizations",
      attributes: {
        locale: "fr-FR",
        name: "Pass Photo saison 2026-2027",
        description: "Accès à vos photos de la saison, dans l'application et sur le web.",
      },
      relationships: { inAppPurchaseV2: { data: { type: "inAppPurchases", id } } },
    },
  });
  if (!loc.ok) console.error(`  ! libellé fr-FR non posé : ${expliquer(loc)}`);

  // ── 5. Le prix ──────────────────────────────────────────────────────────────
  // Apple ne prend pas un montant : il prend un « price point », son propre palier. On cherche donc
  // celui qui correspond en France, et on refuse de deviner si aucun ne colle exactement.
  const points = await appel(
    "GET",
    `/v2/inAppPurchases/${id}/pricePoints?filter[territory]=FRA&limit=200`,
  );
  const palier = (points.json?.data ?? []).find(
    (x) => Number(x.attributes?.customerPrice) === p.prixCible,
  );
  if (!palier) {
    console.error(
      `  ! aucun palier à ${p.prixCible} € en France. `
      + `Le prix reste à poser à la main dans App Store Connect.`,
    );
    echecs++;
    continue;
  }
  const prix = await appel("POST", "/v1/inAppPurchasePriceSchedules", {
    data: {
      type: "inAppPurchasePriceSchedules",
      relationships: {
        inAppPurchase: { data: { type: "inAppPurchases", id } },
        manualPrices: { data: [{ type: "inAppPurchasePrices", id: "prix-1" }] },
        baseTerritory: { data: { type: "territories", id: "FRA" } },
      },
    },
    included: [{
      type: "inAppPurchasePrices",
      id: "prix-1",
      attributes: { startDate: null, endDate: null },
      relationships: { inAppPurchasePricePoint: { data: { type: "inAppPurchasePricePoints", id: palier.id } } },
    }],
  });
  if (!prix.ok) console.error(`  ! prix non posé : ${expliquer(prix)}`);
  else console.log(`  prix ${p.prixCible} € posé (${p.club})`);
}

console.log(
  echecs
    ? `\nTerminé avec ${echecs} problème(s). Ce qui a été créé est conservé : relancer ce script `
      + `reprend là où il s'est arrêté.`
    : `\nTerminé. Les deux produits existent.\n\nIl reste, et seulement toi peux le faire : une `
      + `capture d'écran de revue par produit, et l'accord Paid Applications actif si ce n'est déjà `
      + `fait. Ensuite le bouton d'achat apparaîtra dans l'app, sans nouveau build.`,
);
process.exit(echecs ? 1 : 0);
