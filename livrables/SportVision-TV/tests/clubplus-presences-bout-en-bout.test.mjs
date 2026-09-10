// Présences de bout en bout (10/09/2026) : le club demande, le CM décide, la Production reçoit la mission.
//
//   node tests/clubplus-presences-bout-en-bout.test.mjs
//
// Club+ déployé, navigateur, vrais clics, sur un club fictif « ZZ » du pôle Basket (sans Production
// réelle) : CM, président et Production de test, aucune vraie personne notifiée. Parcourt la demande
// du club sur un match puis une séance d'entraînement, l'acceptation et le refus par le CM, la décision
// directe du CM sur une séance et depuis sa modale ; vérifie la base après chaque clic ; supprime tout.
import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { SB, env, enTeteAdmin } from "./_session-os.mjs";
import { CP, ouvrirClubPlus, ouvrirLeClub, vraiesErreursCP } from "./_session-clubplus.mjs";
const H = { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation" };
const r = []; const t = (n, ok, d = "") => r.push(`${ok ? "ok  " : "KO  "} ${n}${d ? "  · " + d : ""}`);
// Contrôles et nettoyage en SQL, par l'API Management (lecture de la base telle qu'elle est).
const REF = SB.replace(/^https:\/\/([a-z0-9]+)\..*$/, "$1");
const sql = async (query) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
})).json();
const svc = async (m, q, b) => (await fetch(`${SB}/rest/v1/${q}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined })).json();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const NOM = "ZZ Club Présences E2E";
const ids = { users: [] }; const stamp = Date.now();
const attendre = (ms) => new Promise((res) => setTimeout(res, ms));

async function personne(role) {
  const email = `zz-e2e-pres-${role}-${stamp}@example.invalid`;
  const u = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email, password: "ZzE2E!2026-Test", email_confirm: true }) })).json();
  ids.users.push(u.id);
  if (role !== "president") await svc("POST", "profiles?on_conflict=id", { id: u.id, prenom: "QA", nom: `E2E ${role}`, role, actif: true });
  return { id: u.id, email };
}
// Le bouton `libelle` de LA carte qui contient `texteCarte` : on remonte depuis chaque bouton
// jusqu'au premier parent qui contient le texte ; si ce parent contient plusieurs boutons du même
// libellé, c'est la liste entière et non la carte — ce bouton n'est pas le bon.
async function bouton(page, texteCarte, libelle, jour = null) {
  const i = await page.evaluate(([txt, lib, j]) => {
    const tous = [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === lib && b.offsetParent !== null);
    const contient = (el) => el.innerText.includes(txt) && (!j || el.innerText.toLowerCase().includes(j));
    return tous.findIndex((b) => {
      let el = b.parentElement;
      while (el && !contient(el)) el = el.parentElement;
      if (!el) return false;
      return [...el.querySelectorAll("button")].filter((x) => x.textContent.trim() === lib).length === 1;
    });
  }, [texteCarte, libelle, jour]);
  const loc = page.locator("button:visible", { hasText: new RegExp(`^${libelle.replace(/[+()]/g, "\\$&")}$`) });
  return i >= 0 ? loc.nth(i) : page.locator("button#aucun-bouton-correspondant");
}
async function ecarterAssistant(page) {
  const a = page.locator("div.fixed").filter({ hasText: "ONBOARDING FULL COMMUNICATION" }).first();
  if (await a.count()) {
    const b = a.locator("button", { hasText: "Terminer plus tard" }).first();
    if (await b.count()) { await b.click({ force: true }); await attendre(2000); }
  }
}

const nav = await chromium.launch();
try {
  // ── Décor ──
  const basket = (await svc("GET", "poles?select=id&nom=eq.Basket"))[0].id;
  const aff = await svc("GET", `pole_affectations?select=user_id&pole_id=eq.${basket}&actif=eq.true`);
  const roles = aff.length ? await svc("GET", `profiles?select=role&id=in.(${aff.map((a) => a.user_id).join(",")})`) : [];
  if (roles.some((p) => p.role === "prod")) throw new Error("le pôle Basket a une Production réelle : arrêt");
  const cm = await personne("cm"), pres = await personne("president"), prod = await personne("prod");
  const client = (await svc("POST", "clients", { nom: NOM, statut_relation: "partenaire", pole_id: basket, cm_id: cm.id }))[0]; ids.client = client.id;
  const club = (await svc("POST", "clubs", { nom: NOM, portail_client_id: client.id }))[0]; ids.club = club.id;
  await svc("POST", "organization_entitlements", { organization_id: club.id, module_key: "presences", actif: true });
  await svc("POST", "club_members", { user_id: pres.id, club_id: club.id, role: "president", status: "actif" });
  await svc("POST", "club_cm_affectations", { club_id: club.id, cm_id: cm.id, role: "principal", date_debut: iso(new Date()), actif: true });
  await svc("POST", "pole_affectations", { pole_id: basket, user_id: prod.id, role_pole: "membre", actif: true });
  const auj = new Date(); auj.setHours(0, 0, 0, 0);
  const mardi = new Date(auj); mardi.setDate(auj.getDate() + 2 + ((2 - new Date(auj.getTime() + 2 * 864e5).getDay() + 7) % 7));
  const mardi2 = new Date(mardi); mardi2.setDate(mardi.getDate() + 7);
  const jourA = new Date(auj); jourA.setDate(auj.getDate() + 3);
  const mA = (await svc("POST", "club_matches", { club_id: club.id, team: "ZZ U17", opponent: "ZZ Adversaire A", match_date: iso(jourA), kickoff_time: "15:00" }))[0];
  const mB = (await svc("POST", "club_matches", { club_id: club.id, team: "ZZ U17", opponent: "ZZ Adversaire B", match_date: iso(jourA), kickoff_time: "18:00" }))[0];
  const team = (await svc("POST", "club_teams", { club_id: club.id, name: "ZZ Seniors R2" }))[0]; ids.team = team.id;
  const slot = (await svc("POST", "club_team_training_slots", { team_id: team.id, jour: "mardi", heure_debut: "20:00", heure_fin: "21:30" }))[0];
  ids.mA = mA.id; ids.mB = mB.id; ids.slot = slot.id;
  const occ1 = `entrainement:${slot.id}:${iso(mardi)}`, occ2 = `entrainement:${slot.id}:${iso(mardi2)}`;
  t("décor fictif en place", !!(mA.id && mB.id && slot.id), `${NOM}, match le ${iso(jourA)}, séances les ${iso(mardi)} et ${iso(mardi2)}`);

  // ── 1. Le président demande le match A, depuis le calendrier ──
  const P = await ouvrirClubPlus(nav, pres.email, { chemin: `/clubplus/calendar?vue=liste&date=${iso(jourA)}` });
  let pret = false;
  for (let i = 0; i < 40 && !pret; i++) {
    const titre = await P.page.locator("header").first().innerText().catch(() => "");
    pret = /Calendrier/.test(titre) && (await (await bouton(P.page, "ZZ Adversaire A", "Demander une présence SportVision")).count()) > 0;
    if (!pret) { await attendre(15000); await P.page.reload({ waitUntil: "domcontentloaded" }); await attendre(7000); }
  }
  t("président : titre « Calendrier » et bouton sur le match (version déployée)", pret);
  await (await bouton(P.page, "ZZ Adversaire A", "Demander une présence SportVision")).click(); await attendre(1200);
  await P.page.locator('[role="dialog"] button', { hasText: /^Vidéo$/ }).first().click();
  await P.page.locator('[role="dialog"] button', { hasText: "Envoyer la demande" }).click(); await attendre(3000);
  t("président : « Demande envoyée »", await P.page.locator('[role="dialog"]', { hasText: "Demande envoyée" }).count() > 0);
  await P.page.locator('[role="dialog"] button', { hasText: "Fermer" }).last().click(); await attendre(3000);
  let b = (await sql(`select (select source||'/'||status||'/'||requested_coverage_type from coverage_wishes where match_id='${mA.id}') w,
                      (select count(*) from planned_presences where match_id='${mA.id}') p,
                      (select count(*) from notifications where destinataire_id='${cm.id}' and titre='Nouveau souhait de présence') n`))[0];
  t("base : un souhait du club, en vidéo, sans présence ; le CM notifié", b.w === "club_request/wished/video" && b.p === 0 && b.n >= 1, JSON.stringify(b));
  t("président : le match affiche la demande envoyée au CM", await P.page.locator("text=demande envoyée à votre CM SportVision").count() > 0);

  // ── 2. Le président demande la séance du mardi ──
  await P.page.goto(`${CP}/clubplus/calendar?vue=liste&date=${iso(mardi)}`, { waitUntil: "domcontentloaded" }); await attendre(8000);
  const bS = await bouton(P.page, "ZZ Seniors R2", "Demander une présence SportVision");
  t("président : bouton sur la séance d'entraînement", (await bS.count()) > 0);
  if (await bS.count()) {
    await bS.click(); await attendre(1200);
    await P.page.locator('[role="dialog"] button', { hasText: /^Photo$/ }).first().click();
    await P.page.locator('[role="dialog"] button', { hasText: "Envoyer la demande" }).click(); await attendre(3000);
    await P.page.locator('[role="dialog"] button', { hasText: "Fermer" }).last().click(); await attendre(2000);
  }
  b = (await sql(`select (select count(*) from coverage_wishes where occurrence_ref='${occ1}' and source='club_request') s1,
                  (select count(*) from coverage_wishes where occurrence_ref like 'entrainement:${slot.id}:%') tous`))[0];
  t("base : le souhait vise CETTE séance, pas le créneau", b.s1 === 1 && b.tous === 1, JSON.stringify(b));
  t("président : aucune erreur JavaScript", vraiesErreursCP(P.erreurs).length === 0, vraiesErreursCP(P.erreurs).slice(0, 2).join(" | "));

  // ── 3. Le CM accepte le match A, depuis Présences ──
  const C = await ouvrirClubPlus(nav, cm.email);
  await ecarterAssistant(C.page);
  const carte = C.page.locator("main").locator(`text=${NOM}`).first();
  if (await carte.count()) { await carte.click({ timeout: 8000 }).catch(() => {}); await attendre(6000); await ecarterAssistant(C.page); }
  await C.page.goto(`${CP}/clubplus/presences`, { waitUntil: "domcontentloaded" }); await attendre(8000); await ecarterAssistant(C.page);
  t("CM : dans l'espace du club fictif", (await C.page.locator(`text=${NOM}`).count()) > 0);
  const accepter = await bouton(C.page, "ZZ Adversaire A", "Accepter");
  t("CM : la demande du club est dans Présences, avec l'événement", (await accepter.count()) > 0);
  if (await accepter.count()) { await accepter.click(); await attendre(5000); }
  b = (await sql(`select (select pp.source||'/'||pp.type_couverture||'/'||pp.statut from planned_presences pp where pp.match_id='${mA.id}' and pp.statut<>'annule') p,
                  (select case when p.responsable_prod_id='${prod.id}' then 'prod-du-pole' else coalesce(p.responsable_prod_id::text,'aucun') end
                     from planned_presences pp join prestations p on p.id=pp.created_prestation_id where pp.match_id='${mA.id}') m,
                  (select count(*) from notifications where destinataire_id='${prod.id}' and type='nouvelle_mission') n,
                  (select status from coverage_wishes where match_id='${mA.id}') w`))[0];
  t("base : présence « demande du club » en vidéo, mission créée", /^club_request\/video\/mission_creee$/.test(b.p) && b.m === "prod-du-pole", JSON.stringify(b));
  t("base : la Production du pôle notifiée, le souhait retenu", b.n === 1 && b.w === "selected", `notif ${b.n}, souhait ${b.w}`);

  // ── 4. Le CM refuse la séance du mardi, depuis le calendrier ──
  await C.page.goto(`${CP}/clubplus/calendar?vue=liste&date=${iso(mardi)}`, { waitUntil: "domcontentloaded" }); await attendre(8000); await ecarterAssistant(C.page);
  const refuser = await bouton(C.page, "ZZ Seniors R2", "Refuser");
  t("CM : Accepter / Refuser sur la séance demandée", (await refuser.count()) > 0);
  if (await refuser.count()) {
    await refuser.click(); await attendre(500);
    await C.page.locator('input[aria-label="Motif du refus"]').first().fill("Opérateur indisponible ce soir-là");
    await C.page.locator("button", { hasText: "Confirmer le refus" }).first().click(); await attendre(4000);
  }
  b = (await sql(`select status||'/'||coalesce(not_selected_reason,'') w, (select count(*) from planned_presences where occurrence_ref='${occ1}') p from coverage_wishes where occurrence_ref='${occ1}'`))[0];
  t("base : refus enregistré avec son motif, aucune présence", b?.w === "not_selected/Opérateur indisponible ce soir-là" && b.p === 0, JSON.stringify(b));

  // ── 5. Le CM prévoit directement la séance du mardi suivant ──
  await C.page.goto(`${CP}/clubplus/calendar?vue=liste&date=${iso(mardi2)}`, { waitUntil: "domcontentloaded" }); await attendre(8000); await ecarterAssistant(C.page);
  const jour2 = mardi2.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }).toLowerCase();
  const aCouvrir = await bouton(C.page, "ZZ Seniors R2", "À couvrir par SportVision", jour2);
  t("CM : « À couvrir par SportVision » sur la séance suivante", (await aCouvrir.count()) > 0);
  if (await aCouvrir.count()) {
    await aCouvrir.click(); await attendre(600);
    await (await bouton(C.page, "ZZ Seniors R2", "Photo + vidéo", jour2)).click(); await attendre(4000);
  }
  b = (await sql(`select (select count(*) from planned_presences where occurrence_ref='${occ2}' and created_prestation_id is not null) p2,
                  (select count(*) from planned_presences where occurrence_ref like 'entrainement:${slot.id}:%' and statut<>'annule') tous`))[0];
  const quelles = (await sql(`select string_agg(split_part(occurrence_ref, ':', 3), ',') d from planned_presences where occurrence_ref like 'entrainement:${slot.id}:%' and statut<>'annule'`))[0];
  t("base : présence et mission pour cette séance seule", b.p2 === 1 && b.tous === 1, JSON.stringify({ ...b, dates: quelles.d, attendue: iso(mardi2) }));

  // ── 6. Le CM prévoit le match B depuis sa modale « Prévoir SportVision » ──
  await C.page.goto(`${CP}/clubplus/presences`, { waitUntil: "domcontentloaded" }); await attendre(8000); await ecarterAssistant(C.page);
  await C.page.locator("button", { hasText: "Prévoir SportVision" }).first().click(); await attendre(4000);
  await C.page.locator('[role="dialog"] input[type="search"]').fill("Adversaire B"); await attendre(600);
  await C.page.locator('[role="dialog"] button[role="checkbox"]').first().click();
  await C.page.locator('[role="dialog"] button', { hasText: /^Photo$/ }).first().click(); await attendre(300);
  const pied = await C.page.locator('[role="dialog"] footer').innerText();
  t("CM : la modale dit que la présence et la mission partent aussitôt", /présence et mission créées aussitôt/.test(pied) && /Prévoir SportVision/.test(pied), pied.replace(/\s+/g, " ").slice(0, 110));
  await C.page.locator('[role="dialog"] footer button', { hasText: "Prévoir SportVision" }).click(); await attendre(5000);
  t("CM : « Présence prévue »", await C.page.locator('[role="dialog"]', { hasText: "Présence prévue" }).count() > 0);
  b = (await sql(`select (select source||'/'||type_couverture from planned_presences where match_id='${mB.id}' and statut<>'annule' and created_prestation_id is not null) p,
                  (select count(*) from coverage_wishes where match_id='${mB.id}') w,
                  (select count(*) from notifications where destinataire_id='${prod.id}' and type='nouvelle_mission') n`))[0];
  t("base : décision directe (pas de souhait), mission, Production notifiée", b.p === "cm_initiated/photo" && b.w === 0 && b.n === 3, JSON.stringify(b));
  t("CM : aucune erreur JavaScript", vraiesErreursCP(C.erreurs).length === 0, vraiesErreursCP(C.erreurs).slice(0, 2).join(" | "));

  // ── 7. Le président lit le refus et son motif ──
  await P.page.goto(`${CP}/clubplus/presences`, { waitUntil: "domcontentloaded" }); await attendre(8000);
  const txt = await P.page.locator("main").innerText().catch(() => "");
  t("président : « Non retenue » et le motif, dans ses souhaits", /Non retenue/.test(txt) && /Opérateur indisponible ce soir-là/.test(txt));
  b = (await sql(`select count(*) n from notifications where created_at > now() - interval '30 minutes' and destinataire_id not in (${ids.users.map((u) => `'${u}'`).join(",")})
             and (lien_client_id='${client.id}' or prestation_id in (select id from prestations where client_id='${client.id}'))`))[0];
  t("aucune vraie personne notifiée", b.n === 0, `${b.n}`);
  await P.ctx.close(); await C.ctx.close();
} catch (e) {
  t("déroulé", false, String(e.message).slice(0, 220));
} finally {
  await nav.close();
  if (ids.club) {
    const u = ids.users.map((x) => `'${x}'`).join(",") || "null";
    const net = await sql(`begin;
      select set_config('request.jwt.claims', '{"role":"service_role"}', true);
      delete from audit_logs where acteur_id in (${u}) or cible_id in (select id from coverage_wishes where club_id='${ids.club}');
      delete from activity_log where entity_id in (select id from prestations where client_id='${ids.client}');
      delete from notifications where destinataire_id in (${u}) or lien_client_id='${ids.client}' or prestation_id in (select id from prestations where client_id='${ids.client}') or lien_prestation_id in (select id from prestations where client_id='${ids.client}');
      delete from prestations_equipe where prestation_id in (select id from prestations where client_id='${ids.client}');
      delete from coverage_wishes where club_id='${ids.club}';
      delete from planned_presences where plan_id in (select id from monthly_production_plans where client_id='${ids.client}') or match_id in (select id from club_matches where club_id='${ids.club}') or occurrence_ref like 'entrainement:${ids.slot}:%';
      delete from prestations where client_id='${ids.client}';
      delete from monthly_production_plans where client_id='${ids.client}';
      delete from club_team_training_slots where team_id in (select id from club_teams where club_id='${ids.club}');
      delete from club_teams where club_id='${ids.club}';
      delete from club_matches where club_id='${ids.club}';
      delete from organization_entitlements where organization_id='${ids.club}';
      delete from club_members where club_id='${ids.club}';
      delete from club_cm_affectations where club_id='${ids.club}';
      delete from club_onboarding_events where club_id='${ids.club}';
      delete from organizations where legacy_club_id='${ids.club}';
      delete from clubs where id='${ids.club}';
      delete from clients where id='${ids.client}';
      delete from pole_affectations where user_id in (${u});
      delete from profiles where id in (${u});
      delete from auth.users where id in (${u});
      commit;`);
    if (!Array.isArray(net)) t("nettoyage : erreur", false, JSON.stringify(net).slice(0, 200));
    const reste = (await sql(`select (select count(*) from clubs where nom='${NOM}') clubs, (select count(*) from clients where nom='${NOM}') clients,
                              (select count(*) from auth.users where email like 'zz-e2e-pres-%') comptes,
                              (select count(*) from coverage_wishes where club_id='${ids.club}') souhaits,
                              (select count(*) from prestations where client_id='${ids.client}') missions`))[0];
    t("nettoyage complet", Object.values(reste).every((v) => v === 0), JSON.stringify(reste));
  }
  console.log(r.join("\n"));
}
