// Où en est la soumission iOS, en une commande (28/09/2026).
//
// POURQUOI CE SCRIPT EXISTE. Chaque point d'étape Apple se payait en allers-retours : quel build
// est attaché, la version est-elle sortie de REJECTED, les deux Pass sont-ils prêts, l'accord
// Paid Apps est-il enfin actif. Aucune de ces réponses n'est devinable, et se tromper coûte une
// soumission refusée. Ce script les demande toutes, et ne dit que ce qu'Apple répond.
//
// IL NE MODIFIE RIEN. Aucun POST, aucun PATCH : c'est une lecture, elle peut être lancée à tout
// moment sans risque.
//
//   node livrables/SportVision-App/scripts/etat-app-store.mjs [ISSUER_ID] [chemin .p8] [KEY_ID]
//
// L'Issuer ID par défaut est celui du compte Elkana Group, déjà utilisé par
// creer-produits-app-store.mjs. La clé par défaut est ~/Documents/AuthKey_M3MM5D8353.p8.

import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const APP = "6815006638";
const [issuerArg, cheminCleArg, keyIdArg] = process.argv.slice(2);
const issuerId = issuerArg || "299e1e5e-6b69-4964-bf18-b3d9a83ee98a";
const cle = cheminCleArg || join(homedir(), "Documents", "AuthKey_M3MM5D8353.p8");
const keyId = keyIdArg || (cle.match(/AuthKey_([A-Z0-9]+)\.p8/)?.[1] ?? "");

const b64url = (b) => Buffer.from(b).toString("base64url");

/** Le jeton ES256. `dsaEncoding: "ieee-p1363"` n'est pas cosmétique : Node signe en DER par
 *  défaut, et Apple répond alors 401 sans rien expliquer — on soupçonne la clé pour rien. */
function jeton() {
  const pem = readFileSync(cle, "utf8");
  const now = Math.floor(Date.now() / 1000);
  const entete = b64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const corps = b64url(JSON.stringify({ iss: issuerId, iat: now, exp: now + 600, aud: "appstoreconnect-v1" }));
  const s = createSign("SHA256");
  s.update(`${entete}.${corps}`);
  return `${entete}.${corps}.${s.sign({ key: pem, dsaEncoding: "ieee-p1363" }, "base64url")}`;
}

const T = jeton();
const api = async (chemin) => {
  const r = await fetch("https://api.appstoreconnect.apple.com" + chemin,
    { headers: { Authorization: `Bearer ${T}` } });
  const t = await r.text();
  try { return { statut: r.status, d: t ? JSON.parse(t) : null }; } catch { return { statut: r.status, d: t }; }
};

const ligne = (t) => console.log(t);
const titre = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

// ── La version en préparation ─────────────────────────────────────────────────────────────────
titre("Version iOS");
const vers = await api(`/v1/apps/${APP}/appStoreVersions?limit=3&fields[appStoreVersions]=versionString,appStoreState,createdDate,releaseType`);
if (vers.statut !== 200) {
  ligne(`  Apple répond ${vers.statut}. ${JSON.stringify(vers.d).slice(0, 200)}`);
  process.exit(1);
}
const versions = vers.d?.data ?? [];
for (const v of versions) {
  ligne(`  ${v.attributes.versionString} — ${v.attributes.appStoreState}`);
}
const enCours = versions[0];

// ── Le build attaché, et ceux qu'Apple a reçus ────────────────────────────────────────────────
titre("Builds");
if (enCours) {
  const b = await api(`/v1/appStoreVersions/${enCours.id}/build?fields[builds]=version,uploadedDate,processingState`);
  const att = b.d?.data;
  ligne(att ? `  attaché à la version : build ${att.attributes.version} (${att.attributes.processingState})`
            : `  AUCUN build attaché à la version ${enCours.attributes.versionString}`);
}
const tous = await api(`/v1/builds?filter[app]=${APP}&limit=8&sort=-uploadedDate&fields[builds]=version,uploadedDate,processingState,expired`);
for (const b of tous.d?.data ?? []) {
  const a = b.attributes;
  ligne(`  reçu : build ${a.version} — ${a.processingState}${a.expired ? " (expiré)" : ""} — ${String(a.uploadedDate).slice(0, 16).replace("T", " ")}`);
}

// ── Les achats intégrés ───────────────────────────────────────────────────────────────────────
titre("Achats intégrés");
const iaps = await api(`/v1/apps/${APP}/inAppPurchasesV2?limit=10&fields[inAppPurchases]=name,productId,state,inAppPurchaseType`);
for (const p of iaps.d?.data ?? []) {
  ligne(`  ${p.attributes.productId} — ${p.attributes.state}`);
}
if (!(iaps.d?.data ?? []).length) ligne(`  aucun achat lu (${iaps.statut})`);

// ── Ce qu'Apple attend encore ─────────────────────────────────────────────────────────────────
titre("Ce qui reste");
if (enCours) {
  const etat = enCours.attributes.appStoreState;
  const b = await api(`/v1/appStoreVersions/${enCours.id}/build`);
  const aBuild = !!b.d?.data;
  const prets = (iaps.d?.data ?? []).filter((p) => p.attributes.state === "READY_TO_SUBMIT").length;
  if (!aBuild) ligne("  ⚠ rattacher un build à la version");
  if (etat === "REJECTED") ligne("  ⚠ la version est REJECTED : répondre au centre de résolution");
  if (etat === "PREPARE_FOR_SUBMISSION" && aBuild)
    ligne(`  → la version est prête à être soumise, AVEC les ${prets} Pass : un premier achat intégré ne se soumet jamais seul`);
  if (etat === "WAITING_FOR_REVIEW" || etat === "IN_REVIEW") ligne("  rien à faire : Apple relit");
}
ligne("");
