// Où mène le lien de l'e-mail envoyé par org-invite (décisions Club+ du 10/09/2026, n° 5).
//
// POURQUOI CE TEST. org-invite redirigeait vers `${CONNECT_URL}/index.html` : l'ancienne app
// vanilla, retirée. Plus aucun écran déployé ne l'appelle, mais elle reste déployée : son lien
// déposait l'invité sur Connect (espace personnel), pas dans l'organisation qui l'invitait, qui vit
// dans Club+. Cible retenue : /clubplus/auth/reset, le seul écran de Club+ qui lit la session du
// fragment d'URL, fait choisir un mot de passe, puis ouvre /dashboard où l'invitation se présente.
//
// Le test suit le VRAI lien d'invitation Supabase, sans envoyer d'e-mail : `generate_link` de type
// « invite » fabrique exactement le lien que contiendrait l'e-mail, pour une adresse de test.
//   1. l'adresse de retour est celle que le code du dépôt envoie (lue dans org-invite/index.ts) ;
//   2. Supabase l'accepte (sinon il renverrait en silence sur l'URL du site, c'est-à-dire Connect) ;
//   3. dans un vrai navigateur, l'écran propose de choisir son mot de passe.
//
//   node livrables/SportVision-TV/tests/org-invite-redirection.test.mjs
//
// PROPRETÉ. Une adresse zz-cp-dec-…@example.invalid, compte supprimé à la fin et vérifié.

import { readFileSync } from "node:fs";
import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { CP, vraiesErreursCP } from "./_session-clubplus.mjs";
import { rapporteur, SB, enTeteAdmin } from "./_session-os.mjs";

const { t, bilan } = rapporteur();
const T0 = Date.now();
const email = `zz-cp-dec-org-invite-${T0}@example.invalid`;
const auth = (chemin, opts = {}) =>
  fetch(`${SB}/auth/v1/${chemin}`, { ...opts, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(opts.headers || {}) } });

// 1. L'adresse de retour du code du dépôt, telle qu'elle partira en production (CLUBPLUS_URL par défaut).
const source = readFileSync(new URL("../supabase/functions/org-invite/index.ts", import.meta.url), "utf8");
const gabarit = source.match(/redirectTo:\s*`([^`]+)`/)?.[1] || "";
const retour = gabarit.replace("${clubplusUrl}", CP);
t("org-invite renvoie vers Club+ (/clubplus/auth/reset), plus vers Connect", retour === `${CP}/clubplus/auth/reset`, `gabarit : ${gabarit}`);
t("org-invite ne lit plus CONNECT_URL", !/Deno\.env\.get\("CONNECT_URL"\)/.test(source));

let userId = null;
const nav = await chromium.launch();
try {
  // 2. Le lien d'invitation réel (aucun e-mail envoyé), avec cette adresse de retour.
  const g = await (await auth("admin/generate_link", { method: "POST", body: JSON.stringify({ type: "invite", email, redirect_to: retour }) })).json();
  userId = g?.id || g?.user?.id || null;
  const lien = g?.action_link;
  t("Supabase fabrique le lien d'invitation", Boolean(lien), JSON.stringify(g).slice(0, 160));
  const loc = lien ? (await fetch(lien, { redirect: "manual" })).headers.get("location") || "" : "";
  t("Supabase accepte l'adresse de retour de Club+ (pas de repli silencieux sur l'URL du site)", loc.startsWith(`${CP}/clubplus/auth/reset#`), loc.slice(0, 120));
  t("le lien porte la session et le type « invite »", /access_token=/.test(loc) && /type=invite/.test(loc));

  // 3. Dans un vrai navigateur : l'écran de Club+ lit la session et fait choisir un mot de passe.
  if (loc.startsWith(`${CP}/clubplus/auth/reset#`)) {
    const ctx = await nav.newContext({ locale: "fr-FR" });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 200)));
    page.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text().slice(0, 200)); });
    await page.goto(loc, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7000);
    const tx = (await page.evaluate(() => document.body?.innerText || "")).replace(/\s+/g, " ");
    const champs = await page.locator("input[type=password]").count();
    t("l'invité arrive sur Club+ et peut choisir son mot de passe", page.url().startsWith(`${CP}/clubplus/auth/reset`) && champs >= 1 && !/n.est plus valide|a expiré/i.test(tx), `${page.url().slice(0, 80)} — ${tx.slice(0, 160)}`);
    t("aucune erreur JavaScript", vraiesErreursCP(erreurs).length === 0, vraiesErreursCP(erreurs).slice(0, 3).join(" · "));
    await ctx.close();
  }
} catch (e) {
  t("le test va jusqu'au bout", false, String(e?.message || e).slice(0, 200));
} finally {
  await nav.close();
  const d = await (await auth(`admin/users?filter=${encodeURIComponent(email)}&per_page=10`)).json();
  for (const u of d?.users || []) {
    if ((u.email || "").toLowerCase() !== email) continue;
    await fetch(`${SB}/rest/v1/profiles?id=eq.${u.id}`, { method: "DELETE", headers: enTeteAdmin });
    await auth(`admin/users/${u.id}`, { method: "DELETE" });
  }
  const reste = await (await auth(`admin/users?filter=${encodeURIComponent(email)}&per_page=10`)).json();
  t("nettoyage : le compte de test est supprimé", !(reste?.users || []).some((u) => (u.email || "").toLowerCase() === email));
}
process.exit(bilan() ? 1 : 0);
