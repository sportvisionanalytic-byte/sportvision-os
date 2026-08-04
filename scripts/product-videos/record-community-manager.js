// Vidéo "Community Manager" — Newsroom -> Studio de création -> programmation.
// Écart assumé : "choisir un modèle" (mission §6) n'est pas un geste séparé
// dans le produit réel — le Studio de création choisit un TYPE de contenu à
// l'étape 1 de l'assistant (le type détermine implicitement le modèle
// utilisé). Représenté ici par cette étape réelle plutôt qu'inventé.
//
// Sortie : public/videos/clubplus/raw/community-manager-raw.webm
const fs = require('fs');
const path = require('path');
const { launchDemoPage, finishRecording, naturalClick, naturalFill, pause } = require('./lib/record-utils');

const RAW_DIR = path.resolve(__dirname, '../../public/videos/clubplus/raw');
const OUTPUT_NAME = 'community-manager-raw.webm';

(async () => {
  const { browser, context, page } = await launchDemoPage({ device: 'desktop', videoDir: RAW_DIR });
  const video = page.video();

  try {
    await naturalClick(page, "button.role-pick:has-text('Community Manager')", { pauseAfter: 900 });

    // Amorce une "nouvelle information reçue" (évite de rejouer tout le parcours coach).
    await page.evaluate(() => {
      DATA.newsroomItems.unshift({
        id: 'demo-cm-result', type: 'Résultat', team: 'U18 R2', author: 'Thomas Bernard',
        date: '2026-07-28', priority: 'haute', media: 0, sponsor: '', status: 'recu',
        title: 'Résultat U18 R2 vs US Fontainebleau', desc: 'Score : 3-1',
      });
    });

    // 1. Newsroom — nouvelle information reçue, sélection.
    await naturalClick(page, 'button.ni[data-id="newsroom"]', { pauseAfter: 600 });
    await naturalClick(page, ".list-row:has-text('US Fontainebleau'), .tile-card:has-text('US Fontainebleau')", { pauseAfter: 500 });

    // 2. Transformer en publication.
    await naturalClick(page, "button:has-text('Transformer en publication')", { pauseAfter: 600 });

    // 3. Studio de création — nouveau visuel (le type choisi = le modèle utilisé).
    await naturalClick(page, 'button.ni[data-id="creations"]', { pauseAfter: 400 });
    await naturalClick(page, "button:has-text('Nouveau visuel')", { pauseAfter: 500 });
    await naturalClick(page, "button.opt-btn:has-text('Affiche résultat'), .opt-btn:has-text('résultat')", { pauseAfter: 500 });
    await page.locator('#cw-team').selectOption('U18 R2');
    await naturalFill(page, '#cw-title', 'Résultat U18 R2 vs US Fontainebleau', { pauseAfter: 300 });
    await naturalClick(page, "button:has-text('Continuer')", { pauseAfter: 500 });

    // 4. Associe Nova Énergie.
    await page.locator('#cw-sponsor').selectOption({ label: 'Nova Énergie' });
    await pause(page, 400);
    await naturalClick(page, "button:has-text('Voir la finalisation')", { pauseAfter: 600 });

    // 5. Valide directement puis programme la publication.
    await naturalClick(page, "button:has-text('Valider directement')", { pauseAfter: 700 });
    await naturalClick(page, "button.pill:has-text('Validés')", { pauseAfter: 500 });
    await naturalClick(page, ".tile-card:has-text('Résultat U18 R2')", { pauseAfter: 500 });
    await naturalClick(page, "button:has-text('Programmer la publication')", { pauseAfter: 1200 });

  } finally {
    await finishRecording(context, browser);
    const rawPath = await video.path();
    const finalPath = path.join(RAW_DIR, OUTPUT_NAME);
    fs.renameSync(rawPath, finalPath);
    console.log('Enregistrement terminé ->', finalPath);
  }
})();
