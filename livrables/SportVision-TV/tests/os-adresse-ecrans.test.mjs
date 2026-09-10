// Les ecrans touches par le deplacement des donnees personnelles, sur le site DEPLOYE.
//
// L'adresse du domicile a quitte `profiles` pour `collaborateur_coordonnees`, puis ville,
// vehicule et permis pour `collaborateur_logistique` (audit du 10/09/2026). Cinq ecrans lisaient
// ou ecrivaient ces champs. Une migration verte ne prouve rien sur eux : il faut les ouvrir.
//
// Le test fait le tour complet — lire, modifier, enregistrer, RECHARGER, verifier que la valeur a
// tenu — parce que le risque reel n'est pas l'affichage : c'est un enregistrement qui echoue en
// silence, ou qui ecrit au mauvais endroit. Le « ca n'enregistre pas » de Villemomble venait
// justement de l'ecran et non de la base.
//
// Il verifie aussi l'envers : qu'un photographe ne recupere plus la ville ni l'adresse d'un
// collegue, par l'API, avec son propre jeton.

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { SB, ANON, enTeteAdmin, compte, jeton, ouvrirOS, vraiesErreurs, rapporteur } from "./_session-os.mjs";

const { t, bilan } = rapporteur();

const admin = await compte("role=eq.admin");
if (!admin) { console.log("Aucun compte admin — test ignore."); process.exit(0); }
console.log(`\nAdministration : ${admin.prenom} ${admin.nom} (${admin.email})`);

const navigateur = await chromium.launch();
const { page, erreurs } = await ouvrirOS(navigateur, admin);

const version = await (await fetch("https://bc6m3cgdz.sportvision-an.fr/version.json")).json();
console.log(`Version servie : ${version.commit}\n`);

t("l'OS demarre connecte", await page.evaluate(() => !!localStorage.getItem("sv_tok")));

// ── Reglages : lire, ecrire, recharger ──────────────────────────────────────
const marqueur = `ZZ ${Date.now()} avenue du Test`;
const villeMarqueur = `ZZ Ville ${Date.now() % 100000}`;
await page.evaluate(() => window.switchView && window.switchView("set"));
await page.waitForTimeout(4000);

t("l'ecran Reglages s'affiche avec ses champs", await page.locator("#set-adresse").count() > 0 && await page.locator("#set-ville").count() > 0);

await page.fill("#set-adresse", marqueur);
await page.fill("#set-cp", "12345");
await page.fill("#set-ville", villeMarqueur);
// La fonction s'appelle sauvegarderProfil(uid) et prend l'identifiant en argument. Premiere
// version de ce test : elle appelait window.saveSettings(), qui n'existe pas — donc rien ne
// s'enregistrait, aucune erreur ne s'affichait, et le test accusait l'application a tort.
await page.evaluate((id) => window.sauvegarderProfil && window.sauvegarderProfil(id), admin.id);
await page.waitForTimeout(5000);

const msg = (await page.locator("#set-err").textContent().catch(() => "")) || "";
t("l'enregistrement ne signale aucune erreur", !/erreur|impossible|pas pu/i.test(msg), `message affiche : « ${msg} »`);

// La verite est en base, jamais dans le message a l'ecran.
const coord = await (await fetch(`${SB}/rest/v1/collaborateur_coordonnees?select=adresse&collaborateur_id=eq.${admin.id}`, { headers: enTeteAdmin })).json();
t("l'adresse est rangee dans collaborateur_coordonnees", coord?.[0]?.adresse === marqueur, JSON.stringify(coord?.[0] || {}));

const logi = await (await fetch(`${SB}/rest/v1/collaborateur_logistique?select=ville&collaborateur_id=eq.${admin.id}`, { headers: enTeteAdmin })).json();
t("la ville est rangee dans collaborateur_logistique", logi?.[0]?.ville === villeMarqueur, JSON.stringify(logi?.[0] || {}));

const surProfil = await (await fetch(`${SB}/rest/v1/profiles?select=adresse,code_postal,ville,vehicule,permis&id=eq.${admin.id}`, { headers: enTeteAdmin })).json();
const resteSurProfil = Object.entries(surProfil?.[0] || {}).filter(([, v]) => v !== null && v !== "" && v !== false);
t("rien n'est retombe sur profiles", resteSurProfil.length === 0, JSON.stringify(surProfil?.[0] || {}));

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await page.evaluate(() => window.switchView && window.switchView("set"));
await page.waitForTimeout(4000);
const relu = await page.inputValue("#set-adresse").catch(() => "");
const reluVille = await page.inputValue("#set-ville").catch(() => "");
t("apres rechargement, l'adresse est bien reaffichee", relu === marqueur, `lu : « ${relu} »`);
t("apres rechargement, la ville est bien reaffichee", reluVille === villeMarqueur, `lu : « ${reluVille} »`);

// ── Collaborateurs et fiche ─────────────────────────────────────────────────
await page.evaluate(() => window.switchView && window.switchView("equipehub"));
await page.waitForTimeout(5000);
t("l'ecran Collaborateurs affiche des fiches", await page.locator('[onclick^="modalFicheCollaborateur"]').count() > 0);

await page.evaluate((id) => window.modalFicheCollaborateur && window.modalFicheCollaborateur(id), admin.id);
await page.waitForTimeout(5000);
const fiche = (await page.locator("#sv-modal-ct").textContent().catch(() => "")) || "";
t("la fiche collaborateur s'ouvre", fiche.length > 100, `${fiche.length} caracteres`);
t("elle montre l'adresse a l'administration", fiche.includes(marqueur),
  fiche.includes("Adresse") ? "ligne Adresse presente, valeur absente" : "aucune ligne Adresse");
t("elle montre la ville a l'administration", fiche.includes(villeMarqueur),
  fiche.includes("Ville") ? "ligne Ville presente, valeur absente" : "aucune ligne Ville");

t("aucune erreur JavaScript sur le parcours", vraiesErreurs(erreurs).length === 0,
  vraiesErreurs(erreurs).slice(0, 4).join("\n       "));

// ── L'envers : ce qu'un photographe recupere par l'API ──────────────────────
const photo = await compte("role=eq.photo&prenom=eq.c");
if (photo) {
  const j = await jeton(photo.email);
  const lire = (chemin) => fetch(`${SB}/rest/v1/${chemin}`, { headers: { apikey: ANON, Authorization: `Bearer ${j.acces}` } });

  const p1 = await (await lire("profiles?select=id,adresse,code_postal,ville,vehicule,permis")).json();
  const fuites = (Array.isArray(p1) ? p1 : []).filter((x) => x.id !== photo.id &&
    ((x.adresse || "").trim() || (x.code_postal || "").trim() || (x.ville || "").trim() || x.vehicule || x.permis));
  t("un photographe ne lit aucune de ces donnees via profiles", fuites.length === 0,
    JSON.stringify(fuites.slice(0, 3)));

  const r2 = await lire("collaborateur_logistique?select=collaborateur_id,ville");
  const d2 = await r2.json();
  const autres = Array.isArray(d2) ? d2.filter((c) => c.collaborateur_id !== photo.id) : [];
  t("il n'atteint pas la logistique d'un collegue",
    r2.status === 200 ? autres.length === 0 : [401, 403].includes(r2.status),
    `HTTP ${r2.status} — ${autres.length} ligne(s) d'autrui`);

  const r3 = await lire("profiles?select=id,prenom,nom,role,email,telephone,avatar_url,bio&order=nom.asc");
  const d3 = await r3.json();
  t("l'annuaire interne lui repond toujours", r3.status === 200 && Array.isArray(d3) && d3.length > 1,
    `HTTP ${r3.status} — ${Array.isArray(d3) ? d3.length : 0} ligne(s)`);
}

// Nettoyage : aucune donnee fabriquee ne reste sur un vrai compte.
for (const table of ["collaborateur_coordonnees", "collaborateur_logistique"]) {
  await fetch(`${SB}/rest/v1/${table}?collaborateur_id=eq.${admin.id}`, { method: "DELETE", headers: enTeteAdmin });
}

await navigateur.close();
process.exit(bilan() ? 1 : 0);
