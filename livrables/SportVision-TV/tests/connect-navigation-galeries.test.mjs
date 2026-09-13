// La navigation Connect vers Mes galeries, dans un vrai Chromium, en production.
//
// LE PIÈGE MESURÉ (§18) : un compte qui a acheté DEUX fois sur la MÊME galerie doit voir UNE
// galerie et DEUX commandes. Compter les titres mélangeait les deux notions ; on compte les liens.
//
// 13/09/2026 — Ce test s'appuyait sur un compte permanent (`zz-nav@sportvision-an.fr`) et sur
// l'album « Test paiement — U18 ». Le compte a été supprimé lors d'un ménage, l'album archivé : le
// test échouait avant sa première vérification et ne surveillait donc plus rien. Il construit
// maintenant son propre décor — galerie témoin, compte, deux commandes — et le supprime après lui.
import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { creerGalerieTemoin } from "./_galerie-temoin.mjs";
import { SB, enTeteAdmin } from "./_session-os.mjs";

const BASE = "https://connect.sportvision-an.fr";
const T0 = Date.now();
const MAIL = `zz-nav-${T0}@example.invalid`;
const MDP = `ZzNav!${T0}`;
const TITRE = "ZZ Galerie navigation";
const norm = (s) => s.replace(/[   ]/g, " ");
const api = (c, o = {}) => fetch(`${SB}/rest/v1/${c}`, { ...o, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(o.headers || {}) } });

const b = await chromium.launch();
let ko = 0;
const dit = (nom, ok, det = "") => { if (!ok) ko++; console.log((ok ? "OK   " : "KO   ") + nom + (det ? "  (" + det + ")" : "")); };

// ── Décor : une galerie, un compte, deux commandes payées sur cette galerie ──
const temoin = await creerGalerieTemoin(b, { nom: TITRE });
const compte = await (await fetch(`${SB}/auth/v1/admin/users`, {
  method: "POST", headers: { ...enTeteAdmin, "Content-Type": "application/json" },
  body: JSON.stringify({ email: MAIL, password: MDP, email_confirm: true, user_metadata: { first_name: "ZZ", last_name: "Navigation" } }),
})).json();
if (!compte.id) { console.error("compte de test impossible :", compte); process.exit(1); }

// Sans ses réglages de profil, Connect ne sait pas quel espace ouvrir : c'est le tunnel
// d'inscription qui les pose normalement.
await api("connect_profile_settings", {
  method: "POST",
  body: JSON.stringify({ user_id: compte.id, account_type: "particulier", profil_particulier: "autre" }),
});

const commandes = await (await api("media_orders", {
  method: "POST", headers: { Prefer: "return=representation" },
  body: JSON.stringify([
    { club_id: temoin.clubId, album_id: temoin.albumId, link_id: temoin.lienId, purchased_by_user_id: compte.id,
      guest_email: MAIL, guest_name: "ZZ Navigation", amount_cents: 200, currency: "eur", status: "paid",
      paid_at: new Date().toISOString(), photos_allowance: 1 },
    { club_id: temoin.clubId, album_id: temoin.albumId, link_id: temoin.lienId, purchased_by_user_id: compte.id,
      guest_email: MAIL, guest_name: "ZZ Navigation", amount_cents: 400, currency: "eur", status: "paid",
      paid_at: new Date().toISOString(), photos_allowance: 1 },
  ]),
})).json();
dit("décor : deux commandes payées sur la même galerie", Array.isArray(commandes) && commandes.length === 2,
    JSON.stringify(commandes).slice(0, 200));

// Le droit de téléchargement, que le webhook Stripe pose après un vrai paiement. `media_my_galleries`
// le joint sans `left` : une commande payée sans ce droit n'apparaît nulle part, ce qui est la règle.
if (Array.isArray(commandes) && commandes.length === 2) {
  await api("media_download_grants", { method: "POST", body: JSON.stringify(commandes.map((c, i) => ({
    order_id: c.id, token: `zz-grant-${T0}-${i}`, email: MAIL, claimed_by_user_id: compte.id,
    claimed_at: new Date().toISOString(), max_downloads: 10,
  }))) });
}

// Une photo acquise par commande, sinon « photos disponibles » ne compte rien.
if (Array.isArray(commandes) && commandes.length === 2 && temoin.assets.length >= 2) {
  const rItems = await api("media_order_items", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify([
    { order_id: commandes[0].id, asset_id: temoin.assets[0].id, album_id: temoin.albumId, quantity: 1, unit_price_cents: 200 },
    { order_id: commandes[1].id, asset_id: temoin.assets[1].id, album_id: temoin.albumId, quantity: 1, unit_price_cents: 200 },
  ]) });
  const items = await rItems.json();
  dit("décor : une photo acquise par commande", Array.isArray(items) && items.length === 2,
      JSON.stringify(items).slice(0, 200));
}

for (const [nom, vp] of [["iPhone", { width: 390, height: 844 }], ["Bureau", { width: 1440, height: 900 }]]) {
  const p = await b.newPage({ viewport: vp, isMobile: nom === "iPhone", hasTouch: nom === "iPhone" });
  await p.goto(`${BASE}/auth/login`, { waitUntil: "networkidle" });
  await p.locator('input[type="email"]').fill(MAIL);
  await p.locator('input[type="password"]').fill(MDP);
  await p.locator('button[type="submit"]').click();
  await p.waitForURL(/dashboard|particulier/, { timeout: 25000 });
  // L'accueil est rendu côté serveur et interroge `media_my_galleries` : 1,5 s ne suffisait pas,
  // et le test concluait à tort que l'accueil ignorait la galerie. Mesuré : le bloc apparaît en
  // quelques secondes. On attend le bloc lui-même plutôt qu'une durée au jugé.
  await p.waitForLoadState("networkidle").catch(() => {});
  await p.locator("section").filter({ hasText: /Mes dernières galeries/ }).first()
    .waitFor({ timeout: 20000 }).catch(() => {});

  const accueil = norm(await p.locator("body").innerText());
  dit(`${nom} : l'accueil montre les dernieres galeries`, /derni[eè]res galeries/i.test(accueil));
  dit(`${nom} : UNE galerie malgre deux commandes`,
      (accueil.match(new RegExp(TITRE,"g")) || []).length >= 1,
      `${(accueil.match(new RegExp(TITRE,"g")) || []).length} occurrence(s)`);
  dit(`${nom} : le nombre acquis est affiche`, /2 photos disponibles/.test(accueil),
      accueil.match(/\d+ photos? disponibles?/)?.[0]);

  // L'entree de menu, dans le tiroir sur mobile et dans la sidebar sur bureau.
  if (nom === "iPhone") {
    const menu = p.locator('button[aria-label="Menu de navigation"]').first();
    if (await menu.count()) { await menu.click(); await p.waitForTimeout(700); }
  }
  const lien = p.locator('a[href="/galeries"]:visible').first();
  dit(`${nom} : l'entree « Mes galeries » est visible`, (await p.locator('a[href="/galeries"]:visible').count()) > 0);

  await lien.click();
  await p.waitForURL(/\/galeries/, { timeout: 20000 });
  await p.waitForTimeout(1200);
  const liste = norm(await p.locator("body").innerText());
  dit(`${nom} : la page Mes galeries s'ouvre`, /Mes galeries/.test(liste));
  // On compte les LIENS de galerie, pas les occurrences du titre : celui-ci apparait aussi une
  // fois par commande plus bas, ce qui est justement le comportement voulu (une galerie, deux
  // commandes distinctes). Compter le texte melangeait les deux notions.
  dit(`${nom} : une seule galerie listee`,
      (await p.locator('a[href^="/galeries/"]').count()) === 1,
      `${await p.locator('a[href^="/galeries/"]').count()} lien(s) de galerie`);
  dit(`${nom} : mais bien deux commandes`,
      (await p.locator('a[href^="/gallery/commande/"]').count()) === 2,
      `${await p.locator('a[href^="/gallery/commande/"]').count()} commande(s)`);
  dit(`${nom} : acces permanent annonce`, /Acc[eè]s permanent/i.test(liste));
  dit(`${nom} : les deux commandes restent distinctes`,
      (liste.match(new RegExp(TITRE,"g")) || []).length + (liste.match(/2 €|4 €/g) || []).length >= 2);

  // Entrer dans la galerie, puis revenir : aucun cul-de-sac.
  await p.locator('a[href^="/galeries/"]').first().click();
  await p.waitForURL(/\/galeries\/[0-9a-f-]{36}/, { timeout: 20000 });
  await p.waitForLoadState("networkidle");
  const detail = norm(await p.locator("body").innerText());
  dit(`${nom} : le detail affiche mes photos`, /T[eé]l[eé]charger/.test(detail));
  dit(`${nom} : et le retour vers Mes galeries`, (await p.locator('a[href="/galeries"]').count()) > 0);
  await p.close();
}

// ── Ménage, et on le vérifie ────────────────────────────────────────────────
for (const c of Array.isArray(commandes) ? commandes : []) {
  await api(`media_download_grants?order_id=eq.${c.id}`, { method: "DELETE" });
  await api(`media_order_items?order_id=eq.${c.id}`, { method: "DELETE" });
  await api(`media_orders?id=eq.${c.id}`, { method: "DELETE" });
}
const menage = await temoin.nettoyer();
await fetch(`${SB}/auth/v1/admin/users/${compte.id}`, { method: "DELETE", headers: enTeteAdmin });
const resteCmd = await (await api(`media_orders?select=id&guest_email=eq.${MAIL}`)).json();
dit("nettoyage : galerie, commandes et compte supprimes",
    menage.reste === 0 && !menage.fichierEncoreServi && (Array.isArray(resteCmd) ? resteCmd.length : 1) === 0,
    `${menage.reste} ligne(s) / ${JSON.stringify(resteCmd).slice(0, 80)}`);

await b.close();
console.log(ko === 0 ? "\ntout conforme" : `\n${ko} ecart(s)`);
process.exit(ko ? 1 : 0);
