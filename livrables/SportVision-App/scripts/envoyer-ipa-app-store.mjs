// Déposer l'IPA chez Apple, attendre qu'il soit traité, et le rattacher à la version (28/09/2026).
//
// POURQUOI CE SCRIPT EXISTE. Les trois premiers dépôts ont été faits à la main, et le troisième a
// montré ce que ça coûte : le build 14 est arrivé chez Apple, VALID, pendant que la version
// continuait de pointer sur le build 13. Rien ne le signale dans App Store Connect — la version
// affiche simplement un build, et il faut penser à regarder LEQUEL. Une soumission serait partie
// avec le mauvais binaire.
//
// Les trois étapes vont donc ensemble, dans cet ordre, et la dernière est celle qu'on oublie.
//
//   node livrables/SportVision-App/scripts/envoyer-ipa-app-store.mjs [chemin de l'ipa]
//
// La clé doit être dans ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8 : c'est là que
// `altool` la cherche, et il ne dit pas clairement quand il ne la trouve pas.
//
// IL NE SOUMET RIEN. Rattacher n'est pas soumettre : la soumission emporte les achats intégrés et
// reste un geste volontaire, fait depuis App Store Connect.

import { readFileSync, existsSync } from "node:fs";
import { createSign } from "node:crypto";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const APP = "6815006638";
const KEY_ID = "M3MM5D8353";
const ISSUER = "299e1e5e-6b69-4964-bf18-b3d9a83ee98a";
const RACINE = new URL("../", import.meta.url).pathname;
const ipa = process.argv[2] || join(RACINE, "build", "SportVision.ipa");

if (!existsSync(ipa)) {
  console.error(`Aucune archive à ${ipa}. Construire d'abord : bash scripts/construire.sh ios`);
  process.exit(1);
}

// Le numéro qu'on vient de construire, lu dans app.json : c'est lui qu'on attendra chez Apple.
const attendu = JSON.parse(readFileSync(join(RACINE, "app.json"), "utf8")).expo.ios.buildNumber;

const b64url = (b) => Buffer.from(b).toString("base64url");
function jeton() {
  const pem = readFileSync(join(homedir(), "Documents", `AuthKey_${KEY_ID}.p8`), "utf8");
  const now = Math.floor(Date.now() / 1000);
  const e = b64url(JSON.stringify({ alg: "ES256", kid: KEY_ID, typ: "JWT" }));
  const c = b64url(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 900, aud: "appstoreconnect-v1" }));
  const s = createSign("SHA256");
  s.update(`${e}.${c}`);
  // DER par défaut côté Node ; un JWT ES256 veut r||s. Sinon Apple répond 401 sans rien dire.
  return `${e}.${c}.${s.sign({ key: pem, dsaEncoding: "ieee-p1363" }, "base64url")}`;
}
const api = async (methode, chemin, corps) => {
  const r = await fetch("https://api.appstoreconnect.apple.com" + chemin, {
    method: methode,
    headers: { Authorization: `Bearer ${jeton()}`, "Content-Type": "application/json" },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const t = await r.text();
  try { return { statut: r.status, d: t ? JSON.parse(t) : null }; } catch { return { statut: r.status, d: t }; }
};

// ── 1. Le dépôt ───────────────────────────────────────────────────────────────────────────────
console.log(`Dépôt du build ${attendu} (${ipa})…`);
try {
  const { stdout } = await execFileP("xcrun", [
    "altool", "--upload-app", "-f", ipa, "-t", "ios",
    "--apiKey", KEY_ID, "--apiIssuer", ISSUER,
  ], { maxBuffer: 10 * 1024 * 1024 });
  console.log("  " + stdout.trim().split("\n").slice(-2).join(" "));
} catch (e) {
  const sortie = `${e.stdout || ""}${e.stderr || ""}`;
  // Un numéro déjà pris est l'erreur la plus fréquente, et son message ne le dit pas franchement.
  if (/already been used|redundant/i.test(sortie))
    console.error(`  Apple a déjà reçu un build ${attendu}. Incrémenter expo.ios.buildNumber dans app.json et reconstruire.`);
  else console.error("  " + sortie.trim().slice(0, 900));
  process.exit(1);
}

// ── 2. L'attente ──────────────────────────────────────────────────────────────────────────────
//
// Apple accepte l'archive bien avant de l'avoir traitée : pendant quelques minutes, le build
// n'existe tout simplement pas pour l'API. On interroge jusqu'à VALID plutôt que de deviner.
console.log("Traitement par Apple (quelques minutes)…");
let build = null;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 30000));
  const r = await api("GET", `/v1/builds?filter[app]=${APP}&limit=5&sort=-uploadedDate&fields[builds]=version,processingState`);
  build = (r.d?.data ?? []).find((b) => b.attributes.version === String(attendu));
  const etat = build?.attributes?.processingState;
  process.stdout.write(`\r  ${etat ? `build ${attendu} : ${etat}` : "pas encore visible"}          `);
  if (etat === "VALID") break;
  if (etat === "INVALID" || etat === "FAILED") {
    console.error(`\n  Apple refuse le build ${attendu} (${etat}). Le détail arrive par e-mail.`);
    process.exit(1);
  }
}
console.log("");
if (build?.attributes?.processingState !== "VALID") {
  console.error(`  Le build ${attendu} n'est pas VALID après 20 minutes. Relancer le rattachement plus tard.`);
  process.exit(1);
}

// ── 3. Le rattachement, l'étape qu'on oublie ──────────────────────────────────────────────────
const vers = await api("GET", `/v1/apps/${APP}/appStoreVersions?limit=1&fields[appStoreVersions]=versionString,appStoreState`);
const v = vers.d?.data?.[0];
if (!v) { console.error("  Aucune version en préparation."); process.exit(1); }

const avant = await api("GET", `/v1/appStoreVersions/${v.id}/build?fields[builds]=version`);
const rep = await api("PATCH", `/v1/appStoreVersions/${v.id}/relationships/build`,
  { data: { type: "builds", id: build.id } });
if (rep.statut >= 300) {
  console.error(`  Rattachement refusé (${rep.statut}) : ${JSON.stringify(rep.d).slice(0, 300)}`);
  process.exit(1);
}
console.log(`\nVersion ${v.attributes.versionString} (${v.attributes.appStoreState}) : build ${avant.d?.data?.attributes?.version ?? "aucun"} → ${attendu}`);
console.log("Reste la soumission, qui doit emporter les deux Pass avec la version.");
