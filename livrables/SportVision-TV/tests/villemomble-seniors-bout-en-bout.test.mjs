// Inviter les Séniors de Villemomble, du coach aux joueurs, jusqu'à leurs photos (20/09/2026).
//
//   node livrables/SportVision-TV/tests/villemomble-seniors-bout-en-bout.test.mjs
//
// Fouka s'apprête à ouvrir les accès catégorie par catégorie, en commençant par les Séniors :
// « le coach sur Club+, les joueurs sur Connect, qu'ils rejoignent bien leur catégorie, et que
// les photos que je mets dans les galeries arrivent bien dans leur espace ». Plusieurs comptes
// vont se créer d'un coup ; un défaut de liaison se verrait alors sur des dizaines de personnes
// à la fois, pas sur une.
//
// Ce test joue la chaîne ENTIÈRE sur le vrai club et la vraie équipe, avec des comptes de test :
//   1. le coach est invité sur Club+ pour Séniors R2, il entre, et ne voit que son équipe ;
//   2. il génère le code d'adhésion de son équipe ;
//   3. un joueur arrive par ce code : rattaché d'emblée, sans validation à faire ;
//   4. une galerie de l'équipe est publiée : le joueur la voit dans son espace Connect ;
//   5. un joueur d'une AUTRE équipe ne la voit pas.
// Tout est supprimé à la fin, et vérifié.
import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { SB, env, enTeteAdmin, jeton, rapporteur } from "./_session-os.mjs";
import { ouvrirClubPlus, ouvrirLeClub, vraiesErreursCP } from "./_session-clubplus.mjs";

const H = { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation" };
const { t, bilan } = rapporteur();
const stamp = Date.now();
const MDP = "QaSeniors!2026";
const ids = { users: [], joueurs: [], albums: [] };
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (m, q, b) => {
  const r = await fetch(`${SB}/rest/v1/${q}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
  const txt = await r.text();
  try { return JSON.parse(txt); } catch { return txt; }
};
const g = async (q) => { const d = await api("GET", q); return Array.isArray(d) ? d : []; };
const compte = async (tag) => {
  const email = `qa-sv-seniors-${tag}-${stamp}@example.invalid`;
  const u = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: H,
    body: JSON.stringify({ email, password: MDP, email_confirm: true }) })).json();
  if (!u.id) throw new Error(`compte ${tag} : ${JSON.stringify(u).slice(0, 120)}`);
  ids.users.push(u.id);
  return { id: u.id, email };
};
// Une action avec la session de la personne : le vrai chemin de l'application.
const commePersonne = async (email, m, chemin, corps) => {
  const j = await jeton(email);
  const r = await fetch(`${SB}/rest/v1/${chemin}`, { method: m,
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${j.acces}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: corps ? JSON.stringify(corps) : undefined });
  const txt = await r.text();
  let d = null; try { d = JSON.parse(txt); } catch { /* */ }
  return { status: r.status, data: d, txt: txt.slice(0, 160) };
};

const nav = await chromium.launch();
try {
  const club = (await g("clubs?select=id,nom,portail_client_id&nom=eq.SF%20Villemomble"))[0];
  const equipe = (await g(`club_teams?select=id,name&club_id=eq.${club.id}&name=eq.S%C3%A9niors%20R2`))[0];
  const autreEquipe = (await g(`club_teams?select=id,name&club_id=eq.${club.id}&name=eq.S%C3%A9niors%20D1`))[0];
  t("décor : le club et l'équipe Séniors R2 existent", !!club && !!equipe, `${club?.nom} · ${equipe?.name}`);

  // ── 1. Le coach est invité sur Club+, pour SON équipe ──
  const coach = await compte("coach");
  const inv = (await api("POST", "club_invitations", { club_id: club.id, email: coach.email,
    prenom: "QA", nom: "CoachSeniors", role: "coach", teams: [equipe.name] }))[0];
  ids.invitation = inv.id;
  const C = await ouvrirClubPlus(nav, coach.email, { chemin: `/clubplus/rejoindre?token=${inv.token}` });
  await attendre(4000);
  const page1 = await C.page.evaluate(() => document.body.innerText);
  t("le lien d'invitation annonce le club et le rôle", /SF Villemomble/.test(page1) && /Coach/i.test(page1),
    page1.replace(/\s+/g, " ").slice(0, 110));
  // Deja connecte avec son compte : l'ecran reconnait la session et propose « Activer mon
  // espace ». (Un visiteur non connecte verrait « J'ai deja un compte » / creation d'acces.)
  await C.page.locator("button", { hasText: /Activer mon espace/i }).first().click()
    .catch(async () => {
      await C.page.locator("button", { hasText: "J'ai déjà un compte" }).first().click().catch(() => {});
      await attendre(1200);
      await C.page.locator("input[type=email]").first().fill(coach.email).catch(() => {});
      await C.page.locator("input[type=password]").first().fill(MDP).catch(() => {});
      await C.page.locator("button", { hasText: /Se connecter et rejoindre/i }).first().click().catch(() => {});
    });
  await attendre(12000);
  await ouvrirLeClub(C.page, "zz-aucun-club");
  await attendre(2500);
  const bureau = await C.page.evaluate(() => document.body.innerText);
  t("le coach entre dans l'espace du club", /\/clubplus\/dashboard/.test(C.page.url()) && /SF Villemomble/.test(bureau),
    C.page.url().replace("https://clubplus.sportvision-an.fr", ""));
  const membre = (await g(`club_members?select=role,status,teams&club_id=eq.${club.id}&user_id=eq.${coach.id}`))[0];
  t("il est coach, sur la seule équipe Séniors R2", membre?.role === "coach" && membre?.status === "actif"
    && JSON.stringify(membre?.teams) === JSON.stringify([equipe.name]), JSON.stringify(membre));
  const boumC = vraiesErreursCP(C.erreurs);
  t("coach : aucune erreur JavaScript", boumC.length === 0, boumC.slice(0, 2).join(" | "));
  await C.ctx.close();

  // ── 2. Le coach génère le code d'adhésion de son équipe ──
  const creation = await commePersonne(coach.email, "POST", "rpc/create_invite_code",
    { p_club_id: club.id, p_team_id: equipe.id, p_max_uses: null });
  const lien = Array.isArray(creation.data) ? creation.data[0] : creation.data;
  const code = lien?.code;
  ids.code = lien?.id;
  t("le coach génère le code d'adhésion de son équipe", !!code, `${creation.status} ${creation.txt}`);

  // ── 3. Un joueur arrive par ce code : rattaché d'emblée ──
  const joueur = await compte("joueur");
  // Le joueur a d'abord sa fiche (c'est ce que fait Connect a l'inscription), puis il demande
  // son equipe avec le code du coach.
  const fiche0 = (await api("POST", "player_profiles", { club_id: club.id, prenom: "QA",
    nom: `Senior ${stamp}`, date_naissance: "1999-02-02", account_status: "actif", user_id: joueur.id }))[0];
  if (fiche0?.id) ids.joueurs.push(fiche0.id);
  const adhesion = await commePersonne(joueur.email, "POST", "rpc/request_team_membership_as_player",
    { p_club_id: club.id, p_team_id: equipe.id, p_invite_code: code });
  const statut = adhesion.data?.statut ?? adhesion.data?.[0]?.statut ?? adhesion.data;
  t("le joueur rejoint son équipe sans validation à faire", String(statut).includes("valid"),
    `${adhesion.status} ${JSON.stringify(adhesion.data).slice(0, 140)}`);
  const fiche = (await g(`player_profiles?select=id,prenom,nom&club_id=eq.${club.id}&nom=eq.Senior%20${stamp}`))[0];
  const rattache = fiche ? await g(`team_memberships?select=id,statut&player_id=eq.${fiche.id}&team_id=eq.${equipe.id}`) : [];
  t("son rattachement à Séniors R2 existe en base", rattache.length === 1 && rattache[0].statut === "active",
    JSON.stringify(rattache));

  // ── 4. La galerie de l'équipe arrive dans son espace ──
  const album = (await api("POST", "media_albums", { title: `ZZ Séniors R2 ${stamp}`, club_id: club.id,
    team_id: equipe.id, status: "published", event_date: new Date().toISOString().slice(0, 10),
    published_at: new Date().toISOString() }))[0];
  ids.albums.push(album.id);
  // Un joueur ne passe PAS par media_club_galleries : c'est la lecture de Club+, reservee aux
  // membres du club. Son espace Connect lit media_album_list, la seule voie ouverte a un joueur
  // (aucune policy SELECT sur media_albums pour un compte authentifie, volontairement).
  const vues = await commePersonne(joueur.email, "POST", "rpc/media_album_list",
    { p_club_id: club.id, p_team_id: equipe.id, p_saison_id: null });
  const titres = (vues.data || []).map((x) => x.title ?? x.titre);
  t("le joueur voit la galerie de son équipe dans son espace Connect", titres.includes(album.title),
    `${vues.status} ${JSON.stringify(titres).slice(0, 140)}`);

  // ── 5. Un joueur d'une autre équipe ne la voit pas ──
  const joueur2 = await compte("joueur2");
  const f2 = (await api("POST", "player_profiles", { club_id: club.id, prenom: "QA",
    nom: `Autre ${stamp}`, date_naissance: "1999-03-03", account_status: "actif", user_id: joueur2.id }))[0];
  if (f2?.id) ids.joueurs.push(f2.id);
  await api("POST", "team_memberships", { player_id: f2.id, team_id: autreEquipe.id, club_id: club.id,
    statut: "active", saison: "2026-2027" });
  const vues2 = await commePersonne(joueur2.email, "POST", "rpc/media_album_list",
    { p_club_id: club.id, p_team_id: autreEquipe.id, p_saison_id: null });
  const titres2 = (vues2.data || []).map((x) => x.title ?? x.titre);
  t("un joueur d'une autre équipe ne voit pas cette galerie", !titres2.includes(album.title),
    JSON.stringify(titres2).slice(0, 120));
} catch (e) {
  t("déroulé", false, String(e.message).slice(0, 200));
} finally {
  await nav.close();
  const u = ids.users.map((x) => `'${x}'`).join(",") || "null";
  const jr = ids.joueurs.map((x) => `'${x}'`).join(",") || "null";
  const al = ids.albums.map((x) => `'${x}'`).join(",") || "null";
  // Nettoyage par la cle de service, table par table : l'acces SQL direct est indisponible
  // (jeton Management revoque le 16/09), et PostgREST ne connait pas les transactions.
  const del = async (q) => { await fetch(`${SB}/rest/v1/${q}`, { method: "DELETE", headers: H }); };
  if (ids.albums.length) await del(`media_albums?id=in.(${ids.albums.join(",")})`);
  if (ids.joueurs.length) {
    await del(`team_memberships?player_id=in.(${ids.joueurs.join(",")})`);
    await del(`membership_requests?player_id=in.(${ids.joueurs.join(",")})`);
    await del(`client_affiliations?user_id=in.(${ids.users.join(",")})`);
    await del(`player_profiles?id=in.(${ids.joueurs.join(",")})`);
  }
  if (ids.code) await del(`team_invite_codes?id=eq.${ids.code}`);
  if (ids.invitation) await del(`club_invitations?id=eq.${ids.invitation}`);
  if (ids.users.length) {
    await del(`club_members?user_id=in.(${ids.users.join(",")})`);
    await del(`memberships?user_id=in.(${ids.users.join(",")})`);
    for (const id of ids.users) await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: H });
  }
  const resteJ = await g(`player_profiles?select=id&nom=like.*${stamp}*`);
  const resteC = (await (await fetch(`${SB}/auth/v1/admin/users?page=1&per_page=200`, { headers: H })).json()).users
    .filter((x) => (x.email || "").includes(`seniors-`) && (x.email || "").includes(String(stamp)));
  t("nettoyage complet", resteJ.length === 0 && resteC.length === 0, `${resteJ.length} fiche(s), ${resteC.length} compte(s)`);
  bilan();
}
