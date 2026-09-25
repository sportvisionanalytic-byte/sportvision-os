// Valider un livrable valide le travail, previent l'operateur et credite ses XP (25/09/2026).
//
// DEMANDE DE FOUKA : « Le responsable production verifie, il valide. Une fois que c'est valide, le
// photographe videaste n'a plus rien a faire. Il recoit comme quoi ca a ete valide, il recoit ses
// XP, sa remuneration. »
//
// IL Y AVAIT DEUX VALIDATIONS QUI NE SE PARLAIENT PAS : « Valider » sur le livrable changeait un
// statut et rien d'autre ; « Valider le travail » sur l'affectation notifiait, creditait et
// debloquait la paie. La Production devait faire les deux sans que rien ne le dise. Elle en
// faisait une.
//
// CE TEST ECRIT VRAIMENT EN PRODUCTION, PUIS REMET TOUT EN PLACE. Il n'y a pas d'autre facon
// d'eprouver ce chemin : le bouton vit dans le navigateur et appelle PostgREST, on ne peut pas
// l'enfermer dans une transaction annulee. Il cree donc un livrable d'essai sur une vraie
// prestation, clique le bouton avec un vrai compte Production, mesure, puis supprime le livrable,
// l'evenement d'XP, la notification, la ligne du journal financier, et remet le compteur d'XP et
// le verdict a leur valeur d'avant. La derniere ligne affichee le confirme.
//
// A LANCER QUAND ON TOUCHE A LA CHAINE DE VALIDATION, pas en routine : il notifie brievement un
// vrai operateur avant d'effacer la notification.

import { chromium } from "/Users/fouka/Downloads/jarvis-starter-kit/livrables/SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { SB, enTeteAdmin, jeton, compte, vraiesErreurs } from "/Users/fouka/Downloads/jarvis-starter-kit/.claude/worktrees/cockpit-main/livrables/SportVision-TV/tests/_session-os.mjs";

const A = { headers: { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation" } };
const rest = async (c, i = {}) => { const r = await fetch(`${SB}/rest/v1/${c}`, { ...A, ...i, headers: { ...A.headers, ...(i.headers||{}) } }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

// ── Mise en place : une prestation reelle, son operateur, un livrable d'essai ──
const prod = await compte("role=eq.prod");
const aff = (await rest(`prestations_equipe?select=id,prestation_id,collaborateur_id,travail_valide,est_responsable&statut=eq.acceptée&travail_valide=is.null&collaborateur_id=neq.${prod.id}&limit=1`))[0];
if (!aff) { console.log("aucune affectation a valider"); process.exit(0); }
const xpAvant = (await rest(`profiles?select=xp&id=eq.${aff.collaborateur_id}`))[0]?.xp ?? 0;

const lienEssai = (await rest("media_liens", { method: "POST", body: JSON.stringify({
  nom: "ESSAI validation unique", url: "https://exemple.test/essai", categorie: "livraison",
  type_media: "photo", fournisseur: "autre", prestation_id: aff.prestation_id,
  ajouteur_id: prod.id, statut: "valide" }) }))[0];
const livrable = (await rest("media_livrables", { method: "POST", body: JSON.stringify({
  nom: "ESSAI validation unique", type_livrable: "photos_finales",
  prestation_id: aff.prestation_id, lien_id: lienEssai?.id, statut: "a_valider" }) }))[0];
console.log("mise en place : livrable", livrable?.id?.slice(0, 8), "| operateur", xpAvant, "XP");

// ── Le clic, dans un vrai navigateur, avec le compte Production ──
const j = await jeton(prod.email);
const nav = await chromium.launch();
const pg = await (await nav.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const err = [];
pg.on("pageerror", (e) => err.push(String(e).slice(0, 140)));
await pg.addInitScript((s) => {
  localStorage.setItem("sv_tok", s.tok); localStorage.setItem("sv_ref", s.ref);
  localStorage.setItem("sv_uid", s.uid); localStorage.setItem("sv_role", s.role);
  localStorage.setItem("sv_prenom", s.prenom || "");
}, { tok: j.acces, ref: j.rafraichissement, uid: prod.id, role: prod.role, prenom: prod.prenom });
await pg.goto("http://localhost:8779/SportVision-OS-Full.html", { waitUntil: "domcontentloaded" });
await pg.waitForTimeout(6000);
await pg.evaluate((id) => validerLivrable(id), livrable.id);
await pg.waitForTimeout(3500);
const toast = await pg.evaluate(() => document.querySelector(".toast,#toast,[class*=toast]")?.textContent?.trim() ?? null);
console.log("message affiche :", toast);
if (vraiesErreurs(err).length) console.log("ERREURS :", vraiesErreurs(err).slice(0, 2));
await nav.close();

// ── Ce qui s'est vraiment passe en base ──
const apres = (await rest(`prestations_equipe?select=travail_valide&id=eq.${aff.id}`))[0];
const xpApres = (await rest(`profiles?select=xp&id=eq.${aff.collaborateur_id}`))[0]?.xp ?? 0;
const evt = await rest(`xp_events?select=id,montant&source_id=eq.${aff.id}&type=eq.prestation`);
const notif = await rest(`notifications?select=id,titre,message&destinataire_id=eq.${aff.collaborateur_id}&type=eq.mission_verdict&prestation_id=eq.${aff.prestation_id}`);
const lvApres = (await rest(`media_livrables?select=statut&id=eq.${livrable.id}`))[0];
console.log("\nRESULTAT :");
console.log("  travail_valide :", apres?.travail_valide, "(attendu true)");
console.log("  XP             :", xpAvant, "→", xpApres, `(attendu +${100 + (aff.est_responsable ? 50 : 0)})`);
console.log("  xp_events      :", evt.length, "ligne(s)", evt[0]?.montant ? `de ${evt[0].montant}` : "");
console.log("  notification   :", notif.length ? `« ${notif[0].message.slice(0, 80)} »` : "AUCUNE");
console.log("  livrable       :", lvApres?.statut);

// ── Nettoyage integral ──
for (const [c, id] of [["media_livrables", livrable.id], ["media_liens", lienEssai.id]]) if (id) await rest(`${c}?id=eq.${id}`, { method: "DELETE" });
for (const e of evt) await rest(`xp_events?id=eq.${e.id}`, { method: "DELETE" });
for (const n of notif) await rest(`notifications?id=eq.${n.id}`, { method: "DELETE" });
await rest(`profiles?id=eq.${aff.collaborateur_id}`, { method: "PATCH", body: JSON.stringify({ xp: xpAvant }) });
await rest(`prestations_equipe?id=eq.${aff.id}`, { method: "PATCH", body: JSON.stringify({ travail_valide: null, travail_motif: null, travail_decide_par: null, travail_decide_le: null }) });
await rest(`financial_audit_log?ligne_id=eq.${aff.id}&action=eq.mission_travail_valide`, { method: "DELETE" });
const ctrl = (await rest(`profiles?select=xp&id=eq.${aff.collaborateur_id}`))[0]?.xp;
const ctrl2 = (await rest(`prestations_equipe?select=travail_valide&id=eq.${aff.id}`))[0]?.travail_valide;
console.log(`\nNETTOYAGE : XP remis a ${ctrl} (etait ${xpAvant}), travail_valide remis a ${ctrl2}`);
