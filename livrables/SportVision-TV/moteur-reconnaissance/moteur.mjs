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

import { readFileSync, writeSync } from "node:fs";
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
const rest = async (chemin, init = {}) => {
  const r = await fetch(`${URL_SB}/rest/v1/${chemin}`, { ...init, headers: { ...entetes, ...(init.headers || {}) } });
  const t = await r.text();
  try { return { ok: r.ok, d: t ? JSON.parse(t) : null }; } catch { return { ok: r.ok, d: t }; }
};
const rpc = (nom, corps) => rest(`rpc/${nom}`, { method: "POST", body: JSON.stringify(corps) });

/** Le contenu d'un fichier du stockage privé. On télécharge en mémoire : les originaux vivent sur
 *  R2 depuis le 24/09 et ne sont plus chez Supabase, mais l'aperçu clair y est resté — sans
 *  filigrane, toujours disponible, et déjà à la bonne taille. */
async function charger(chemin) {
  if (!chemin) return null;
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
  const { d: infos } = await rest(`media_albums?select=title&id=eq.${album}`);
  dire(`\n▸ ${infos?.[0]?.title ?? album}`);

  // 1. QUI PEUT ÊTRE RECONNU. La base seule le sait : consentement, équipes de la galerie, photos
  //    de référence déposées. Le moteur ne rejoue pas cette règle.
  // LE MODELE FAIT PARTIE DE LA QUESTION (v337). Sans lui, la base repondait « deja calculee » a
  // cause des empreintes de l'ancien moteur, on sautait toutes les photos de reference, et la
  // passe rendait zero identification sur 284 visages releves — sans rien dire.
  const { d: joueurs } = await rpc("reconnaissance_joueurs_prets", { p_album_id: album, p_modele: MODELE });
  if (!Array.isArray(joueurs) || joueurs.length === 0) {
    dire("   aucun sportif n'a autorisé la reconnaissance pour cette galerie");
    if (!SIMULER) for (const l of lignes) await rpc("reconnaissance_fait", { p_id: l.id, p_resultat: "aucun sportif autorisé" });
    return { photos: 0, marques: 0 };
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
    // UNE photo de référence montre UN visage. Deux, et on ne sait pas lequel est l'enfant.
    if (v.length !== 1) { dire(`   ${j.joueur} : ${v.length} visage(s) sur la référence, on ne devine pas`); continue; }
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
    `media_assets?select=id,preview_clair_path&album_id=eq.${album}&status=eq.ready&order=position`);
  if (!Array.isArray(photos) || photos.length === 0) {
    dire("   aucune photo prête");
    if (!SIMULER) for (const l of lignes) await rpc("reconnaissance_fait", { p_id: l.id, p_resultat: "aucune photo" });
    return { photos: 0, marques: 0 };
  }

  const visagesParPhoto = new Map();
  let nVisages = 0, sansVisage = 0, illisibles = 0, relus = 0, numerosLus = 0;
  const motifs = new Map();
  const t0 = Date.now();
  for (let i = 0; i < photos.length; i++) {
    if (i % 20 === 0) dire(`   lecture ${i + 1}/${photos.length}…`);
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
      const octets = await charger(photos[i].preview_clair_path);
      if (!octets) { illisibles++; continue; }
      const v = await visagesDe(octets, { seuil: CFG.scoreMin, cotes: CFG.cotes });
      const empreintes = v.map((x) => x.empreinte);
      retenir(photos[i].id, empreintes);

      // LES DOSSARDS, SUR LA MEME LECTURE D'IMAGE. On tient l'image en memoire : la relire plus
      // tard couterait un second telechargement pour rien. Une photo sans personne de dos ne
      // declenche aucun calcul.
      if (CFG.lireLesDossards && !dossardsVus.has(photos[i].id)) {
        try {
          const corps = await personnesDe(octets);
          const nums = corps.length ? await lireDossards(octets, corps, v) : [];
          dossardsVus.add(photos[i].id);
          if (nums.length) {
            numerosLus += nums.length;
            if (!SIMULER) {
              const rep = await rpc("media_numeros_lus", {
                p_asset_id: photos[i].id, p_numeros: nums, p_lecteur: LECTEUR_DOSSARDS,
              });
              if (!rep.ok) dire(`   numero non enregistre : ${JSON.stringify(rep.d).slice(0, 110)}`);
            }
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
    const rep = await rest(`media_assets?id=in.(${[...deGroupe].join(",")})`, {
      method: "PATCH", body: JSON.stringify({ photo_de_groupe: true }),
      headers: { Prefer: "return=minimal" },
    });
    if (!rep.ok) dire("   les photos de groupe n'ont pas pu etre marquees");
  }
  dire(`   ${nVisages} visage(s) sur ${photos.length} photo(s) en ${Math.round((Date.now() - t0) / 1000)} s`
     + (deGroupe.size ? `, dont ${deGroupe.size} photo(s) de groupe` : "")
     + (sansVisage ? `, ${sansVisage} sans visage` : "") + (illisibles ? `, ${illisibles} illisible(s)` : "")
     + (relus ? `, dont ${relus} déjà en mémoire` : ""));
  if (numerosLus) dire(`   ${numerosLus} numéro(s) de maillot relevé(s)`);
  for (const [m, n] of [...motifs].sort((a, b) => b[1] - a[1])) dire(`   ${n} photo(s) en échec : ${m}`);

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
  const { d: confirmes } = await rest(
    `media_player_tags?select=media_ref_id,player_id&media_ref_type=eq.media_asset&statut=eq.valide`
    + `&valide_par=not.is.null&media_ref_id=in.(${photos.map((p) => p.id).join(",")})`);
  const confirmeesPar = new Map();
  for (const t of (Array.isArray(confirmes) ? confirmes : [])) {
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
    const { d: file } = await rest("reconnaissance_a_faire?select=id,album_id,player_id&traite_le=is.null&order=demande_le&limit=500");
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
    const r = await traiterGalerie(album, lignes.filter((l) => l.id));
    albums++; photos += r.photos; marques += r.marques;
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
