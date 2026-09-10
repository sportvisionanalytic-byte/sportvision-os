// Ouvrir Club+ deploye dans un vrai navigateur, avec l'identite d'un vrai compte.
//
// POURQUOI ENSEMENCER PLUTOT QUE SE CONNECTER. Club+ traite `?code=` (PKCE) via /auth/callback et
// le fragment sur l'ecran de reinitialisation, mais la page de connexion ignore `#access_token` :
// elle attend un e-mail et un mot de passe. C'est coherent — Club+ n'envoie jamais de magic link —
// mais cela laisse un test sans porte d'entree. Les deux autres options etaient pires : changer le
// mot de passe d'un vrai compte, ou consommer un lien de recuperation, qui invaliderait celui
// d'une personne (l'erreur du 09/09, une matinee perdue pour une recrue).
//
// On recupere donc un jeton par l'API et on pose le cookie de session directement.
// @supabase/ssr 0.12 range la session dans `sb-<ref>-auth-token`, valeur « base64- » suivie du
// JSON encode, decoupee en morceaux .0/.1 au-dela d'environ 3600 octets — un cookie unique trop
// gros serait refuse en silence, et l'app afficherait un ecran deconnecte sans dire pourquoi.

import { SB, enTeteAdmin } from "./_session-os.mjs";

export const CP = "https://clubplus.sportvision-an.fr";
const REF = SB.replace(/^https:\/\/([a-z0-9]+)\..*$/, "$1");

export async function cookiesDeSession(email) {
  const lien = (await (await fetch(`${SB}/auth/v1/admin/generate_link`, {
    method: "POST", headers: { ...enTeteAdmin, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email, redirect_to: `${CP}/clubplus` }),
  })).json()).action_link;
  if (!lien) throw new Error(`aucun lien pour ${email}`);

  const loc = (await fetch(lien, { redirect: "manual" })).headers.get("location") || "";
  const p = new URLSearchParams(loc.split("#")[1] || "");
  const access = p.get("access_token"), refresh = p.get("refresh_token");
  if (!access) throw new Error(`aucun jeton pour ${email}`);

  const user = await (await fetch(`${SB}/auth/v1/user`, {
    headers: { apikey: enTeteAdmin.apikey, Authorization: `Bearer ${access}` },
  })).json();

  const session = {
    access_token: access, refresh_token: refresh,
    expires_at: Number(p.get("expires_at")), expires_in: Number(p.get("expires_in")),
    token_type: "bearer", user,
  };
  const brut = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64");
  const morceaux = [];
  for (let i = 0; i < brut.length; i += 3200) morceaux.push(brut.slice(i, i + 3200));
  const bruts = morceaux.length === 1
    ? [{ name: `sb-${REF}-auth-token`, value: brut }]
    : morceaux.map((v, i) => ({ name: `sb-${REF}-auth-token.${i}`, value: v }));

  return bruts.map((c) => ({
    ...c, domain: "clubplus.sportvision-an.fr", path: "/",
    httpOnly: false, secure: true, sameSite: "Lax",
  }));
}

// Rend { page, erreurs, ctx }. `erreurs` se remplit tout seul pendant le parcours.
export async function ouvrirClubPlus(navigateur, email, { largeur = 1440, hauteur = 900, chemin = "/clubplus" } = {}) {
  const ctx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur } });
  await ctx.addCookies(await cookiesDeSession(email));
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text().slice(0, 200)); });
  await page.goto(CP + chemin, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  return { page, erreurs, ctx };
}

// Le bruit qui ne dit rien sur l'application.
export const vraiesErreursCP = (l) =>
  l.filter((e) => !/favicon|status of 40[34]|Download the React DevTools|ResizeObserver loop/i.test(e));

// Ouvre un club depuis la liste « Mes clubs », puis ecarte l'assistant d'onboarding.
//
// L'assistant « ONBOARDING FULL COMMUNICATION » (etape 1/9) s'ouvre tout seul des qu'un CM ouvre
// un club dont l'onboarding n'est pas fini, en modale plein ecran z-100 qui intercepte TOUS les
// clics. Ni Echap ni un clic sur le voile ne la ferment : seul le bouton « Terminer plus tard ».
// Sans cette etape, un test conclut a tort que la navigation est cassee — c'est ce qui est arrive
// le 10/09/2026 avant d'aller regarder ce que contenait vraiment la surcouche.
export async function ouvrirLeClub(page, nomDuClub) {
  const carte = page.locator(`text=${nomDuClub}`).first();
  if (await carte.count()) { await carte.click(); await page.waitForTimeout(8000); }

  const assistant = page.locator("div.fixed").filter({ hasText: "ONBOARDING FULL COMMUNICATION" }).first();
  if (await assistant.count()) {
    const plusTard = assistant.locator("button", { hasText: "Terminer plus tard" }).first();
    if (await plusTard.count()) { await plusTard.click({ force: true }); await page.waitForTimeout(2500); }
  }
  return (await page.locator("div.fixed").filter({ hasText: "ONBOARDING FULL COMMUNICATION" }).count()) === 0;
}

// Va sur une entree du menu lateral et attend que la page se pose.
export async function allerA(page, libelle, attente = 4000) {
  const t0 = Date.now();
  await page.locator("nav a, aside a").filter({ hasText: libelle }).first().click();
  await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(attente);
  return Date.now() - t0;
}
