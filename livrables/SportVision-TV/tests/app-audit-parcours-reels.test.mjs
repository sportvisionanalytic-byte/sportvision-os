// Ce que chaque écran de l'application reçoit vraiment, avec de vrais comptes (25/09/2026).
//
// POURQUOI CE TEST EXISTE. Les tests précédents vérifiaient des droits — qui voit quoi, qui est
// refusé. Celui-ci vérifie autre chose : qu'un écran a quelque chose à afficher. Un écran qui
// répond 200 avec zéro ligne n'est pas une réussite, c'est un écran vide, et une famille ne fait
// pas la différence entre « votre club n'a rien publié » et « notre application est cassée ».
//
// Il suit, requête par requête, exactement ce que fait chaque écran :
//
//   Accueil      lireEvenements, puis la dernière galerie
//   Calendrier   les mêmes événements, séparés passé/à venir
//   Fiche match  lireMatch sur un identifiant réel, des deux formes
//   Photos       media_album_list, puis vidéos et comptage par joueur
//   Profil       club_identite, l'écusson
//   Services     les quatre pages du site, avec la session transportée
//
// CE QU'IL DISTINGUE, et c'est le point : un écran vide FAUTE DE DONNÉES (personne n'a saisi
// d'entraînement) d'un écran vide PAR DÉFAUT (la requête échoue, ou renvoie ce qu'il ne faut
// pas). Le premier n'est pas un bug, le second en est un — et jusqu'ici rien ne les séparait.
import { SB, ANON } from "./_session-os.mjs";

const MDP = "DemoSportVision2026!";
const COMPTES = {
  joueur: "demo.u18.villemomble@example.invalid",
  parent: "demo.parent.villemomble@example.invalid",
};

let ok = 0;
const echecs = [];
const infos = [];
const t = (nom, condition, detail = "") => {
  if (condition) { ok += 1; console.log("  ok  ", nom); }
  else { echecs.push(`${nom}${detail ? " — " + detail : ""}`); console.log("  KO  ", nom, detail); }
};
/** Ce qui est vide sans être cassé : on le dit, on ne le compte pas comme un échec. */
const note = (texte) => { infos.push(texte); console.log("  ··  ", texte); };

async function session(email) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: MDP }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(`connexion impossible : ${email}`);
  return {
    jeton: d.access_token, rafraichissement: d.refresh_token, uid: d.user.id,
    H: { apikey: ANON, Authorization: `Bearer ${d.access_token}`, "Content-Type": "application/json" },
  };
}

const rest = async (H, chemin) => {
  const r = await fetch(`${SB}/rest/v1/${chemin}`, { headers: H });
  return { code: r.status, corps: await r.json().catch(() => null) };
};
const rpc = async (H, nom, corps = {}) => {
  const r = await fetch(`${SB}/rest/v1/rpc/${nom}`, { method: "POST", headers: H, body: JSON.stringify(corps) });
  return { code: r.status, corps: await r.json().catch(() => null) };
};

console.log("\n═══ ESPACE JOUEUR ═══\n");
const j = await session(COMPTES.joueur);

const fiche = (await rest(j.H, `player_profiles?select=id,prenom,club_id&user_id=eq.${j.uid}`)).corps?.[0];
t("le joueur a une fiche et un club", !!fiche?.club_id, JSON.stringify(fiche));

const equipe = (await rest(j.H,
  `team_memberships?select=team_id,saison_id&player_id=eq.${fiche.id}&statut=eq.active`)).corps?.[0];
t("il est rattaché à une équipe", !!equipe?.team_id);

// ── Accueil et calendrier : les deux sources du calendrier ─────────────────────────────────
const evts = await rest(j.H, `club_calendar_events?select=id,type&club_id=eq.${fiche.club_id}`);
const matchs = await rest(j.H,
  `club_matches?select=id,team,opponent,match_date,score,opponent_club_slug&club_id=eq.${fiche.club_id}&order=match_date`);
t("les deux sources du calendrier répondent", evts.code === 200 && matchs.code === 200,
  `événements ${evts.code}, matchs ${matchs.code}`);
t("le calendrier a des matchs à afficher", (matchs.corps ?? []).length > 0,
  `${(matchs.corps ?? []).length} matchs`);
if ((evts.corps ?? []).length === 0) {
  note("aucun entraînement ni événement de club en base — le calendrier ne montrera que des matchs");
}

const joues = (matchs.corps ?? []).filter((m) => m.score);
if (joues.length === 0) note("aucun match avec un score — l'accueil n'aura aucun résultat à montrer");
else t("des résultats existent pour l'accueil", true, `${joues.length} matchs joués`);

// ── Fiche match : les deux formes d'identifiant ────────────────────────────────────────────
const unMatch = (matchs.corps ?? [])[0];
if (unMatch) {
  const r = await fetch(
    `${SB}/rest/v1/club_matches?select=id,team,opponent,match_date,kickoff_time,lieu,score,is_home,competition&id=eq.${unMatch.id}`,
    { headers: { ...j.H, Accept: "application/vnd.pgrst.object+json" } });
  t("la fiche d'un match s'ouvre pour un joueur", r.status === 200, `HTTP ${r.status}`);
}

// ── Photos ─────────────────────────────────────────────────────────────────────────────────
const albums = await rpc(j.H, "media_album_list",
  { p_club_id: fiche.club_id, p_team_id: equipe?.team_id, p_saison_id: equipe?.saison_id ?? null });
t("la liste des galeries répond", albums.code === 200, `HTTP ${albums.code}`);
if ((albums.corps ?? []).length === 0) {
  note("aucune galerie pour l'équipe du compte de démonstration — l'onglet Photos sera vide");
} else {
  const ids = albums.corps.map((a) => a.id);
  const videos = await rpc(j.H, "media_galeries_video", { p_album_ids: ids });
  t("les vidéos des galeries répondent", videos.code === 200, `HTTP ${videos.code}`);
  const compte = await rpc(j.H, "media_compte_photos_du_joueur",
    { p_album_id: ids[0], p_player_id: fiche.id });
  t("le comptage « mes photos » répond", compte.code === 200, `HTTP ${compte.code}`);
}

// ── Profil : l'écusson ─────────────────────────────────────────────────────────────────────
const ident = await rpc(j.H, "club_identite", { p_club_id: fiche.club_id });
const club = Array.isArray(ident.corps) ? ident.corps[0] : ident.corps;
t("l'identité du club répond", ident.code === 200);
t("le club a un écusson", !!club?.ecusson_url, club?.nom ?? "");
if (club?.ecusson_url) {
  const img = await fetch(club.ecusson_url);
  t("l'écusson se charge vraiment", img.ok, `HTTP ${img.status}`);
}

// ── Les écussons des adversaires ───────────────────────────────────────────────────────────
const avecSlug = (matchs.corps ?? []).filter((m) => m.opponent_club_slug);
if (avecSlug.length) {
  const slugs = [...new Set(avecSlug.map((m) => m.opponent_club_slug))];
  const fede = await rest(j.H,
    `federation_clubs?select=slug,nom,logo_url&slug=in.(${slugs.slice(0, 20).join(",")})`);
  const avecLogo = (fede.corps ?? []).filter((f) => f.logo_url).length;
  t("l'annuaire fédéral est lisible depuis l'application", fede.code === 200, `HTTP ${fede.code}`);
  t("les adversaires ont un écusson", avecLogo > 0,
    `${avecLogo} sur ${(fede.corps ?? []).length} adversaires interrogés`);
} else {
  note("aucun match ne porte l'identifiant de son adversaire");
}

console.log("\n═══ ESPACE PARENT ═══\n");
const p = await session(COMPTES.parent);

const enfants = await rpc(p.H, "connect_list_my_athletes");
t("le parent voit ses enfants", (enfants.corps ?? []).length > 0, `${(enfants.corps ?? []).length}`);
t("il en a au moins deux, le sélecteur a un sens", (enfants.corps ?? []).length >= 2);

const agenda = await rpc(p.H, "connect_list_calendar_for_athletes");
t("le calendrier de la famille répond", agenda.code === 200, `HTTP ${agenda.code}`);
const parEnfant = {};
for (const e of agenda.corps ?? []) parEnfant[e.athlete_label] = (parEnfant[e.athlete_label] ?? 0) + 1;
t("chaque enfant a des événements", Object.keys(parEnfant).length === (enfants.corps ?? []).length,
  JSON.stringify(parEnfant));

// La fiche de match, côté parent : l'identifiant composite doit être ramené à son UUID.
const unMatchParent = (agenda.corps ?? []).find((e) => e.type === "match");
if (unMatchParent) {
  const compose = `${unMatchParent.source ?? "match"}-${unMatchParent.id}-${unMatchParent.athlete_ref_id}`;
  const extrait = compose.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  const r = await fetch(`${SB}/rest/v1/club_matches?select=id&id=eq.${extrait}`,
    { headers: { ...p.H, Accept: "application/vnd.pgrst.object+json" } });
  t("la fiche d'un match s'ouvre pour un parent", r.status === 200, `HTTP ${r.status}`);
}

// ── Les pages ouvertes en fenêtre, pour les deux rôles ─────────────────────────────────────
console.log("\n═══ PAGES OUVERTES DANS L'APPLICATION ═══\n");
const PAGES = ["/prestations", "/cotisations", "/commandes", "/factures",
               "/affiliations", "/equipes", "/messages", "/profil", "/acces",
               "/galeries", "/contenus", "/aide"];

for (const [role, s] of [["joueur", j], ["parent", p]]) {
  const mauvaises = [];
  for (const page of PAGES) {
    const corps = new URLSearchParams({
      access_token: s.jeton, refresh_token: s.rafraichissement, next: page });
    const r = await fetch("https://connect.sportvision-an.fr/auth/app", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: corps.toString(), redirect: "manual" });
    const biscuits = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get("set-cookie")])
      .filter(Boolean).map((c) => c.split(";")[0]).join("; ");
    const vue = await fetch(r.headers.get("location"), { headers: { cookie: biscuits }, redirect: "manual" });
    if (vue.status !== 200) mauvaises.push(`${page} → ${vue.status} ${vue.headers.get("location") ?? ""}`);
  }
  t(`les ${PAGES.length} pages s'ouvrent pour un ${role}`, mauvaises.length === 0, mauvaises.join(" | "));
}

console.log(`\n${ok} vérifications passées, ${echecs.length} échec(s), ${infos.length} constat(s) de données manquantes.`);
if (infos.length) {
  console.log("\nCe qui est vide faute de données, pas par défaut de l'application :");
  infos.forEach((i) => console.log("  · " + i));
}
if (echecs.length) { console.log(""); echecs.forEach((e) => console.log("  ❌ " + e)); process.exit(1); }
