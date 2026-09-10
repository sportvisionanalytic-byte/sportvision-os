// Smoke-test des deux ecrans touches par le deplacement de l'adresse, sur le site DEPLOYE.
//
// L'adresse du domicile a quitte `profiles` pour `collaborateur_coordonnees` (audit du
// 10/09/2026). Trois ecrans lisaient ou ecrivaient ces champs : Reglages (soi-meme), la fiche
// Collaborateur et sa modale de modification (administration). Une migration verte ne prouve rien
// sur eux : il faut ouvrir les ecrans.
//
// Le test fait le tour complet — lire, modifier, enregistrer, recharger, verifier que la valeur a
// tenu — parce que le risque reel n'est pas l'affichage, c'est un enregistrement qui echoue en
// silence ou qui ecrit au mauvais endroit.

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../../../.env", import.meta.url).pathname, "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const SB = env.SUPABASE_URL, KEY = env.SUPABASE_SECRET_KEY;
const OS = "https://bc6m3cgdz.sportvision-an.fr/SportVision-OS-Full.html";
const admin = { apikey: KEY, Authorization: `Bearer ${KEY}` };

let ok = 0, ko = 0;
const t = (nom, cond, detail = "") => {
  if (cond) { ok++; console.log(`  ok   ${nom}`); }
  else { ko++; console.log(`  KO   ${nom}${detail ? "\n       " + detail : ""}`); }
};

const prof = (await (await fetch(`${SB}/rest/v1/profiles?select=id,prenom,nom&role=eq.admin&limit=1`, { headers: admin })).json())[0];
const email = (await (await fetch(`${SB}/auth/v1/admin/users/${prof.id}`, { headers: admin })).json()).email;
const lien = (await (await fetch(`${SB}/auth/v1/admin/generate_link`, {
  method: "POST", headers: { ...admin, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email, options: { redirect_to: OS } }),
})).json()).action_link;

const navigateur = await chromium.launch();
const page = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const erreurs = [];
page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 160)));
page.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text().slice(0, 160)); });

console.log(`\nCompte : ${prof.prenom} ${prof.nom} (${email})`);
await page.goto(lien, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

const connecte = await page.evaluate(() => !!localStorage.getItem("sv_tok"));
t("connexion aboutie sur l'OS deploye", connecte);
if (!connecte) { await navigateur.close(); process.exit(1); }

const version = await (await fetch("https://bc6m3cgdz.sportvision-an.fr/version.json")).json();
console.log(`Version servie : ${version.commit} (${version.date})`);

// ── Ecran Reglages : lire, ecrire, recharger ────────────────────────────────
const marqueur = `ZZ ${Date.now()} avenue du Test`;
await page.evaluate(() => window.switchView && window.switchView("settings"));
await page.waitForTimeout(3500);

t("l'ecran Reglages affiche le champ Adresse", await page.locator("#set-adresse").count() > 0);
await page.fill("#set-adresse", marqueur);
await page.fill("#set-cp", "12345");
await page.evaluate(() => window.saveSettings && window.saveSettings());
await page.waitForTimeout(4000);

const msg = await page.locator("#set-err").textContent().catch(() => "");
t("l'enregistrement ne signale aucune erreur", !/erreur|impossible|pas pu/i.test(msg || ""), `message affiche : « ${msg} »`);

// La verite est en base, pas dans le message a l'ecran.
const range = await (await fetch(`${SB}/rest/v1/collaborateur_coordonnees?select=adresse,code_postal&collaborateur_id=eq.${prof.id}`, { headers: admin })).json();
t("l'adresse est bien rangee dans collaborateur_coordonnees", range?.[0]?.adresse === marqueur, JSON.stringify(range?.[0] || {}));
const surProfil = await (await fetch(`${SB}/rest/v1/profiles?select=adresse,code_postal&id=eq.${prof.id}`, { headers: admin })).json();
t("elle n'est PAS retombee sur profiles", !((surProfil?.[0]?.adresse || "").trim()), JSON.stringify(surProfil?.[0] || {}));

// Rechargement : l'ecran doit relire la valeur depuis sa nouvelle table.
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
await page.evaluate(() => window.switchView && window.switchView("settings"));
await page.waitForTimeout(3500);
t("apres rechargement, l'ecran reaffiche l'adresse enregistree",
  (await page.inputValue("#set-adresse").catch(() => "")) === marqueur,
  `lu : « ${await page.inputValue("#set-adresse").catch(() => "")} »`);

// ── Ecran Collaborateurs et fiche ───────────────────────────────────────────
await page.evaluate(() => window.switchView && window.switchView("equipehub"));
await page.waitForTimeout(4500);
const cartes = await page.locator('[onclick^="modalFicheCollaborateur"]').count();
t("l'ecran Collaborateurs affiche des fiches", cartes > 0, `${cartes} carte(s)`);

await page.evaluate((id) => window.modalFicheCollaborateur && window.modalFicheCollaborateur(id), prof.id);
await page.waitForTimeout(4500);
const fiche = await page.locator("#sv-modal-ct").textContent().catch(() => "");
t("la fiche collaborateur s'ouvre", (fiche || "").length > 100, `${(fiche || "").length} caracteres`);
t("la fiche montre l'adresse a l'administration", (fiche || "").includes(marqueur),
  (fiche || "").includes("Adresse") ? "ligne Adresse presente mais valeur absente" : "aucune ligne Adresse");

// ── Etat general ────────────────────────────────────────────────────────────
const vraiesErreurs = erreurs.filter((e) => !/favicon|Failed to load resource: the server responded with a status of 40[34]/i.test(e));
t("aucune erreur JavaScript sur le parcours", vraiesErreurs.length === 0, vraiesErreurs.slice(0, 4).join("\n       "));

// Nettoyage : on ne laisse pas l'adresse fabriquee sur un vrai compte.
await fetch(`${SB}/rest/v1/collaborateur_coordonnees?collaborateur_id=eq.${prof.id}`, { method: "DELETE", headers: admin });

await navigateur.close();
console.log(`\n${ok}/${ok + ko} verifications passees.`);
process.exit(ko ? 1 : 0);
