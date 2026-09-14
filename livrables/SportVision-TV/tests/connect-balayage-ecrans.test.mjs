// Tous les écrans de Connect, ouverts un par un, pour chaque type de compte.
//
// POURQUOI CE TEST (14/09/2026). L'OS a son balayage (os-balayage-ecrans) : chaque entrée de menu
// ouverte, à la recherche d'un écran qui répond 200 mais affiche « une erreur est survenue ».
// Connect, par où passeront tous les joueurs et tous les parents des clubs, n'avait pas
// l'équivalent. Fouka avant d'envoyer les invitations : « pas de bouton qui bug, pas de truc qui
// manque ».
//
// CE QU'ON MESURE, pour un joueur, un parent et un particulier :
//   • chaque écran du menu s'ouvre, sans message d'erreur ni page vide ;
//   • aucune erreur JavaScript ;
//   • aucun écran ne renvoie vers la connexion (session perdue en cours de route).
//
// Un écran « vide » légitime (aucun contenu, aucune galerie) n'est PAS un échec : c'est l'état
// normal d'un compte neuf. On cherche les erreurs, pas l'absence de données.
//
// PROPRETÉ. Trois comptes créés par l'API d'administration (aucun e-mail), supprimés à la fin.
//
//   node livrables/SportVision-TV/tests/connect-balayage-ecrans.test.mjs

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { rapporteur, SB, enTeteAdmin } from "./_session-os.mjs";

const BASE = "https://connect.sportvision-an.fr";
const T0 = Date.now();
const MDP = `ZzBalayage!${T0}`;
const { t, bilan } = rapporteur();
const api = (c, o = {}) => fetch(`${SB}/rest/v1/${c}`, { ...o, headers: { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation", ...(o.headers || {}) } });

// Ce qui trahit un écran cassé, par opposition à un écran simplement vide.
const CASSE = /une erreur est survenue|erreur inattendue|something went wrong|application error|500|introuvable|Impossible de charger/i;

async function compte(role, reglages) {
  const email = `zz-balayage-${role}-${T0}@example.invalid`;
  const u = await (await fetch(`${SB}/auth/v1/admin/users`, {
    method: "POST", headers: { ...enTeteAdmin, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: MDP, email_confirm: true, user_metadata: { first_name: "ZZ", last_name: role } }),
  })).json();
  if (!u.id) throw new Error(`compte ${role} : ${JSON.stringify(u).slice(0, 160)}`);
  await api("connect_profile_settings", { method: "POST", body: JSON.stringify({ user_id: u.id, ...reglages }) });
  return { id: u.id, email };
}

async function main() {
  const navigateur = await chromium.launch();
  const comptes = [];
  try {
    const profils = [
      ["particulier", { account_type: "particulier", profil_particulier: "autre" }],
      ["parent", { account_type: "particulier", profil_particulier: "parent" }],
      ["joueur", { account_type: "joueur" }],
    ];

    for (const [role, reglages] of profils) {
      const c = await compte(role, reglages);
      comptes.push(c.id);
      console.log(`\n[${role}] ${c.email}`);

      const ctx = await navigateur.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      const erreurs = [];
      page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 160)));

      // Supabase limite les authentifications à 30 par 5 minutes et par IP (`rate_limit_verify`,
      // valeur par défaut). C'est une protection contre la force brute qu'on ne desserre pas pour
      // arranger un test : trois connexions d'affilée, après tous les autres tests de la nuit,
      // suffisent à la toucher. On patiente et on réessaie une fois, plutôt que de conclure à tort
      // que le compte ne peut pas se connecter — ce que ce test a fait avant d'être corrigé.
      let connecte = false;
      let dernierEcran = "";
      for (const essai of [0, 1]) {
        if (essai === 1) await page.waitForTimeout(45000);
        await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded" });
        await page.locator('input[type="email"]').fill(c.email);
        await page.locator('input[type="password"]').fill(MDP);
        await page.locator('button[type="submit"]').first().click();
        await page.waitForTimeout(7000);
        dernierEcran = (await page.evaluate(() => document.body.innerText).catch(() => "")).replace(/\s+/g, " ");
        if (!/auth\/login/.test(page.url())) { connecte = true; break; }
      }
      t(`[${role}] la connexion ouvre un espace`, connecte, `${page.url().replace(BASE, "")} — ${dernierEcran.slice(0, 140)}`);
      if (!connecte) { await ctx.close(); continue; }

      // Les entrées du menu, telles qu'elles sont réellement proposées à CE compte.
      const chemins = await page.locator("a").evaluateAll((liens) =>
        [...new Set(liens.map((a) => a.getAttribute("href")).filter((h) => h && h.startsWith("/") && !h.startsWith("//")))]);
      t(`[${role}] son menu propose des écrans`, chemins.length >= 3, `${chemins.length} entrée(s)`);

      const casses = [];
      const perdus = [];
      for (const chemin of chemins.slice(0, 18)) {
        await page.goto(BASE + chemin, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(2500);
        const vu = (await page.evaluate(() => document.body.innerText).catch(() => "")).replace(/\s+/g, " ");
        if (/auth\/login/.test(page.url())) perdus.push(chemin);
        else if (CASSE.test(vu)) casses.push(`${chemin} → ${vu.slice(0, 80)}`);
      }
      t(`[${role}] aucun écran en erreur`, casses.length === 0, casses.slice(0, 3).join(" | "));
      t(`[${role}] aucun écran ne le déconnecte`, perdus.length === 0, perdus.slice(0, 4).join(", "));
      t(`[${role}] aucune erreur JavaScript`, erreurs.length === 0, erreurs.slice(0, 2).join(" | "));
      await ctx.close();
    }
  } finally {
    for (const id of comptes) {
      await api(`connect_profile_settings?user_id=eq.${id}`, { method: "DELETE" });
      await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: enTeteAdmin });
    }
    await navigateur.close();
    const reste = await (await api(`connect_profile_settings?select=user_id&user_id=in.(${comptes.join(",") || "00000000-0000-0000-0000-000000000000"})`)).json();
    t("nettoyage : aucun compte de test ne subsiste", (Array.isArray(reste) ? reste.length : 1) === 0);
  }
  process.exit(bilan() === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
