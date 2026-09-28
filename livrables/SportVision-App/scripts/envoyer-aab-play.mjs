// Envoyer l'AAB sur la piste de test interne, par l'API Google Play.
//
// Pourquoi par l'API plutot que par la console : le compte de service repond deja, et un envoi
// manuel de 81 Mo dans un navigateur est exactement le genre d'etape qu'on refait trois fois.
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

// LA CLÉ N'EST PAS DANS LE DÉPÔT, et son emplacement non plus. Chrome télécharge sur un disque
// externe chez Fouka ; coder ce chemin en dur ferait échouer le script sur toute autre machine, et
// inscrirait dans Git où vit un secret. On la passe en argument, ou par GOOGLE_PLAY_KEY.
const CLE = process.argv[2] || process.env.GOOGLE_PLAY_KEY || "";
if (!CLE) {
  console.error(`Il manque le chemin de la clé du compte de service Google Play.

  node ${process.argv[1].split("/").pop()} /chemin/vers/sportvision-play-xxxx.json

ou bien : export GOOGLE_PLAY_KEY=/chemin/vers/la/cle.json

Cette clé est téléchargée une seule fois depuis Google Cloud. Ne la mets jamais dans Git.`);
  process.exit(1);
}
const PAQUET = "build/SportVision.aab";
const APP = "fr.sportvision.app";
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${APP}`;

const d = JSON.parse(readFileSync(CLE, "utf8"));
const b = (x) => Buffer.from(x).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const h = b(JSON.stringify({ alg: "RS256", typ: "JWT" }));
const p = b(JSON.stringify({
  iss: d.client_email, scope: "https://www.googleapis.com/auth/androidpublisher",
  aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
}));
const sg = createSign("SHA256"); sg.update(`${h}.${p}`);
const tok = await (await fetch("https://oauth2.googleapis.com/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${h}.${p}.${sg.sign(d.private_key, "base64url")}` }),
})).json();
const T = tok.access_token;
if (!T) { console.error("pas de jeton :", JSON.stringify(tok).slice(0, 200)); process.exit(1); }

const j = async (m, u, corps, entetes = {}) => {
  const r = await fetch(u, { method: m,
    headers: { Authorization: `Bearer ${T}`, ...entetes },
    body: corps });
  const t = await r.text();
  let o = null; try { o = t ? JSON.parse(t) : null; } catch { /* non-JSON */ }
  return { ok: r.ok, statut: r.status, o, t };
};

const edit = await j("POST", `${API}/edits`, "{}", { "Content-Type": "application/json" });
if (!edit.ok) { console.error("edition :", edit.t.slice(0, 250)); process.exit(1); }
const ID = edit.o.id;
console.log("edition ouverte :", ID);

const octets = readFileSync(PAQUET);
console.log(`envoi de ${(octets.length / 1e6).toFixed(1)} Mo…`);
const up = await j("POST",
  `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${APP}/edits/${ID}/bundles?uploadType=media`,
  octets, { "Content-Type": "application/octet-stream" });
if (!up.ok) { console.error("envoi refuse :", up.statut, up.t.slice(0, 400)); process.exit(1); }
const vc = up.o.versionCode;
console.log("paquet accepte, versionCode", vc, "| sha256", String(up.o.sha256 ?? "").slice(0, 16));

const piste = await j("PUT", `${API}/edits/${ID}/tracks/internal`,
  JSON.stringify({ track: "internal", releases: [{ versionCodes: [String(vc)], status: "completed",
    releaseNotes: [{ language: "fr-FR", text: "Achat du Pass Photo dans l'application, et écussons des clubs adverses." }] }] }),
  { "Content-Type": "application/json" });
if (!piste.ok) { console.error("piste refusee :", piste.t.slice(0, 300)); process.exit(1); }
console.log("attache a la piste interne");

const fin = await j("POST", `${API}/edits/${ID}:commit`, null);
console.log(fin.ok ? "edition validee — le paquet est en ligne sur la piste interne"
                   : `validation refusee : ${fin.t.slice(0, 300)}`);
process.exit(fin.ok ? 0 : 1);
