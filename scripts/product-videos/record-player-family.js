// Vidéo "Joueur et Parent" — Partie 1 (Lucas, U15) : Accueil -> Livrables ->
// ajout d'un highlight en favori -> Mes favoris. Partie 2 (Sophie, parent) :
// Ma famille -> espace de Lucas (calendrier) -> bascule vers Emma (U13) ->
// Autorisations d'Emma (une autorisation "En attente" avec action
// "Transmettre" encore visible, pour montrer un cas concret).
//
// Écarts assumés par rapport au storyboard d'origine : (1) "notification de
// nouvelle galerie" n'est pas un geste séparé dans le produit réel — le mode
// démo Joueur (cf. FAMILY_DEMO dans app.html) place directement une galerie
// déjà publiée dans Livrables ; représenté par la consultation réelle de
// Livrables plutôt qu'un événement de notification simulé. (2) "lecture du
// highlight" : les livrables de démonstration n'ont pas de lien de lecture
// (aucun média réel à streamer sans données de production) — le clic sur la
// tuile affiche un message d'attente produit réel ; représenté à la place
// par le geste réel le plus proche, l'ajout du highlight aux favoris puis
// sa consultation dans "Mes favoris".
//
// Usage : node record-player-family.js [desktop|mobile]  (défaut : desktop)
// Sortie : public/videos/clubplus/raw/player-family-<device>-raw.webm
const fs = require('fs');
const path = require('path');
const { launchDemoPage, finishRecording, naturalClick, pause } = require('./lib/record-utils');

const DEVICE = (process.argv[2] === 'mobile') ? 'mobile' : 'desktop';
const RAW_DIR = path.resolve(__dirname, '../../public/videos/clubplus/raw');
const OUTPUT_NAME = `player-family-${DEVICE}-raw.webm`;

(async () => {
  const { browser, context, page } = await launchDemoPage({ device: DEVICE, videoDir: RAW_DIR });
  const video = page.video();
  const isMobile = DEVICE === 'mobile';

  try {
    // ── Partie 1 : Joueur (Lucas Martin, U15) ──────────────────────────
    await naturalClick(page, "button.role-pick:has-text('Joueur')", { pauseAfter: 900 });

    // Accueil — club, prochain match, prochain événement.
    await pause(page, 900);

    // Livrables — galerie déjà publiée par le club.
    if (isMobile) {
      await naturalClick(page, "button.mbn-i:has-text('Livrables')", { pauseAfter: 1000 });
    } else {
      await naturalClick(page, 'button.ni[data-id="famlivrables"]', { pauseAfter: 1000 });
    }

    // Ajoute "Vidéo highlights U15" aux favoris (étoile sur la tuile).
    await naturalClick(page, ".tile-card:has-text('Vidéo highlights U15') button[onclick*='famToggleFavorite']", { pauseAfter: 800 });

    // Mes favoris — confirme la présence du highlight.
    if (isMobile) {
      await naturalClick(page, "button.mbn-i:has-text('Plus')", { pauseAfter: 400 });
      await naturalClick(page, "#mobSheet button.tile-card:has-text('Mes favoris')", { pauseAfter: 1000 });
    } else {
      await naturalClick(page, 'button.ni[data-id="famfavoris"]', { pauseAfter: 1000 });
    }

    // ── Transition : déconnexion puis connexion Parent ─────────────────
    if (isMobile) {
      await naturalClick(page, "button.mbn-i:has-text('Plus')", { pauseAfter: 400 });
      await naturalClick(page, "#mobSheet button.bd:has-text('Déconnexion')", { pauseAfter: 700 });
    } else {
      await naturalClick(page, 'button.sb-logout', { pauseAfter: 700 });
    }

    // ── Partie 2 : Parent (Sophie Martin) ───────────────────────────────
    await naturalClick(page, "button.role-pick:has-text('Parent')", { pauseAfter: 900 });

    // Ma famille — cartes Lucas et Emma.
    await pause(page, 900);

    // Ouvre l'espace de Lucas (bascule l'enfant actif + calendrier).
    await naturalClick(page, ".card:has-text('Lucas Martin') button:has-text(\"Voir l'espace\")", { pauseAfter: 1200 });

    // Bascule vers Emma via le sélecteur d'enfant.
    await naturalClick(page, ".pillbar .pill:has-text('Emma')", { pauseAfter: 1200 });

    // Autorisations d'Emma — une autorisation encore "En attente".
    if (isMobile) {
      await naturalClick(page, "button.mbn-i:has-text('Plus')", { pauseAfter: 400 });
      await naturalClick(page, "#mobSheet button.tile-card:has-text('Autorisations')", { pauseAfter: 1400 });
    } else {
      await naturalClick(page, 'button.ni[data-id="famautorisations"]', { pauseAfter: 1400 });
    }

  } finally {
    await finishRecording(context, browser);
    const rawPath = await video.path();
    const finalPath = path.join(RAW_DIR, OUTPUT_NAME);
    fs.renameSync(rawPath, finalPath);
    console.log('Enregistrement terminé ->', finalPath);
  }
})();
