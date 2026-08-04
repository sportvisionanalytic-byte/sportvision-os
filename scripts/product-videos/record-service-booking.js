// Vidéo "Prestation SportVision" — catalogue -> réservation -> statut.
// Écart assumé : "Pack Match Photo + Vidéo" (mission §9) n'existe pas tel
// quel dans le catalogue démo actuel — remplacé par "Vidéo highlights",
// l'entrée la plus proche. "Livrables disponibles" n'a pas d'écran dédié
// par réservation aujourd'hui : représenté par le pipeline de suivi réel
// affiché dans le drawer de la réservation (dernier statut visible).
//
// Sortie : public/videos/clubplus/raw/service-booking-raw.webm
const fs = require('fs');
const path = require('path');
const { launchDemoPage, finishRecording, naturalClick, naturalFill, pause } = require('./lib/record-utils');

const RAW_DIR = path.resolve(__dirname, '../../public/videos/clubplus/raw');
const OUTPUT_NAME = 'service-booking-raw.webm';

(async () => {
  const { browser, context, page } = await launchDemoPage({ device: 'desktop', videoDir: RAW_DIR });
  const video = page.video();

  try {
    await naturalClick(page, "button.role-pick:has-text('Président')", { pauseAfter: 1600 });

    // 1. Catalogue -> réservation "Vidéo highlights".
    await naturalClick(page, 'button.ni[data-id="services"]', { pauseAfter: 1200 });
    await page.locator('.card:has-text(\'Vidéo highlights\') button:has-text(\'Réserver\')').first().hover();
    await pause(page, 400);
    await page.locator('.card:has-text(\'Vidéo highlights\') button:has-text(\'Réserver\')').first().click();
    await pause(page, 800);

    // 2. Équipe + date (réduction Club+ déjà affichée sur la carte du catalogue).
    await page.locator('#bw-team').selectOption('U18 R2');
    await pause(page, 300);
    await naturalFill(page, '#bw-date', '2026-08-02', { pauseAfter: 300 });
    await naturalFill(page, '#bw-heure', '15:00', { pauseAfter: 300 });
    await naturalFill(page, '#bw-adresse', 'Stade Municipal, Sens', { pauseAfter: 600 });
    await naturalClick(page, "button:has-text('Continuer')", { pauseAfter: 1400 }); // récap + réduction Club+ visible

    // 3. Demande envoyée.
    await naturalClick(page, "button:has-text('Envoyer la demande')", { pauseAfter: 1400 });

    // 4. Statut de la prestation (pipeline terrain).
    await naturalClick(page, "button.pill:has-text('Mes réservations')", { pauseAfter: 900 });
    await naturalClick(page, ".list-row:has-text('Vidéo highlights')", { pauseAfter: 2400 });

  } finally {
    await finishRecording(context, browser);
    const rawPath = await video.path();
    const finalPath = path.join(RAW_DIR, OUTPUT_NAME);
    fs.renameSync(rawPath, finalPath);
    console.log('Enregistrement terminé ->', finalPath);
  }
})();
