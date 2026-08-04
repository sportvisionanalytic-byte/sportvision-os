const path = require('path');
const { chromium } = require('playwright');
const { applyDemoPersona } = require('./demo-persona');

const APP_URL = 'file://' + path.resolve(__dirname, '../../../livrables/SportVision-Club-Plus/app.html');

const VIEWPORTS = {
  desktop: { width: 1920, height: 1080 },
  mobile: { width: 430, height: 932 },
};

/**
 * Ouvre app.html dans un navigateur Chromium propre, avec enregistrement
 * vidéo de contexte activé (sortie WebM brute dans videoDir — cf. §3 de
 * CLUBPLUS_VIDEO_PRODUCTION.md : les vidéos brutes restent séparées des
 * exports finaux, produits ensuite par FFmpeg).
 *
 * Navigateur "propre" : profil temporaire (pas de --user-data-dir
 * persistant), aucune extension chargée, permissions par défaut refusées
 * (pas de popup de notification), animations CSS réduites au strict
 * nécessaire pour ne pas ralentir le rendu pendant l'enregistrement.
 */
async function launchDemoPage({ device = 'desktop', videoDir, slowMoMs = 60 }) {
  const viewport = VIEWPORTS[device];
  if (!viewport) throw new Error(`device inconnu: ${device}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: device === 'mobile' ? 3 : 2,
    recordVideo: { dir: videoDir, size: viewport },
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
    permissions: [],
    isMobile: device === 'mobile',
    hasTouch: device === 'mobile',
  });
  context.setDefaultTimeout(8000);

  const page = await context.newPage();
  await page.goto(APP_URL, { waitUntil: 'load' });

  // Persona de démonstration (§1 de la mission) — mutation en mémoire uniquement.
  await page.evaluate(applyDemoPersona);

  return { browser, context, page, viewport };
}

/** Termine proprement le contexte : Playwright finalise le .webm à la fermeture. */
async function finishRecording(context, browser) {
  await context.close();
  await browser.close();
}

/** Clic "naturel" : survole l'élément avant de cliquer, laisse un court silence après. */
async function naturalClick(page, selector, { pauseBefore = 250, pauseAfter = 500 } = {}) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible' });
  await el.hover();
  await page.waitForTimeout(pauseBefore);
  await el.click();
  await page.waitForTimeout(pauseAfter);
}

/** Remplit un champ déjà "préparé" (valeur connue à l'avance, pas de frappe visible). */
async function naturalFill(page, selector, value, { pauseAfter = 220 } = {}) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible' });
  await el.click();
  await el.fill(value);
  await page.waitForTimeout(pauseAfter);
}

async function pause(page, ms) { await page.waitForTimeout(ms); }

module.exports = { launchDemoPage, finishRecording, naturalClick, naturalFill, pause, APP_URL, VIEWPORTS };
