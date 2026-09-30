// UN COACH INVITE DANS SON EQUIPE, ET NULLE PART AILLEURS (30/09/2026)
//
// POURQUOI CE TEST. L'edge function `clubplus-family-invite` autorise en deux temps :
// `peut_operer_club` d'abord — faux pour un coach — puis, en repli, `is_team_educateur(team_id)`.
// C'est ce repli qui donne au coach le droit que Fouka veut : « uniquement ses joueurs et ses
// parents, mais uniquement pour sa categorie ». Je l'avais rate en lisant l'en-tete de la fonction
// et pas son corps, et j'avais cache le bouton a tous les coachs. Ce test existe pour que
// personne n'ait plus a relire le corps.
//
// CE QU'IL MESURE, SANS RIEN CREER :
//   1. `is_team_educateur` est VRAI sur son equipe, FAUX sur celle d'un autre. C'est la condition
//      exacte de la fonction.
//   2. L'appel REEL a la fonction avec l'equipe d'un autre est REFUSE. L'autorisation precede la
//      creation : un refus ne laisse ni compte, ni invitation, ni e-mail.
//
// CE QU'IL NE MESURE PAS, ET IL FAUT LE DIRE : l'envoi qui reussit. Le faire creerait un vrai
// compte et enverrait un vrai e-mail a une vraie adresse. Le droit est prouve par la base, la
// reussite de l'envoi ne l'est pas.
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
const rpc = async (nom, corps) => (await (await fetch(`${SB}/rest/v1/rpc/${nom}`, { method: "POST", headers: coach, body: JSON.stringify(corps) })).json());

const moi = await (await fetch(`${SB}/auth/v1/user`, { headers: coach })).json();
const membre = (await lire(`club_members?select=club_id,teams&user_id=eq.${moi.id}&status=eq.actif`, coach))[0];
const sienne = membre.teams?.[0];
const equipes = await lire(`club_teams?select=id,name&club_id=eq.${membre.club_id}`, admin);
const idSienne = equipes.find((e) => e.name === sienne)?.id;
const autre = equipes.find((e) => e.name !== sienne);

verdict(!!idSienne && !!autre, `son equipe = ${sienne}, equipe d'un autre = ${autre?.name}`);
verdict(await rpc("peut_operer_club", { p_club_id: membre.club_id }) === false,
  "peut_operer_club est FAUX pour lui : c'est bien le repli qui le rend autorise");
verdict(await rpc("is_team_educateur", { p_team_id: idSienne }) === true,
  `is_team_educateur(${sienne}) est vrai`);
verdict(await rpc("is_team_educateur", { p_team_id: autre.id }) === false,
  `is_team_educateur(${autre.name}) est faux`);

// L'appel reel, sur l'equipe d'un AUTRE. Le refus tombe avant toute creation.
const r = await fetch(`${SB}/functions/v1/clubplus-family-invite`, {
  method: "POST", headers: coach,
  body: JSON.stringify({
    target_type: "joueur",
    email: `refus-attendu-${Date.now()}@example.invalid`,
    prenom: "Refus", nom: "Attendu",
    club_id: membre.club_id, team_id: autre.id, date_naissance: "2010-01-01",
  }),
});
const corps = await r.json().catch(() => null);
verdict(r.status === 403, `inviter dans ${autre.name} lui est refuse (${r.status} — « ${corps?.error ?? ""} »)`);

const cree = await lire(`player_invitations?select=id&team_id=eq.${autre.id}&prenom=eq.Refus`, admin);
verdict(Array.isArray(cree) && cree.length === 0, "et rien n'a ete cree");

console.log(rouges ? `\n${rouges} rouge(s)` : "\nUn coach invite dans son equipe, et nulle part ailleurs");
process.exit(rouges ? 1 : 0);
