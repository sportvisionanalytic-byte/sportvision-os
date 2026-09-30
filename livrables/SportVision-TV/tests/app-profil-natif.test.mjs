// MON PROFIL, ECRIT DEPUIS L'APPLICATION (30/09/2026)
//
// L'ecran natif « Mon profil » ecrit dans `auth.users.user_metadata` par l'API Auth, comme Club+.
// Trois choses doivent rester vraies :
//
//   1. l'ecriture PASSE avec le seul jeton de la personne, sans aucune policy a prevoir ;
//   2. ce qu'on relit est bien ce qu'on a ecrit — l'ecran ne dit « enregistre » que si les
//      metadonnees rendues correspondent, jamais sur la seule absence d'erreur ;
//   3. elle ne touche PAS `club_members`. Cette table porte les DROITS (role, statut, perimetre
//      d'equipes) et un formulaire de profil n'a rien a y ecrire, meme si le declencheur
//      `protect_sensitive_club_member_fields` l'y autoriserait pour le seul prenom.
//
// Les metadonnees d'essai sont relues avant, restaurees apres, et la restauration est verifiee.
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

const lien = await (await fetch(`${SB}/auth/v1/admin/generate_link`, {
  method: "POST", headers: admin,
  body: JSON.stringify({ type: "magiclink", email: COACH, redirect_to: "https://clubplus.sportvision-an.fr/clubplus" }),
})).json();
const loc = (await fetch(lien.action_link, { redirect: "manual" })).headers.get("location") || "";
const jeton = new URLSearchParams(loc.split("#")[1] || "").get("access_token");
if (!jeton) { console.log("ROUGE aucun jeton"); process.exit(1); }
const moi = { apikey: ANON, Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" };

const lireCompte = async () => (await (await fetch(`${SB}/auth/v1/user`, { headers: moi })).json());
const ecrireProfil = async (data) => {
  const r = await fetch(`${SB}/auth/v1/user`, { method: "PUT", headers: moi, body: JSON.stringify({ data }) });
  return { statut: r.status, corps: await r.json() };
};

const avant = (await lireCompte()).user_metadata ?? {};
const uid = (await lireCompte()).id;
const membreAvant = (await (await fetch(`${SB}/rest/v1/club_members?select=prenom,nom,role,teams&user_id=eq.${uid}&status=eq.actif`, { headers: admin })).json())[0];

try {
  const essai = { prenom: "Marc-Essai", nom: "Lemoine-Essai", telephone: "0600000000", locale: "fr" };
  const ecrit = await ecrireProfil(essai);
  verdict(ecrit.statut === 200, `l'ecriture du profil passe avec le seul jeton (${ecrit.statut})`);

  const m = ecrit.corps?.user_metadata ?? {};
  verdict(m.prenom === essai.prenom && m.nom === essai.nom && m.telephone === essai.telephone,
    `l'API rend bien ce qu'on a ecrit (${m.prenom} / ${m.nom} / ${m.telephone})`);

  const relu = (await lireCompte()).user_metadata ?? {};
  verdict(relu.prenom === essai.prenom, `et une relecture le confirme (${relu.prenom})`);

  const membreApres = (await (await fetch(`${SB}/rest/v1/club_members?select=prenom,nom,role,teams&user_id=eq.${uid}&status=eq.actif`, { headers: admin })).json())[0];
  verdict(membreApres.prenom === membreAvant.prenom && membreApres.nom === membreAvant.nom,
    `club_members n'a pas bouge (${membreApres.prenom} / ${membreApres.nom})`);
  verdict(membreApres.role === membreAvant.role && JSON.stringify(membreApres.teams) === JSON.stringify(membreAvant.teams),
    "ni le role ni le perimetre d'equipes");
} finally {
  await ecrireProfil({
    prenom: avant.prenom ?? null, nom: avant.nom ?? null,
    telephone: avant.telephone ?? null, locale: avant.locale ?? null,
  });
  const apres = (await lireCompte()).user_metadata ?? {};
  const remis = (apres.prenom ?? null) === (avant.prenom ?? null) && (apres.nom ?? null) === (avant.nom ?? null);
  verdict(remis, `le profil d'essai est remis dans son etat (prenom=${apres.prenom ?? "vide"})`);
}

console.log(rouges ? `\n${rouges} rouge(s)` : "\nLe profil natif ecrit la ou il doit, et nulle part ailleurs");
process.exit(rouges ? 1 : 0);
