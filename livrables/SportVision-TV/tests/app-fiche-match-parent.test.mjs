// La fiche d'un match s'ouvre, pour un joueur comme pour un parent (25/09/2026).
//
// SIGNALÉ PAR FOUKA : « quand j'appuie sur un résultat du calendrier, ça met chargement
// impossible ». Reproduit et mesuré le 25/09.
//
// LA CAUSE. Deux formes d'identifiant circulent dans l'application :
//
//   joueur   « match-<uuid du match> »                      posé par lireEvenements
//   parent   « match-<uuid du match>-<uuid de l'enfant> »   posé par lireCalendrierFamille
//
// Le second porte l'enfant parce que deux enfants peuvent jouer le même match : sans lui, les
// deux lignes du calendrier auraient la même clé React et une seule s'afficherait. Bonne raison.
// Mais la fiche de match ne retirait que le préfixe « match- » et envoyait le reste à la base,
// qui répondait « invalid input syntax for type uuid » — HTTP 400. L'écran affichait alors
// « chargement impossible », c'est-à-dire le message réservé aux vraies pannes.
//
// CE QUE CE TEST VÉRIFIE, contre la vraie base et avec de vrais comptes :
//   1. La forme composite du parent n'est PAS acceptée telle quelle par la base — c'est bien la
//      cause, et si un jour elle le devenait, ce test le dirait.
//   2. L'extraction du premier UUID redonne un identifiant que la base accepte.
//   3. Elle fonctionne aussi sur la forme simple du joueur, qui ne doit pas régresser.
import { SB, ANON } from "./_session-os.mjs";

const MDP = "DemoSportVision2026!";
const CHAMPS = "id,team,opponent,match_date,kickoff_time,lieu,score,is_home,competition";

let ok = 0;
const echecs = [];
const t = (nom, condition, detail = "") => {
  if (condition) { ok += 1; console.log("  ok  ", nom); }
  else { echecs.push(`${nom}${detail ? " — " + detail : ""}`); console.log("  KO  ", nom, detail); }
};

/** La même extraction que src/lib/donnees.ts. Recopiée ici : ce test tourne sans bundler. */
function identifiantDeMatch(id) {
  const m = id.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : id.replace(/^match-/, "");
}

async function session(email) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: MDP }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(`connexion impossible pour ${email}`);
  return { apikey: ANON, Authorization: `Bearer ${d.access_token}`, "Content-Type": "application/json" };
}

/** La requête exacte de lireMatch : maybeSingle passe par cet en-tête Accept. */
async function fiche(H, identifiant) {
  const r = await fetch(`${SB}/rest/v1/club_matches?select=${CHAMPS}&id=eq.${identifiant}`,
    { headers: { ...H, Accept: "application/vnd.pgrst.object+json" } });
  return { code: r.status, corps: await r.text() };
}

// ── Le parent ───────────────────────────────────────────────────────────────────────────────
const parent = await session("demo.parent.villemomble@example.invalid");
const agenda = await (await fetch(`${SB}/rest/v1/rpc/connect_list_calendar_for_athletes`,
  { method: "POST", headers: parent, body: "{}" })).json();
const match = (Array.isArray(agenda) ? agenda : []).find((e) => e.type === "match");
t("le parent reçoit bien des matchs dans son calendrier", !!match,
  `${Array.isArray(agenda) ? agenda.length : 0} événements`);

if (match) {
  // L'identifiant tel que l'application le construit pour le parent.
  const compose = `${match.source ?? "match"}-${match.id}-${match.athlete_ref_id}`;

  const brut = await fiche(parent, compose.replace(/^match-/, ""));
  t("la forme composite est bien refusée par la base (c'est la cause)",
    brut.code === 400 && brut.corps.includes("invalid input syntax for type uuid"),
    `HTTP ${brut.code}`);

  const corrige = await fiche(parent, identifiantDeMatch(compose));
  t("après extraction du premier UUID, la fiche s'ouvre", corrige.code === 200, `HTTP ${corrige.code}`);
  t("et c'est bien le bon match", corrige.corps.includes(match.id));
}

// ── Le joueur, qui ne doit pas régresser ────────────────────────────────────────────────────
const joueur = await session("demo.u18.villemomble@example.invalid");
const siens = await (await fetch(
  `${SB}/rest/v1/club_matches?select=id&limit=1`, { headers: joueur })).json();
t("le joueur voit ses matchs", Array.isArray(siens) && siens.length > 0);

if (siens?.[0]) {
  const simple = `match-${siens[0].id}`;
  t("l'extraction ne casse pas la forme simple", identifiantDeMatch(simple) === siens[0].id);
  const r = await fiche(joueur, identifiantDeMatch(simple));
  t("et la fiche du joueur s'ouvre", r.code === 200, `HTTP ${r.code}`);
}

console.log(`\n${ok} vérifications passées, ${echecs.length} échec(s).`);
if (echecs.length) { echecs.forEach((e) => console.log("  ❌ " + e)); process.exit(1); }
