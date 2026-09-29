#!/usr/bin/env node
// LE MOTEUR DE RECONNAISSANCE, DEUXIÈME GÉNÉRATION (29/09/2026).
//
// Il remplace `scripts/reconnaissance-automatique.mjs`, qui lançait Chromium pour faire tourner
// face-api. Trois choses changent, et chacune a été mesurée sur la galerie réelle « RCPF VS PSG
// U16 » (110 photos) avant d'être écrite ici.
//
//   LE DÉTECTEUR.      SSD MobileNet trouvait 183 visages, soit 1,7 par photo. SCRFD en trouve
//                      284, soit 2,6 — et il rend cinq points de repère par visage, ce qui permet
//                      d'aligner avant de comparer.
//   L'EMPREINTE.       128 valeurs deviennent 512, avec ArcFace. Deux personnes différentes d'une
//                      même photo ne descendaient jamais sous 0,574 avec l'ancien, et la même
//                      personne montait à 0,53 : les deux se chevauchaient. Ici, différentes ≥ 1,41
//                      et la même à 0,30. La séparation est franche.
//   LE TEMPS.          371 ms par photo au lieu de 5 500. Quinze fois moins, sans navigateur.
//
// ET IL APPREND. Fouka : « chaque photo qu'il y a dans les galeries devient une photo de référence
// supplémentaire. Lui ne le voit pas, mais nous ça nous fait plus de matière pour le retrouver. »
// C'est fait, avec la précaution qui manquait — voir `accumuler` plus bas.
//
// CE QU'IL NE FAIT TOUJOURS PAS : aucune règle métier. Qui a le droit d'être reconnu, de quelle
// équipe, avec quel consentement, à partir de quand un marquage vaut : tout cela vit dans la base
// et n'est appelé que par ses fonctions. Une seconde copie des règles finirait par diverger de la
// première, et cinq défauts d'une seule journée venaient exactement de là.
//
//   node moteur.mjs                # vide la file
//   node moteur.mjs --voir         # dit seulement ce qui attend
//   node moteur.mjs --simuler      # calcule tout, n'écrit rien
//   node moteur.mjs --boucle       # attend la file et la vide, sans fin
//   node moteur.mjs --album <id>   # une galerie précise, même hors file

import { execFile, spawn } from "node:child_process";
import { readFileSync, writeSync } from "node:fs";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { visagesDe, detecterFin, distance, MODELE, preparer } from "./visages.mjs";
import { personnesDe, preparerPersonnes } from "./personnes.mjs";
import { lireDossards, LECTEUR_DOSSARDS } from "./dossards.mjs";
import { regrouper } from "./grappes.mjs";

const ICI = dirname(fileURLToPath(import.meta.url));
const VOIR = process.argv.includes("--voir");
const SIMULER = process.argv.includes("--simuler");
const EN_BOUCLE = process.argv.includes("--boucle");
const ALBUM_FORCE = (process.argv.find((a) => a.startsWith("--album=")) || "").split("=")[1] || null;
const ATTENTE = Math.max(5, Number((process.argv.find((a) => a.startsWith("--attente=")) || "").split("=")[1] || 20)) * 1000;

// Un service dont le journal ne dit rien ne se diagnostique pas : Node met sa sortie en tampon dès
// qu'elle va dans un fichier. En service, on écrit en synchrone.
const dire = EN_BOUCLE
  ? (t) => { try { writeSync(1, String(t) + "\n"); } catch { console.log(t); } }
  : console.log;

const env = Object.fromEntries(readFileSync(join(ICI, "../../../.env"), "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
  .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const URL_SB = env.SUPABASE_URL, CLE = env.SUPABASE_SECRET_KEY;
if (!URL_SB || !CLE) { console.error("SUPABASE_URL et SUPABASE_SECRET_KEY sont nécessaires."); process.exit(1); }

// ── Les réglages, et d'où ils viennent ──────────────────────────────────────────────────────────
const CFG = {
  // DÉTECTION, À DEUX ÉCHELLES (corrigé le 29/09/2026).
  //
  // La première mesure portait sur 8 photos et concluait « 1920 trouve plus que 640 ». Reprise sur
  // 40 photos, elle dit autre chose : les deux tailles trouvent exactement 71 visages, et chacune
  // en trouve 9 que l'autre rate. Réunies, 80 visages — 13 % de plus — pour 12 % de temps en plus,
  // parce que 640 px ne coûte que 193 ms quand 1920 en coûte 1 669. Voir detecterFin().
  //
  // Une justification fausse dans une configuration, c'est le prochain réglage qui part de travers.
  cotes: [1920, 640],
  // La photo de référence, elle, ne montre qu'un visage et vaut la meilleure empreinte possible :
  // une seule échelle, la plus fine. Mesuré : la même tête donne des empreintes distantes de 0,24
  // selon la taille de détection, et une reconnaissance certaine se joue à 0,95.
  cote: 1920,
  scoreMin: 0.3,
  // Sur un portrait déposé exprès, il n'y a personne d'autre à confondre : on descend, pour ne pas
  // rejeter une photo de référence un peu sombre.
  scoreMinReference: 0.2,

  // RESSEMBLANCE. Ces seuils appartiennent à l'espace d'ArcFace et n'ont RIEN À VOIR avec les
  // 0,42 / 0,55 de l'ancien modèle. Les reprendre aurait été refaire la faute du 28/09 : mesurer
  // dans une unité et trancher dans une autre.
  //
  // Ce qu'on sait, mesuré : deux personnes différentes d'une même photo ne descendent pas sous
  // 1,41 ; les trois photos que Fouka a confirmées à la main sont à 0,384, 1,124 et 1,207 ; la
  // masse des inconnus commence vers 1,2.
  //
  // CES CHIFFRES REPOSENT SUR TROIS PHOTOS DE VÉRITÉ. C'est peu, et il faut le dire : ils seront
  // à remesurer dès que plusieurs familles auront trié leurs galeries. En attendant on reste
  // prudent — on valide d'office très bas, et on propose jusqu'au seuil usuel d'ArcFace.
  seuilCertain: 0.95,

  // APPRENDRE DEMANDE PLUS QUE RECONNAITRE (29/09/2026). Une photo validee d'office par la machine
  // peut servir de reference — c'est la demande de Fouka, « chaque photo que tu vois du joueur
  // devient une photo de reference en plus » — mais pas n'importe laquelle. Valider a 0,94, puis
  // apprendre dessus, puis valider a 0,94 de ce qu'on vient d'apprendre : c'est ainsi qu'une
  // reconnaissance derive sans que personne ne s'en apercoive. On n'apprend donc que de ce dont on
  // etait tres sur. Ce qu'un HUMAIN a confirme entre sans condition : lui a regarde la photo.
  seuilApprentissage: 0.85,
  seuilPropose: 1.24,

  // ACCUMULATION. Un visage plus éloigné que cela, même sur une photo confirmée, n'est pas le sien :
  // c'est un autre joueur de la même image. Sans ce plafond on apprend le visage du voisin.
  plafondAccumulation: 1.24,
  referencesMax: 40,

  // REGROUPEMENT. On rassemble d'abord les visages entre eux : une grappe, c'est une personne vue
  // sous tous ses angles ce jour-là. Il suffit qu'UN visage de la grappe soit reconnu pour que
  // toute la grappe prenne le nom — c'est ce qui retrouve quelqu'un de profil, puisqu'il n'a plus
  // à ressembler à sa photo de référence mais à lui-même de face.
  //
  // Mesuré sur 284 visages : à 0,9 on obtient 159 grappes dont 59 à plusieurs visages. Plus haut,
  // les grappes grossissent sans que la cohésion tienne.
  seuilFusion: 0.9,
  cohesionMax: 1.0,

  // PHOTO DE GROUPE. La distribution est sans ambiguïté sur une vraie galerie : les photos de jeu
  // ont 1 à 4 visages, puis plus rien, et les photos d'équipe en ont 7, 16, 21, 22, 23. La coupure
  // se place donc toute seule.
  //
  // Décision de Fouka, 29/09 : « les photos de groupe doivent aller automatiquement à tout le
  // monde ». `media_assets.photo_de_groupe` existe depuis la v219 et fait exactement cela — mais
  // AUCUNE des 6 288 photos ne l'avait jamais : le mécanisme attendait une donnée que personne ne
  // remplissait. Le moteur la remplit.
  visagesPourGroupe: 5,

  // LES DOSSARDS (29/09/2026). Une photo de dos ne donne aucun visage, et c'est une part enorme des
  // photos de match : le numero est la seule prise. Fouka : « quand on met les numeros, hop, ca
  // retrouve automatiquement toutes les photos du numero 7 ».
  //
  // Mesure sur les 110 photos de la galerie : 6 numeros releves, 6 exacts, 0 invente, chacun
  // verifie en ouvrant la photo. Il en rate — un 4 lointain, un 10 a l'arriere-plan — et c'est
  // assume : rater coute une photo non proposee, inventer coute les photos d'un enfant envoyees a
  // la famille d'un autre.
  lireLesDossards: true,
};

// ── TENIR LE MAC ÉVEILLÉ PENDANT QU'ON TRAVAILLE ────────────────────────────────────────────────
//
// Fouka, le 29/09 : « il faut que le moteur tourne même quand mon Mac est sur batterie, parce qu'il
// ne sera pas tout le temps branché. »
//
// CE QUE FAIT DÉJÀ LE SERVICE. Le fichier launchd l'enveloppe dans `caffeinate -s`, qui empêche la
// veille SUR SECTEUR. Sur batterie, rien : le Mac s'endort au bout d'une minute, et le passage en
// cours se met en pause jusqu'au réveil. Rien n'est perdu — le processus est gelé, pas tué — mais
// une galerie peut rester à moitié traitée pendant des heures.
//
// CE QU'ON AJOUTE. Le moteur tient lui-même l'assertion, mais SEULEMENT pendant qu'il traite une
// galerie. Quand la file est vide, il la relâche et le Mac dort comme il veut : il n'y a aucune
// raison de tenir un portable éveillé pour interroger une file vide toutes les vingt secondes.
//
// ET UN PLANCHER DE BATTERIE. En dessous, on laisse le Mac dormir : un portable à plat ne traite
// aucune photo, et le travail reprend tout seul au rebranchement. Le moteur n'a pas à décider que
// la machine de quelqu'un doit mourir debout.
const PLANCHER_BATTERIE = 30;

/** L'alimentation, lue au moment où on en a besoin : elle change sans prévenir. */
async function alimentation() {
  try {
    const { stdout } = await promisify(execFile)("/usr/bin/pmset", ["-g", "batt"]);
    return {
      secteur: /'AC Power'/.test(stdout),
      pourcent: Number((stdout.match(/(\d+)%/) || [])[1] ?? 100),
    };
  } catch {
    // Sans réponse, on suppose le secteur : le pire cas est de ne pas empêcher une veille.
    return { secteur: true, pourcent: 100 };
  }
}

/**
 * Empêche la veille le temps d'un traitement. Rend la fonction qui relâche.
 *
 * L'assertion vit dans un processus fils : s'il meurt, ou si le moteur meurt, elle disparaît. On
 * ne laisse jamais un Mac éveillé derrière soi.
 */
async function tenirEveille() {
  const { secteur, pourcent } = await alimentation();
  if (secteur) return () => {};              // déjà tenu par le service lui-même
  if (pourcent < PLANCHER_BATTERIE) {
    dire(`   batterie à ${pourcent} % : on laisse le Mac dormir s'il le veut`);
    return () => {};
  }
  let fils = null;
  try { fils = spawn("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" }); }
  catch { return () => {}; }
  return () => { try { fils.kill(); } catch { /* deja parti */ } };
}

// ── LA MÉMOIRE DU SERVICE, ET CE QU'ELLE N'EST PAS ──────────────────────────────────────────────
//
// LE PROBLÈME. Un travail, c'est un couple (galerie, sportif). Chaque fois qu'une famille dépose sa
// photo de référence ou déclare quelque chose, la galerie ENTIÈRE était relue : 110 photos en 305
// secondes. Sur une galerie réelle de 3 000 photos, c'est plus de deux heures — à chaque demande,
// et il y en a une par famille.
//
// CE QU'ON NE FAIT PAS, ET C'EST LA DÉCISION DU 14/09 (v225, v325). On ne conserve AUCUNE empreinte
// de visage de galerie, nulle part. Le texte signé par les parents promet noir sur blanc que « les
// visages des autres enfants présents sur une photo ne sont jamais enregistrés ». La v225 a
// justement supprimé la table qui les gardait, avec cette phrase : une table de biométrie qui
// existe finit par être remplie. Écrire ces empreintes dans un fichier sur le Mac reviendrait au
// même, sur un autre disque.
//
// CE QU'ON FAIT. On les garde en MÉMOIRE VIVE, le temps que le service tourne, exactement comme le
// navigateur les gardait le temps d'une comparaison. Rien n'est écrit, rien ne survit à l'arrêt du
// service, et la deuxième demande sur la même galerie ne coûte plus que la comparaison.
//
// BORNÉE, parce qu'une mémoire sans limite finit par tuer le processus qui la tient : au-delà de
// 20 000 photos retenues, on oublie les plus anciennes. À trois visages par photo, cela représente
// environ 120 Mo.
const MEMOIRE = new Map();
/** Les photos dont on a deja lu le dos dans ce passage de service : on ne recommence pas. */
const dossardsVus = new Set();
const MEMOIRE_MAX = 20000;
function retenir(assetId, empreintes) {
  if (MEMOIRE.size >= MEMOIRE_MAX) {
    // Les clés d'une Map sortent dans leur ordre d'insertion : la première est la plus ancienne.
    for (const vieille of MEMOIRE.keys()) { MEMOIRE.delete(vieille); if (MEMOIRE.size < MEMOIRE_MAX) break; }
  }
  MEMOIRE.set(assetId, empreintes);
}

const entetes = { apikey: CLE, Authorization: `Bearer ${CLE}`, "Content-Type": "application/json" };
// LA MÊME ENDURANCE QUE `charger` (29/09/2026). Une coupure réseau ici levait aussi, et comme ces
// appels vivent dans la boucle par photo (`media_numeros_lus`) et dans l'apprentissage, la galerie
// entière tombait. On réessaie trois fois, puis on rend un échec LISIBLE — `{ok:false}` — au lieu
// de lever : chaque appelant sait déjà quoi faire d'un échec, aucun ne sait quoi faire d'une
// exception.
//
// ON RÉESSAIE AUSSI LES ÉCRITURES, et c'est un choix. Une exception de `fetch` veut dire qu'aucune
// réponse n'est revenue : l'écriture a peut-être eu lieu. Toutes celles du moteur sont refaisables
// sans dégât — elles portent sur un couple (photo, sportif) et remplacent au lieu d'empiler. La
// seule dont un doublon compterait est `reconnaissance_commencer`, qui incrémente les essais ; et
// depuis v349 un travail qui avance remet ce compteur à zéro, donc même là c'est sans conséquence.
const rest = async (chemin, init = {}) => {
  for (let essai = 1; essai <= 3; essai++) {
    try {
      const r = await fetch(`${URL_SB}/rest/v1/${chemin}`, { ...init, headers: { ...entetes, ...(init.headers || {}) } });
      const t = await r.text();
      try { return { ok: r.ok, d: t ? JSON.parse(t) : null }; } catch { return { ok: r.ok, d: t }; }
    } catch (e) {
      if (essai === 3) {
        const m = String(e && e.message || e).slice(0, 70);
        dire(`   base injoignable après 3 essais (${chemin.split("?")[0]}) : ${m}`);
        return { ok: false, d: { reseau: m } };
      }
      await new Promise((r) => setTimeout(r, 1500 * essai));
    }
  }
  return { ok: false, d: null };
};
const rpc = (nom, corps) => rest(`rpc/${nom}`, { method: "POST", body: JSON.stringify(corps) });

/** Le contenu d'un fichier du stockage privé. On télécharge en mémoire : les originaux vivent sur
 *  R2 depuis le 24/09 et ne sont plus chez Supabase, mais l'aperçu clair y est resté — sans
 *  filigrane, toujours disponible, et déjà à la bonne taille. */
async function charger(chemin) {
  if (!chemin) return null;
  // UNE COUPURE RÉSEAU NE DOIT PAS EMPORTER LA GALERIE ENTIÈRE (29/09/2026).
  //
  // Mesuré ce soir, et c'est la panne la plus probable du moteur : « RCPF VS PSG U16 », 110 photos,
  // est morte à la photo 61 sur un seul `fetch failed`. Vingt-cinq minutes de calcul perdues, et
  // pas une photo écrite — l'erreur remontait hors de `traiterGalerie`, qui abandonnait tout.
  //
  // Le moteur tourne sur le Mac de Fouka, en Wi-Fi, en permanence. Une micro-coupure par heure est
  // normale ; perdre une galerie à chaque fois ne l'est pas. Trois essais avec une pause qui
  // double, puis on rend null : la photo compte comme illisible, une seule, et les 109 autres
  // restent faites. Un échec total remplacé par un trou d'une photo.
  //
  // C'est `charger` qui réessaie, et pas l'appelant : c'est ici qu'on sait que l'erreur est un
  // transport, pas un refus. Un 404 ou un 403 ne se réessaient pas, ils sont rendus tout de suite.
  for (let essai = 1; essai <= 3; essai++) {
    try {
      const r = await fetch(`${URL_SB}/storage/v1/object/sign/${encodeURI("sportvision-media-prive/" + chemin)}`, {
        method: "POST", headers: entetes, body: JSON.stringify({ expiresIn: 900 }),
      });
      if (!r.ok) return null;
      const j = await r.json().catch(() => ({}));
      const p = j.signedURL || j.signedUrl;
      if (!p) return null;
      const rep = await fetch(`${URL_SB}/storage/v1${p.startsWith("/") ? "" : "/"}${p}`);
      if (!rep.ok) return null;
      return Buffer.from(await rep.arrayBuffer());
    } catch (e) {
      if (essai === 3) { dire(`   téléchargement abandonné après 3 essais : ${String(e && e.message || e).slice(0, 70)}`); return null; }
      await new Promise((r) => setTimeout(r, 1500 * essai));
    }
  }
  return null;
}

/**
 * L'ACCUMULATION, ET LA PRÉCAUTION QUI LA REND SÛRE.
 *
 * Fouka veut que chaque photo où l'enfant apparaît serve à le retrouver ensuite. C'est juste, et
 * c'est ce qui fait qu'un sportif finit par être reconnu sous presque tous les angles.
 *
 * LE PIÈGE, MESURÉ AVANT D'ÊTRE ÉVITÉ. Sur une photo confirmée où l'enfant n'est pas seul, on ne
 * sait pas lequel des visages est le sien. En les ajoutant tous : 3 photos confirmées ont produit
 * 31 références, et 73 photos sur 92 passaient le seuil — on attribuait la galerie entière, les
 * autres enfants compris. En choisissant le bon visage : 4 références, 14 photos. Le double de ce
 * qu'on trouvait avec la seule photo de référence, sans rien ramasser d'étranger.
 *
 * ON AVANCE DANS L'ORDRE DE PROXIMITÉ : la photo la plus sûre d'abord, pour que chaque ajout
 * s'appuie sur des références déjà fiables. Et un visage trop éloigné n'entre pas, même sur une
 * photo confirmée.
 */
function accumuler(references, photosConfirmees, visagesParPhoto) {
  const refs = [...references];
  const candidats = photosConfirmees
    .map((asset) => {
      const visages = visagesParPhoto.get(asset) || [];
      const d = visages.length ? Math.min(...visages.map((e) => Math.min(...refs.map((r) => distance(r, e))))) : Infinity;
      return { asset, d };
    })
    .filter((x) => Number.isFinite(x.d))
    .sort((a, b) => a.d - b.d);

  for (const { asset } of candidats) {
    if (refs.length >= CFG.referencesMax) break;
    let meilleur = null, best = Infinity;
    for (const e of visagesParPhoto.get(asset) || []) {
      const d = Math.min(...refs.map((r) => distance(r, e)));
      if (d < best) { best = d; meilleur = e; }
    }
    if (meilleur && best < CFG.plafondAccumulation) refs.push(meilleur);
  }
  return refs;
}

// ── Une galerie ─────────────────────────────────────────────────────────────────────────────────
async function traiterGalerie(album, lignes) {
  const relacher = await tenirEveille();
  try {
    return await traiterGalerieVraiment(album, lignes);
  } finally {
    relacher();
  }
}

async function traiterGalerieVraiment(album, lignes) {
  const { d: infos } = await rest(`media_albums?select=title&id=eq.${album}`);
  dire(`\n▸ ${infos?.[0]?.title ?? album}`);

  // 1. QUI PEUT ÊTRE RECONNU. La base seule le sait : consentement, équipes de la galerie, photos
  //    de référence déposées. Le moteur ne rejoue pas cette règle.
  // LE MODELE FAIT PARTIE DE LA QUESTION (v337). Sans lui, la base repondait « deja calculee » a
  // cause des empreintes de l'ancien moteur, on sautait toutes les photos de reference, et la
  // passe rendait zero identification sur 284 visages releves — sans rien dire.
  // UNE PREPARATION DE GALERIE N'A PAS DE SPORTIF (v347, 29/09/2026). Fouka : « des que j'ajoute une
  // galerie d'un club partenaire, tu fais la reconnaissance, meme s'il n'y a pas encore de joueurs
  // inscrits ». On prepare donc ce qui se prepare sans personne : les numeros de maillot et les
  // photos d'equipe. Les VISAGES, eux, n'ont ni a etre reconnus ni a etre conserves tant que
  // personne n'a rien demande — et surtout tant qu'aucune famille n'a rien signe.
  const preparationSeule = lignes.every((l) => !l.player_id);
  const { d: joueursBruts } = preparationSeule
    ? { d: [] }
    : await rpc("reconnaissance_joueurs_prets", { p_album_id: album, p_modele: MODELE });
  const joueurs = Array.isArray(joueursBruts) ? joueursBruts : [];

  // LIRE UN DOSSARD N'EST PAS DE LA BIOMÉTRIE (29/09/2026).
  //
  // Le moteur s'arrêtait ici quand personne n'avait donné son accord pour la reconnaissance des
  // visages. Or le numéro cousu sur un maillot n'est pas un visage : c'est un chiffre peint sur un
  // vêtement, et le relever ne demande l'accord de personne.
  //
  // Le cas est arrivé aussitôt, en jouant le parcours de Fouka : le Pass s'achète AVANT de déposer
  // une photo de référence, donc avant tout accord. Quelqu'un qui paie, déclare son numéro et
  // n'a pas encore donné son accord recevait « rien trouvé » — alors que rien n'avait été cherché.
  //
  // On sépare donc les deux passes. Les dossards se lisent toujours ; les visages, jamais sans
  // accord. Ce qui suit — empreintes de référence, grappes, marquages — reste derrière la porte.
  const reconnaissanceDesVisages = joueurs.length > 0;
  if (preparationSeule) {
    dire("   préparation de la galerie : numéros de maillot et photos d'équipe, aucun visage reconnu");
  } else if (!reconnaissanceDesVisages) {
    dire("   aucun sportif n'a autorisé la reconnaissance des visages : on lit les dossards seulement");
  }

  // 2. LES EMPREINTES DE RÉFÉRENCE MANQUANTES, une par photo déposée.
  // ON DIT CE QU'ON SAUTE, ET POURQUOI. Le silence sur cette etape a coute une passe entiere.
  const aCalculer = joueurs.filter((j) => !j.a_une_empreinte && j.chemin_photo);
  const dejaFaites = joueurs.filter((j) => j.a_une_empreinte).length;
  const sansPhoto = joueurs.filter((j) => !j.chemin_photo).length;
  dire(`   ${joueurs.length} ligne(s) : ${aCalculer.length} photo(s) a calculer, ${dejaFaites} deja faite(s)`
     + (sansPhoto ? `, ${sansPhoto} sportif(s) sans photo de reference` : ""));

  for (const j of aCalculer) {
    const octets = await charger(j.chemin_photo);
    if (!octets) { dire(`   ${j.joueur} : photo de référence illisible`); continue; }
    let v = [];
    try { v = await visagesDe(octets, { seuil: CFG.scoreMinReference, cote: CFG.cote }); }
    catch (e) { dire(`   ${j.joueur} : ${String(e.message).slice(0, 90)}`); continue; }
    // LE SUJET DE LA PHOTO, PAS LE SEUL VISAGE DE LA PHOTO (29/09/2026).
    //
    // La règle était : un seul visage, sinon on ne devine pas. Elle a rejeté la photo de Fouka, qui
    // était pourtant parfaite — un joueur net au premier plan. Les cinq autres « visages » étaient
    // des SPECTATEURS derrière le grillage, de 70 pixels de haut, détectés entre 0,20 et 0,63.
    //
    // Sur un terrain il y a toujours du monde au fond. Exiger une photo sans personne derrière,
    // c'est exiger une photo que personne n'a — et la famille ne le savait même pas : rien ne le
    // lui disait, elle voyait juste qu'aucune photo n'arrivait.
    //
    // On prend donc le SUJET : le plus grand visage, à condition qu'il domine nettement. Deux fois
    // plus haut que le suivant, c'est un premier plan devant un arrière-plan ; en dessous, ce sont
    // deux personnes côte à côte et là, vraiment, on ne devine pas.
    v.sort((a, b) => b.boite[3] - a.boite[3]);
    const sujet = v[0], suivant = v[1];
    const domine = !suivant || sujet.boite[3] >= 2 * suivant.boite[3];
    if (!v.length) { dire(`   ${j.joueur} : aucun visage sur la référence`); continue; }
    if (!domine) {
      dire(`   ${j.joueur} : ${v.length} visages de taille voisine sur la référence, on ne devine pas lequel`);
      continue;
    }
    if (sujet.score < 0.4) {
      dire(`   ${j.joueur} : visage trop incertain sur la référence (${sujet.score})`);
      continue;
    }
    if (suivant) {
      dire(`   ${j.joueur} : sujet retenu, ${Math.round(sujet.boite[3])} px, devant ${v.length - 1} visage(s) d'arrière-plan`);
    }
    v = [sujet];
    if (SIMULER) { dire(`   ${j.joueur} : empreinte calculée (simulation)`); continue; }
    const rep = await rpc("visage_reference_ajouter", {
      p_player_id: j.player_id, p_empreinte: `[${v[0].empreinte.join(",")}]`,
      p_modele: MODELE, p_face_ref_id: j.face_ref_id ?? null,
    });
    dire(rep.ok ? `   ${j.joueur} : empreinte de référence calculée`
                : `   ${j.joueur} : refus — ${JSON.stringify(rep.d).slice(0, 110)}`);
  }

  // 3. TOUS LES VISAGES DE LA GALERIE, relevés une seule fois.
  const { d: photos } = await rest(
    `media_assets?select=id,preview_clair_path,numeros_lus_par&album_id=eq.${album}&status=eq.ready&order=position`);
  if (!Array.isArray(photos) || photos.length === 0) {
    dire("   aucune photo prête");
    if (!SIMULER) for (const l of lignes) await rpc("reconnaissance_fait", { p_id: l.id, p_resultat: "aucune photo" });
    return { photos: 0, marques: 0 };
  }

  const visagesParPhoto = new Map();
  let nVisages = 0, sansVisage = 0, illisibles = 0, relus = 0, numerosLus = 0;
  // OU PASSE LE TEMPS (29/09/2026). 23 s par photo, et je n'en savais rien de precis : ni le
  // telechargement, ni les visages, ni les dossards n'etaient mesures separement. On ne peut pas
  // accelerer ce qu'on n'a pas mesure — c'est la lecon des tuiles, d'Otsu et des silhouettes,
  // trois pistes abandonnees le meme jour parce que la mesure contredisait l'hypothese.
  const chrono = { charge: 0, visages: 0, personnes: 0, dossards: 0, ecriture: 0 };
  const motifs = new Map();
  const t0 = Date.now();
  for (let i = 0; i < photos.length; i++) {
    if (i % 20 === 0) {
      dire(`   lecture ${i + 1}/${photos.length}…`);
      // ON DIT QU'ON AVANCE (v349, 29/09/2026).
      //
      // `reconnaissance_commencer` compte un essai AVANT de travailler, et trois essais
      // abandonnent la galerie. Mais un redémarrage du service au milieu d'un long album compte
      // un essai lui aussi : « Villemomble vs OPB », 161 photos et quarante minutes de calcul,
      // était déjà à 2 sans avoir jamais planté. Les albums les plus lourds sont précisément
      // ceux qu'on interrompt le plus souvent : on aurait perdu les gros et gardé les petits.
      //
      // Vingt photos calculées prouvent que ce travail n'est pas cassé. Son budget repart donc de
      // zéro, et seule une galerie qui plante toujours au même endroit atteint ses trois essais.
      const suivis = lignes.filter((l) => l.id).map((l) => l.id);
      // Les identifiants seulement : une ligne sans `id` glissee dans un uuid[] ferait echouer
      // l'appel, et `rpc` ne leve rien — le compteur ne repartirait jamais de zero, en silence.
      if (!SIMULER && i > 0 && suivis.length) await rpc("reconnaissance_progresse", { p_ids: suivis });
    }
    // DÉJÀ LU DANS CE PASSAGE DE SERVICE ? On ne relit pas. Voir MEMOIRE plus bas : rien n'est
    // écrit nulle part, c'est la mémoire vive du service et elle meurt avec lui.
    const connu = MEMOIRE.get(photos[i].id);
    if (connu !== undefined) {
      relus++;
      if (connu.length) { nVisages += connu.length; visagesParPhoto.set(photos[i].id, connu); }
      else sansVisage++;
      continue;
    }
    try {
      const tCharge = Date.now();
      const octets = await charger(photos[i].preview_clair_path);
      chrono.charge += Date.now() - tCharge;
      if (!octets) { illisibles++; continue; }
      // Les visages servent a deux choses : reconnaitre quelqu'un, et savoir si une personne est
      // vue de face — ce dont la lecture des dossards a besoin pour ne lire que les dos. La
      // seconde n'identifie personne et ne conserve rien : on detecte sans calculer d'empreinte.
      const tVisages = Date.now();
      const v = reconnaissanceDesVisages
        ? await visagesDe(octets, { seuil: CFG.scoreMin, cotes: CFG.cotes })
        : await detecterFin(octets, { seuil: CFG.scoreMin, cotes: CFG.cotes });
      chrono.visages += Date.now() - tVisages;
      const empreintes = reconnaissanceDesVisages ? v.map((x) => x.empreinte) : [];
      if (reconnaissanceDesVisages) retenir(photos[i].id, empreintes);

      // LES DOSSARDS, SUR LA MEME LECTURE D'IMAGE. On tient l'image en memoire : la relire plus
      // tard couterait un second telechargement pour rien. Une photo sans personne de dos ne
      // declenche aucun calcul.
      // DEJA EXAMINEE PAR CE LECTEUR-CI ? On ne recommence pas. Et si c'est une version plus
      // ancienne qui est passee, on repasse : c'est ce qui fait qu'un meilleur lecteur rattrape
      // tout seul les galeries deja traitees.
      if (CFG.lireLesDossards && !dossardsVus.has(photos[i].id)
          && photos[i].numeros_lus_par !== LECTEUR_DOSSARDS) {
        try {
          const tCorps = Date.now();
          const corps = await personnesDe(octets);
          chrono.personnes += Date.now() - tCorps;
          const tDos = Date.now();
          const nums = corps.length ? await lireDossards(octets, corps, v) : [];
          chrono.dossards += Date.now() - tDos;
          dossardsVus.add(photos[i].id);
          numerosLus += nums.length;
          // ON LE DIT MÊME QUAND ON NE TROUVE RIEN. Une photo de face, un gros plan, un banc de
          // touche : il n'y a pas de dossard à y lire, et c'est une information. Sans elle, la base
          // ne distingue pas « pas encore regardée » de « regardée, rien à lire », et l'application
          // annonce à une famille qu'elle relit cent photos déjà lues.
          if (!SIMULER) {
            const tEcr = Date.now();
            const rep = await rpc("media_numeros_lus", {
              p_asset_id: photos[i].id, p_numeros: nums, p_lecteur: LECTEUR_DOSSARDS,
            });
            chrono.ecriture += Date.now() - tEcr;
            if (!rep.ok) dire(`   lecture non enregistree : ${JSON.stringify(rep.d).slice(0, 110)}`);
          }
        } catch (e) {
          motifs.set(`dossards: ${String(e.message).slice(0, 60)}`,
                     (motifs.get(`dossards: ${String(e.message).slice(0, 60)}`) || 0) + 1);
        }
      }

      if (!empreintes.length) { sansVisage++; continue; }
      nVisages += empreintes.length;
      visagesParPhoto.set(photos[i].id, empreintes);
    } catch (e) {
      const m = String(e && e.message || e).slice(0, 80);
      motifs.set(m, (motifs.get(m) || 0) + 1);
    }
  }
  // LES PHOTOS DE GROUPE. Beaucoup de visages sur une image, c'est une photo d'equipe : elle va a
  // toute l'equipe, sans marquage individuel, et elle n'entre PAS dans l'apprentissage — sur une
  // photo a vingt-deux visages, chaque tete est minuscule et l'empreinte qu'on en tire est
  // mauvaise. C'est d'ailleurs ce qui faussait le calibrage : deux des trois photos confirmees par
  // Fouka etaient des photos de groupe, a 7 et 22 visages.
  const deGroupe = new Set();
  for (const [asset, empreintes] of visagesParPhoto)
    if (empreintes.length >= CFG.visagesPourGroupe) deGroupe.add(asset);
  if (deGroupe.size && !SIMULER) {
    // Par paquets, pour la meme raison que l'apprentissage plus bas : une tres grosse galerie
    // fabriquerait une adresse trop longue et le marquage tomberait, silencieusement pour la
    // moitie des photos. Ici au moins l'echec se dit, mais mieux vaut qu'il n'arrive pas.
    const tous = [...deGroupe];
    let rate = 0;
    for (let k = 0; k < tous.length; k += 100) {
      const rep = await rest(`media_assets?id=in.(${tous.slice(k, k + 100).join(",")})`, {
        method: "PATCH", body: JSON.stringify({ photo_de_groupe: true }),
        headers: { Prefer: "return=minimal" },
      });
      if (!rep.ok) rate += Math.min(100, tous.length - k);
    }
    if (rate) dire(`   ${rate} photo(s) de groupe n'ont pas pu etre marquees`);
  }
  dire(`   ${reconnaissanceDesVisages ? `${nVisages} visage(s)` : "dossards lus"} sur ${photos.length} photo(s) en ${Math.round((Date.now() - t0) / 1000)} s`
     + (deGroupe.size ? `, dont ${deGroupe.size} photo(s) de groupe` : "")
     + (reconnaissanceDesVisages && sansVisage ? `, ${sansVisage} sans visage` : "") + (illisibles ? `, ${illisibles} illisible(s)` : "")
     + (relus ? `, dont ${relus} déjà en mémoire` : ""));
  {
    const sec = (ms) => Math.round(ms / 1000);
    const total = Object.values(chrono).reduce((a, b) => a + b, 0);
    if (total > 2000) dire(`   temps : ${sec(chrono.charge)} s de téléchargement, ${sec(chrono.visages)} s de visages, `
      + `${sec(chrono.personnes)} s de silhouettes, ${sec(chrono.dossards)} s de dossards, ${sec(chrono.ecriture)} s d'écriture`);
  }
  if (dossardsVus.size) {
    dire(`   ${dossardsVus.size} dos examiné(s), ${numerosLus} numéro(s) de maillot relevé(s)`);
  }
  for (const [m, n] of [...motifs].sort((a, b) => b[1] - a[1])) dire(`   ${n} photo(s) en échec : ${m}`);

  if (!reconnaissanceDesVisages) {
    if (!SIMULER) for (const l of lignes) {
      await rpc("reconnaissance_fait", { p_id: l.id, p_resultat: `${numerosLus} numéro(s) relevé(s), visages non autorisés` });
    }
    return { photos: photos.length, marques: 0 };
  }

  // 4. ON REGROUPE AVANT DE NOMMER.
  //
  // Une grappe, c'est une personne vue sous tous ses angles ce jour-là. Plutôt que de demander à
  // la base pour chaque visage, on lui demande pour chaque GRAPPE, en lui présentant son visage
  // moyen — plus stable qu'aucun de ses membres. Si elle reconnaît quelqu'un, toute la grappe
  // prend le nom, y compris les vues de profil qui, seules, n'auraient jamais passé le seuil.
  //
  // Les photos de groupe sont exclues du regroupement : leurs visages minuscules colleraient
  // n'importe où et feraient fusionner des grappes entières.
  const pourGrappes = [];
  for (const [asset, empreintes] of visagesParPhoto) {
    if (deGroupe.has(asset)) continue;
    empreintes.forEach((emp, k) => pourGrappes.push({ cle: `${asset}#${k}`, asset, emp }));
  }
  const grappes = regrouper(pourGrappes, { seuilFusion: CFG.seuilFusion, minMoyen: CFG.cohesionMax });
  const fiables = grappes.filter((g) => g.membres.length >= 2 && g.fiable);
  dire(`   ${grappes.length} personne(s) distinguée(s), dont ${fiables.length} vue(s) plusieurs fois`);

  const parJoueur = new Map();   // joueur -> Map(asset -> meilleure distance)

  // D'abord les grappes : un seul appel par personne au lieu d'un par visage.
  for (const g of grappes) {
    const asset = g.membres[0].asset;
    const { d: props } = await rpc("visage_rapprocher_direct", {
      p_asset_id: asset, p_empreinte: `[${g.centre.join(",")}]`,
      p_modele: MODELE, p_seuil: CFG.seuilPropose,
    });
    if (!Array.isArray(props) || !props.length) continue;
    for (const c of props) {
      if (!parJoueur.has(c.player_id)) parJoueur.set(c.player_id, new Map());
      const parAsset = parJoueur.get(c.player_id);
      const d = Number(c.distance);
      // TOUTE LA GRAPPE PREND LE NOM. C'est le gain : un visage de trois quarts qui n'aurait
      // jamais passé le seuil tout seul arrive ici parce qu'il ressemble à lui-même de face.
      for (const m of g.membres) if (!parAsset.has(m.asset) || d < parAsset.get(m.asset)) parAsset.set(m.asset, d);
    }
  }

  // Puis les visages des photos de groupe, un par un : ils n'ont pas de grappe.
  for (const asset of deGroupe) {
    for (const emp of visagesParPhoto.get(asset) || []) {
      const { d: props } = await rpc("visage_rapprocher_direct", {
        p_asset_id: asset, p_empreinte: `[${emp.join(",")}]`,
        p_modele: MODELE, p_seuil: CFG.seuilPropose,
      });
      if (!Array.isArray(props) || !props.length) continue;
      // PROPOSER AUX DEUX QUAND LA MACHINE HÉSITE. Décision de Fouka, 29/09 : « quand elle hésite
      // entre deux personnes, elle propose aux deux ». On ne retient donc plus le seul plus
      // proche — la famille tranche, et c'est elle qui sait.
      for (const c of props) {
        if (!parJoueur.has(c.player_id)) parJoueur.set(c.player_id, new Map());
        const parAsset = parJoueur.get(c.player_id);
        const d = Number(c.distance);
        if (!parAsset.has(asset) || d < parAsset.get(asset)) parAsset.set(asset, d);
      }
    }
  }

  // 5. L'APPRENTISSAGE. Les photos qu'UNE PERSONNE a confirmées deviennent des références.
  //
  // ON N'APPREND PAS SUR UNE PHOTO ENTRÉE PAR SON NUMÉRO (v340, 29/09/2026). Un dossard lu dans le
  // dos met la photo dans la galerie de la famille, et c'est voulu — mais le seul visage de cette
  // image est celui de QUELQU'UN D'AUTRE, puisque le joueur, lui, est de dos. En tirer une
  // référence, c'est apprendre le visage du voisin sous le nom de l'enfant.
  // ON NE REGARDE PLUS SEULEMENT CE QU'UN HUMAIN A CONFIRME (29/09/2026).
  //
  // Le filtre etait `valide_par not null`, c'est-a-dire « quelqu'un a confirme ». Il avait un sens
  // tant que la machine se contentait de PROPOSER. Depuis qu'elle met les photos d'office (v340),
  // ses propres validations ont `valide_par` vide — le moteur tourne avec la cle de service, et il
  // n'y a donc aucun utilisateur a inscrire. L'apprentissage ne voyait plus rien : Fouka avait
  // 7 photos validees et TOUJOURS une seule empreinte de reference.
  //
  // On prend donc les deux, avec deux exigences differentes : ce qu'un humain a confirme entre sans
  // condition — il a regarde la photo —, ce que la machine a decide n'entre que si elle en etait
  // tres sure. Voir seuilApprentissage.
  //
  // ET ON DEMANDE PAR PAQUETS (v349, 29/09/2026). `in.(...)` avec un identifiant par photo faisait
  // 6 000 caracteres d'adresse pour 161 photos. A 400 photos on depasse la limite du serveur, qui
  // repond 414 : `rest` rend alors un texte d'erreur, `Array.isArray` est faux, la boucle ne tourne
  // pas — et l'apprentissage s'arrete SANS RIEN DIRE, sur les galeries les plus grosses justement.
  // Fouka veut « toutes les equipes, tous les clubs » : c'est exactement la taille ou ca casse.
  const confirmes = [];
  const PAQUET = 100;
  for (let k = 0; k < photos.length; k += PAQUET) {
    const lot = photos.slice(k, k + PAQUET).map((p) => p.id);
    const { ok, d } = await rest(
      `media_player_tags?select=media_ref_id,player_id,score,valide_par&media_ref_type=eq.media_asset`
      + `&statut=eq.valide&source=neq.numero`
      + `&media_ref_id=in.(${lot.join(",")})`);
    if (!ok || !Array.isArray(d)) {
      dire(`   apprentissage : lot ${k / PAQUET + 1} illisible (${String(JSON.stringify(d)).slice(0, 90)})`);
      continue;
    }
    confirmes.push(...d);
  }
  const confirmeesPar = new Map();
  for (const t of confirmes) {
    const parUnHumain = t.valide_par !== null && t.valide_par !== undefined;
    const sure = t.score !== null && Number(t.score) < CFG.seuilApprentissage;
    if (!parUnHumain && !sure) continue;
    // Une photo de groupe ne sert pas de référence : ses visages sont trop petits, et l'empreinte
    // qu'on en tirerait abîmerait celles qu'on a déjà.
    if (deGroupe.has(t.media_ref_id)) continue;
    if (!confirmeesPar.has(t.player_id)) confirmeesPar.set(t.player_id, []);
    confirmeesPar.get(t.player_id).push(t.media_ref_id);
  }

  let parAccumulation = 0;
  for (const [joueur, assets] of confirmeesPar) {
    // On repart des empreintes déjà connues de ce sportif : c'est la base qui les détient.
    const { d: base } = await rpc("visage_empreintes_du_sportif", { p_player_id: joueur, p_modele: MODELE })
      .catch(() => ({ d: null }));
    const depart = Array.isArray(base) && base.length
      ? base.map((b) => (typeof b.empreinte === "string" ? JSON.parse(b.empreinte) : b.empreinte))
      : [];
    if (!depart.length) continue;

    const enrichies = accumuler(depart, assets, visagesParPhoto);
    if (enrichies.length <= depart.length) continue;

    const parAsset = parJoueur.get(joueur) ?? new Map();
    for (const [asset, empreintes] of visagesParPhoto) {
      if (parAsset.has(asset)) continue;
      const d = Math.min(...empreintes.map((e) => Math.min(...enrichies.map((r) => distance(r, e)))));
      if (d < CFG.seuilPropose) { parAsset.set(asset, d); parAccumulation++; }
    }
    parJoueur.set(joueur, parAsset);

    // Les références gagnées valent pour les galeries SUIVANTES, pas seulement pour celle-ci :
    // c'est tout l'intérêt, et c'est la base qui les garde — sous réserve que l'accord le couvre.
    if (!SIMULER) {
      for (const asset of assets) {
        const visages = visagesParPhoto.get(asset) || [];
        if (!visages.length) continue;
        let meilleur = null, best = Infinity;
        for (const e of visages) {
          const d = Math.min(...depart.map((r) => distance(r, e)));
          if (d < best) { best = d; meilleur = e; }
        }
        if (meilleur && best < CFG.plafondAccumulation) {
          await rpc("visage_reference_depuis_galerie", {
            p_player_id: joueur, p_asset_id: asset,
            p_empreinte: `[${meilleur.join(",")}]`, p_modele: MODELE,
          });
        }
      }
    }
  }

  // 6. LE MARQUAGE.
  let marques = 0, certains = 0;
  for (const [joueur, parAsset] of parJoueur) {
    for (const [asset, d] of parAsset) {
      if (SIMULER) { marques++; if (d < CFG.seuilCertain) certains++; continue; }
      const rep = await rpc("marquer_par_reconnaissance", {
        p_asset_id: asset, p_player_id: joueur, p_distance: d,
        p_modele: MODELE, p_certain: d < CFG.seuilCertain,
      });
      if (rep.ok) { marques++; if (d < CFG.seuilCertain) certains++; }
    }
  }
  dire(`   ${marques} identification(s), dont ${certains} sans relecture`
     + (parAccumulation ? `, ${parAccumulation} grâce aux photos déjà confirmées` : "")
     + (SIMULER ? " (simulation, rien écrit)" : ""));

  if (!SIMULER) for (const l of lignes) await rpc("reconnaissance_fait", { p_id: l.id, p_resultat: `${marques} identification(s)` });
  return { photos: photos.length, marques };
}

// ── La file ─────────────────────────────────────────────────────────────────────────────────────
async function vider() {
  let travaux;
  if (ALBUM_FORCE) {
    travaux = [{ id: null, album_id: ALBUM_FORCE }];
  } else {
    // LA PRIORITE D'ABORD, L'ORDRE D'ARRIVEE ENSUITE (v345, 29/09/2026). Une famille qui vient de
    // deposer sa photo attend devant son ecran ; un rattrapage de publication n'attend personne.
    // Fouka a depose sa reference a 11 h 58 et n'a rien vu venir : son travail patientait derriere
    // une galerie de 161 photos mise en file une heure plus tot.
    const { d: file } = await rest("reconnaissance_a_faire?select=id,album_id,player_id,priorite&traite_le=is.null&order=priorite,demande_le&limit=500");
    if (!Array.isArray(file) || file.length === 0) {
      if (!EN_BOUCLE) dire("La file est vide. Rien à faire.");
      return { albums: 0, photos: 0, marques: 0 };
    }
    travaux = file;
  }

  const parAlbum = new Map();
  for (const l of travaux) {
    if (!parAlbum.has(l.album_id)) parAlbum.set(l.album_id, []);
    parAlbum.get(l.album_id).push(l);
  }
  if (VOIR) {
    dire(`${travaux.length} travail(aux) en attente, sur ${parAlbum.size} galerie(s).`);
    return { albums: 0, photos: 0, marques: 0 };
  }
  dire(`${travaux.length} travail(aux) en attente, sur ${parAlbum.size} galerie(s).`);

  let albums = 0, photos = 0, marques = 0;
  for (const [album, lignes] of parAlbum) {
    const aFaire = lignes.filter((l) => l.id);

    // UNE FAMILLE QUI VIENT DE PAYER NE FAIT PAS LA QUEUE DERRIÈRE LE RATTRAPAGE (v349, 29/09/2026).
    //
    // La file est lue d'un coup, 500 lignes, triée par priorité. Correct au moment de la lecture,
    // et faux ensuite : les 52 galeries de rattrapage (priorité 9) mettent des HEURES, et un achat
    // de Pass qui arrive pendant ce temps entre en priorité 1 dans une file qu'on ne relit plus.
    // Mesuré : le travail de Nathan, demandé à 14 h 20, attendait derrière un album de 161 photos
    // de priorité 5. On promet « reviens dans cinq à dix minutes » ; on livrait le lendemain.
    //
    // Entre deux galeries, on regarde donc si quelqu'un de plus pressé est arrivé. Si oui, on
    // arrête ce passage : la boucle du service en relance un dans vingt secondes, qui repartira du
    // haut de la file. On ne perd rien, les travaux non commencés sont toujours là.
    if (!SIMULER && aFaire.length) {
      const ici = Math.min(...lignes.map((l) => l.priorite ?? 9));
      if (ici > 1) {
        const { d: presses } = await rest(
          `reconnaissance_a_faire?select=id&traite_le=is.null&priorite=lt.${ici}&limit=1`);
        if (Array.isArray(presses) && presses.length) {
          dire(`   quelqu'un de plus pressé est arrivé : on reprend la file du haut.`);
          break;
        }
      }
    }

    // ON ANNONCE QU'ON COMMENCE, ET ON COMPTE L'ESSAI AVANT DE TRAVAILLER (v348, 29/09/2026).
    //
    // `traiterGalerie` tournait sans filet : une photo corrompue, une réponse inattendue, un
    // plantage d'onnxruntime, et tout le passage tombait. launchd relançait dix secondes plus
    // tard, reprenait LA MÊME galerie, retombait au même endroit. Une boucle infinie et
    // silencieuse, qui bloquait tout ce qui attendait derrière — familles comprises. Le service
    // aurait eu l'air vivant : il tourne, il consomme, il écrit. Et plus rien n'avancerait.
    //
    // Compter après coup n'aurait rien donné : un plantage ne revient jamais écrire son échec.
    let recevables = aFaire;
    if (!SIMULER && aFaire.length) {
      const { d } = await rpc("reconnaissance_commencer", { p_ids: aFaire.map((l) => l.id) });
      if (Array.isArray(d)) {
        const gardes = new Set(d.map((x) => x.id));
        const abandonnes = aFaire.length - gardes.size;
        if (abandonnes) dire(`   ${abandonnes} travail(aux) abandonné(s) après trois échecs`);
        recevables = aFaire.filter((l) => gardes.has(l.id));
      }
    }
    if (!recevables.length) continue;

    // ET LE FILET LUI-MÊME. Un échec sur une galerie ne doit pas emporter les suivantes : on le
    // dit, on passe, et le compteur fera le reste si ça se reproduit.
    try {
      const r = await traiterGalerie(album, recevables);
      albums++; photos += r.photos; marques += r.marques;
    } catch (e) {
      dire(`   échec sur cette galerie : ${String(e && e.message || e).slice(0, 160)}`);
    }
  }
  return { albums, photos, marques };
}

// ── Le fil ──────────────────────────────────────────────────────────────────────────────────────
if (VOIR) {
  await vider();
} else {
  dire("Chargement des modèles…");
  await preparer();
  if (CFG.lireLesDossards) await preparerPersonnes();
  dire(`Modèle : ${MODELE}`);
  if (EN_BOUCLE) {
    dire(`En attente de travail (vérification toutes les ${ATTENTE / 1000} s).`);
    let silencieux = 0;
    for (;;) {
      let faits = 0;
      try { faits = (await vider()).albums; }
      catch (e) { dire(`   passe interrompue : ${String(e && e.message || e).slice(0, 160)}`); }
      if (faits) { silencieux = 0; dire("   en attente…"); }
      else if (++silencieux % 90 === 0) dire(`   toujours rien (${Math.round(silencieux * ATTENTE / 60000)} min).`);
      await new Promise((r) => setTimeout(r, ATTENTE));
    }
  } else {
    const bilan = await vider();
    dire(`\n${bilan.albums} galerie(s), ${bilan.photos} photo(s), ${bilan.marques} identification(s).`);
  }
}
