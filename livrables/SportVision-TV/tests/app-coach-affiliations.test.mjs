// UN COACH ACCEPTE DANS SON EQUIPE, ET NE VOIT QUE SES DEMANDES (30/09/2026)
//
// L'ecran natif « Affiliations » laisse un coach accepter ou refuser une demande d'adhesion. Trois
// choses doivent rester vraies, et aucune ne se lit dans le code de l'application :
//
//   1. IL NE LIT QUE SES EQUIPES. `mr_educateur_select` dit team_id IS NOT NULL AND
//      is_team_educateur(team_id). Ici, contrairement aux galeries et aux equipes, c'est la BASE
//      qui borne — l'ecran n'a aucun filtre, et c'est preferable.
//   2. LES TROIS FONCTIONS LUI SONT ATTEIGNABLES. Si l'une cessait d'etre executable par un compte
//      connecte, les boutons echoueraient sans que rien d'autre ne le signale.
//   3. UNE DEMANDE DEJA TRAITEE EST REFUSEE. C'est le garde-fou contre le double appui, et il
//      passe AVANT le controle d'autorisation dans la fonction : on le mesure tel quel.
//
// CE TEST N'ECRIT RIEN. Les quatre demandes reelles sont toutes deja validees : les toucher
// creerait une affiliation dans un vrai club. On mesure donc sur des identifiants inexistants et
// sur des lignes deja closes, ce qui suffit a prouver l'atteignabilite et l'ordre des gardes.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../../../.env", import.meta.url).pathname, "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const SB = env.SUPABASE_URL, ANON = env.SUPABASE_ANON_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

let rouges = 0;
const verdict = (ok, quoi) => { if (!ok) rouges++; console.log(`  ${ok ? "\x1b[32mvert \x1b[0m" : "\x1b[31mROUGE\x1b[0m"} ${quoi}`); };

const lien = await (await fetch(`${SB}/auth/v1/admin/generate_link`, {
  method: "POST", headers: admin,
  body: JSON.stringify({ type: "magiclink", email: "demo.coach.fontainebleau@example.invalid", redirect_to: "https://clubplus.sportvision-an.fr/clubplus" }),
})).json();
const jeton = new URLSearchParams(((await fetch(lien.action_link, { redirect: "manual" })).headers.get("location") || "").split("#")[1] || "").get("access_token");
if (!jeton) { console.log("ROUGE aucun jeton"); process.exit(1); }
const coach = { apikey: ANON, Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" };

const lire = async (q, h) => (await (await fetch(`${SB}/rest/v1/${q}`, { headers: h })).json());
const rpc = async (nom, corps, h) => {
  const r = await fetch(`${SB}/rest/v1/rpc/${nom}`, { method: "POST", headers: h, body: JSON.stringify(corps) });
  return { statut: r.status, corps: await r.json().catch(() => null) };
};

const moi = await (await fetch(`${SB}/auth/v1/user`, { headers: coach })).json();
const membre = (await lire(`club_members?select=club_id,teams&user_id=eq.${moi.id}&status=eq.actif`, coach))[0];
const sesEquipes = membre.teams ?? [];

// 1. Le perimetre de lecture, tenu par la RLS.
const toutes = await lire(`membership_requests?select=id,team_id,statut,club_teams(name)`, admin);
const lues = await lire(`membership_requests?select=id,team_id,statut,club_teams(name)`, coach);
const horsPerimetre = lues.filter((d) => !sesEquipes.includes(d.club_teams?.name));
console.log(`  perimetre du coach : ${JSON.stringify(sesEquipes)}`);
verdict(Array.isArray(lues), `il lit ${lues.length} demande(s) sur ${toutes.length} en base`);
verdict(horsPerimetre.length === 0,
  horsPerimetre.length === 0
    ? "aucune demande hors de ses equipes ne lui parvient"
    : `${horsPerimetre.length} demande(s) hors perimetre lui parviennent : ${horsPerimetre.map((d) => d.club_teams?.name).join(", ")}`);

// 2. Les trois fonctions repondent, avec leur propre message.
const inexistant = "00000000-0000-0000-0000-000000000000";
for (const [nom, corps] of [
  ["confirm_request_educateur", { p_request_id: inexistant }],
  ["validate_team_membership", { p_request_id: inexistant, p_par_code: false }],
  ["reject_team_membership", { p_request_id: inexistant, p_motif: null }],
]) {
  const r = await rpc(nom, corps, coach);
  const message = r.corps?.message ?? "";
  verdict(/introuvable/i.test(message), `${nom} est atteignable et repond « ${message || r.statut} »`);
}

// 3. Le garde-fou du double appui, sur une vraie demande deja close.
const close = toutes.find((d) => d.statut === "validee" || d.statut === "refusee");
if (close) {
  const r = await rpc("validate_team_membership", { p_request_id: close.id, p_par_code: false }, coach);
  const message = r.corps?.message ?? "";
  verdict(/deja/i.test(message.normalize("NFD").replace(/[̀-ͯ]/g, "")),
    `une demande deja traitee est refusee (« ${message} »)`);
} else {
  verdict(false, "aucune demande close pour mesurer le garde-fou du double appui");
}

console.log(rouges ? `\n${rouges} rouge(s)` : "\nLes affiliations restent bornees au perimetre du coach");
process.exit(rouges ? 1 : 0);
