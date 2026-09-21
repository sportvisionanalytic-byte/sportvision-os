// Un joueur MAJEUR donne lui-meme son accord a la reconnaissance (21/09/2026).
//
//   node livrables/SportVision-TV/tests/reconnaissance-joueur-majeur.test.mjs
//
// Fouka : « pour un joueur majeur, ils donnent leur accord eux-memes. » La base reconnaissait
// trois qualites depuis le 12/09 — parent, joueur de 15 a 17 ans, joueur majeur — et deux d'entre
// elles n'avaient aucun ecran. Ce test emprunte le parcours reel, avec une vraie session, sur
// Connect deploye.
//
// CE QU'ON MESURE, et pourquoi :
//   • le bouton existe la ou il vient chercher ses photos ;
//   • l'ecran lui parle A LUI (« vos photos »), pas de son enfant ;
//   • AUCUNE attestation d'autorite parentale : un majeur n'atteste rien sur sa propre personne ;
//   • le texte dit toujours ce qu'on conserve et qu'il peut se retracter — c'est la partie
//     juridique, elle ne doit pas disparaitre avec le changement de destinataire ;
//   • l'accord enregistre porte la qualite « joueur_majeur » : le jour ou le seuil d'age est
//     conteste, il faut pouvoir dire sur quel titre chaque accord repose.
//
// Decor fictif dans un club ZZ, entierement supprime a la fin, suppression verifiee.
import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { SB, enTeteAdmin, rapporteur } from "./_session-os.mjs";
const CX = "https://connect.sportvision-an.fr";
const { t, bilan } = rapporteur();
const T0 = Date.now();
const MDP = "ZzMajeur!2026";
const H = { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation" };
const REF = SB.replace(/^https:\/\/([a-z0-9]+)\..*$/, "$1");
const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${process.env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }) });
  const j = await r.json(); if (j && j.message) throw new Error(String(j.message).slice(0, 220)); return j;
};
const api = async (m, c, b) => {
  const r = await fetch(`${SB}/rest/v1/${c}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
  const x = await r.text(); if (!r.ok) throw new Error(`${m} ${c} → ${r.status} ${x.slice(0, 180)}`);
  return x ? JSON.parse(x) : null;
};
const un = (x) => (Array.isArray(x) ? x[0] : x);
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const ids = { users: [] };
const nav = await chromium.launch();
try {
  const cm = un(await sql(`select id from profiles where role='cm' and actif limit 1`));
  const client = un(await api("POST", "clients", { nom: `ZZ Client Majeur ${T0}`, statut: "client", cm_id: cm.id }));
  const club = un(await api("POST", "clubs", { nom: `ZZ Club Majeur ${T0}`, plan: "performance", portail_client_id: client.id }));
  const equipe = un(await api("POST", "club_teams", { club_id: club.id, name: "ZZ Seniors" }));
  const saison = un(await api("GET", "saisons?select=id&active=is.true&limit=1"));
  ids.club = club.id; ids.client = client.id;

  const email = `zz-majeur-${T0}@example.invalid`;
  const u = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: { ...enTeteAdmin, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: MDP, email_confirm: true, user_metadata: { first_name: "ZZ", last_name: "Majeur" } }) })).json();
  ids.users.push(u.id);
  await api("POST", "connect_profile_settings", { user_id: u.id, account_type: "joueur" });
  const joueur = un(await api("POST", "player_profiles", { club_id: club.id, user_id: u.id, prenom: "ZZ", nom: "Majeur",
    date_naissance: "1998-03-03", account_status: "actif" }));
  ids.joueur = joueur.id;
  await api("POST", "team_memberships", { player_id: joueur.id, team_id: equipe.id, club_id: club.id,
    saison: "2026-2027", saison_id: saison?.id ?? null, statut: "active" });
  await api("POST", "membership_requests", { club_id: club.id, team_id: equipe.id, player_id: joueur.id,
    source: "invitation", statut: "validee", validation_mode: "standard", admin_valide_at: new Date().toISOString() });

  const ctx = await nav.newContext({ viewport: { width: 390, height: 860 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const err = []; page.on("pageerror", (e) => err.push(String(e).slice(0, 150)));
  let ok = false;
  for (const essai of [0, 1, 2]) {
    if (essai) await attendre(60000);
    await page.goto(`${CX}/auth/login`, { waitUntil: "domcontentloaded" });
    await page.locator('input[type="email"]').first().waitFor({ state: "visible", timeout: 30000 });
    await page.locator('input[type="email"]').first().fill(email);
    await page.locator('input[type="password"]').first().fill(MDP);
    await page.locator('button[type="submit"]').first().click();
    await attendre(9000);
    if (!/login/.test(page.url())) { ok = true; break; }
  }
  t("le joueur se connecte", ok, page.url().replace(CX, ""));

  await page.goto(`${CX}/photos`, { waitUntil: "domcontentloaded" });
  await attendre(4000);
  const surPhotos = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
  t("le bouton « Retrouver mes photos » est propose", /Retrouver mes photos/.test(surPhotos), surPhotos.slice(0, 120));

  await page.goto(`${CX}/reconnaissance`, { waitUntil: "domcontentloaded" });
  await attendre(4500);
  const vu = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
  t("l'ecran s'ouvre et parle A LUI", /Retrouver automatiquement vos photos/.test(vu), vu.slice(0, 150));
  t("aucune attestation d'autorite parentale", !/autorité parentale/i.test(vu));
  t("le texte dit ce qu'on conserve", /empreinte numérique/i.test(vu));
  t("et qu'il peut changer d'avis", /changer d.avis/i.test(vu));

  // Le geste : cocher, puis accepter.
  const cases = await page.locator('input[type="checkbox"]').count();
  t("une seule case a cocher", cases === 1, `${cases} case(s)`);
  if (cases === 1) await page.locator('input[type="checkbox"]').first().check();
  const bouton = page.locator("button", { hasText: /J.accepte/ }).first();
  t("le bouton d'accord est actif une fois coche", await bouton.isEnabled().catch(() => false));
  if (await bouton.count()) { await bouton.click(); await attendre(5000); }

  const etat = await sql(`select statut, qualite, texte_version from consentements_biometrie where player_id='${ids.joueur}'`);
  t("l'accord est enregistre en base", (etat[0]?.statut || "") === "accorde", JSON.stringify(etat[0] || {}));
  t("et il porte la qualite « joueur majeur »", (etat[0]?.qualite || "") === "joueur_majeur", etat[0]?.qualite);

  const vu2 = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
  t("l'ecran propose maintenant de deposer la photo", /photo de référence|Choisir une photo/i.test(vu2), vu2.slice(0, 160));
  t("aucune erreur JavaScript", err.length === 0, err.slice(0, 2).join(" | "));
  await ctx.close();
} catch (e) {
  t("deroule", false, String(e.message).slice(0, 220));
} finally {
  await nav.close();
  const u = ids.users.map((x) => `'${x}'`).join(",") || "null";
  await sql(`begin; select set_config('request.jwt.claims','{"role":"service_role"}',true);
    delete from player_face_refs where player_id in (select id from player_profiles where club_id='${ids.club}');
    delete from consentements_biometrie where club_id='${ids.club}';
    delete from membership_requests where club_id='${ids.club}';
    delete from team_memberships where club_id='${ids.club}';
    delete from player_profiles where club_id='${ids.club}';
    delete from club_teams where club_id='${ids.club}';
    delete from connect_profile_settings where user_id in (${u});
    delete from clubs where id='${ids.club}';
    delete from clients where id='${ids.client}'; commit;`).catch((e) => console.log("menage:", e.message.slice(0, 130)));
  for (const id of ids.users) await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: enTeteAdmin });
  const r = await sql(`select (select count(*)::int from clubs where nom like 'ZZ Club Majeur %') c,
                              (select count(*)::int from auth.users where email like 'zz-majeur-%@example.invalid') u`);
  t("nettoyage complet", r[0]?.c === 0 && r[0]?.u === 0, JSON.stringify(r[0]));
  bilan();
}
