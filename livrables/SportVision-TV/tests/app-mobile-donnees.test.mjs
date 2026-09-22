// L'application mobile, éprouvée avec de vrais comptes (23/09/2026).
//
// POURQUOI CE TEST. L'application native lit la base directement, avec la clé publique et la
// session de la personne : ce qu'elle voit est donc décidé par les règles d'accès, pas par le
// code des écrans. Un écran peut être parfait et laisser fuir un club entier si une règle est
// trop large ; il peut aussi rester vide alors que tout est correct, si une règle est trop
// étroite. Les deux sont déjà arrivés ce mois-ci (v251, v252).
//
// On rejoue donc EXACTEMENT les requêtes de l'application, avec trois identités : un joueur, son
// parent, et un visiteur non connecté. Et on vérifie autant ce qui doit remonter que ce qui doit
// rester fermé.
//
//   node livrables/SportVision-TV/tests/app-mobile-donnees.test.mjs

import { SB, ANON, enTeteAdmin } from "./_session-os.mjs";

const MDP = "DemoSportVision2026!";
const JOUEUR = "demo.u18.villemomble@example.invalid";
const PARENT = "demo.parent.villemomble@example.invalid";
const AUTRE_JOUEUR = "demo.joueur.fontainebleau@example.invalid";

let ok = 0;
const echecs = [];
const t = (nom, condition, detail = "") => {
  if (condition) { ok += 1; console.log("  ok  ", nom); }
  else { echecs.push(`${nom}${detail ? " — " + detail : ""}`); console.log("  KO  ", nom, detail); }
};

async function session(email) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: MDP }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(`connexion impossible pour ${email} : ${d.error_description || d.msg}`);
  return { apikey: ANON, Authorization: `Bearer ${d.access_token}` };
}

const lire = async (entetes, chemin) => {
  const r = await fetch(`${SB}/rest/v1/${chemin}`, { headers: entetes });
  const d = await r.json().catch(() => null);
  return { statut: r.status, données: d };
};
const rpc = async (entetes, nom, corps = {}) => {
  const r = await fetch(`${SB}/rest/v1/rpc/${nom}`, {
    method: "POST", headers: { ...entetes, "Content-Type": "application/json" },
    body: JSON.stringify(corps),
  });
  const d = await r.json().catch(() => null);
  return { statut: r.status, données: d };
};

console.log("\n── LE JOUEUR ────────────────────────────────────────────────");
const joueur = await session(JOUEUR);

const fiches = await lire(joueur, "player_profiles?select=id,prenom,club_id,account_status");
t("sa fiche joueur est lisible", Array.isArray(fiches.données) && fiches.données.length === 1,
  JSON.stringify(fiches.données).slice(0, 120));
const fiche = fiches.données?.[0] ?? {};
const CLUB = fiche.club_id;

const org = await lire(joueur, `organizations?select=id,nom,ville,logo_url&id=eq.${CLUB}`);
t("son club est lisible dans organizations", org.données?.length === 1);

const identite = await rpc(joueur, "club_identite", { p_club_id: CLUB });
t("club_identite lui rend l'écusson de son club", identite.données?.[0]?.ecusson_url != null,
  JSON.stringify(identite.données).slice(0, 120));

const equipe = await lire(joueur, `team_memberships?select=team_id,saison_id,club_teams(name)&player_id=eq.${fiche.id}&statut=eq.active`);
t("son équipe est lisible", equipe.données?.length >= 1);
const EQUIPE = equipe.données?.[0]?.team_id;

const matchs = await lire(joueur, `club_matches?select=id,team,team_id,match_date,score&club_id=eq.${CLUB}&order=match_date`);
t("il voit des matchs", Array.isArray(matchs.données) && matchs.données.length > 0,
  `reçus : ${matchs.données?.length}`);
t("il ne voit QUE les matchs de son équipe",
  (matchs.données ?? []).every((m) => !m.team_id || m.team_id === EQUIPE),
  `équipes distinctes : ${[...new Set((matchs.données ?? []).map((m) => m.team_id))].length}`);

const cal = await lire(joueur, `club_calendar_events?select=id,type,event_date&club_id=eq.${CLUB}&limit=5`);
t("le calendrier du club répond sans erreur", cal.statut === 200);

const galeries = await rpc(joueur, "media_album_list", { p_club_id: CLUB, p_team_id: EQUIPE, p_saison_id: null });
t("la liste des galeries répond", galeries.statut === 200, `statut ${galeries.statut}`);

console.log("\n── CE QUE LE JOUEUR NE DOIT PAS VOIR ───────────────────────");
const autre = await session(AUTRE_JOUEUR);
const autreFiche = (await lire(autre, "player_profiles?select=id,club_id")).données?.[0] ?? {};

const matchsAutreClub = await lire(joueur, `club_matches?select=id&club_id=eq.${autreFiche.club_id}&limit=5`);
t("les matchs d'un autre club lui sont fermés",
  !Array.isArray(matchsAutreClub.données) || matchsAutreClub.données.length === 0,
  `statut ${matchsAutreClub.statut}`);

const identiteAutre = await rpc(joueur, "club_identite", { p_club_id: autreFiche.club_id });
t("l'identité d'un autre club lui est fermée", (identiteAutre.données ?? []).length === 0);

const photosAutre = await rpc(joueur, "media_photos_du_joueur", { p_album_id: "00000000-0000-0000-0000-000000000000", p_player_id: autreFiche.id });
t("il ne peut pas demander les photos d'un autre joueur",
  photosAutre.statut !== 200 || (photosAutre.données ?? []).length === 0,
  `statut ${photosAutre.statut}`);

const fichesAutrui = await lire(joueur, "player_profiles?select=id&limit=50");
t("il ne lit pas l'annuaire des joueurs", (fichesAutrui.données ?? []).length <= 1,
  `fiches lues : ${fichesAutrui.données?.length}`);

console.log("\n── LE PARENT ────────────────────────────────────────────────");
const parent = await session(PARENT);

const sportifs = await rpc(parent, "connect_list_my_athletes");
t("il voit au moins un sportif", (sportifs.données ?? []).length >= 1,
  `reçus : ${sportifs.données?.length}`);
const enfant = (sportifs.données ?? [])[0] ?? {};

const detail = await rpc(parent, "connect_get_athlete_detail", { p_kind: enfant.kind, p_ref_id: enfant.ref_id });
t("le détail de son enfant porte l'équipe", detail.données?.team_id != null,
  JSON.stringify(detail.données).slice(0, 100));
t("le détail porte l'écusson du club", detail.données?.club_logo_url != null);

const calFamille = await rpc(parent, "connect_list_calendar_for_athletes");
t("son calendrier familial répond", calFamille.statut === 200,
  `lignes : ${(calFamille.données ?? []).length}`);
t("le calendrier familial porte le score", (calFamille.données ?? []).some((e) => "score" in e));

const detailAutre = await rpc(parent, "connect_get_athlete_detail", { p_kind: "club", p_ref_id: autreFiche.id });
t("il n'obtient rien sur l'enfant d'une autre famille", detailAutre.données == null,
  JSON.stringify(detailAutre.données).slice(0, 80));

console.log("\n── LE VISITEUR NON CONNECTÉ ─────────────────────────────────");
const anonyme = { apikey: ANON };
// Sans compte, la base répond soit une liste vide, soit un refus. Les deux conviennent : ce qui
// compte est qu'aucune ligne ne sorte. Compter la longueur d'un objet d'erreur, c'est se mentir.
const rienNeSort = (r) => !Array.isArray(r.données) || r.données.length === 0;
const matchsAnon = await lire(anonyme, `club_matches?select=id&club_id=eq.${CLUB}&limit=5`);
t("aucun match sans compte", rienNeSort(matchsAnon), `statut ${matchsAnon.statut}`);
const identiteAnon = await rpc(anonyme, "club_identite", { p_club_id: CLUB });
t("aucune identité de club sans compte", rienNeSort(identiteAnon), `statut ${identiteAnon.statut}`);
const sportifsAnon = await rpc(anonyme, "connect_list_my_athletes");
t("aucun sportif sans compte", rienNeSort(sportifsAnon), `statut ${sportifsAnon.statut}`);

console.log(`\n${ok} vérifications passées, ${echecs.length} échec(s).`);
if (echecs.length) { for (const e of echecs) console.log("  •", e); process.exit(1); }
