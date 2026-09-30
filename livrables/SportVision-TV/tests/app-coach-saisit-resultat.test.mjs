// UN COACH SAISIT LE RESULTAT DE SON MATCH, ET DE CELUI D'UN AUTRE : NON (30/09/2026)
//
// POURQUOI CE TEST. L'application mobile laisse un coach saisir un score au bord du terrain. Ce
// geste ecrit dans `club_matches`, table que la RLS borne au perimetre d'equipes du membre
// (`cma_member_update` : is_club_member(club_id) AND (team_id IS NULL OR is_team_educateur)).
// Deux choses doivent rester vraies, et aucune ne se lit dans le code de l'application :
//
//   1. l'ecriture PASSE sur une equipe de son perimetre, sinon la fonctionnalite n'existe pas ;
//   2. elle est REFUSEE ailleurs, et refusee SANS ERREUR — PostgREST rend 200 et zero ligne.
//      C'est le piege : sans `.select()`, l'application afficherait « enregistre » alors que rien
//      n'a bouge. Regle du 10/09 : aucune action n'affiche un succes si la ligne n'a pas change.
//
// IL VERIFIE AUSSI LE DECLENCHEUR. `trg_club_matches_sport_status` accorde `status` et
// `sport_status` dans les deux sens. L'application n'ecrit que `status`, en comptant sur lui :
// si ce declencheur disparaissait, le telephone des familles continuerait d'annoncer un match
// reporte comme prevu, et personne ne le verrait avant qu'une famille se deplace pour rien.
//
// IL REMET TOUT EN PLACE. Le match d'essai est relu avant, restaure apres, et la restauration est
// verifiee. Aucun declencheur de notification ne se declenche sur un score : `signaler_evenement_
// modifie` ne reagit qu'a une date, un horaire, un lieu ou un adversaire.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../../../.env", import.meta.url).pathname, "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const SB = env.SUPABASE_URL, ANON = env.SUPABASE_ANON_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const COACH = "demo.coach.fontainebleau@example.invalid";
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

let rouges = 0;
const verdict = (ok, quoi) => { if (!ok) rouges++; console.log(`  ${ok ? "\x1b[32mvert \x1b[0m" : "\x1b[31mROUGE\x1b[0m"} ${quoi}`); };

async function jetonDe(email) {
  const l = await (await fetch(`${SB}/auth/v1/admin/generate_link`, {
    method: "POST", headers: admin,
    body: JSON.stringify({ type: "magiclink", email, redirect_to: "https://clubplus.sportvision-an.fr/clubplus" }),
  })).json();
  const loc = (await fetch(l.action_link, { redirect: "manual" })).headers.get("location") || "";
  return new URLSearchParams(loc.split("#")[1] || "").get("access_token");
}

const jeton = await jetonDe(COACH);
if (!jeton) { console.log("ROUGE aucun jeton pour le coach d'essai"); process.exit(1); }
const coach = { apikey: ANON, Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" };

const lire = async (q, h = admin) => (await (await fetch(`${SB}/rest/v1/${q}`, { headers: h })).json());
const ecrire = async (id, corps, h) => {
  const r = await fetch(`${SB}/rest/v1/club_matches?id=eq.${id}&select=id`, {
    method: "PATCH", headers: { ...h, Prefer: "return=representation" }, body: JSON.stringify(corps),
  });
  const lignes = await r.json();
  return { statut: r.status, lignes: Array.isArray(lignes) ? lignes.length : -1 };
};

const moi = await (await fetch(`${SB}/auth/v1/user`, { headers: coach })).json();
const membre = (await lire(`club_members?select=club_id,teams,role&user_id=eq.${moi.id}&status=eq.actif`, coach))[0];
verdict(membre?.role === "coach", `le compte d'essai est bien un coach (${membre?.role})`);
const sienne = membre?.teams?.[0];
verdict(!!sienne, `il a un perimetre d'equipe (${JSON.stringify(membre?.teams)})`);

const equipes = await lire(`club_teams?select=id,name&club_id=eq.${membre.club_id}`);
const idSienne = equipes.find((e) => e.name === sienne)?.id;
const idAutre = equipes.find((e) => e.name !== sienne && e.id !== idSienne)?.id;

const sonMatch = (await lire(`club_matches?select=id,score,status,sport_status&team_id=eq.${idSienne}&order=match_date.desc&limit=1`))[0];
verdict(!!sonMatch, "un match de son equipe existe");
const avant = { score: sonMatch.score, status: sonMatch.status, sport_status: sonMatch.sport_status };

try {
  // 1. Il enregistre un resultat sur SON match.
  const joue = await ecrire(sonMatch.id, { status: "recu", score: "4-2" }, coach);
  verdict(joue.lignes === 1, `il enregistre le resultat de son match (${joue.statut}, ${joue.lignes} ligne)`);

  let relu = (await lire(`club_matches?select=score,status,sport_status&id=eq.${sonMatch.id}`))[0];
  verdict(relu.score === "4-2", `le score est bien en base (${relu.score})`);
  verdict(relu.sport_status === "completed",
    `le declencheur a pose sport_status = completed (${relu.sport_status})`);

  // 2. Il reporte le match : les familles doivent le voir.
  const reporte = await ecrire(sonMatch.id, { status: "reportee", score: null }, coach);
  verdict(reporte.lignes === 1, "il reporte son match");
  relu = (await lire(`club_matches?select=score,status,sport_status&id=eq.${sonMatch.id}`))[0];
  verdict(relu.sport_status === "postponed",
    `le declencheur a pose sport_status = postponed, que l'application des familles lit (${relu.sport_status})`);
  verdict(relu.score === null, "un match reporte ne garde pas le score d'une saisie precedente");

  // 3. Le match d'une autre equipe lui est refuse — 200 et zero ligne, pas une erreur.
  if (idAutre) {
    const autreMatch = (await lire(`club_matches?select=id,score,status&team_id=eq.${idAutre}&limit=1`))[0];
    if (autreMatch) {
      const refus = await ecrire(autreMatch.id, { status: "recu", score: "9-0" }, coach);
      verdict(refus.lignes === 0, `l'equipe d'un autre lui est refusee (${refus.statut}, ${refus.lignes} ligne)`);
      const intact = (await lire(`club_matches?select=score,status&id=eq.${autreMatch.id}`))[0];
      verdict(intact.score === autreMatch.score && intact.status === autreMatch.status,
        "et rien n'a bouge sur ce match");
    } else { verdict(false, "aucun match sur une autre equipe pour mesurer le refus"); }
  } else { verdict(false, "aucune autre equipe dans ce club"); }
} finally {
  // ON REMET EN PLACE, ET ON LE VERIFIE. Un test qui laisse la production modifiee est pire qu'un
  // test absent : on ne sait plus si une donnee etrange vient du terrain ou de nous.
  await ecrire(sonMatch.id, avant, admin);
  const apres = (await lire(`club_matches?select=score,status,sport_status&id=eq.${sonMatch.id}`))[0];
  const remis = apres.score === avant.score && apres.status === avant.status && apres.sport_status === avant.sport_status;
  verdict(remis, `le match d'essai est remis dans son etat (${JSON.stringify(apres)})`);
}

console.log(rouges ? `\n${rouges} rouge(s)` : "\nLa saisie du resultat respecte le perimetre du coach");
process.exit(rouges ? 1 : 0);
