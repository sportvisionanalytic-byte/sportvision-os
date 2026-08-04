// Vidéo "Sponsors" — fiche Nova Énergie -> contreparties -> preuve -> rapport.
// Écarts assumés : "ajout d'une preuve" et "contenu associé" n'existent pas
// comme gestes distincts dans le produit réel — représentés par l'action
// réelle la plus proche, "Marquer réalisé" sur une contrepartie. "Génération
// du rapport" est aujourd'hui un message d'attente ("disponible au
// lancement"), montré tel quel plutôt que simulé.
//
// Sortie : public/videos/clubplus/raw/sponsors-raw.webm
const fs = require('fs');
const path = require('path');
const { launchDemoPage, finishRecording, naturalClick, pause } = require('./lib/record-utils');

const RAW_DIR = path.resolve(__dirname, '../../public/videos/clubplus/raw');
const OUTPUT_NAME = 'sponsors-raw.webm';

(async () => {
  const { browser, context, page } = await launchDemoPage({ device: 'desktop', videoDir: RAW_DIR });
  const video = page.video();

  try {
    await naturalClick(page, "button.role-pick:has-text('Responsable sponsors')", { pauseAfter: 1600 });

    // 1. Sponsors -> Partenaires -> fiche Nova Énergie.
    await naturalClick(page, 'button.ni[data-id="sponsors"]', { pauseAfter: 1000 });
    await naturalClick(page, "button.pill:has-text('Partenaires')", { pauseAfter: 1000 });
    await naturalClick(page, ".tile-card:has-text('Nova Énergie')", { pauseAfter: 1800 });

    // 2. Contreparties visibles, échéance (déjà affichées dans le drawer) — marque une contrepartie réalisée.
    await naturalClick(page, "button:has-text('Marquer réalisé')", { pauseAfter: 1600 });

    // 3. Génération du rapport.
    await naturalClick(page, "button:has-text('Générer le rapport')", { pauseAfter: 2600 });

  } finally {
    await finishRecording(context, browser);
    const rawPath = await video.path();
    const finalPath = path.join(RAW_DIR, OUTPUT_NAME);
    fs.renameSync(rawPath, finalPath);
    console.log('Enregistrement terminé ->', finalPath);
  }
})();
