// Accessibilite automatique (axe-core, WCAG 2.1 A et AA) des pages que de vraies personnes ouvrent
// sans formation : Connect (accueil, connexion, inscription), la galerie publique et son formulaire
// de paiement sur iPhone, Club+ (connexion et quatre ecrans d'un club).
//
// POURQUOI. Au 10/09/2026, l'accessibilite etait la seule ligne de la liste V1.1 jamais mesuree.
// Premier passage : aucune fenetre sans nom, aucun champ sans etiquette, aucune image sans texte —
// mais du texte trop pale sur fond sombre partout ou il sert d'etiquette : « Pas encore de
// compte ? » (3,9:1), les etiquettes du formulaire de paiement, les titres de section du menu
// Club+. Le seuil WCAG AA est 4,5:1 pour ce corps de texte.
//
// Echoue sur toute violation « serious » ou « critical ». Ce que axe ne voit pas (ordre de
// tabulation, focus visible, lecteur d'ecran) est controle a part : voir la fin du fichier.
//
// Ne clique jamais sur « Payer » (session Stripe reelle). La galerie est un temoin cree puis supprime.

import { chromium, devices } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";
import { CP, ouvrirClubPlus, ouvrirLeClub, allerA } from "./_session-clubplus.mjs";
import { creerGalerieTemoin } from "./_galerie-temoin.mjs";
import { rapporteur } from "./_session-os.mjs";

const AXE = readFileSync(new URL("../../SportVision-Connect/app-next/node_modules/axe-core/axe.min.js", import.meta.url).pathname, "utf8");
const CX = "https://connect.sportvision-an.fr";
const { t, bilan } = rapporteur();

async function mesurer(page, nom) {
  await page.addScriptTag({ content: AXE });
  const violations = await page.evaluate(async () =>
    (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({ id: v.id, n: v.nodes.length, ex: v.nodes.slice(0, 3).map((x) => {
        const d = x.any?.[0]?.data;
        const mesure = d?.contrastRatio ? ` [${d.fgColor} sur ${d.bgColor} = ${d.contrastRatio}:1, attendu ${d.expectedContrastRatio}]` : "";
        return (x.html.replace(/\s+/g, " ").slice(0, 90)) + mesure;
      }) })));
  t(`${nom} : aucune violation grave`, violations.length === 0,
    violations.map((v) => `${v.id} x${v.n}\n         ${v.ex.join("\n         ")}`).join("\n       "));
}

const navigateur = await chromium.launch();
const temoin = await creerGalerieTemoin(navigateur, { nom: "ZZ Temoin accessibilite" });

try {
  // ── Connect et galerie, sur iPhone ─────────────────────────────────────
  const mobile = await navigateur.newContext({ ...devices["iPhone 13"] });
  const p = await mobile.newPage();
  for (const [nom, url] of [["Connect accueil", CX], ["Connect connexion", `${CX}/auth/login`], ["Connect inscription", `${CX}/auth/signup`]]) {
    await p.goto(url, { waitUntil: "networkidle" });
    await p.waitForTimeout(1500);
    await mesurer(p, nom);
  }
  await p.goto(temoin.url, { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  await mesurer(p, "Galerie publique");
  await p.locator("button", { hasText: /^Choisir$/ }).first().tap();
  await p.waitForTimeout(1500);
  const coches = p.locator("button", { hasText: "✓" });
  await coches.nth(0).tap();
  await coches.nth(1).tap();
  await p.locator("button", { hasText: /Continuer/ }).first().tap();
  await p.waitForTimeout(2500);
  t("le formulaire de paiement est bien ouvert (sinon la mesure ne vaut rien)", await p.locator("#co-email").count() > 0);
  await mesurer(p, "Galerie, formulaire de paiement");
  await mobile.close();

  // ── Le formulaire de paiement au clavier ────────────────────────────────
  // Ce que axe ne mesure pas. Le 10/09/2026 : pas de role « dialog », focus laisse sur la page,
  // Tab qui ressortait vers les photos derriere le voile, Echap sans effet.
  const bureauGalerie = await navigateur.newContext();
  const g = await bureauGalerie.newPage();
  await g.goto(temoin.url, { waitUntil: "networkidle" });
  await g.waitForTimeout(2500);
  await g.locator("button", { hasText: /^Choisir$/ }).first().click();
  await g.waitForTimeout(1500);
  const c2 = g.locator("button", { hasText: "✓" });
  await c2.nth(0).click();
  await c2.nth(1).click();
  const continuer = g.locator("button", { hasText: /Continuer/ }).first();
  await continuer.focus();
  await g.keyboard.press("Enter");
  await g.waitForTimeout(2500);
  const fenetre = await g.evaluate(() => {
    const d = document.querySelector("#co-email")?.closest("[role=dialog]");
    return d ? { modal: d.getAttribute("aria-modal"), titre: document.getElementById(d.getAttribute("aria-labelledby") || "")?.textContent || "" } : null;
  });
  t("la fenetre de paiement est annoncee comme une fenetre modale", fenetre?.modal === "true", JSON.stringify(fenetre));
  t("elle porte un titre lu par le lecteur d'ecran", !!fenetre?.titre, JSON.stringify(fenetre));
  const dedans = () => g.evaluate(() => !!document.activeElement?.closest("[role=dialog]"));
  t("a l'ouverture, le focus entre dans la fenetre", await dedans());
  let sorti = 0;
  for (let i = 0; i < 12; i++) { await g.keyboard.press("Tab"); if (!(await dedans())) sorti++; }
  for (let i = 0; i < 6; i++) { await g.keyboard.press("Shift+Tab"); if (!(await dedans())) sorti++; }
  t("Tab et Maj+Tab restent dans la fenetre", sorti === 0, `${sorti} sortie(s) sur 18 appuis`);
  await g.fill("#co-nom", "Camille Martin");
  await g.keyboard.press("Escape");
  await g.waitForTimeout(800);
  const fermee = await g.locator("#co-email").count() === 0;
  t("Echap ferme la fenetre", fermee);
  // Conditionne a la fermeture : tant que la fenetre reste ouverte, le focus n'a nulle part ou revenir
  // et ce controle passerait sans rien avoir mesure.
  t("le focus revient sur la page, pas dans le vide", fermee && await g.evaluate(() =>
    document.activeElement !== document.body && !document.activeElement?.closest("[role=dialog]")));
  await bureauGalerie.close();

  // ── Club+ ──────────────────────────────────────────────────────────────
  const bureau = await navigateur.newContext();
  const q = await bureau.newPage();
  await q.goto(`${CP}/clubplus/login`, { waitUntil: "networkidle" }).catch(() => {});
  await q.waitForTimeout(1500);
  await mesurer(q, "Club+ connexion");
  await bureau.close();

  const { page } = await ouvrirClubPlus(navigateur, "chris2brazza@gmail.com");
  await ouvrirLeClub(page, "Villeneuve 340 SC");
  t("le menu du club est bien affiche (sinon la mesure ne vaut rien)", await page.locator("nav a, aside a").count() > 5);
  await mesurer(page, "Club+ tableau de bord");
  for (const ecran of ["Calendrier", "Membres", "Équipes"]) {
    await allerA(page, ecran);
    await mesurer(page, `Club+ ${ecran}`);
  }
} finally {
  await navigateur.close();
  const menage = await temoin.nettoyer();
  t("la galerie temoin est supprimee", menage.reste === 0 && !menage.fichierEncoreServi);
}

process.exit(bilan() ? 1 : 0);
