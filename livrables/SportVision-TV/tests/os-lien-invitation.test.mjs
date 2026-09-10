// Une recrue qui clique son lien d'invitation doit arriver sur SON compte.
//
// INCIDENT DU 09/09/2026, remonte par Fouka : « des photographes se sont connectes, ils
// arrivent sur d'autres profils ». Plusieurs comptes venaient d'etre crees.
//
// Cause : consumeRecoveryHashOS() lisait `profiles` SANS FILTRE et gardait `profs[0]`. Un
// collaborateur voit les profils de toute l'equipe — 17 lignes mesurees pour un photographe —
// et l'ordre d'un SELECT sans ORDER BY est arbitraire. Chaque recrue etait donc connectee sous
// l'identite ET le role d'un collegue tire au sort.
//
// Le chemin de connexion normal (email + mot de passe) filtrait deja par id, d'ou le fait que
// le probleme ne se manifestait QUE sur les invitations et les reinitialisations de mot de
// passe — les deux moments ou une personne decouvre son compte.
//
// Ce test rejoue la situation exacte du terrain : un navigateur ou un collegue etait deja
// connecte, et un vrai jeton d'invitation dans l'URL.
//
// Il a besoin de SUPABASE_URL et SUPABASE_SECRET_KEY (fichier .env a la racine du workspace)
// pour fabriquer un vrai jeton. Sans eux, il s'arrete proprement plutot que de faire semblant.

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../../../.env", import.meta.url).pathname, "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const SB = env.SUPABASE_URL, KEY = env.SUPABASE_SECRET_KEY;
if (!SB || !KEY) {
  console.log("SUPABASE_URL / SUPABASE_SECRET_KEY absents — test ignore.");
  process.exit(0);
}

// Deux comptes : celui qui recoit le lien, et celui dont la session traine deja dans le navigateur.
//
// Le compte qui recoit le lien est le compte photographe de TEST de Fouka (prenom « c »). Jusqu'au
// 10/09/2026, c'etait le plus ancien photographe actif — une vraie personne, sur qui chaque passage
// du test fabriquait un lien de connexion. Or fabriquer un lien sur le compte d'un collegue peut
// invalider celui qu'il attend : c'est ainsi qu'Emile a perdu le sien le 09/09. L'occupant, lui,
// n'est jamais touche : seuls son identifiant et son role sont poses dans le navigateur.
const enTete = { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } };
const invite = (await (await fetch(`${SB}/rest/v1/profiles?select=id,prenom,role&role=eq.photo&prenom=eq.c&limit=1`, enTete)).json())[0];
const occupant = (await (await fetch(`${SB}/rest/v1/profiles?select=id,prenom,role&role=eq.photo&actif=is.true&prenom=neq.c&order=created_at.asc&limit=1`, enTete)).json())[0];
if (!invite || !occupant) {
  console.log("Compte de test ou collegue introuvable — test ignore.");
  process.exit(0);
}

// Un vrai lien, comme celui que recoit une recrue.
const rl = await fetch(`${SB}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email: (await (await fetch(`${SB}/auth/v1/admin/users/${invite.id}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })).json()).email }),
});
const lien = (await rl.json()).action_link;
const loc = (await fetch(lien, { redirect: "manual" })).headers.get("location") || "";
const hash = loc.includes("#") ? loc.slice(loc.indexOf("#")).replace("type=magiclink", "type=invite") : "";
if (!hash.includes("access_token")) {
  console.log("Impossible de fabriquer un jeton — test ignore.");
  process.exit(0);
}

const html = readFileSync(new URL("../SportVision-OS-Full.html", import.meta.url).pathname, "utf8");
const srv = createServer((q, r) => r.writeHead(200, { "content-type": "text/html" }).end(html));
await new Promise((r) => srv.listen(0, r));
const nav = await chromium.launch();
const page = await nav.newPage();
const erreursJs = [];
page.on("pageerror", (e) => { const m = String(e).split("\n")[0]; if (!/ServiceWorker/i.test(m)) erreursJs.push(m); });

// La session du collegue est semee AVANT que le moindre script de la page ne tourne : c'est
// la situation reelle, et la seule facon de mesurer si la recrue en herite.
await page.addInitScript(([uid, role, prenom]) => {
  localStorage.setItem("sv_uid", uid);
  localStorage.setItem("sv_tok", "ancien-jeton-invalide");
  localStorage.setItem("sv_role", role);
  localStorage.setItem("sv_prenom", prenom);
}, [occupant.id, "admin", occupant.prenom || "Collegue"]);

await page.goto(`http://localhost:${srv.address().port}/${hash}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
const etat = await page.evaluate(() => ({
  uid: localStorage.getItem("sv_uid"), role: localStorage.getItem("sv_role"),
  prenom: localStorage.getItem("sv_prenom"), hash: location.hash,
}));

let ok = 0, ko = 0;
const t = (nom, cond, detail = "") => {
  if (cond) { ok++; console.log(`  ok   ${nom}`); }
  else { ko++; console.log(`  KO   ${nom}${detail ? " — " + detail : ""}`); }
};

console.log(`\nInvitation de ${invite.prenom} (${invite.id.slice(0, 8)}), session en place : ${occupant.prenom} (${occupant.id.slice(0, 8)})`);
t("la recrue arrive sur SON compte", etat.uid === invite.id, `identite obtenue : ${etat.uid}`);
t("elle n'herite pas de l'identite du collegue", etat.uid !== occupant.id);
t("elle n'herite pas du role du collegue", etat.role !== "admin", `role obtenu : ${etat.role}`);
t("le role est bien le sien", etat.role === invite.role, `attendu ${invite.role}, obtenu ${etat.role}`);
t("le prenom affiche est le sien", (etat.prenom || "") !== (occupant.prenom || ""), `prenom : ${etat.prenom}`);
t("le jeton est retire de l'URL", etat.hash === "", etat.hash.slice(0, 30));
t("aucune erreur JavaScript", erreursJs.length === 0, erreursJs.join(" / "));

// Une INVITATION doit ouvrir la fenetre « Definir un nouveau mot de passe » : la recrue n'en a pas
// encore. C'est ce que le lien magique, lui, ne doit pas faire (ci-dessous).
t("l'invitation ouvre la fenetre de mot de passe", await page.locator("#rec-pass1").count() > 0);

// ── Le lien magique (accepte depuis le 10/09/2026) ─────────────────────────
// Meme jeton, type conserve. Il doit faire ENTRER dans l'OS sans passer par la fenetre du mot de
// passe — l'imposer ferait croire a la personne que le sien a ete perdu.
const rl2 = await fetch(`${SB}/auth/v1/admin/generate_link`, {
  method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email: (await (await fetch(`${SB}/auth/v1/admin/users/${invite.id}`, enTete)).json()).email }),
});
const loc2 = (await fetch((await rl2.json()).action_link, { redirect: "manual" })).headers.get("location") || "";
const hashMagique = loc2.includes("#") ? loc2.slice(loc2.indexOf("#")) : "";
const page2 = await nav.newPage();
await page2.addInitScript(([uid, role, prenom]) => {
  localStorage.setItem("sv_uid", uid); localStorage.setItem("sv_tok", "ancien-jeton-invalide");
  localStorage.setItem("sv_role", role); localStorage.setItem("sv_prenom", prenom);
}, [occupant.id, "admin", occupant.prenom || "Collegue"]);
await page2.goto(`http://localhost:${srv.address().port}/${hashMagique}`, { waitUntil: "domcontentloaded" });
await page2.waitForTimeout(6000);
const etat2 = await page2.evaluate(() => ({ uid: localStorage.getItem("sv_uid"), role: localStorage.getItem("sv_role"),
  ecran: [...document.querySelectorAll(".scr.on")].map((e) => e.id).join(","), hash: location.hash }));
t("lien magique : la personne arrive sur SON compte", etat2.uid === invite.id, `identite obtenue : ${etat2.uid}`);
t("lien magique : pas le role du collegue", etat2.role === invite.role, `role obtenu : ${etat2.role}`);
t("lien magique : elle entre directement dans l'OS", etat2.ecran === "s-app", `ecran : ${etat2.ecran}`);
t("lien magique : sans fenetre de mot de passe", await page2.locator("#rec-pass1").count() === 0);
t("lien magique : le jeton est retire de l'URL", etat2.hash === "", etat2.hash.slice(0, 30));

console.log(`\n${ok}/${ok + ko} verifications passees.`);
await nav.close();
srv.close();
process.exit(ko ? 1 : 0);
