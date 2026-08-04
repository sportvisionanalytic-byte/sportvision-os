// Vidéo "Hero" — parcours réel (app.html, mode démonstration, aucune
// donnée réelle, aucun appel réseau), viewport desktop 1920×1080.
// Storyboard (mission §4), avec deux écarts assumés, documentés ici et
// dans CLUBPLUS_VIDEO_PRODUCTION.md :
//
//  - "Coach U18 sur mobile" (beat 2) est filmé sur le MÊME viewport desktop
//    que le reste de la séquence (changer de viewport en cours
//    d'enregistrement produirait une coupure visible). Le vrai geste mobile
//    existe déjà, filmé séparément : public/videos/clubplus/raw/
//    coach-result-mobile-raw.webm — à composer en incrustation lors du
//    montage final si un rendu mobile-dans-le-hero est souhaité.
//  - "Galerie disponible dans l'Espace Joueur" (beat 8) : l'Espace Joueur
//    n'existe QUE derrière une vraie session Supabase authentifiée (aucun
//    mode démonstration ne le couvre, cf. app.html phase 6/7 — cette route
//    n'accepte jamais REAL=null). Créer un compte réel pour l'enregistrement
//    écrirait dans la base de production, ce que la mission interdit
//    explicitement. Remplacé par la Banque média (dirigeants), l'écran
//    démontrable le plus proche montrant une "galerie disponible" réelle.
//
// Sortie : public/videos/clubplus/raw/hero-desktop-raw.webm
const fs = require('fs');
const path = require('path');
const { launchDemoPage, finishRecording, naturalClick, naturalFill, pause } = require('./lib/record-utils');

const RAW_DIR = path.resolve(__dirname, '../../public/videos/clubplus/raw');
const OUTPUT_NAME = 'hero-desktop-raw.webm';

async function switchRole(page, value, pauseAfter = 700) {
  await page.locator('#roleSel').selectOption(value);
  await pause(page, pauseAfter);
}
async function openNav(page, viewId, pauseAfter = 700) {
  await naturalClick(page, `button.ni[data-id="${viewId}"]`, { pauseAfter });
}

(async () => {
  const { browser, context, page } = await launchDemoPage({ device: 'desktop', videoDir: RAW_DIR });
  const video = page.video();

  try {
    // 1. Tableau de bord — connexion démonstration en Président (Marc Lefèvre).
    await naturalClick(page, "button.role-pick:has-text('Président')", { pauseAfter: 1000 });

    // 2. Coach U18 R2 — passe le résultat du match (rôle changé via le sélecteur démo).
    await switchRole(page, 'coach');
    await openNav(page, 'matchcenter');
    await pause(page, 700); // onglet "À venir" : prochain match U18 R2 vs US Fontainebleau visible

    // 3. Ajout du résultat 3-1.
    await naturalClick(page, "button:has-text('Résultat express')", { pauseAfter: 500 });
    await page.locator('#me-team').selectOption('U18 R2');
    await page.locator('#me-de').selectOption('Domicile');
    await naturalFill(page, '#me-opp', 'US Fontainebleau');
    await naturalFill(page, '#me-score', '3-1', { pauseAfter: 400 });
    await naturalClick(page, "button:has-text('Envoyer')", { pauseAfter: 800 });

    // Envoie le résultat vers la Newsroom (geste séparé et réel du produit).
    await naturalClick(page, "button.pill:has-text('Reçus')", { pauseAfter: 500 });
    await naturalClick(page, ".tile-card:has-text('US Fontainebleau')", { pauseAfter: 500 });
    await naturalClick(page, "button:has-text('Envoyer à la Newsroom')", { pauseAfter: 700 });

    // 4-5. Résultat reçu dans la Newsroom — Community Manager (Lina Robert) l'ouvre.
    await switchRole(page, 'comm');
    await openNav(page, 'newsroom');
    await pause(page, 500);
    await naturalClick(page, ".list-row:has-text('US Fontainebleau'), .tile-card:has-text('US Fontainebleau')", { pauseAfter: 500 });

    // 6. Création du visuel résultat (le drawer se referme tout seul après l'action).
    await naturalClick(page, "button:has-text('Transformer en publication')", { pauseAfter: 600 });
    await openNav(page, 'creations');
    await naturalClick(page, "button.pill:has-text('À valider')", { pauseAfter: 900 }); // le visuel apparaît dans la liste

    // 7. Le président valide le contenu.
    await switchRole(page, 'president');
    await openNav(page, 'creations');
    await naturalClick(page, "button.pill:has-text('À valider')", { pauseAfter: 500 });
    await naturalClick(page, ".tile-card:has-text('Résultat')", { pauseAfter: 500 });
    // ":text-is" (correspondance exacte) : "À valider" contient "valider" en
    // sous-chaîne et serait sinon capté par erreur par ":has-text('Valider')".
    await naturalClick(page, "button:text-is('Valider')", { pauseAfter: 800 });

    // 8. Galerie disponible — Banque média (cf. écart documenté en tête de fichier).
    // Le rôle Président n'a pas accès à ce module (allowedKeys) : on repasse
    // en Community Manager, cohérent avec le reste du parcours.
    await switchRole(page, 'comm');
    await openNav(page, 'mediatheque', 1400);

  } finally {
    await finishRecording(context, browser);
    const rawPath = await video.path();
    const finalPath = path.join(RAW_DIR, OUTPUT_NAME);
    fs.renameSync(rawPath, finalPath);
    console.log('Enregistrement terminé ->', finalPath);
  }
})();
