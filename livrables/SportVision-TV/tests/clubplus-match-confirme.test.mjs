// Le coach confirme son match dans Club+ deploye (v241, 21/09/2026).
//
//   node livrables/SportVision-TV/tests/clubplus-match-confirme.test.mjs
//
// Fouka : « il y a eu pas mal d'erreurs sur les calendriers, des matchs qui n'etaient pas bons.
// Les coachs doivent pouvoir confirmer si c'est la bonne horaire, le bon lieu, qu'ils puissent
// modifier ou ajouter un match, comme ca moi sur le calendrier je vois le match exact. »
//
// Ce test regarde l'ecran que verra un vrai coach : le rappel en haut du calendrier, le bouton de
// confirmation, et ce que ca ecrit reellement en base. Decor fictif, retire a la fin.
import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { SB, env, enTeteAdmin, rapporteur } from "./_session-os.mjs";
import { ouvrirClubPlus, ouvrirLeClub, vraiesErreursCP } from "./_session-clubplus.mjs";

const H = { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation" };
const REF = SB.replace(/^https:\/\/([a-z0-9]+)\..*$/, "$1");
const sql = async (q) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: q }) })).json();
const svc = async (m, q, b) => (await fetch(`${SB}/rest/v1/${q}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined })).json();
const { t, bilan } = rapporteur();
const stamp = Date.now();
const ids = { users: [], matchs: [] };
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const CLUB = "SF Villemomble";

// Un match dans 6 jours : assez loin pour ne pas polluer la semaine en cours a l'ecran, assez
// proche pour entrer dans la fenetre de matchs_a_confirmer (21 jours).
const dans = (j) => {
  const d = new Date(Date.now() + j * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const nav = await chromium.launch();
try {
  const vm = (await sql(`select id from clubs where nom='${CLUB}'`))[0];
  ids.club = vm.id;

  // Une equipe fictive et son match, pour ne toucher a aucune donnee reelle du club.
  const eq = await svc("POST", "club_teams", { club_id: vm.id, name: `ZZ QA Confirm ${stamp}` });
  ids.team = eq[0].id;
  const m = await svc("POST", "club_matches", {
    club_id: vm.id, team: eq[0].name, team_id: eq[0].id, opponent: "ZZ Adversaire QA",
    match_date: dans(6), kickoff_time: "14:00", lieu: "ZZ Stade QA", provider: "SPORTCORICO",
    external_event_id: `zz-qa-${stamp}`,
  });
  ids.matchs.push(m[0].id);

  const email = `qa-sv-coach-confirm-${stamp}@example.invalid`;
  const u = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: H,
    body: JSON.stringify({ email, password: "QaCoachConf!2026", email_confirm: true }) })).json();
  ids.users.push(u.id);
  await svc("POST", "club_members", {
    user_id: u.id, club_id: vm.id, role: "coach", status: "actif",
    teams: [eq[0].name], prenom: "ZZ", nom: "CoachQA",
  });

  const P = await ouvrirClubPlus(nav, email, { chemin: "/clubplus/calendar" });
  await ouvrirLeClub(P.page, CLUB);
  await attendre(5000);
  let vu = await P.page.evaluate(() => document.body.innerText);

  t("le rappel des matchs a confirmer s'affiche", /à confirmer/i.test(vu),
    vu.replace(/\s+/g, " ").slice(0, 160));
  t("le match fictif y figure", /ZZ Adversaire QA/.test(vu));
  t("le rappel dit pourquoi on confirme", /bon endroit|bonne heure|SportVision/i.test(vu));

  // Le geste reel : le coach clique « C'est exact ».
  const bouton = P.page.locator("button", { hasText: "C'est exact" }).first();
  t("le bouton de confirmation est propose", (await bouton.count()) > 0);
  if (await bouton.count()) {
    await bouton.click();
    await attendre(3000);
  }

  const apres = (await sql(`select horaire_confirme_par, horaire_confirme_le from club_matches where id='${ids.matchs[0]}'`))[0];
  t("la confirmation est enregistree en base", Boolean(apres?.horaire_confirme_le), JSON.stringify(apres));
  t("elle porte le nom du coach qui a clique", apres?.horaire_confirme_par === u.id);

  vu = await P.page.evaluate(() => document.body.innerText);
  t("le rappel ne redemande plus ce match", !/ZZ Adversaire QA/.test(vu.split("Calendrier")[0] ?? vu));

  // La fiche du match doit maintenant porter la confirmation, avec le nom et la date.
  const carte = P.page.locator("text=ZZ Adversaire QA").first();
  if (await carte.count()) {
    await carte.click();
    await attendre(2500);
    const fiche = await P.page.evaluate(() => document.body.innerText);
    t("la fiche du match affiche la confirmation", /confirmés|confirmé/i.test(fiche),
      fiche.replace(/\s+/g, " ").slice(0, 160));
    t("elle nomme qui a confirme", /ZZ CoachQA|Par le club/.test(fiche));
  }

  const boum = vraiesErreursCP(P.erreurs);
  t("aucune erreur JavaScript", boum.length === 0, boum.slice(0, 2).join(" | "));
  await P.ctx.close();

  // Et la frontiere : un coach ne signe pas pour l'equipe d'a cote.
  const j = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: env.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "QaCoachConf!2026" }) })).json();
  const autre = await svc("POST", "club_matches", {
    club_id: vm.id, team: "ZZ QA Autre equipe", opponent: "ZZ Adversaire Voisin",
    match_date: dans(7), kickoff_time: "10:00",
  });
  ids.matchs.push(autre[0].id);
  const r = await fetch(`${SB}/rest/v1/rpc/match_confirmer`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${j.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_match_id: autre[0].id }),
  });
  t("il ne confirme pas le match d'une autre equipe", r.status >= 400, `HTTP ${r.status}`);
} catch (e) {
  t("deroule", false, String(e.message).slice(0, 200));
} finally {
  await nav.close();
  const u = ids.users.map((x) => `'${x}'`).join(",") || "null";
  const mm = ids.matchs.map((x) => `'${x}'`).join(",") || "null";
  await sql(`begin; select set_config('request.jwt.claims','{"role":"service_role"}',true);
    delete from club_matches where id in (${mm});
    delete from club_teams where id = ${ids.team ? `'${ids.team}'` : "null"};
    delete from club_members where user_id in (${u});
    delete from memberships where user_id in (${u});
    delete from profiles where id in (${u});
    delete from auth.users where id in (${u}); commit;`);
  const reste = (await sql(`select
      (select count(*)::int from auth.users where email like 'qa-sv-coach-confirm-%@example.invalid') u,
      (select count(*)::int from club_teams where name like 'ZZ QA Confirm %') e,
      (select count(*)::int from club_matches where opponent like 'ZZ Adversaire%') m`))[0];
  t("nettoyage complet", reste?.u === 0 && reste?.e === 0 && reste?.m === 0, JSON.stringify(reste));
  bilan();
}
