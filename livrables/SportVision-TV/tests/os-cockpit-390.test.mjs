// Le cockpit Production sur un téléphone de 390 px.
//
// Fouka travaille surtout sur desktop, mais le cockpit sert aussi les urgences : « sur le
// terrain », « à vérifier », un incident. Ces moments-là arrivent rarement devant un écran.
//
// Ce test rend le VRAI cockpit, avec ses vraies fonctions et son vrai CSS, dans une fenêtre de
// 390 px. Seule la couche de données est remplacée par des fixtures : le but est de mesurer la
// mise en page dans le pire cas raisonnable (noms longs, échéances longues, tous les drapeaux
// allumés), pas de tester PostgREST.
//
// Ce qu'il vérifie, et qui ne se voit qu'à l'œil autrement : aucun débordement horizontal, et
// aucune cible tactile sous 40 px.

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../SportVision-OS-Full.html", import.meta.url).pathname, "utf8");
const srv = createServer((req, res) => {
  if (req.url !== "/") return res.writeHead(404).end();
  res.writeHead(200, { "content-type": "text/html" }).end(html);
});
await new Promise((r) => srv.listen(0, r));
const url = `http://localhost:${srv.address().port}/`;

const nav = await chromium.launch();
const page = await nav.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
const erreursJs = [];
page.on("pageerror", (e) => {
  const msg = String(e).split("\n")[0];
  if (/ServiceWorker/i.test(msg)) return;
  erreursJs.push(msg);
});
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof renderCockpitProduction === "function");

let ok = 0, ko = 0;
const t = (nom, cond, detail = "") => {
  if (cond) { ok++; console.log(`  ok   ${nom}`); }
  else { ko++; console.log(`  KO   ${nom}${detail ? " — " + detail : ""}`); }
};

// Le pire cas raisonnable, pas le cas confortable.
const demain = new Date(Date.now() + 864e5).toISOString();
const hier = new Date(Date.now() - 864e5).toISOString();
const FIXTURES = [
  { prestation_id: "1", reference: "SV-2026-000418", statut: "planifiée", couverture: "photo_video",
    date_prestation: new Date().toISOString().slice(0, 10), heure_debut: "15:00:00", heure_rdv: "14:15:00",
    lieu: "Parc des Sports Georges Pompidou — terrain d’honneur, entrée rue de Neuilly",
    client_nom: "Sporting Football Villemomble Association — Seniors R2", groupe: "attente_acceptation",
    invitation_depuis: hier, operateurs: null, deadline_photo_at: null, deadline_video_at: null,
    nb_photos: 0, nb_montages: 0, nb_rushs: 0, transfert_confirme: false, kit_nom: null,
    kit_retour_prevu: null, incident_ouvert: false, livraison_en_retard: false,
    echeance_manquante: true, cloture_manquant: [], mission_prete: false },
  { prestation_id: "2", reference: "SV-2026-000419", statut: "équipe_en_route", couverture: "photo",
    date_prestation: new Date().toISOString().slice(0, 10), heure_debut: "18:30:00", heure_rdv: "17:45:00",
    lieu: "Stade Alain Mimoun", client_nom: "SF Villemomble", groupe: "terrain",
    invitation_depuis: null, operateurs: "Mikael Athanase Ruffine, Lynkone Montantin",
    arrive_at: hier, deadline_photo_at: demain, deadline_video_at: null,
    nb_photos: 0, nb_montages: 0, nb_rushs: 0, transfert_confirme: false, kit_nom: "Kit Photo 02",
    kit_retour_prevu: demain, incident_ouvert: true, livraison_en_retard: false,
    echeance_manquante: false, cloture_manquant: ["Prestation non déclarée réalisée"], mission_prete: true },
  { prestation_id: "3", reference: "SV-2026-000420", statut: "montage_en_cours", couverture: "photo_video",
    date_prestation: "2026-09-06", heure_debut: "10:00:00", heure_rdv: null, lieu: "Gymnase Jean Jaurès",
    client_nom: "AS Fontainebleau", groupe: "post_production", operateurs: "Peter Cognon",
    deadline_photo_at: hier, deadline_video_at: demain, nb_photos: 1, nb_montages: 0, nb_rushs: 0,
    transfert_confirme: true, kit_nom: "Kit Vidéo 01", kit_retour_prevu: hier, incident_ouvert: false,
    livraison_en_retard: true, echeance_manquante: false,
    cloture_manquant: ["Montage final non livré", "Rushs vidéo non transmis", "Kit non restitué"], mission_prete: true },
  { prestation_id: "4", reference: "SV-2026-000421", statut: "prêt_validation", couverture: "video",
    date_prestation: "2026-09-05", heure_debut: "14:00:00", heure_rdv: null, lieu: "Stade Claude Ripert",
    client_nom: "US Montereau", groupe: "a_verifier", operateurs: "Antoine Blin",
    livre_at: hier, deadline_photo_at: null, deadline_video_at: demain, nb_photos: 0, nb_montages: 1,
    nb_rushs: 1, transfert_confirme: true, kit_nom: "Kit Vidéo 02", kit_retour_prevu: null,
    incident_ouvert: false, livraison_en_retard: false, echeance_manquante: false,
    cloture_manquant: ["Montage non validé par la Production"], mission_prete: true },
  { prestation_id: "5", reference: "SV-2026-000422", statut: "prêt_validation", couverture: "photo_video",
    date_prestation: "2026-09-04", heure_debut: "16:00:00", heure_rdv: null, lieu: "Complexe sportif",
    client_nom: "Entente Sportive du Val de Seine et de la Brie Réunies", groupe: "corrections",
    operateurs: "Peter Cognon", deadline_photo_at: hier, deadline_video_at: hier, nb_photos: 1,
    nb_montages: 1, nb_rushs: 0, transfert_confirme: true, kit_nom: null, kit_retour_prevu: null,
    incident_ouvert: false, livraison_en_retard: true, echeance_manquante: false,
    cloture_manquant: ["Rushs vidéo non transmis"], mission_prete: true },
  { prestation_id: "6", reference: "SV-2026-000423", statut: "clôturée", couverture: "photo",
    date_prestation: "2026-08-30", heure_debut: "11:00:00", heure_rdv: null, lieu: "Stade municipal",
    client_nom: "FC Melun", groupe: "terminees", operateurs: "Antoine Blin",
    deadline_photo_at: hier, deadline_video_at: null, nb_photos: 1, nb_montages: 0, nb_rushs: 0,
    transfert_confirme: true, kit_nom: null, kit_retour_prevu: null, incident_ouvert: false,
    livraison_en_retard: false, echeance_manquante: false, cloture_manquant: [], mission_prete: true },
  { prestation_id: "7", reference: "SV-2026-000424", statut: "prête", couverture: "video",
    date_prestation: "2026-09-14", heure_debut: "09:00:00", heure_rdv: "08:15:00", lieu: "Stade nautique",
    client_nom: "Club Nautique de Sens", groupe: "a_venir", operateurs: "Lynkone Montantin",
    deadline_photo_at: null, deadline_video_at: null, nb_photos: 0, nb_montages: 0, nb_rushs: 0,
    transfert_confirme: false, kit_nom: null, kit_retour_prevu: null, incident_ouvert: false,
    livraison_en_retard: false, echeance_manquante: true, cloture_manquant: [], mission_prete: false },
];

// On remplace la couche de donnees, pas le rendu : `sbFetch` est une declaration de fonction de
// premier niveau, donc reellement remplacable sur l'objet global d'un script classique.
await page.evaluate((rows) => {
  window.sbFetch = async () => rows;
  // On AJOUTE le cockpit sans vider le corps du document : openModal() a besoin du conteneur
  // de modale deja present dans la page. L'ecraser faisait echouer l'etape 5 sur un null.
  // On masque le reste de la page (ecran de connexion, en-tetes) pour que la mesure de
  // debordement ne porte que sur le cockpit. #sv-modal est explicitement epargne : c'est lui
  // qui accueille la fenetre de verification a l'etape 5, et le masquer donnait des hauteurs
  // de 0 px sur tous ses boutons — un artefact du banc d'essai, pas un defaut du produit.
  document.querySelectorAll("body > *:not(script)").forEach((n) => {
    if (n.id === "sv-modal") return;
    n.style.display = "none";
  });
  const hote = document.createElement("div");
  hote.style.padding = "16px";
  hote.innerHTML =
    `<div id="cockpit-tabs" style="display:flex;gap:8px;margin-bottom:13px;overflow-x:auto;scrollbar-width:none"></div>
     <div id="cockpit-real"></div>`;
  document.body.appendChild(hote);
}, FIXTURES);
await page.evaluate(() => loadCockpitProduction());
await page.waitForFunction(() => document.querySelectorAll("#cockpit-tabs button").length > 0);

// ── 1. Les sept files, et leurs compteurs ───────────────────────────────────
console.log("\n1. Les sept files et leurs compteurs");
const onglets = await page.$$eval("#cockpit-tabs button", (b) => b.map((x) => x.textContent.trim()));
t("sept onglets rendus", onglets.length === 7, `${onglets.length} : ${onglets.join(" / ")}`);
t("« En post-production » est bien une file distincte", onglets.some((o) => /post-production/i.test(o)), onglets.join(" / "));
t("les compteurs affichent 1 par file active", onglets.filter((o) => /1$/.test(o)).length >= 5, onglets.join(" / "));
t("« Terminées » ne porte pas de compteur", !/\d/.test(onglets[6]), onglets[6]);

// ── 2. Chaque file rend sans deborder ───────────────────────────────────────
console.log("\n2. Chaque file, à 390 px");
const groupes = ["attente_acceptation", "a_venir", "terrain", "post_production", "a_verifier", "corrections", "terminees"];
for (const g of groupes) {
  await page.evaluate((x) => setCockpitGroupe(x), g);
  const debord = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  t(`${g} : aucun débordement horizontal`, debord <= 0, `${debord} px de trop`);
  const vide = await page.$eval("#cockpit-real", (e) => e.textContent.includes("Rien dans cette file"));
  t(`${g} : la file affiche sa mission`, !vide);
}

// ── 3. Le contenu attendu est bien la ───────────────────────────────────────
console.log("\n3. Ce que Production doit lire");
await page.evaluate(() => setCockpitGroupe("post_production"));
let txt = await page.$eval("#cockpit-real", (e) => e.textContent);
t("la liste « Reste : … » est affichée", /Reste :/.test(txt) && /Rushs vidéo non transmis/.test(txt));
t("le retard est signalé", /Livraison en retard/.test(txt));
t("le retour de kit échu est visible", /retour kit/.test(txt));

await page.evaluate(() => setCockpitGroupe("a_venir"));
txt = await page.$eval("#cockpit-real", (e) => e.textContent);
t("l’échéance manquante est signalée", /Aucune échéance de livraison renseignée/.test(txt));
t("l’échéance manquante n’est jamais annoncée comme un retard", !/Livraison en retard/.test(txt));

await page.evaluate(() => setCockpitGroupe("attente_acceptation"));
txt = await page.$eval("#cockpit-real", (e) => e.textContent);
t("l’attente d’acceptation est datée", /En attente de réponse depuis/.test(txt), txt.slice(0, 120));

// ── 4. Cibles tactiles ──────────────────────────────────────────────────────
console.log("\n4. Cibles tactiles");
for (const g of ["a_verifier", "corrections"]) {
  await page.evaluate((x) => setCockpitGroupe(x), g);
  const petits = await page.$$eval("#cockpit-real button, #cockpit-tabs button", (els) =>
    els.map((e) => ({ t: e.textContent.trim().slice(0, 24), h: e.offsetHeight }))
       .filter((x) => x.h < 40));
  t(`${g} : aucun bouton sous 40 px`, petits.length === 0, JSON.stringify(petits));
  const verifier = await page.$eval("#cockpit-real", (e) => /Vérifier/.test(e.textContent));
  t(`${g} : le bouton « Vérifier » est proposé`, verifier);
}

// ── 5. Le detail d'une livraison, sur le meme ecran etroit ──────────────────
console.log("\n5. Vérifier une livraison à 390 px");
await page.evaluate(() => {
  window.sbFetch = async (path) => {
    if (path.startsWith("v_production_missions")) return [window.__M];
    return [
      { id: "l1", nom: "Photos traitées", url: "https://drive.google.com/drive/folders/abc", categorie: "final", type_media: "photo", statut: "valide", nombre_fichiers: 412, transfert_confirme: true, commentaire: null },
      { id: "l2", nom: "Montage final", url: "https://wetransfer.com/downloads/xyz", categorie: "final", type_media: "video", statut: "correction_demandee", nombre_fichiers: 1, transfert_confirme: true, commentaire: "Il manque les rushs vidéo, et l’export est en 1080p au lieu de 4K comme demandé au brief." },
      { id: "l3", nom: "Rushs vidéo", url: "https://www.swisstransfer.com/d/abc-def", categorie: "rushs", type_media: "video", statut: "a_verifier", nombre_fichiers: 87, transfert_confirme: false, commentaire: null },
    ];
  };
});
await page.evaluate((m) => { window.__M = m; }, FIXTURES[4]);
await page.evaluate(() => modalVerifierLivraison("5"));
await page.waitForFunction(() => document.getElementById("verif-corps") && !/Chargement/.test(document.getElementById("verif-corps").textContent));
// La fenetre s'ouvre avec une mise a l'echelle : mesurer trop tot renvoyait 38 px pour des
// boutons de 40 (40 x 0,95). On attend donc l'etat stable, et on mesure offsetHeight, qui est
// la hauteur de mise en page et ignore les transformations.
await page.waitForFunction(() => document.getElementById("sv-modal")?.classList.contains("on"));
await page.waitForFunction(() => {
  const m = document.getElementById("sv-modal");
  return getComputedStyle(m).transform === "none" || getComputedStyle(m).transform === "matrix(1, 0, 0, 1, 0, 0)";
}, null, { timeout: 3000 }).catch(() => {});
const vt = await page.$eval("#verif-corps", (e) => e.textContent);
t("les trois liens sont listés", /Photos traitées/.test(vt) && /Montage final/.test(vt) && /Rushs vidéo/.test(vt));
t("le fournisseur est reconnu", /Google Drive/.test(vt) && /WeTransfer/.test(vt) && /SwissTransfer/.test(vt), vt.slice(0, 200));
t("le motif de correction est lisible", /Il manque les rushs vidéo/.test(vt));
t("ce qui bloque la clôture est dit", /Mission pas encore clôturable/.test(vt) && /Rushs vidéo non transmis/.test(vt));
const debordModal = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
t("aucun débordement horizontal dans la fenêtre de vérification", debordModal <= 0, `${debordModal} px`);
const petitsModal = await page.$$eval("#verif-corps a, #verif-corps button", (els) =>
  els.map((e) => ({ t: e.textContent.trim().slice(0, 20), h: e.offsetHeight })).filter((x) => x.h < 40));
t("aucune cible sous 40 px dans la vérification", petitsModal.length === 0, JSON.stringify(petitsModal));

t("aucune erreur JavaScript pendant tout le test", erreursJs.length === 0, erreursJs.join(" / "));

console.log(`\n${ok}/${ok + ko} verifications passees.`);
await nav.close();
srv.close();
process.exit(ko ? 1 : 0);
