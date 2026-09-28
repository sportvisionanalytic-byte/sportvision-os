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
//   node livrables/SportVision-TV/scripts/reconnaissance-automatique.mjs --boucle   # attend la file et la vide, sans fin
//
// Reprenable : chaque ligne de la file est close dès qu'elle est traitée, donc on peut
// l'interrompre et le relancer sans rien refaire deux fois.
import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { readFileSync, writeSync } from "node:fs";
import { createServer } from "node:http";

const VOIR_SEULEMENT = process.argv.includes("--voir");
// MESURER SANS RIEN ÉCRIRE (28/09/2026). Pour comparer deux réglages, j'ai effacé les marquages de
// la galerie et relancé le moteur — pendant que Fouka regardait ses photos, qui ont disparu de son
// écran le temps de la passe. On ne mesure pas en abîmant ce que quelqu'un utilise. Ce mode calcule
// tout et annonce ce qu'il POSERAIT, sans toucher à une seule ligne.
const SIMULER = process.argv.includes("--simuler");
// EN BOUCLE, POUR QUE PERSONNE N'AIT A LANCER QUOI QUE CE SOIT (28/09/2026).
//
// Fouka : « des lors qu'il y a une photo qui pop, bam, elle retrouve ses photos. » La file se
// remplit deja toute seule (v325) : une photo de reference deposee, une galerie publiee, et le
// travail s'y inscrit. Ce qui manquait, c'est quelqu'un pour la vider — c'etait moi, a la main.
//
// En mode boucle, le moteur attend la file et la traite des qu'elle contient quelque chose. Il
// reste immobile le reste du temps : pas de calcul, pas de requete inutile.
const EN_BOUCLE = process.argv.includes("--boucle");

// UN SERVICE MUET NE SERT A RIEN. Quand la sortie va dans un fichier et non dans un terminal, Node
// la met en tampon : le service tournait depuis deux minutes, stable, et son journal etait vide.
// On ecrit donc en synchrone des qu'on tourne en service — `console.log` reste utilise partout
// ailleurs, ou la sortie est un terminal et se vide toute seule.
const dire = EN_BOUCLE
  ? (t) => { try { writeSync(1, String(t) + "\n"); } catch { console.log(t); } }
  : console.log;
const ATTENTE = Math.max(5, Number((process.argv.find((a) => a.startsWith("--attente=")) || "").split("=")[1] || 20)) * 1000;
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
  // ── LA SILHOUETTE ───────────────────────────────────────────────────────────────────────────
  //
  // Fouka : « il faut reconnaitre les cheveux, la posture, de dos, sur le cote, meme si on le voit
  // qu'a moitie. » Un moteur de visages ne rend RIEN sur une photo de dos, et c'est 31 photos sur
  // 110 dans une galerie reelle. On decrit donc aussi l'APPARENCE de chaque personne : ses
  // couleurs en six bandes — cheveux, epaules, maillot, hanches, cuisses, chaussettes.
  //
  // CA N'A DE SENS QUE DANS UNE GALERIE, et c'est ce qui rend l'idee solide : le meme jour, la
  // meme tenue, la meme lumiere. Entre deux matchs, ces signatures ne veulent plus rien dire — on
  // ne les conserve donc jamais, exactement comme les empreintes de visage.
  //
  // LE SEUIL EST MESURE. Sur 31 personnes de 14 photos : deux personnes DIFFERENTES de la meme
  // photo ne descendent jamais sous 0,688 (mediane 1,602). Dix paires issues de photos
  // differentes sont entre 0,318 et 0,691 — verifiees a l'oeil, c'est bien le meme joueur, vu de
  // face puis de trois quarts. On s'arrete a 0,60 pour garder une marge sous ce plancher.
  seuilSilhouette: 0.60,
  scoreMinPersonne: 0.55,
  // ── LE DOSSARD ──────────────────────────────────────────────────────────────────────────────
  //
  // « J'etais le numero 7 a ce match-la » ne pouvait rien trouver : `media_assets.numeros_visibles`
  // se saisit a la main depuis l'OS, et sur 6 288 photos reelles AUCUNE n'avait ete relevee. Le
  // geste etait vide par construction.
  //
  // CE QUI A MARCHE, APRES DEUX ECHECS. Lire la photo entiere rendait 94 « nombres » par image :
  // du gazon, des panneaux. Cadrer une bande fixe sur le corps tombait sur le ventre. On CHERCHE
  // donc le numero : un chiffre de maillot est une tache d'une couleur franche, d'une taille
  // previsible par rapport au corps. On fabrique le masque, on etiquette les taches, on garde
  // celles qui ont la bonne taille et la bonne forme, on regroupe celles qui sont cote a cote — un
  // « 11 », ce sont deux taches voisines — et on ne lit QUE ca.
  //
  // UNE LECTURE FAUSSE N'EST PAS GRAVE, et c'est ce qui rend l'imperfection acceptable : un numero
  // releve ne fait qu'emettre une SUGGESTION, croisee avec le numero que la famille declare, et la
  // famille tranche. Jamais une attribution.
  confianceDossard: 40,
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
// LE NAVIGATEUR ET LES MODELES VIVENT HORS DE LA BOUCLE (28/09/2026).
//
// Ils etaient a l'interieur de `vider()` : en mode boucle, chaque passe aurait relance Chromium
// et recharge les trois modeles, toutes les vingt secondes. Le commentaire de la boucle affirmait
// le contraire — c'est le genre d'ecart qu'on ne voit pas tant qu'on ne lance pas vraiment.
// Et en mode simple, la fermeture finale ne trouvait meme plus le navigateur : `ReferenceError`
// apres que tout le travail ait ete fait et enregistre.

// ── Un navigateur, juste pour le calcul d'images ────────────────────────────────────────────────
// La page est servie depuis 127.0.0.1 et non `about:blank` : sans origine réelle, les requêtes
// vers le stockage partent d'une origine nulle et sont refusées.
const serveur = createServer((_, rep) => {
  rep.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  rep.end("<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>");
}).listen(0, "127.0.0.1");
// ON ATTACHE L'ECOUTE AVANT, ET ON REGARDE L'ETAT (29/09/2026).
//
// `serveur.on("listening", ...)` pose apres coup : si l'evenement est DEJA passe quand on attache
// le gestionnaire, il ne reviendra jamais et l'attente ne se termine pas. En lancement manuel le
// hasard du timing passait ; installe en service, le script restait bloque la, indefiniment, sans
// ecrire une ligne — journal a zero octet, processus vivant, rien a diagnostiquer.
await new Promise((resoudre, rejeter) => {
  if (serveur.listening) return resoudre();
  serveur.once("listening", resoudre);
  serveur.once("error", rejeter);
});

// SwiftShader rend WebGL disponible sans carte graphique. Sans ces drapeaux, le navigateur sans
// ecran tombe en plein calcul — « Resulting promise was garbage collected », vu au premier essai.
dire("Démarrage du navigateur…");
const navigateur = await chromium.launch({
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"],
});
dire("Navigateur prêt.");
const page = await navigateur.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("   navigateur :", m.text().slice(0, 140)); });
await page.goto(`http://127.0.0.1:${serveur.address().port}/`);

dire("Chargement des modèles…");
await page.addScriptTag({ url: CFG.lib });
// LE DETECTEUR DE PERSONNES, a cote du detecteur de visages. face-api embarque son propre
// TensorFlow ; coco-ssd, lui, cherche `window.tf`. On le lui donne plutot que d'en charger un
// second, qui se disputerait le meme backend.
await page.evaluate(() => { if (!window.tf && window.faceapi) window.tf = window.faceapi.tf; });
await page.addScriptTag({ url: "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js" });
await page.addScriptTag({ url: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js" });
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

  // Le detecteur de personnes. S'il ne se charge pas, on continue sans : la reconnaissance de
  // visages garde toute sa valeur, seule la silhouette est perdue — et on le DIT.
  try { window._personnes = await window.cocoSsd.load({ base: "lite_mobilenet_v2" }); }
  catch (e) { window._personnes = null; window._raterPersonnes = String(e && e.message || e).slice(0, 120); }

  // Le lecteur de chiffres. Comme le detecteur de personnes : s'il manque, on continue sans, et on
  // le dit. Aucune de ces deux capacites n'est indispensable a la reconnaissance de visages.
  try { window._ocr = await window.Tesseract.createWorker("eng", 1, {}); 
        await window._ocr.setParameters({ tessedit_char_whitelist: "0123456789" }); }
  catch (e) { window._ocr = null; window._raterOcr = String(e && e.message || e).slice(0, 120); }

  // LA RECHERCHE DES CHIFFRES. `reference` est la hauteur du CORPS, pas celle de la zone fouillee :
  // sans elle, un chiffre valant 12 % du corps devient 2 % de l'image et se fait rejeter par la
  // borne de taille. C'est ce qui faisait manquer un « 11 » pourtant parfaitement isole.
  window._chercherChiffres = function (ctx, x, y, w, h, clairSurFonce, reference) {
    const X = Math.max(0, Math.round(x)), Y = Math.max(0, Math.round(y));
    const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
    const d = ctx.getImageData(X, Y, W, H).data;
    // CE QUI DISTINGUE UN CHIFFRE BLANC, CE N'EST PAS SA LUMINOSITE, C'EST SON ABSENCE DE COULEUR.
    // Un « 11 » blanc sur un maillot bleu clair donne deux gris voisins : en niveaux de gris, on
    // ne separait rien. Par la saturation, le chiffre ressort net.
    const masque = new Uint8Array(W * H);
    for (let i = 0, k = 0; i < masque.length; i++, k += 4) {
      const r = d[k] / 255, g = d[k + 1] / 255, b = d[k + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx, lum = 0.299 * r + 0.587 * g + 0.114 * b;
      masque[i] = clairSurFonce ? ((sat < 0.25 && lum > 0.62) ? 1 : 0) : ((lum < 0.32) ? 1 : 0);
    }
    const ech = reference || H;
    const hMin = Math.max(6, ech * 0.07), hMax = ech * 0.32;
    const vu = new Uint8Array(W * H), file = new Int32Array(W * H), taches = [];
    for (let s = 0; s < masque.length; s++) {
      if (!masque[s] || vu[s]) continue;
      let tete = 0, queue = 0; file[queue++] = s; vu[s] = 1;
      let x0 = W, x1 = 0, y0 = H, y1 = 0, n = 0;
      while (tete < queue) {
        const p = file[tete++]; const px = p % W, py = (p - px) / W; n++;
        if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
        if (px > 0     && masque[p - 1] && !vu[p - 1]) { vu[p - 1] = 1; file[queue++] = p - 1; }
        if (px < W - 1 && masque[p + 1] && !vu[p + 1]) { vu[p + 1] = 1; file[queue++] = p + 1; }
        if (py > 0     && masque[p - W] && !vu[p - W]) { vu[p - W] = 1; file[queue++] = p - W; }
        if (py < H - 1 && masque[p + W] && !vu[p + W]) { vu[p + W] = 1; file[queue++] = p + W; }
      }
      const th = y1 - y0 + 1, tw = x1 - x0 + 1;
      if (th < hMin || th > hMax) continue;
      if (tw < th * 0.12 || tw > th * 1.3) continue;              // un chiffre est plus haut que large
      if (n < tw * th * 0.15 || n > tw * th * 0.92) continue;     // ni un trait, ni un bloc plein
      taches.push({ x0, x1, y0, y1, th, tw });
    }
    // Regrouper : « 11 », ce sont deux taches cote a cote, a la meme hauteur, de taille voisine.
    taches.sort((a, b) => a.x0 - b.x0);
    const groupes = [], pris = new Array(taches.length).fill(false);
    for (let i = 0; i < taches.length; i++) {
      if (pris[i]) continue;
      const g = { x0: taches[i].x0, x1: taches[i].x1, y0: taches[i].y0, y1: taches[i].y1, n: 1, parts: [taches[i]] };
      pris[i] = true;
      for (let j = i + 1; j < taches.length; j++) {
        if (pris[j]) continue;
        const t = taches[j], haut = g.y1 - g.y0 + 1;
        if (Math.abs(t.th - haut) < haut * 0.45
            && Math.abs((t.y0 + t.y1) / 2 - (g.y0 + g.y1) / 2) < haut * 0.45
            && t.x0 - g.x1 < haut * 0.8 && t.x0 >= g.x0) {
          g.x1 = Math.max(g.x1, t.x1); g.y0 = Math.min(g.y0, t.y0); g.y1 = Math.max(g.y1, t.y1);
          g.n++; g.parts.push(t); pris[j] = true;
        }
      }
      if (g.n <= 2) groupes.push(g);   // un dossard fait un ou deux chiffres, jamais cinq
    }
    return groupes.map((g) => ({
      x: X + g.x0, y: Y + g.y0, w: g.x1 - g.x0 + 1, h: g.y1 - g.y0 + 1,
      // CHAQUE TACHE EST UN CHIFFRE : les dix chiffres sont d'un seul tenant, meme le 0. Leur
      // NOMBRE dit combien de chiffres attendre, et c'est le meilleur juge d'une lecture — sans
      // lui, « 11 » se lisait « 1 » a 83 % de confiance : sur de lui, et faux.
      parts: g.parts.sort((a, b) => a.x0 - b.x0)
                    .map((t) => ({ x: X + t.x0, y: Y + t.y0, w: t.x1 - t.x0 + 1, h: t.y1 - t.y0 + 1 })),
    }));
  };

  // LA SIGNATURE D'APPARENCE. Six bandes horizontales — cheveux, epaules, maillot, hanches,
  // cuisses, chaussettes — et pour chacune un histogramme grossier de teinte, plus la clarte et la
  // saturation moyennes. Grossier a dessein : on veut que deux vues du MEME joueur se ressemblent
  // malgre le mouvement, pas qu'elles soient identiques.
  window._signature = function (ctx, x, y, w, h) {
    const BANDES = 6, TEINTES = 12;
    const sig = new Float32Array(BANDES * (TEINTES + 2));
    for (let b = 0; b < BANDES; b++) {
      const by = Math.round(y + h * b / BANDES), bh = Math.max(1, Math.round(h / BANDES));
      const d = ctx.getImageData(Math.round(x), by, Math.max(1, Math.round(w)), bh).data;
      let n = 0, sl = 0, ss = 0; const hist = new Float32Array(TEINTES);
      for (let k = 0; k < d.length; k += 4) {
        const r = d[k] / 255, g = d[k + 1] / 255, bl = d[k + 2] / 255;
        const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), c = mx - mn;
        let t = 0;
        if (c > 0.001) {
          if (mx === r) t = ((g - bl) / c + 6) % 6; else if (mx === g) t = (bl - r) / c + 2; else t = (r - g) / c + 4;
          t = t / 6;
        }
        hist[Math.min(TEINTES - 1, Math.floor(t * TEINTES))] += c;  // pondere par la saturation
        sl += mx; ss += (mx === 0 ? 0 : c / mx); n++;
      }
      let som = 0; for (let i = 0; i < TEINTES; i++) som += hist[i];
      for (let i = 0; i < TEINTES; i++) sig[b * (TEINTES + 2) + i] = som > 0 ? hist[i] / som : 0;
      sig[b * (TEINTES + 2) + TEINTES] = n ? sl / n : 0;
      sig[b * (TEINTES + 2) + TEINTES + 1] = n ? ss / n : 0;
    }
    return Array.from(sig);
  };
}, CFG);
const sansPersonnes = await page.evaluate(() => window._raterPersonnes || null);
if (sansPersonnes) console.log(`   detecteur de personnes indisponible (${sansPersonnes}) : la silhouette ne sera pas utilisee.`);
const sansOcr = await page.evaluate(() => window._raterOcr || null);
if (sansOcr) console.log(`   lecteur de chiffres indisponible (${sansOcr}) : les dossards ne seront pas releves.`);

/** Vider la file une fois. Rend le nombre de galeries traitées, pour que la boucle sache si elle a
 *  travaillé ou si elle doit se rendormir. */
async function vider() {
  const { d: file } = await rest("reconnaissance_a_faire?select=id,album_id,player_id&traite_le=is.null&order=demande_le&limit=500");
  if (!Array.isArray(file) || file.length === 0) {
    if (!EN_BOUCLE) console.log("La file est vide. Rien à faire.");
    return { albums: 0, photos: 0, marques: 0 };
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
    return;
  }


  /** Les visages d'une image, tels que l'OS les calcule : empreinte et qualité.
   *
   *  Toute erreur est rendue, jamais levée : une image illisible, un décodage qui échoue ou un
   *  modèle qui trébuche ne doivent pas emporter le lot entier. Au premier essai, une seule photo a
   *  suffi à tout arrêter. */
  async function visagesDe(url, scoreMin = CFG.scoreMin) {
    try {
      return await page.evaluate(async ({ url, scoreMin, scoreMinPersonne, confianceDossard }) => {
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
          const ctx = toile.getContext("2d", { willReadFrequently: true });
          const visages = (res || [])
            .filter((d) => (d.detection && d.detection.score || 0) >= scoreMin)
            .map((d) => ({
              emp: Array.from(d.descriptor),
              // Le cadre du visage sert a savoir DANS QUELLE PERSONNE il se trouve : c'est ce lien
              // qui donne un nom a une silhouette.
              boite: [d.detection.box.x, d.detection.box.y, d.detection.box.width, d.detection.box.height],
            }));

          // LES PERSONNES, MEME CELLES DE DOS. C'est tout l'interet : un moteur de visages ne rend
          // rien sur une photo de dos, et c'est 31 photos sur 110 dans une galerie reelle.
          let silhouettes = [];
          if (window._personnes) {
            const pers = await window._personnes.detect(toile, 20);
            silhouettes = pers
              .filter((d) => d.class === "person" && d.score >= scoreMinPersonne
                             && d.bbox[2] >= 20 && d.bbox[3] >= 50)
              .map((d) => ({ boite: d.bbox, sig: window._signature(ctx, d.bbox[0], d.bbox[1], d.bbox[2], d.bbox[3]) }));
          }
          // ── LES DOSSARDS ────────────────────────────────────────────────────────────────────
          const numeros = [];
          if (window._ocr && silhouettes.length) {
            // La hauteur du plus grand corps donne l'echelle des chiffres qu'on cherche.
            const plusGrand = silhouettes.reduce((m, s) => Math.max(m, s.boite[3]), 0);
            const decouper = (zone, clair) => {
              const marge = Math.round(zone.h * 0.30);
              const zx = Math.max(0, zone.x - marge), zy = Math.max(0, zone.y - marge);
              const zw = Math.min(toile.width - zx, zone.w + marge * 2);
              const zh = Math.min(toile.height - zy, zone.h + marge * 2);
              const ech2 = Math.min(12, Math.max(3, 140 / zh));
              const v = document.createElement("canvas");
              v.width = Math.round(zw * ech2); v.height = Math.round(zh * ech2);
              const vx = v.getContext("2d", { willReadFrequently: true });
              vx.imageSmoothingQuality = "high";
              vx.drawImage(toile, zx, zy, zw, zh, 0, 0, v.width, v.height);
              const im = vx.getImageData(0, 0, v.width, v.height), dd = im.data;
              for (let k = 0; k < dd.length; k += 4) {
                const rr = dd[k] / 255, gg = dd[k + 1] / 255, bb = dd[k + 2] / 255;
                const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb);
                const sat = mx === 0 ? 0 : (mx - mn) / mx, lum = 0.299 * rr + 0.587 * gg + 0.114 * bb;
                const est = clair ? (sat < 0.25 && lum > 0.62) : (lum < 0.32);
                const val = est ? 0 : 255; dd[k] = dd[k + 1] = dd[k + 2] = val; dd[k + 3] = 255;
              }
              vx.putImageData(im, 0, 0);
              return v;
            };
            // On fouille chaque personne, puis l'image entiere : un joueur du premier plan echappe
            // parfois au detecteur, et son dossard est alors le plus lisible de tous.
            const lots = silhouettes.map((sh) => ({ boite: sh.boite, ref: sh.boite[3] }))
                           .concat(plusGrand ? [{ boite: [0, 0, toile.width, toile.height], ref: plusGrand }] : []);
            for (const lot of lots) {
              const [px, py, pw, ph] = lot.boite;
              for (const clair of [true, false]) {
                for (const z of window._chercherChiffres(ctx, px, py, pw, ph, clair, lot.ref)) {
                  const attendus = z.parts.length;
                  const v = decouper(z, clair);
                  const essais = [];
                  for (const psm of ["7", "8", "13"]) {
                    await window._ocr.setParameters({ tessedit_pageseg_mode: psm });
                    const { data } = await window._ocr.recognize(v);
                    const brut = (data.text || "").replace(/[^0-9]/g, "");
                    if (brut.length >= 1 && brut.length <= 2) essais.push({ t: brut, c: data.confidence });
                  }
                  await window._ocr.setParameters({ tessedit_pageseg_mode: "10" });
                  let parChiffre = "", somme = 0, nb = 0;
                  for (const part of z.parts) {
                    const { data } = await window._ocr.recognize(decouper(part, clair));
                    const ch = (data.text || "").replace(/[^0-9]/g, "");
                    if (ch.length === 1) { parChiffre += ch; somme += data.confidence; nb++; }
                  }
                  if (parChiffre) essais.push({ t: parChiffre, c: nb ? somme / nb : 0 });
                  // La bonne LONGUEUR d'abord, la confiance ensuite.
                  essais.sort((a, b) => ((b.t.length === attendus) - (a.t.length === attendus)) || (b.c - a.c));
                  const lu = essais[0];
                  if (!lu || !lu.t) continue;
                  const n = +lu.t;
                  if (n >= 1 && n <= 99 && lu.c >= confianceDossard && !numeros.includes(n)) numeros.push(n);
                }
              }
            }
          }
          return { visages, silhouettes, numeros };
        } catch (e) {
          return { erreur: String((e && e.message) || e).slice(0, 120) };
        }
      }, { url, scoreMin, scoreMinPersonne: CFG.scoreMinPersonne, confianceDossard: CFG.confianceDossard });
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
        p_player_id: j.player_id, p_empreinte: `[${r.visages[0].emp.join(",")}]`, p_modele: CFG.modele,
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
    // La distance euclidienne, pour les empreintes de visage comme pour les signatures d'apparence.
    const distance = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) { const d = a[k] - b[k]; s += d * d; } return Math.sqrt(s); };
    let marques = 0, visagesVus = 0, illisibles = 0, sansVisage = 0, numerosVus = 0;
    const motifs = new Map();
    const vus = [];          // les visages   : { asset, emp, boite, joueur, distance, ancre }
    const silhouettes = [];  // les personnes : { asset, sig, visage, joueur }

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
        for (const v of r.visages) vus.push({ asset: photos[i].id, emp: v.emp, boite: v.boite, joueur: null, distance: null, ancre: false });
        // CHAQUE VISAGE APPARTIENT A QUELQU'UN. On relie le visage a la personne qui le contient :
        // c'est ce lien qui permet, plus tard, de donner un nom a une silhouette vue de dos.
        // LES NUMEROS RELEVES. `media_assets.numeros_visibles` se saisissait a la main depuis l'OS,
        // et AUCUNE des 6 288 photos reelles ne l'avait jamais ete : le geste « j'etais le numero 7 »
        // etait vide par construction. On les releve donc ici.
        if (r.numeros && r.numeros.length) {
          numerosVus += r.numeros.length;
          if (!SIMULER) {
            const rep = await rest(`media_assets?id=eq.${photos[i].id}`, {
              method: "PATCH", body: JSON.stringify({ numeros_visibles: r.numeros }),
              headers: { Prefer: "return=minimal" },
            });
            if (!rep.ok) motifs.set("numeros non enregistres", (motifs.get("numeros non enregistres") || 0) + 1);
          }
        }
        for (const sil of (r.silhouettes || [])) {
          const [sx, sy, sw, sh] = sil.boite;
          const dedans = r.visages.find((v) => {
            const cx = v.boite[0] + v.boite[2] / 2, cy = v.boite[1] + v.boite[3] / 2;
            return cx >= sx && cx <= sx + sw && cy >= sy && cy <= sy + sh;
          });
          silhouettes.push({ asset: photos[i].id, sig: sil.sig, visage: dedans ? dedans.emp : null, joueur: null });
        }
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

    // ET DE CE QUE LA FAMILLE A CONFIRMÉ À LA MAIN (28/09/2026).
    //
    // Fouka : « quand je mets "c'était moi"… il faut que ça mette automatiquement toutes les
    // photos. » C'est exactement ce que ces réponses permettent : un « oui c'est moi » est une
    // CERTITUDE HUMAINE, bien meilleure que n'importe quel rapprochement machine, et jusqu'ici elle
    // ne servait qu'à ranger une photo. Elle devient un point d'appui : chaque confirmation élargit
    // la passe suivante, et la reconnaissance s'améliore à mesure qu'on s'en sert.
    //
    // ON NE GARDE RIEN POUR AUTANT. L'empreinte est recalculée pendant la passe, depuis la photo, et
    // disparaît avec le processus — la promesse faite aux parents tient.
    //
    // UNE SEULE PRUDENCE, et elle est nécessaire : on n'utilise que les photos où UN SEUL visage a
    // été relevé. Sur une photo à deux visages, rien ne dit lequel est l'enfant, et se tromper
    // d'ancre propagerait l'erreur à toute la chaîne.
    const { d: confirmees } = await rest(
      `media_player_tags?select=media_ref_id,player_id&media_ref_type=eq.media_asset&statut=eq.valide`
      + `&media_ref_id=in.(${photos.map((p) => p.id).join(",")})`);
    let ancresConfirmees = 0;
    if (Array.isArray(confirmees) && confirmees.length) {
      const parAsset = new Map();
      for (const v of vus) parAsset.set(v.asset, (parAsset.get(v.asset) || 0) + 1);
      const quiEstLa = new Map(confirmees.map((c) => [c.media_ref_id, c.player_id]));
      for (const v of vus) {
        if (v.joueur || parAsset.get(v.asset) !== 1) continue;
        const qui = quiEstLa.get(v.asset);
        if (!qui) continue;
        v.joueur = qui;
        v.ancre = true;
        v.confirmeeParHumain = true;
        ancresConfirmees++;
      }
    }
    if (ancresConfirmees) console.log(`   ${ancresConfirmees} photo(s) deja confirmee(s) par la famille servent de point d'appui`);
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

    // ── LA SILHOUETTE : reconnaitre de dos, de cote, a moitie cache ─────────────────────────────
    //
    // Fouka : « il faut reconnaitre les cheveux, la posture, de dos, sur le cote, meme si on le voit
    // qu'a moitie, meme un petit bout en fond. »
    //
    // On sait maintenant QUI est chaque visage. Un visage appartient a une personne, et cette
    // personne a une apparence : ses couleurs, ses cheveux, sa tenue. Ces apparences-la portent donc
    // un nom, et deviennent des points d'appui. Toute autre personne de la galerie qui leur
    // ressemble assez est proposee — meme si on ne voit pas son visage, meme de dos.
    //
    // CE QUI BORNE LA DERIVE, et il en faut, parce que vingt-deux joueurs portent deux maillots :
    //   - le seuil est MESURE (0,60), sous le plancher de 0,688 auquel descendent deux personnes
    //     differentes d'une MEME photo ;
    //   - une personne dont le visage a deja ete attribue n'est jamais reprise ;
    //   - deux personnes de la MEME photo ne peuvent pas etre le meme joueur : on ne garde que la
    //     plus proche ;
    //   - et tout ce qui sort d'ici est PROPOSE, jamais valide d'office. La famille tranche.
    //
    // RIEN N'EST CONSERVE. Ces signatures ne valent que dans cette galerie — meme jour, meme tenue,
    // meme lumiere — et disparaissent avec le processus, comme les empreintes de visage.
    let parSilhouette = 0;
    if (silhouettes.length) {
      const parVisage = new Map();
      for (const v of vus) if (v.joueur) parVisage.set(`${v.asset}|${v.emp[0]}|${v.emp[1]}`, v.joueur);
      for (const sh of silhouettes) {
        if (!sh.visage) continue;
        sh.joueur = parVisage.get(`${sh.asset}|${sh.visage[0]}|${sh.visage[1]}`) ?? null;
      }
      const reperes = silhouettes.filter((sh) => sh.joueur);
      if (reperes.length) {
        // Les photos ou ce joueur est DEJA trouve par son visage : inutile d'y chercher sa silhouette.
        const dejaTrouve = new Set(vus.filter((v) => v.joueur).map((v) => `${v.asset}|${v.joueur}`));
        const meilleure = new Map();   // asset|joueur -> { distance }
        for (const sh of silhouettes) {
          if (sh.joueur) continue;
          let best = Infinity, qui = null;
          for (const a of reperes) {
            if (a.asset === sh.asset) continue;   // deux personnes d'une meme photo sont differentes
            const d = distance(sh.sig, a.sig);
            if (d < best) { best = d; qui = a.joueur; }
          }
          if (!qui || best >= CFG.seuilSilhouette) continue;
          const cle = `${sh.asset}|${qui}`;
          if (dejaTrouve.has(cle)) continue;
          const dejaLa = meilleure.get(cle);
          if (!dejaLa || best < dejaLa.distance) meilleure.set(cle, { asset: sh.asset, joueur: qui, distance: best });
        }
        for (const m of meilleure.values()) {
          const rep = await rpc("marquer_par_reconnaissance", {
            p_asset_id: m.asset, p_player_id: m.joueur,
            // La distance de silhouette n'est pas une distance de visage : on l'enregistre telle
            // quelle, mais elle ne vaut JAMAIS validation — c'est le dernier argument qui le dit.
            p_distance: m.distance, p_modele: CFG.modele, p_certain: false,
          });
          if (rep.ok) { marques++; parSilhouette++; }
        }
      }
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
      // Deja tranchee par un humain : on ne la repose pas, et on ne la compte pas comme trouvaille.
      if (v.confirmeeParHumain) continue;
      if (SIMULER) { marques++; if (v.parExpansion) parExpansion++; continue; }
      const rep = await rpc("marquer_par_reconnaissance", {
        p_asset_id: v.asset, p_player_id: v.joueur, p_distance: v.distance,
        // CE QUI VIENT DE L'EXPANSION EST TOUJOURS PROPOSÉ. Seule une ressemblance directe à la
        // photo de référence peut valider sans relecture humaine.
        p_modele: CFG.modele, p_certain: !v.parExpansion && v.distance < CFG.seuilCertain,
      });
      if (rep.ok) { marques++; if (v.parExpansion) parExpansion++; }
    }
    console.log(`   ${marques} identification(s) sur ${photos.length} photo(s) — ${directs} par le visage (dont ${ancres0} certain(s)), ${parExpansion} par ressemblance de visage, ${parSilhouette} par la silhouette${sansVisage ? `, ${sansVisage} photo(s) sans visage` : ""}${illisibles ? `, ${illisibles} introuvable(s)` : ""}`);
    if (silhouettes.length) console.log(`   ${silhouettes.length} personne(s) decrite(s), dont ${silhouettes.filter((x) => x.joueur).length} reconnue(s) par leur visage`);

    // ── LES DOSSARDS CROISES AVEC LES NUMEROS DECLARES ──────────────────────────────────────────
    //
    // La base fait la jointure, pas le moteur : c'est elle qui sait qui a declare quel numero, qui
    // refuse quand deux sportifs revendiquent le meme, et qui ne produit que des SUGGESTIONS. Une
    // lecture fausse coute donc une proposition ecartee d'un geste, jamais une photo attribuee au
    // mauvais enfant.
    if (numerosVus) {
      if (SIMULER) {
        console.log(`   ${numerosVus} numero(s) de dossard relevé(s) (simulation, rien écrit)`);
      } else {
        const { d: suggerees } = await rpc("media_suggerer_par_numero", { p_album_id: album });
        console.log(`   ${numerosVus} numero(s) de dossard relevé(s), ${suggerees ?? 0} photo(s) proposée(s) par le numéro`);
      }
    }
    for (const [motif, n] of [...motifs].sort((a, b) => b[1] - a[1]))
      console.log(`   ${n} photo(s) en echec : ${motif}`);
    totalPhotos += photos.length;
    totalMarques += marques;
    albumsFaits++;
    if (!SIMULER) for (const l of lignes) await rpc("reconnaissance_fait", { p_id: l.id, p_resultat: `${marques} identification(s)` });
  }


  // Les totaux sont locaux a cette fonction : en boucle, chaque passe repart de zero. On les rend
  // donc, plutot que de les lire de l'exterieur — ou ils n'existent pas.
  return { albums: albumsFaits, photos: totalPhotos, marques: totalMarques };
}

if (EN_BOUCLE) {
  // ON RESTE IMMOBILE TANT QU'IL N'Y A RIEN. Pas de calcul, pas de modèle rechargé : le navigateur
  // et les modèles sont déjà là, une passe ne coûte donc qu'une requête toutes les vingt secondes.
  dire(`En attente de travail (vérification toutes les ${ATTENTE / 1000} s). Ctrl+C pour arrêter.`);
  let silencieux = 0;
  for (;;) {
    let faits = 0;
    try { faits = (await vider()).albums; }
    catch (e) { dire(`   passe interrompue : ${String(e && e.message || e).slice(0, 160)}`); }
    if (faits) { silencieux = 0; dire(`   en attente…`); }
    // On ne répète pas « rien à faire » toutes les vingt secondes : le journal deviendrait
    // illisible, et un vrai message s'y perdrait.
    else if (++silencieux % 90 === 0) dire(`   toujours rien (${Math.round(silencieux * ATTENTE / 60000)} min).`);
    await new Promise((r) => setTimeout(r, ATTENTE));
  }
} else {
  const bilan = await vider();
  await navigateur.close();
  serveur.close();
  console.log(`\n${bilan.albums} galerie(s), ${bilan.photos} photo(s), ${bilan.marques} identification(s).`);
}

