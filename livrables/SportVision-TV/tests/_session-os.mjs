// Ouvrir l'OS deploye dans un vrai navigateur, avec l'identite d'un vrai compte.
//
// POURQUOI CE MODULE. L'OS ne consomme un fragment d'URL que pour `type=recovery` et
// `type=invite` (voir consumeRecoveryHashOS). Un lien `magiclink` atterrit donc sur l'ecran de
// connexion sans un mot, session vide — mesure faite le 10/09/2026. Et consommer un vrai lien de
// recuperation pour un test invaliderait celui d'une personne : c'est exactement l'erreur commise
// le 09/09, qui a coute une matinee a une recrue.
//
// On recupere donc le jeton par l'API, sans jamais charger l'OS avec, puis on seme la session
// AVANT le chargement de la page — addInitScript s'execute avant les scripts du document, donc
// l'OS demarre deja connecte, comme apres une vraie connexion.

import { readFileSync } from "node:fs";

export const env = Object.fromEntries(
  readFileSync(new URL("../../../.env", import.meta.url).pathname, "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

export const SB = env.SUPABASE_URL;
export const KEY = env.SUPABASE_SECRET_KEY;
export const ANON = env.SUPABASE_ANON_KEY;
export const OS = "https://bc6m3cgdz.sportvision-an.fr/SportVision-OS-Full.html";
export const enTeteAdmin = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// Resout un compte reel par son role. `filtre` est un fragment de requete PostgREST
// (ex. "role=eq.photo&prenom=eq.c"). On ne code jamais d'UUID en dur : trois identifiants figes
// dans l'ancienne matrice d'acces pointaient vers des comptes supprimes, et le test mesurait le
// vide sans que rien ne le signale.
export async function compte(filtre) {
  const r = await fetch(`${SB}/rest/v1/profiles?select=id,prenom,nom,role&${filtre}&limit=1`, { headers: enTeteAdmin });
  const p = (await r.json())[0];
  if (!p) return null;
  const u = await (await fetch(`${SB}/auth/v1/admin/users/${p.id}`, { headers: enTeteAdmin })).json();
  return { ...p, email: u.email };
}

// Un vrai jeton d'acces, obtenu sans charger l'OS.
export async function jeton(email) {
  const lien = (await (await fetch(`${SB}/auth/v1/admin/generate_link`, {
    method: "POST", headers: { ...enTeteAdmin, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email, redirect_to: OS }),
  })).json()).action_link;
  if (!lien) return null;
  const loc = (await fetch(lien, { redirect: "manual" })).headers.get("location") || "";
  const p = new URLSearchParams(loc.split("#")[1] || "");
  const acces = p.get("access_token");
  return acces ? { acces, rafraichissement: p.get("refresh_token") || "" } : null;
}

// Ouvre l'OS deja connecte. Rend { page, erreurs } — `erreurs` se remplit tout seul.
export async function ouvrirOS(navigateur, personne, { largeur = 1440, hauteur = 900 } = {}) {
  const j = await jeton(personne.email);
  if (!j) throw new Error(`jeton impossible a obtenir pour ${personne.email}`);

  const contexte = await navigateur.newContext({ viewport: { width: largeur, height: hauteur } });
  const page = await contexte.newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 180)));
  page.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text().slice(0, 180)); });

  await page.addInitScript((s) => {
    localStorage.setItem("sv_tok", s.tok);
    localStorage.setItem("sv_ref", s.ref);
    localStorage.setItem("sv_uid", s.uid);
    localStorage.setItem("sv_role", s.role);
    localStorage.setItem("sv_prenom", s.prenom);
  }, { tok: j.acces, ref: j.rafraichissement, uid: personne.id, role: personne.role, prenom: personne.prenom || "" });

  await page.goto(OS, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  return { page, erreurs, jeton: j.acces };
}

// Les 404 de favicon et les avertissements d'extension ne disent rien sur l'application.
export const vraiesErreurs = (l) =>
  l.filter((e) => !/favicon|status of 40[34]|Download the React DevTools/i.test(e));

export function rapporteur() {
  let ok = 0, ko = 0;
  const t = (nom, cond, detail = "") => {
    if (cond) { ok++; console.log(`  ok   ${nom}`); }
    else { ko++; console.log(`  KO   ${nom}${detail ? "\n       " + detail : ""}`); }
  };
  return { t, bilan: () => { console.log(`\n${ok}/${ok + ko} verifications passees.`); return ko; } };
}
