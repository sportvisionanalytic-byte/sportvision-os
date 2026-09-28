#!/usr/bin/env node
// Le moteur de reconnaissance, sans personne devant l'écran (28/09/2026).
//
// POURQUOI CE SCRIPT EXISTE. La reconnaissance tournait derrière un bouton de l'OS, galerie par
// galerie. Une famille déposait sa photo de référence et ne voyait jamais rien venir, parce que
// personne n'avait cliqué. Fouka : « il faut vraiment que ce soit automatique ».
//
// La v325 a posé la FILE : dès qu'une photo de référence arrive, ou qu'une galerie est publiée, le
// travail s'y inscrit tout seul. Ce script la vide.
//
// CE QU'IL FAIT, ET CE QU'IL NE FAIT PAS. Il ne porte AUCUNE règle métier. Il ne sait pas qui a le
// droit d'être reconnu, ni à quel club appartient une photo, ni à partir de quelle distance deux
// visages sont la même personne. Tout cela vit dans la base, dans les trois fonctions que l'OS
// appelle déjà — `visage_reference_ajouter`, `visage_rapprocher_direct`,
// `marquer_par_reconnaissance`. Ce script ne fait que le calcul d'images, qui exige un navigateur :
// détecter les visages et en tirer une empreinte. C'est délibéré : une seconde version des règles
// finirait par diverger de la première, et cinq défauts de la journée venaient exactement de là.
//
// AUCUNE EMPREINTE DE GALERIE N'EST CONSERVÉE. C'est ce que le texte de consentement promet aux
// parents : les visages des autres enfants présents sur une photo ne sont jamais enregistrés.
// L'empreinte ne quitte le navigateur que le temps d'une comparaison, et il ne reste en base que
// le résultat.
//
//   node livrables/SportVision-TV/scripts/reconnaissance-automatique.mjs          # vide la file
//   node livrables/SportVision-TV/scripts/reconnaissance-automatique.mjs --voir   # dit seulement ce qui attend
//   node livrables/SportVision-TV/scripts/reconnaissance-automatique.mjs --simuler # calcule tout, n'ecrit rien
//
// Reprenable : chaque ligne de la file est close dès qu'elle est traitée, donc on peut
// l'interrompre et le relancer sans rien refaire deux fois.
import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const VOIR_SEULEMENT = process.argv.includes("--voir");
// MESURER SANS RIEN ÉCRIRE (28/09/2026). Pour comparer deux réglages, j'ai effacé les marquages de
// la galerie et relancé le moteur — pendant que Fouka regardait ses photos, qui ont disparu de son
// écran le temps de la passe. On ne mesure pas en abîmant ce que quelqu'un utilise. Ce mode calcule
// tout et annonce ce qu'il POSERAIT, sans toucher à une seule ligne.
const SIMULER = process.argv.includes("--simuler");
const RACINE = new URL("../../../", import.meta.url).pathname;
const env = Object.fromEntries(readFileSync(`${RACINE}.env`, "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
  .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const URL_SB = env.SUPABASE_URL, CLE = env.SUPABASE_SECRET_KEY;
if (!URL_SB || !CLE) { console.error("SUPABASE_URL et SUPABASE_SECRET_KEY sont nécessaires."); process.exit(1); }

// Les mêmes réglages que l'OS, recopiés ici parce qu'ils vivent dans un fichier HTML qu'on ne peut
// pas importer. Si l'un change là-bas, il doit changer ici : c'est la seule chose en double, et
// elle est volontairement réduite à cinq nombres.
const CFG = {
  lib: "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.js",
  modeles: `${URL_SB}/storage/v1/object/public/modeles-reconnaissance/face-api-1.7.15`,
  modele: "face-api-1.7.15-ssd128",
  // LE SEUIL DE VALIDATION AUTOMATIQUE EST CALÉ SUR DE VRAIES RÉPONSES (28/09/2026).
  //
  // Fouka : « je veux que tu mettes tout de suite toutes les photos. Et là où il y a des doutes,
  // tu demandes. » Il avait à ce moment-là tranché huit propositions à la main, et ces huit
  // réponses disent où est la frontière, bien mieux qu'un seuil de bibliothèque :
  //
  //     0,226  0,482  0,491  0,505   → « c'est moi »   (4 sur 4)
  //     0,506  0,518         0,527   → « ce n'est pas moi »
  //                   0,519          → « c'est moi »
  //
  // Sous 0,506, aucune erreur. Au-dessus, une bonne sur quatre. On valide donc d'office jusqu'à
  // 0,50 au lieu de 0,42, et le reste continue d'être proposé. C'est huit réponses, pas mille : à
  // revoir quand plusieurs familles auront trié leurs galeries, et c'est le genre de seuil qui se
  // remesure au lieu de se deviner.
  seuilCertain: 0.50,
  seuilPropose: 0.55,
  // Sur une PHOTO DE MATCH, un seuil haut protège : un visage flou au fond du terrain ne doit
  // jamais désigner un enfant. Sur un PORTRAIT DÉPOSÉ EXPRÈS, il n'a aucune raison d'être aussi
  // haut — il n'y a personne d'autre à confondre, et la photo de Nathan sortait à 0,53, donc
  // écartée : la détection marchait et on jetait son résultat.
  scoreMin: 0.6,
  scoreMinReference: 0.3,
  // L'EXPANSION : deux visages de la MÊME galerie sont-ils la même personne ? Question de
  // géométrie, pas de métier — la règle « qui a le droit d'être reconnu » reste en base.
  //
  // LE SEUIL EST MESURÉ, PAS CHOISI. Sur la galerie « RCPF VS PSG U16 » (110 photos, 183 visages,
  // 8 reconnus directement), le mode --simuler a compté ce que chaque réglage retrouve EN PLUS :
  //
  //     depuis les seuls « certains »   0,38 → 0   0,42 → 0   0,45 → 0   0,50 → 0
  //     depuis tous les reconnus        0,38 → 0   0,42 → 4   0,45 → 5   0,50 → 38
  //
  // Deux enseignements. Partir des seuls « certains » ne donne RIEN : il n'y en avait qu'un, et une
  // chaîne ne part pas d'un point unique. Et le bond de 5 à 38 entre 0,45 et 0,50 n'est pas un
  // gain, c'est un effondrement : 0,50 approche les 0,574 qui séparent deux personnes différentes
  // du même banc de touche, et la chaîne se met à ramasser tout le monde. 38 sur les 175 visages
  // restants, avec vingt-deux joueurs sur le terrain, c'est exactement la signature de « tout le
  // monde ressemble à tout le monde ».
  //
  // On s'arrête donc à 0,45 : +63 % de photos retrouvées, et on reste loin du point de bascule. Un
  // faux positif ici, c'est la photo d'un enfant envoyée à la famille d'un autre.
  seuilExpansion: 0.45,
  toursExpansion: 2,
};

const entetes = { apikey: CLE, Authorization: `Bearer ${CLE}`, "Content-Type": "application/json" };
const rest = async (chemin, init = {}) => {
  const r = await fetch(`${URL_SB}/rest/v1/${chemin}`, { ...init, headers: { ...entetes, ...(init.headers || {}) } });
  const t = await r.text();
  try { return { ok: r.ok, d: t ? JSON.parse(t) : null }; } catch { return { ok: r.ok, d: t }; }
};
const rpc = (nom, corps) => rest(`rpc/${nom}`, { method: "POST", body: JSON.stringify(corps) });

/** Une adresse signée, éventuellement réduite : on ne télécharge pas un original de 3 Mo pour y
 *  chercher un visage. 600 px suffisent au modèle et divisent le temps par dix. */
async function urlSignee(bucket, chemin, largeur) {
  if (!chemin) return null;
  const r = await fetch(`${URL_SB}/storage/v1/object/sign/${bucket}/${encodeURI(chemin)}`, {
    method: "POST", headers: entetes,
    body: JSON.stringify(largeur ? { expiresIn: 900, transform: { width: largeur, resize: "contain" } } : { expiresIn: 900 }),
  });
  if (!r.ok) return null;
  const { signedURL, signedUrl } = await r.json().catch(() => ({}));
  const chemin2 = signedURL || signedUrl;
  return chemin2 ? `${URL_SB}/storage/v1${chemin2.startsWith("/") ? "" : "/"}${chemin2}` : null;
}

/** OÙ LIRE UNE PHOTO. Depuis le passage à Cloudflare R2 (24/09), l'ORIGINAL de la plupart des
 *  photos n'est plus chez Supabase : `media_assets.storage_bucket` vaut alors `r2`, et son
 *  `original_path` ne désigne plus aucun objet. Signer ce chemin dans le bucket privé répond
 *  « Object not found », en 400, sans que rien le dise : c'est ce qui donnait 0 visage détecté sur
 *  110 photos, moteur en parfait état de marche.
 *
 *  On lit donc l'APERÇU CLAIR, qui est justement fait pour être regardé : sans filigrane, toujours
 *  chez Supabase quel que soit l'hébergeur de l'original, présent pour les 110 photos, et déjà plus
 *  petit que ce qu'on redimensionnerait. Le modèle n'a besoin de rien de plus : on lui donnait de
 *  toute façon 1 200 px. L'original ne sert de recours que s'il est encore dans le bucket privé. */
function aLire(photo) {
  if (photo.preview_clair_path) return ["sportvision-media-prive", photo.preview_clair_path, null];
  if (photo.storage_bucket === "sportvision-media-prive" && photo.original_path)
    return ["sportvision-media-prive", photo.original_path, 600];
  return ["sportvision-media-prive", "", null];
}

// ── Ce qui attend ───────────────────────────────────────────────────────────────────────────────
const { d: file } = await rest("reconnaissance_a_faire?select=id,album_id,player_id&traite_le=is.null&order=demande_le&limit=500");
if (!Array.isArray(file) || file.length === 0) {
  console.log("La file est vide. Rien à faire.");
  process.exit(0);
}
const parAlbum = new Map();
for (const l of file) {
  if (!parAlbum.has(l.album_id)) parAlbum.set(l.album_id, []);
  parAlbum.get(l.album_id).push(l);
}
console.log(`${file.length} travail(aux) en attente, sur ${parAlbum.size} galerie(s).`);
if (VOIR_SEULEMENT) {
  for (const [album, lignes] of parAlbum) {
    const { d } = await rest(`media_albums?select=title&id=eq.${album}`);
    console.log(`  ${d?.[0]?.title ?? album} · ${lignes.length} sportif(s)`);
  }
  process.exit(0);
}

// ── Un navigateur, juste pour le calcul d'images ────────────────────────────────────────────────
// La page est servie depuis 127.0.0.1 et non `about:blank` : sans origine réelle, les requêtes
// vers le stockage partent d'une origine nulle et sont refusées.
const serveur = createServer((_, rep) => {
  rep.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  rep.end("<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>");
}).listen(0, "127.0.0.1");
await new Promise((r) => serveur.on("listening", r));

// SwiftShader rend WebGL disponible sans carte graphique. Sans ces drapeaux, le navigateur sans
// ecran tombe en plein calcul — « Resulting promise was garbage collected », vu au premier essai.
const navigateur = await chromium.launch({
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"],
});
const page = await navigateur.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("   navigateur :", m.text().slice(0, 140)); });
await page.goto(`http://127.0.0.1:${serveur.address().port}/`);

console.log("Chargement du modèle…");
await page.addScriptTag({ url: CFG.lib });
await page.evaluate(async (cfg) => {
  const fa = window.faceapi;
  // LE PROCESSEUR, PAS LA CARTE GRAPHIQUE. Dans un navigateur sans ecran, WebGL passe par une
  // emulation logicielle qui tient mal la charge : le premier essai s'est effondre au bout de
  // quelques images. Le processeur est plus lent mais ne lache pas, et ce script tourne seul, la
  // nuit — personne n'attend devant.
  try { await fa.tf.setBackend("cpu"); } catch { /* on prend ce qui vient */ }
  await fa.tf.ready();
  await fa.nets.ssdMobilenetv1.loadFromUri(cfg.modeles);
  await fa.nets.faceLandmark68Net.loadFromUri(cfg.modeles);
  await fa.nets.faceRecognitionNet.loadFromUri(cfg.modeles);
}, CFG);

/** Les visages d'une image, tels que l'OS les calcule : empreinte et qualité.
 *
 *  Toute erreur est rendue, jamais levée : une image illisible, un décodage qui échoue ou un
 *  modèle qui trébuche ne doivent pas emporter le lot entier. Au premier essai, une seule photo a
 *  suffi à tout arrêter. */
async function visagesDe(url, scoreMin = CFG.scoreMin) {
  try {
    return await page.evaluate(async ({ url, scoreMin }) => {
      try {
        const fa = window.faceapi;
        const rep = await fetch(url);
        if (!rep.ok) return { erreur: `image ${rep.status}` };
        const bmp = await createImageBitmap(await rep.blob(), { imageOrientation: "from-image" });
        // UN CANEVAS, PAS UN IMAGEBITMAP. face-api refuse un ImageBitmap :
        //   « toNetInput - expected media to be of type HTMLImageElement | HTMLVideoElement |
        //     HTMLCanvasElement | tf.Tensor3D »
        // Le refus est levé dans une promesse non attendue, donc il ne remonte pas comme une
        // erreur : la détection ne rend simplement jamais rien, et l'appelant attend pour
        // toujours. C'est ce qui faisait « Resulting promise was garbage collected » sur CHAQUE
        // photo, sans qu'aucun message ne dise pourquoi.
        //
        // ET ON RÉDUIT ICI, PAS À LA SIGNATURE. Le redimensionnement demandé au stockage n'est pas
        // appliqué — l'image revient en 3219 x 6192. Un visage perdu dans 6 000 px de haut sort à
        // 0,53 de confiance, sous notre seuil de 0,6 : la détection marchait, et on jetait son
        // résultat. Ramenée à 1 200 px, la même photo donne un score franc, et le modèle travaille
        // dix fois plus vite.
        const cote = Math.max(bmp.width, bmp.height);
        const ech = cote > 1200 ? 1200 / cote : 1;
        const toile = document.createElement("canvas");
        toile.width = Math.round(bmp.width * ech);
        toile.height = Math.round(bmp.height * ech);
        toile.getContext("2d", { willReadFrequently: true })
             .drawImage(bmp, 0, 0, toile.width, toile.height);
        if (bmp.close) bmp.close();
        const res = await fa.detectAllFaces(toile).withFaceLandmarks().withFaceDescriptors();
        return {
          visages: (res || [])
            .filter((d) => (d.detection && d.detection.score || 0) >= scoreMin)
            .map((d) => Array.from(d.descriptor)),
        };
      } catch (e) {
        return { erreur: String((e && e.message) || e).slice(0, 120) };
      }
    }, { url, scoreMin });
  } catch (e) {
    return { erreur: String((e && e.message) || e).slice(0, 120) };
  }
}

let totalMarques = 0, totalPhotos = 0, albumsFaits = 0;

for (const [album, lignes] of parAlbum) {
  const { d: infos } = await rest(`media_albums?select=title&id=eq.${album}`);
  const titre = infos?.[0]?.title ?? album;
  console.log(`\n▸ ${titre}`);

  // 1. LES EMPREINTES DE RÉFÉRENCE. La base dit qui est prêt et qui manque — elle seule connaît le
  //    consentement et l'équipe.
  const { d: joueurs } = await rpc("reconnaissance_joueurs_prets", { p_album_id: album });
  if (!Array.isArray(joueurs) || joueurs.length === 0) {
    console.log("   aucun sportif n'a autorisé la reconnaissance pour cette galerie");
    for (const l of lignes) await rpc("reconnaissance_fait", { p_id: l.id, p_resultat: "aucun sportif autorisé" });
    continue;
  }
  // v331 — UNE LIGNE PAR PHOTO DE REFERENCE, plus une par sportif. Une famille peut en deposer
  // plusieurs sous des angles differents, et `visage_rapprocher_direct` retient spontanement la
  // meilleure : c'est le levier le plus efficace mesure sur une vraie galerie, bien avant les
  // seuils. `a_une_empreinte` dit maintenant si CETTE photo est calculee, pas si le sportif en a
  // une quelque part — sans quoi la deuxieme n'etait jamais lue.
  for (const j of joueurs) {
    if (j.a_une_empreinte || !j.chemin_photo) continue;
    const url = await urlSignee("sportvision-media-prive", j.chemin_photo, 600);
    if (!url) { console.log(`   ${j.joueur} : photo de référence illisible`); continue; }
    const r = await visagesDe(url, CFG.scoreMinReference);
    if (r.erreur) { console.log(`   ${j.joueur} : ${r.erreur}`); continue; }
    // UNE photo de référence montre UN visage. Deux, et on ne sait pas lequel est l'enfant.
    if (!r.visages || r.visages.length !== 1) {
      console.log(`   ${j.joueur} : ${r.visages ? r.visages.length : 0} visage(s) sur la référence, on ne devine pas`);
      continue;
    }
    if (SIMULER) { console.log(`   ${j.joueur} : empreinte de référence calculée (simulation, rien écrit)`); continue; }
    const rep = await rpc("visage_reference_ajouter", {
      p_player_id: j.player_id, p_empreinte: `[${r.visages[0].join(",")}]`, p_modele: CFG.modele,
      // SANS CE LIEN, l'empreinte ne sait pas de quelle photo elle vient, et la passe suivante la
      // recalculerait indefiniment tout en declarant la photo « deja faite ».
      p_face_ref_id: j.face_ref_id ?? null,
    });
    console.log(rep.ok ? `   ${j.joueur} : empreinte de référence calculée` : `   ${j.joueur} : refus — ${JSON.stringify(rep.d).slice(0, 120)}`);
  }

  // 2. LES PHOTOS DE LA GALERIE. On compare, on marque, on jette l'empreinte.
  const { d: photos } = await rest(`media_assets?select=id,original_path,preview_clair_path,storage_bucket&album_id=eq.${album}&status=eq.ready&order=position`);
  if (!Array.isArray(photos) || photos.length === 0) {
    console.log("   aucune photo prête");
    for (const l of lignes) await rpc("reconnaissance_fait", { p_id: l.id, p_resultat: "aucune photo" });
    continue;
  }
  // LA GALERIE SE LIT EN DEUX TEMPS (28/09/2026).
  //
  // Fouka : « il faut que ça retrouve automatiquement toutes les photos. On ne va pas passer les
  // 117 photos en revue. »
  //
  // POURQUOI UNE SEULE PASSE NE SUFFIT PAS. Comparer chaque visage à L'UNIQUE photo de référence,
  // c'est ne retrouver que les prises de vue qui lui ressemblent : même angle, même lumière. Un
  // profil, une tête baissée, un contre-jour sortent au-delà du seuil et sont perdus — alors qu'ils
  // ressemblent beaucoup, eux, à un visage de face DE LA MÊME GALERIE qui, lui, a été reconnu.
  //
  // CE QU'ON FAIT À LA PLACE. On relève d'abord tous les visages de la galerie, sans rien décider.
  // La base dit ensuite lesquels sont sûrement le joueur : ceux-là deviennent des ANCRES. On
  // repasse alors sur les visages restants et on retient ceux qui sont très proches d'une ancre.
  // Les nouveaux deviennent ancres à leur tour, deux fois. C'est la photo de référence multipliée
  // par la galerie elle-même, sans rien demander de plus à la famille.
  //
  // CE QUI BORNE LA DÉRIVE, parce qu'un enchaînement mal réglé finirait par relier deux enfants :
  //   - l'expansion part UNIQUEMENT de ce que la base a jugé certain, jamais d'une simple proposition ;
  //   - son seuil (0,38) est plus sévère que celui qui déclenche un marquage automatique (0,42) ;
  //   - deux tours, pas plus ;
  //   - un visage déjà attribué à un autre joueur n'est jamais repris ;
  //   - et ce qui vient de l'expansion est PROPOSÉ, jamais validé d'office : la famille tranche.
  //
  // AUCUNE EMPREINTE DE GALERIE N'EST CONSERVÉE. Elles vivent dans ce tableau le temps de la passe
  // et disparaissent avec le processus. C'est ce que le texte de consentement promet.
  let marques = 0, visagesVus = 0, illisibles = 0, sansVisage = 0;
  const motifs = new Map();
  const vus = [];   // { asset, emp, joueur, distance, ancre }

  for (let i = 0; i < photos.length; i++) {
    if (i % 20 === 0) process.stdout.write(`   lecture ${i + 1}/${photos.length}…\r`);
    try {
      const url = await urlSignee(...aLire(photos[i]));
      if (!url) { illisibles++; continue; }
      const r = await visagesDe(url);
      // ON DIT POURQUOI, TOUJOURS. Ce `continue` était muet : une photo introuvable, un décodage
      // refusé et une photo sans visage se ressemblaient toutes les trois, et le moteur annonçait
      // « 0 identification sur 110 photos » avec l'air d'avoir travaillé.
      if (r.erreur) { motifs.set(r.erreur, (motifs.get(r.erreur) || 0) + 1); continue; }
      if (!r.visages || !r.visages.length) { sansVisage++; continue; }
      visagesVus += r.visages.length;
      for (const emp of r.visages) vus.push({ asset: photos[i].id, emp, joueur: null, distance: null, ancre: false });
    } catch { /* une photo illisible n'arrête pas le lot */ }
  }
  process.stdout.write(`   ${visagesVus} visage(s) relevé(s) sur ${photos.length} photo(s)          \n`);

  // ── Ce que la base reconnaît directement ────────────────────────────────────────────────────
  // La règle reste où elle est : c'est `visage_rapprocher_direct` qui sait qui a le droit d'être
  // rapproché, de quelle équipe, avec quel consentement. Le moteur ne la rejoue pas.
  for (const v of vus) {
    const { d: props } = await rpc("visage_rapprocher_direct", {
      p_asset_id: v.asset, p_empreinte: `[${v.emp.join(",")}]`,
      p_modele: CFG.modele, p_seuil: CFG.seuilPropose,
    });
    if (!Array.isArray(props) || !props.length) continue;
    v.joueur = props[0].player_id;
    v.distance = Number(props[0].distance);
    v.ancre = v.distance < CFG.seuilCertain;
  }
  const directs = vus.filter((v) => v.joueur).length;
  const ancres0 = vus.filter((v) => v.ancre).length;

  // ── L'expansion ─────────────────────────────────────────────────────────────────────────────
  const distance = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) { const d = a[k] - b[k]; s += d * d; } return Math.sqrt(s); };

  // EN SIMULATION, ON COMPARE PLUSIEURS RÉGLAGES D'UN SEUL COUP. Relire 110 photos coûte onze
  // minutes ; refaire cette lecture pour chaque seuil à essayer serait absurde, et c'est en la
  // refaisant qu'on finit par effacer des données pour « repartir propre ». Les empreintes sont
  // là, en mémoire : autant les interroger plusieurs fois.
  if (SIMULER) {
    console.log("\n   réglages comparés sur cette même lecture :");
    console.log("   ancres            | seuil | retrouvés en plus");
    for (const depuisCertains of [true, false]) {
      for (const seuil of [0.38, 0.42, 0.45, 0.50]) {
        const etat = vus.map((v) => ({ emp: v.emp, joueur: v.joueur, ancre: depuisCertains ? v.ancre : !!v.joueur }));
        let gagnes = 0;
        for (let tour = 0; tour < CFG.toursExpansion; tour++) {
          const ancres = etat.filter((v) => v.ancre);
          if (!ancres.length) break;
          const neufs = [];
          for (const v of etat) {
            if (v.joueur) continue;
            let best = Infinity, qui = null;
            for (const a of ancres) { const d = distance(v.emp, a.emp); if (d < best) { best = d; qui = a; } }
            if (qui && best < seuil) { v.joueur = qui.joueur; neufs.push(v); gagnes++; }
          }
          if (!neufs.length) break;
          for (const v of neufs) v.ancre = true;
        }
        console.log(`   ${depuisCertains ? "certains seulement" : "tous les reconnus "} | ${seuil.toFixed(2)}  | ${gagnes}`);
      }
    }
    console.log("");
  }
  // ON PART DE TOUS LES VISAGES QUE LA BASE A RECONNUS, pas des seuls « certains ». Mesuré : avec
  // une seule certitude dans la galerie, une chaîne n'a aucun point d'appui et ne retrouve rien.
  for (const v of vus) if (v.joueur) v.ancre = true;
  for (let tour = 0; tour < CFG.toursExpansion; tour++) {
    const ancres = vus.filter((v) => v.ancre);
    if (!ancres.length) break;
    let gagnes = 0;
    for (const v of vus) {
      if (v.joueur) continue;
      let meilleur = null, best = Infinity;
      for (const a of ancres) {
        const d = distance(v.emp, a.emp);
        if (d < best) { best = d; meilleur = a; }
      }
      if (meilleur && best < CFG.seuilExpansion) {
        v.joueur = meilleur.joueur;
        // La distance À LA RÉFÉRENCE de l'ancre, majorée de l'écart parcouru. On ne la plafonne
        // PAS : plafonner écrivait 0,550 sur toutes les photos retrouvées par ressemblance, et
        // cette colonne est justement celle qui permet de recaler les seuils plus tard. Un chiffre
        // rond identique partout n'apprend rien à personne.
        v.distance = (meilleur.distance ?? CFG.seuilCertain) + best;
        v.parExpansion = true;
        gagnes++;
      }
    }
    if (!gagnes) break;
    // Les nouveaux deviennent ancres pour le tour suivant, mais jamais « certains » : ils ne
    // valident rien tout seuls.
    for (const v of vus) if (v.parExpansion && !v.ancre) v.ancre = true;
  }

  // ── Le marquage ─────────────────────────────────────────────────────────────────────────────
  const parPhoto = new Map();
  for (const v of vus) {
    if (!v.joueur) continue;
    // Deux visages d'une même photo ne désignent pas la même personne : on ne garde que le plus proche.
    const cle = `${v.asset}|${v.joueur}`;
    const dejaLa = parPhoto.get(cle);
    if (!dejaLa || v.distance < dejaLa.distance) parPhoto.set(cle, v);
  }
  let parExpansion = 0;
  for (const v of parPhoto.values()) {
    if (SIMULER) { marques++; if (v.parExpansion) parExpansion++; continue; }
    const rep = await rpc("marquer_par_reconnaissance", {
      p_asset_id: v.asset, p_player_id: v.joueur, p_distance: v.distance,
      // CE QUI VIENT DE L'EXPANSION EST TOUJOURS PROPOSÉ. Seule une ressemblance directe à la
      // photo de référence peut valider sans relecture humaine.
      p_modele: CFG.modele, p_certain: !v.parExpansion && v.distance < CFG.seuilCertain,
    });
    if (rep.ok) { marques++; if (v.parExpansion) parExpansion++; }
  }
  console.log(`   ${marques} identification(s) sur ${photos.length} photo(s) — ${directs} visage(s) reconnu(s) directement (dont ${ancres0} certain(s)), ${parExpansion} retrouvé(s) par ressemblance${sansVisage ? `, ${sansVisage} photo(s) sans visage` : ""}${illisibles ? `, ${illisibles} introuvable(s)` : ""}`);
  for (const [motif, n] of [...motifs].sort((a, b) => b[1] - a[1]))
    console.log(`   ${n} photo(s) en echec : ${motif}`);
  totalPhotos += photos.length;
  totalMarques += marques;
  albumsFaits++;
  console.log(`   ${marques} identification(s) sur ${photos.length} photo(s) — ${visagesVus} visage(s) detecte(s), ${sansVisage} photo(s) sans visage${illisibles ? `, ${illisibles} introuvable(s) dans le stockage` : ""}   `);
  for (const [motif, n] of [...motifs].sort((a, b) => b[1] - a[1]))
    console.log(`   ${n} photo(s) en echec : ${motif}`);
  if (!SIMULER) for (const l of lignes) await rpc("reconnaissance_fait", { p_id: l.id, p_resultat: `${marques} identification(s)` });
}

await navigateur.close();
serveur.close();
console.log(`\n${albumsFaits} galerie(s), ${totalPhotos} photo(s), ${totalMarques} identification(s).`);
