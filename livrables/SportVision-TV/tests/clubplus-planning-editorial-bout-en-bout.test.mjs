// Planning éditorial de bout en bout (11/09/2026) : le CM construit le planning du club depuis Club+.
//
//   node tests/clubplus-planning-editorial-bout-en-bout.test.mjs
//
// Club+ déployé, navigateur, vrais clics, sur le vrai club SF Villemomble : un CM de test (compte
// qa-sv-…@example.invalid) y est affecté en secondaire, sans toucher au CM principal ni au référent
// du client. Il crée un contenu pour les Séniors R2, vendredi 18 h, le retrouve, change l'heure et le
// réseau, le duplique, supprime la copie, recharge : la base est lue après chaque clic. Puis un coach
// de test du club et un CM de test d'un autre club tentent les mêmes écritures avec leur propre
// session : la base doit rester identique. Aucune notification, tout est supprimé à la fin.
import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { SB, env, enTeteAdmin, jeton, ANON } from "./_session-os.mjs";
import { CP, ouvrirClubPlus, ouvrirLeClub, vraiesErreursCP } from "./_session-clubplus.mjs";
const H = { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation" };
const r = []; const t = (n, ok, d = "") => r.push(`${ok ? "ok  " : "KO  "} ${n}${d ? "  · " + d : ""}`);
const REF = SB.replace(/^https:\/\/([a-z0-9]+)\..*$/, "$1");
const sql = async (query) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
})).json();
const svc = async (m, q, b) => (await fetch(`${SB}/rest/v1/${q}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined })).json();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const attendre = (ms) => new Promise((res) => setTimeout(res, ms));
const CLUB = "SF Villemomble";
const stamp = Date.now();
const TITRE = `QA E2E planning ${stamp}`;
const ids = { users: [] };
// La base compare date_debut à current_date en UTC : daté d'aujourd'hui en heure de Paris, une
// affectation posée entre minuit et 2 h n'est pas encore active. On la date de la veille.
const hier = iso(new Date(Date.now() - 864e5));

async function personne(tag, role) {
  const email = `qa-sv-e2e-planning-${tag}-${stamp}@example.invalid`;
  const u = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email, password: "QaE2E!2026-Planning", email_confirm: true }) })).json();
  if (!u.id) throw new Error(`compte ${tag} : ${JSON.stringify(u).slice(0, 120)}`);
  ids.users.push(u.id);
  if (role) await svc("POST", "profiles?on_conflict=id", { id: u.id, prenom: "QA", nom: `E2E planning ${tag}`, role, actif: true });
  return { id: u.id, email };
}
// Une écriture PostgREST avec la session de la personne : le vrai chemin de l'application.
async function tente(personneEmail, methode, chemin, corps) {
  const j = await jeton(personneEmail);
  const res = await fetch(`${SB}/rest/v1/${chemin}`, {
    method: methode,
    headers: { apikey: ANON, Authorization: `Bearer ${j.acces}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const txt = await res.text();
  let rows = null; try { rows = JSON.parse(txt); } catch { /* */ }
  return { status: res.status, lignes: Array.isArray(rows) ? rows.length : null, txt: txt.slice(0, 140) };
}
const etat = async (id) => (await sql(`select to_char(heure_prevue,'HH24:MI') h, plateforme p, date_prevue::text d, statut s, titre,
  (select name from club_teams where id=team_id) eq, type_contenu ty from contenus where id='${id}'`))[0] ?? null;
// La fiche d'un contenu : on clique sa pastille dans la vue ouverte.
const ouvrirFiche = async (page, texte) => { await page.locator("main button", { hasText: texte }).first().click(); await attendre(1500); };
const fiche = (page) => page.locator('[aria-labelledby="fiche-contenu-titre"]');

const nav = await chromium.launch();
try {
  // ── Décor ──
  const vm = (await sql(`select c.id, c.portail_client_id, cl.cm_id from clubs c join clients cl on cl.id=c.portail_client_id where c.nom='${CLUB}'`))[0];
  if (!vm) throw new Error("club Villemomble introuvable");
  ids.club = vm.id; ids.client = vm.portail_client_id; ids.referent = vm.cm_id;
  const r2 = (await sql(`select id from club_teams where club_id='${vm.id}' and name='Séniors R2'`))[0];
  if (!r2) throw new Error("équipe Séniors R2 introuvable");
  const cm = await personne("cm", "cm"), coach = await personne("coach", null), autre = await personne("autrecm", "cm");
  await svc("POST", "club_cm_affectations", { club_id: vm.id, cm_id: cm.id, role: "secondaire", date_debut: hier, actif: true });
  await svc("POST", "club_members", { user_id: coach.id, club_id: vm.id, role: "coach", status: "actif", teams: ["Séniors R2"] });
  const zzClient = (await svc("POST", "clients", { nom: `ZZ Club planning ${stamp}`, statut_relation: "partenaire" }))[0]; ids.zzClient = zzClient.id;
  const zzClub = (await svc("POST", "clubs", { nom: `ZZ Club planning ${stamp}`, portail_client_id: zzClient.id }))[0]; ids.zzClub = zzClub.id;
  await svc("POST", "club_cm_affectations", { club_id: zzClub.id, cm_id: autre.id, role: "secondaire", date_debut: hier, actif: true });
  const referentApres = (await sql(`select cm_id from clients where id='${vm.portail_client_id}'`))[0].cm_id;
  t("décor : le référent CM de Villemomble inchangé", referentApres === ids.referent);

  // Vendredi : celui de la semaine en cours s'il n'est pas passé.
  const auj = new Date(); auj.setHours(0, 0, 0, 0);
  const ven = new Date(auj); ven.setDate(auj.getDate() + ((5 - auj.getDay() + 7) % 7));
  const VEN = iso(ven);

  // ── 1. Le CM ouvre le Centre communication de Villemomble ──
  // Un seul club accessible : Club+ l'ouvre directement, sans écran de choix. ouvrirLeClub ne sert
  // ici qu'à écarter l'assistant d'onboarding, d'où un nom de club qui n'existe pas.
  const C = await ouvrirClubPlus(nav, cm.email, { chemin: "/clubplus/communication" });
  await ouvrirLeClub(C.page, "zz-aucun-club");
  const p = C.page;
  t("CM : Centre communication ouvert sur Villemomble", (await p.locator("h1", { hasText: `Planning éditorial de ${CLUB}` }).count()) === 1);
  t("CM : Aujourd'hui | Cette semaine | À préparer", (await p.locator("text=Cette semaine").count()) > 0 && (await p.locator("text=À préparer").count()) > 0);
  const ajout = p.locator("main button", { hasText: "Ajouter au planning" }).first();
  t("CM : bouton « + Ajouter au planning »", (await ajout.count()) === 1);

  // ── 2. Créer : Séniors R2, vendredi 18 h, Instagram ──
  await ajout.click(); await attendre(1200);
  const f = fiche(p);
  await f.locator("button", { hasText: "Carrousel" }).click();
  await f.locator('label:has-text("Titre") input').fill(TITRE);
  await f.locator('label:has-text("Date") input').fill(VEN);
  await f.locator('label:has-text("Heure") input').fill("18:00");
  // Instagram est déjà proposé pour un nouveau contenu : ne cliquer que s'il ne l'est pas.
  const insta = f.locator("button", { hasText: /^Instagram$/ });
  t("fiche : Instagram proposé par défaut", (await insta.getAttribute("aria-pressed")) === "true");
  if ((await insta.getAttribute("aria-pressed")) !== "true") await insta.click();
  await f.locator('label:has-text("Équipe") select').selectOption({ label: "Séniors R2" });
  await f.locator("textarea").fill("Contenu de test, supprimé à la fin.");
  await f.locator("footer button", { hasText: "Ajouter au planning" }).click(); await attendre(1200);
  t("écran : confirmation affichée", (await p.locator(`text=ajouté au planning.`).count()) > 0);
  await attendre(2500);
  const cree = (await sql(`select id from contenus where titre='${TITRE}'`));
  ids.contenu = cree[0]?.id;
  let e = ids.contenu ? await etat(ids.contenu) : null;
  t("base : contenu créé (carrousel, Séniors R2, vendredi 18:00, Instagram, brouillon)",
    !!e && e.ty === "carrousel" && e.eq === "Séniors R2" && e.d === VEN && e.h === "18:00" && e.p === "instagram" && e.s === "brouillon", JSON.stringify(e));

  // ── 3. Le retrouver dans le planning ──
  // La pastille de la grille, pas la ligne courte de la carte « Aujourd'hui » (un vendredi, les deux).
  const pastille = p.locator("main button", { hasText: TITRE }).filter({ hasText: "Carrousel" });
  t("écran : dans la semaine, avec l'heure, l'équipe et le réseau", (await pastille.count()) > 0 && /18:00/.test(await pastille.first().innerText()) && /Séniors R2/.test(await pastille.first().innerText())
    && /Instagram/.test(await pastille.first().innerText()) && /Brouillon/.test(await pastille.first().innerText()),
    (await pastille.first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 90));

  // ── 4. Modifier l'heure, puis le réseau ──
  await ouvrirFiche(p, TITRE);
  await f.locator('label:has-text("Heure") input').fill("19:30");
  await f.locator("footer button", { hasText: "Enregistrer" }).click(); await attendre(3000);
  e = await etat(ids.contenu);
  t("base : heure passée à 19:30, rien d'autre", e.h === "19:30" && e.p === "instagram" && e.d === VEN, JSON.stringify(e));
  await ouvrirFiche(p, TITRE);
  await f.locator("button", { hasText: /^Instagram$/ }).click();
  await f.locator("button", { hasText: /^TikTok$/ }).click();
  await f.locator("footer button", { hasText: "Enregistrer" }).click(); await attendre(3000);
  e = await etat(ids.contenu);
  t("base : réseau passé à TikTok", e.p === "tiktok" && e.h === "19:30", JSON.stringify(e));

  // ── 5. Dupliquer, puis supprimer la copie ──
  await ouvrirFiche(p, TITRE);
  await f.locator("footer button", { hasText: "Dupliquer" }).click(); await attendre(3000);
  const copie = (await sql(`select id, to_char(heure_prevue,'HH24:MI') h, plateforme p, statut s from contenus where titre='${TITRE} (copie)'`))[0];
  ids.copie = copie?.id;
  t("base : copie créée, en brouillon, mêmes heure et réseau", !!copie && copie.h === "19:30" && copie.p === "tiktok" && copie.s === "brouillon", JSON.stringify(copie));
  await ouvrirFiche(p, `${TITRE} (copie)`);
  await f.locator("footer button", { hasText: /^Supprimer$/ }).click(); await attendre(500);
  await f.locator("footer button", { hasText: "Confirmer la suppression" }).click(); await attendre(3000);
  const resteCopie = (await sql(`select count(*) n from contenus where id='${ids.copie}'`))[0].n;
  t("base : la copie supprimée, l'original conservé", resteCopie === 0 && !!(await etat(ids.contenu)));

  // ── 6. Recharger : tout est conservé ──
  await p.reload({ waitUntil: "domcontentloaded" }); await attendre(8000);
  await ouvrirLeClub(p, "zz-aucun-club");
  const apres = p.locator("main button", { hasText: TITRE });
  const txt = (await apres.first().innerText().catch(() => "")).replace(/\s+/g, " ");
  t("après rechargement : le contenu est là, 19:30, sans copie", (await apres.count()) >= 1 && /19:30/.test(txt) && (await p.locator("main button", { hasText: "(copie)" }).count()) === 0, txt.slice(0, 90));
  await p.locator("button", { hasText: /^Liste$/ }).click(); await attendre(1000);
  t("vue Liste : le contenu y figure", (await p.locator("main", { hasText: TITRE }).count()) > 0);
  await p.locator("button", { hasText: /^Mois$/ }).click(); await attendre(1000);
  t("vue Mois : le contenu y figure", (await p.locator("main button", { hasText: TITRE }).count()) > 0);
  // Le tableau de bord du CM lit la même table : le contenu y est, sans rien saisir deux fois.
  await p.goto(`${CP}/clubplus`, { waitUntil: "domcontentloaded" }); await attendre(8000);
  await ouvrirLeClub(p, "zz-aucun-club");
  const bloc = p.locator("main div", { hasText: "Communication du jour" }).filter({ hasText: TITRE });
  t("tableau de bord CM : le contenu apparaît dans « Communication du jour »", (await bloc.count()) > 0);
  t("CM : aucune erreur JavaScript", vraiesErreursCP(C.erreurs).length === 0, vraiesErreursCP(C.erreurs).slice(0, 2).join(" | "));

  // ── 7. Mobile 390 px ──
  const M = await ouvrirClubPlus(nav, cm.email, { largeur: 390, hauteur: 844, chemin: "/clubplus/communication" });
  await ouvrirLeClub(M.page, "zz-aucun-club");
  const deborde = await M.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  t("mobile 390 : pas de défilement horizontal, bouton d'ajout visible", !deborde && (await M.page.locator("main button:visible", { hasText: "Ajouter au planning" }).count()) === 1);
  await M.page.locator("main button:visible", { hasText: TITRE }).first().click().catch(() => {}); await attendre(1200);
  const box = await fiche(M.page).locator("> div").first().boundingBox().catch(() => null);
  t("mobile 390 : la fiche s'ouvre en plein écran", !!box && box.width >= 380, box ? `${Math.round(box.width)}px` : "fiche absente");
  await M.ctx.close(); await C.ctx.close();

  // ── 8. Un coach du club et un CM d'un autre club : aucune écriture ──
  const avant = JSON.stringify(await etat(ids.contenu));
  for (const [qui, email] of [["coach Villemomble", coach.email], ["CM d'un autre club", autre.email]]) {
    const u = await tente(email, "PATCH", `contenus?id=eq.${ids.contenu}`, { heure_prevue: "08:00", plateforme: "facebook" });
    const d = await tente(email, "DELETE", `contenus?id=eq.${ids.contenu}`);
    const i = await tente(email, "POST", "contenus", { client_id: ids.client, titre: `${TITRE} intrus`, type_contenu: "visuel", statut: "brouillon", date_prevue: VEN });
    t(`${qui} : modifier, supprimer, créer refusés`, u.lignes === 0 && d.lignes === 0 && i.status >= 400, `patch ${u.status}/${u.lignes} · delete ${d.status}/${d.lignes} · insert ${i.status}`);
  }
  const intrus = (await sql(`select count(*) n from contenus where titre='${TITRE} intrus'`))[0].n;
  t("base : le contenu est intact, aucun intrus créé", JSON.stringify(await etat(ids.contenu)) === avant && intrus === 0);

  // Le coach voit le planning sans pouvoir y ajouter quoi que ce soit.
  const K = await ouvrirClubPlus(nav, coach.email, { chemin: "/clubplus/communication" });
  await ouvrirLeClub(K.page, "zz-aucun-club");
  t("coach : pas de bouton « Ajouter au planning »", (await K.page.locator("button", { hasText: "Ajouter au planning" }).count()) === 0);
  await K.ctx.close();

  const notifs = (await sql(`select count(*) n from notifications where created_at > now() - interval '30 minutes'
    and (lien_client_id='${ids.client}' or message ilike '%${TITRE}%' or titre ilike '%${TITRE}%')`))[0];
  t("aucune notification envoyée", notifs?.n === 0, JSON.stringify(notifs));
} catch (e) {
  t("déroulé", false, String(e.message).slice(0, 220));
} finally {
  await nav.close();
  const u = ids.users.map((x) => `'${x}'`).join(",") || "null";
  const net = await sql(`begin;
    select set_config('request.jwt.claims', '{"role":"service_role"}', true);
    delete from contenus where titre like 'QA E2E planning ${stamp}%';
    delete from audit_logs where acteur_id in (${u});
    delete from club_onboarding_events where auteur_id in (${u});
    delete from memberships where user_id in (${u});
    delete from club_members where user_id in (${u});
    delete from club_cm_affectations where cm_id in (${u});
    ${ids.zzClub ? `delete from organizations where legacy_club_id='${ids.zzClub}'; delete from clubs where id='${ids.zzClub}';` : ""}
    ${ids.zzClient ? `delete from clients where id='${ids.zzClient}';` : ""}
    delete from profiles where id in (${u});
    delete from auth.users where id in (${u});
    commit;`);
  if (!Array.isArray(net)) t("nettoyage : erreur", false, JSON.stringify(net).slice(0, 200));
  const reste = (await sql(`select (select count(*) from contenus where titre like 'QA E2E planning ${stamp}%') contenus,
    (select count(*) from auth.users where email like 'qa-sv-e2e-planning-%-${stamp}@example.invalid') comptes,
    (select count(*) from club_cm_affectations where club_id='${ids.club}') affectations_vm,
    (select cm_id::text from clients where id='${ids.client}') referent`))[0];
  t("nettoyage complet, Villemomble revenu à son CM principal seul", reste.contenus === 0 && reste.comptes === 0 && reste.affectations_vm === 1 && reste.referent === ids.referent, JSON.stringify(reste));
  console.log(r.join("\n"));
}
