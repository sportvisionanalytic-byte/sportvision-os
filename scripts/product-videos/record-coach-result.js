// Vidéo "Coach" — parcours réel (app.html, mode démonstration, aucune
// donnée réelle, aucun appel réseau) : un coach U18 R2 transmet le
// résultat 3-1 contre US Fontainebleau depuis son mobile.
//
// Écart assumé par rapport au script d'origine : la mission demandait une
// étape "ajouter une photo" dans le formulaire Résultat express. Cette
// interface RÉELLE de Club+ (§5 de la mission : "montrer la véritable
// interface") ne propose actuellement aucun champ d'ajout de photo à cet
// endroit précis (le formulaire ne contient que équipe / domicile-extérieur
// / adversaire / score) — l'étape est donc omise plutôt que simulée avec un
// élément qui n'existe pas dans le produit. Signalé aussi dans
// CLUBPLUS_VIDEO_PRODUCTION.md comme séquence nécessitant une décision
// produit (ajouter réellement ce champ, ou retirer l'étape du script).
//
// Sortie : public/videos/clubplus/raw/coach-result-mobile.webm
const fs = require('fs');
const path = require('path');
const { launchDemoPage, finishRecording, naturalClick, naturalFill, pause } = require('./lib/record-utils');

const RAW_DIR = path.resolve(__dirname, '../../public/videos/clubplus/raw');
const OUTPUT_NAME = 'coach-result-mobile-raw.webm';

(async () => {
  const { browser, context, page } = await launchDemoPage({ device: 'mobile', videoDir: RAW_DIR });
  const video = page.video();

  try {
    // 1. Connexion démonstration — rôle Coach U18 (persona: Thomas Bernard).
    await naturalClick(page, "button.role-pick:has-text('Coach U18')", { pauseAfter: 700 });

    // 2. Accueil Coach — dashboard générique (mode démo) avec les actions rapides mobiles.
    await pause(page, 900);

    // 3. Ouvre le menu "Plus" puis Match Center (parcours mobile réel, pas d'appel direct à switchView).
    await naturalClick(page, "button.mbn-i:has-text('Plus')", { pauseAfter: 400 });
    await naturalClick(page, "#mobSheet button.tile-card:has-text('Match Center')", { pauseAfter: 500 });

    // 4. Onglet "À venir" (par défaut) — le prochain match U18 R2 vs US Fontainebleau est visible.
    await pause(page, 900);

    // 5. Ouvre le formulaire Résultat express.
    await naturalClick(page, "button:has-text('Résultat express')", { pauseAfter: 500 });

    // 6. Renseigne le résultat (champs déjà connus, pas de frappe caractère par caractère).
    await page.locator('#me-team').selectOption('U18 R2');
    await pause(page, 200);
    await page.locator('#me-de').selectOption('Domicile');
    await pause(page, 200);
    await naturalFill(page, '#me-opp', 'US Fontainebleau');
    await naturalFill(page, '#me-score', '3-1', { pauseAfter: 500 });

    // 7. Envoi + confirmation (toast "Résultat envoyé.").
    await naturalClick(page, "button:has-text('Envoyer')", { pauseAfter: 900 });

    // 8. Onglet "Reçus" : la carte du match affiche désormais le score 3-1 (confirmation visuelle finale).
    await naturalClick(page, "button.pill:has-text('Reçus')", { pauseAfter: 1300 });

  } finally {
    await finishRecording(context, browser);
    const rawPath = await video.path();
    const finalPath = path.join(RAW_DIR, OUTPUT_NAME);
    fs.renameSync(rawPath, finalPath);
    console.log('Enregistrement terminé ->', finalPath);
  }
})();
