// Charge la SAISON COMPLETE des matchs d'un club depuis la source federale, et l'ecrit dans un
// fichier JSON. N'ecrit rien en base : c'est l'etape « regarder avant d'agir ».
//
//   node livrables/SportVision-TV/scripts/charger-saison-federale.mjs villemomble-sports sortie.json
//
// ── Pourquoi ce script est local et pas une edge function ──
// Deux sources coexistent chez le fournisseur, et elles n'ont pas la meme solidite :
//
//   * l'API JSON (api.sportcorico.com/api/clubs/{slug}) rend du JSON propre, mais seulement une
//     fenetre glissante d'environ trois semaines. C'est elle qui porte les LIEUX. C'est elle que
//     l'edge function federation-club-fiche interroge, et elle seule qui tournera en automatique.
//
//   * les pages d'equipe portent la saison entiere (375 matchs pour Villemomble, aout a mai) mais
//     AUCUN lieu, et leur contenu est embarque dans un bloc JavaScript minifie qu'aucun lecteur
//     JSON ne sait lire. Il faut l'evaluer.
//
// Evaluer du code venu d'un tiers, meme dans un bac a sable, n'a pas sa place dans un service
// deploye qui tourne tout seul : une refonte de leur site le casserait sans prevenir, en pleine
// nuit, sur un automatisme que personne ne regarde. Fouka a tranche le 09/09/2026 : la saison se
// charge a la main quand on le demande, l'automatisme ne repose que sur l'API stable.
//
// Le bac a sable est un contexte vm SANS prototype, sans require, sans process, sans fetch : le
// code evalue ne peut que construire et rendre un objet.

import vm from "node:vm";
import { writeFileSync } from "node:fs";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const API = "https://api.sportcorico.com/api/clubs";
const SITE = "https://www.sportcorico.com/clubs";

const [slugClub, sortie] = process.argv.slice(2);
if (!slugClub || !sortie) {
  console.error("Usage : node charger-saison-federale.mjs <slug-du-club> <sortie.json>");
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(slugClub)) {
  console.error("Slug de club invalide.");
  process.exit(1);
}

/** JJ/MM/AAAA → AAAA-MM-JJ, ou null. Une date mal comprise vaut moins que pas de date : elle se
 *  retrouverait silencieusement dans le calendrier d'un club. */
function versIso(v) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((v ?? "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

async function texte(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${r.status} sur ${url}`);
  return r.text();
}

/** Extrait les objets « match » de l'etat embarque dans une page d'equipe. */
async function matchsDeLaPage(slugEquipe) {
  const html = await texte(`${SITE}/${slugClub}/${slugEquipe}`);
  const debut = html.indexOf("window.__NUXT__=");
  if (debut < 0) return [];
  const source = html
    .slice(debut + "window.__NUXT__=".length, html.indexOf("</script>", debut))
    .replace(/;\s*$/, "");

  let etat;
  try {
    etat = vm.runInNewContext(`(${source})`, Object.create(null), { timeout: 5000 });
  } catch (e) {
    console.error(`  ! ${slugEquipe} : etat illisible (${e.message})`);
    return [];
  }

  const trouves = [];
  const vus = new Set();
  (function parcourir(n, profondeur = 0) {
    if (!n || typeof n !== "object" || profondeur > 12 || vus.has(n)) return;
    vus.add(n);
    if (Array.isArray(n)) { for (const x of n) parcourir(x, profondeur + 1); return; }
    if ("planned_date" in n && ("home_team_name" in n || "outside_team_name" in n)) trouves.push(n);
    for (const cle of Object.keys(n)) parcourir(n[cle], profondeur + 1);
  })(etat);
  return trouves;
}

// 1. L'API donne la liste des equipes engagees, et les lieux sur la fenetre courante.
console.log(`Fiche de ${slugClub}…`);
const fiche = JSON.parse(await texte(`${API}/${slugClub}`));
const club = fiche?.club;
if (!club) { console.error("Fiche illisible."); process.exit(1); }

const equipes = (club.categories_matches ?? []).flatMap((cat) =>
  (cat.teams ?? []).map((t) => ({
    slug: t.slug, nom: t.name_generated ?? null,
    categorie: cat.name ?? null, feminine: Boolean(cat.is_female),
  })),
).filter((e) => e.slug);

console.log(`${club.name} · affiliation ${club.affiliation_number} · ${equipes.length} equipes engagees`);

// Les lieux ne vivent que dans la fenetre glissante de l'API : on les indexe pour les recoller
// sur les matchs de la saison, qui n'en portent aucun.
const lieux = new Map();
for (const jour of [...(club.previousMatches ?? []), ...(club.currentMatches ?? []), ...(club.nextMatches ?? [])]) {
  for (const m of jour.matches ?? []) if (m.id && m.location) lieux.set(m.id, m.location);
}
console.log(`${lieux.size} lieux connus via la fenetre courante`);

// 2. Les pages d'equipe donnent la saison entiere.
const parId = new Map();
for (const e of equipes) {
  const bruts = await matchsDeLaPage(e.slug);
  // On retient de QUELLE page vient chaque match. C'est la seule facon fiable de savoir laquelle
  // des deux equipes est celle du club : sur les pages de saison, `home_team_club_slug` est
  // souvent absent, et s'y fier inversait equipe et adversaire — au point de faire apparaitre
  // « Gournay FC Seniors 1 » comme une equipe de Villemomble (constate le 09/09/2026).
  for (const m of bruts) if (m.id && !parId.has(m.id)) parId.set(m.id, { ...m, _equipe: e });
  console.log(`  ${e.slug.padEnd(24)} ${(e.nom ?? "").padEnd(22)} ${String(bruts.length).padStart(3)} matchs`);
}

const matchs = [...parId.values()].map((m) => {
  // Les deux surfaces du fournisseur ne nomment pas ce champ pareil : l'API dit
  // `home_team_club_slug`, les pages de saison disent `home_club_slug`. Se fier a un seul des deux
  // donnait 375 matchs « a l'exterieur » sur 375, et un match ou l'equipe affrontait elle-meme.
  const clubDomicile = m.home_club_slug ?? m.home_team_club_slug ?? null;
  const domicile = clubDomicile === slugClub;
  return {
    external_event_id: String(m.id),
    date: versIso(m.planned_date),
    heure: m.planned_time || null,
    lieu: lieux.get(m.id) ?? null,
    competition: m.championship_name ?? null,
    poule: m.pool_name ?? null,
    // L'equipe du club vient de la page parcourue, pas du match : c'est la seule donnee sure.
    equipe_source: m._equipe.nom,
    equipe_source_slug: m._equipe.slug,
    equipe_categorie: m._equipe.categorie,
    equipe_feminine: m._equipe.feminine,
    adversaire: domicile ? m.outside_team_name ?? null : m.home_team_name ?? null,
    // Le club adverse, pas son equipe : c'est lui qui porte l'ecusson, et son identifiant permet
    // de ranger cet ecusson dans l'annuaire plutot que de le recopier sur chaque match.
    adversaire_club: domicile ? m.outside_club_name || null : m.home_club_name || null,
    adversaire_club_slug: domicile ? m.outside_club_slug ?? null : m.home_club_slug ?? null,
    adversaire_logo: domicile ? m.outside_logo ?? null : m.home_logo ?? null,
    domicile,
    // « Notre equipe - adversaire », JAMAIS « receveur - visiteur ».
    // C'est la convention de `club_matches.score` partout ailleurs : `saveClubMatchResult` ecrit
    // `scoreFor-scoreAgainst`, et `parseScore` relit le premier nombre comme le NOTRE. Ce script
    // ecrivait la paire brute de la source, donc a l'envers des qu'on jouait a l'exterieur.
    // Aucun score n'etait encore passe par ici (aucun match joue au moment de l'ecrire), mais le
    // prochain chargement de saison aurait inverse tous les scores des matchs a l'exterieur.
    score:
      m.home_score != null && m.outside_score != null
        ? domicile
          ? `${m.home_score}-${m.outside_score}`
          : `${m.outside_score}-${m.home_score}`
        : null,
    exempt: Boolean(m.exempt),
    reporte: Boolean(m.postponed),
  };
}).filter((m) => m.date);

matchs.sort((a, b) => (a.date + (a.heure ?? "")).localeCompare(b.date + (b.heure ?? "")));

// Deduplication sur la SIGNATURE METIER, en plus de l'identifiant.
// La source expose parfois deux identifiants pour une meme rencontre : les calendriers de
// SENIORS 3 et de U14 2 etaient integralement dupliques (44 et 40 matchs au lieu de 22 et 20),
// memes date, heure, competition et equipes, deux ids. Dedupliquer sur le seul id ne pouvait pas
// le voir, et 27 doublons sont partis en base avant qu'on s'en apercoive (09/09/2026).
// On garde le plus petit identifiant : c'est le calendrier d'origine.
const vusMetier = new Set();
const uniques = [];
for (const m of matchs) {
  const signature = [m.date, m.heure ?? "", m.equipe_source ?? "", m.adversaire ?? ""].join("");
  if (vusMetier.has(signature)) continue;
  vusMetier.add(signature);
  uniques.push(m);
}
if (uniques.length !== matchs.length) {
  console.log(`${matchs.length - uniques.length} doublons de la source ecartes (meme rencontre, deux identifiants)`);
}
matchs.length = 0;
matchs.push(...uniques);

writeFileSync(sortie, JSON.stringify({
  source: "SPORTCORICO",
  charge_le: new Date().toISOString(),
  club: {
    slug: slugClub, nom: club.name ?? null,
    affiliation_number: club.affiliation_number ?? null,
    saison: club.active_season?.label ?? null,
    logo_url: club.logo_filename ?? null,
  },
  equipes, matchs,
}, null, 1), "utf8");

const dates = matchs.map((m) => m.date);
console.log(`\n${matchs.length} matchs uniques · ${dates[0]} → ${dates[dates.length - 1]}`);
console.log(`avec heure ${matchs.filter((m) => m.heure).length} · avec lieu ${matchs.filter((m) => m.lieu).length} · exempts ${matchs.filter((m) => m.exempt).length}`);
console.log(`ecrit dans ${sortie}`);
