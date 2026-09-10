// Le formulaire de paiement d'une galerie, tel qu'un parent le remplit sur son iPhone.
//
// POURQUOI CE TEST. Deux defauts ont ete trouves le 10/09/2026 pendant le paiement reel de
// validation, et aucun test ne les voyait :
//
//   1. « quand j'ecris mon mail, ca me quitte » — champs en 14 px (Safari iOS zoome en dessous de
//      16 px) et voile qui fermait le formulaire au moindre toucher. L'emulation Chromium ne zoome
//      pas : la saisie y passait sans encombre. On mesure donc la CAUSE — la taille reelle des champs
//      et le comportement du voile — puisque le symptome n'est pas reproductible hors d'un vrai
//      telephone.
//   2. l'adresse saisie avec une faute (« sportvisionalytic » pour « sportvisionanalytic ») : le
//      paiement est passe, l'e-mail de livraison est parti vers la mauvaise boite. D'ou le champ de
//      confirmation et la suggestion de domaine.
//
// Le test ne clique JAMAIS sur « Payer » : ce bouton ouvre une session Stripe REELLE. Le 10/09, un
// test qui le faisait avait laisse onze sessions payables dans le compte de production.

import { chromium, devices } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { creerGalerieTemoin } from "./_galerie-temoin.mjs";
import { rapporteur } from "./_session-os.mjs";

const { t, bilan } = rapporteur();
const navigateur = await chromium.launch();
const temoin = await creerGalerieTemoin(navigateur, { nom: "ZZ Temoin formulaire" });

try {
  const ctx = await navigateur.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 180)));

  await page.goto(temoin.url, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.locator("button", { hasText: /^Choisir$/ }).first().tap();
  await page.waitForTimeout(1500);
  const coches = page.locator("button", { hasText: "✓" });
  await coches.nth(0).tap();
  await coches.nth(1).tap();
  await page.locator("button", { hasText: /Continuer/ }).first().tap();
  await page.waitForTimeout(2500);

  const payer = page.locator("button[type=submit]", { hasText: /Payer/ });
  const actif = async () => !(await payer.isDisabled());
  t("le formulaire de paiement s'ouvre", await page.locator("#co-email").count() > 0);

  // ── 1. Le zoom iOS et le voile ──────────────────────────────────────────
  const tailles = await page.evaluate(() =>
    [...document.querySelectorAll("form input")].map((i) => [i.id, getComputedStyle(i).fontSize]));
  const petits = tailles.filter(([, px]) => parseFloat(px) < 16);
  t("tous les champs font au moins 16 px (pas de zoom Safari)", petits.length === 0,
    petits.map(([id, px]) => `${id} : ${px}`).join(", "));

  await page.fill("#co-nom", "Camille Martin");
  await page.fill("#co-email", "camille.martin@gmail.com");
  await page.mouse.click(195, 60);   // un toucher en haut de l'ecran, sur le voile
  await page.waitForTimeout(1000);
  t("un toucher sur le voile ne ferme pas le formulaire", await page.locator("#co-email").count() > 0);
  t("et la saisie est conservee", (await page.inputValue("#co-email").catch(() => "")) === "camille.martin@gmail.com");

  // ── 2. La confirmation ──────────────────────────────────────────────────
  t("un champ de confirmation existe", await page.locator("#co-email-confirmation").count() > 0);
  t("il refuse la saisie automatique", (await page.getAttribute("#co-email-confirmation", "autocomplete")) === "off");
  t("« Payer » reste inactif tant que la confirmation est vide", !(await actif()));

  // La faute reelle du 10/09.
  await page.fill("#co-email", "sportvisionanalytic@gmail.com");
  await page.fill("#co-email-confirmation", "sportvisionalytic@gmail.com");
  await page.waitForTimeout(400);
  t("la faute du 10/09 est bloquee : « Payer » inactif", !(await actif()));
  t("et la difference est signalee", await page.locator("#co-email-difference").isVisible().catch(() => false));

  await page.fill("#co-email-confirmation", "SportVisionAnalytic@gmail.com ");
  await page.waitForTimeout(400);
  t("les majuscules et espaces ne comptent pas comme une difference", await actif());
  t("le message d'erreur disparait", !(await page.locator("#co-email-difference").isVisible().catch(() => false)));

  // Pas de reproche des la premiere lettre.
  await page.fill("#co-email-confirmation", "sp");
  await page.waitForTimeout(300);
  t("pas d'erreur affichee pendant qu'on commence a taper", !(await page.locator("#co-email-difference").isVisible().catch(() => false)));

  // ── 3. La suggestion de domaine ─────────────────────────────────────────
  await page.fill("#co-email", "camille@gmial.com");
  await page.waitForTimeout(400);
  const suggestion = page.locator("button", { hasText: /Vouliez-vous dire/ });
  t("« gmial.com » declenche une suggestion", await suggestion.count() > 0);
  if (await suggestion.count()) {
    t("elle propose gmail.com", /camille@gmail\.com/.test(await suggestion.textContent()));
    await suggestion.tap();
    t("un toucher corrige l'adresse", (await page.inputValue("#co-email")) === "camille@gmail.com");
  }
  await page.fill("#co-email", "camille@sportvision-an.fr");
  await page.waitForTimeout(400);
  t("aucune suggestion sur un domaine d'entreprise", await page.locator("button", { hasText: /Vouliez-vous dire/ }).count() === 0);

  t("aucune erreur JavaScript", erreurs.length === 0, erreurs.slice(0, 3).join("\n       "));
  await ctx.close();
} finally {
  await navigateur.close();
  const menage = await temoin.nettoyer();
  t("la galerie temoin est supprimee", menage.reste === 0 && !menage.fichierEncoreServi,
    `${menage.reste} ligne(s), fichier encore servi : ${menage.fichierEncoreServi}`);
}

process.exit(bilan() ? 1 : 0);
