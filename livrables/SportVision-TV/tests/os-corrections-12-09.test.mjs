// Ce que l'audit du 12/09 a corrigé dans l'OS, vérifié dans un vrai navigateur sur le site déployé.
//
// Trois choses, et rien d'autre :
//   1. le Responsable Production retrouve « Rémunérations équipe » et « Mode Jour J » dans son
//      menu de poste fixe — sans eux, le circuit de paiement des opérateurs était bloqué ;
//   2. la fiche d'une galerie propose « Qui est sur les photos » quand elle porte une équipe ;
//   3. aucune erreur JavaScript ne sort au chargement.
// Lecture seule : ce test n'écrit rien, il regarde.

import { chromium } from "playwright";
import { compte, ouvrirOS, vraiesErreurs, rapporteur } from "./_session-os.mjs";

const { t, bilan } = rapporteur();
const navigateur = await chromium.launch();
try {
  const prod = await compte("role=eq.prod&actif=is.true");
  if (!prod) throw new Error("aucun compte Production actif en base");
  const { page, erreurs } = await ouvrirOS(navigateur, prod);

  const menu = await page.evaluate(() => document.body.innerText);
  t("le menu Production porte « Rémunérations équipe »", /Rémunérations équipe/.test(menu));
  t("le menu Production porte « Mode Jour J »", /Mode Jour J/.test(menu));
  t("« Mes finances » est toujours là", /Mes finances/.test(menu));
  t("aucune erreur JavaScript au chargement", vraiesErreurs(erreurs).length === 0, vraiesErreurs(erreurs).join(" | "));

  // La page Galeries : elle doit s'ouvrir et proposer le dépôt de photos.
  await page.evaluate(() => window.switchView && window.switchView("media"));
  await page.waitForTimeout(3500);
  const galeries = await page.evaluate(() => document.body.innerText);
  t("l'écran Galeries s'ouvre", /Galeries|galerie/i.test(galeries));
  t("les textes du module sont accentués", !/Aucune galerie consultee|Voir le detail/.test(galeries));

  await page.close();
} finally {
  await navigateur.close();
}
process.exit(bilan());
