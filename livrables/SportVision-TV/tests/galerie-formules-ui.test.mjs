// Le parcours multi-formules dans un vrai Chromium, sur la galerie EN PRODUCTION.
//
// Deux pieges appris ici : Intl.NumberFormat("fr-FR") insere une espace FINE INSECABLE (U+202F)
// avant le symbole euro, et innerText rend les libelles de champs en majuscules a cause du
// text-transform CSS. On normalise donc les espaces et on compare sans tenir compte de la casse.
import { chromium } from "/Users/fouka/Downloads/jarvis-starter-kit/livrables/SportVision-Connect/app-next/node_modules/playwright/index.mjs";

const URL = "https://connect.sportvision-an.fr/gallery/test-paiement-u18?k=z8Dk6uTkSSSlFRkvo42j2Ejv";
const norm = (s) => s.replace(/[   ]/g, " ");

const b = await chromium.launch();
let ko = 0;
const dit = (nom, ok, det = "") => { if (!ok) ko++; console.log((ok ? "OK   " : "KO   ") + nom + (det ? "  (" + det + ")" : "")); };

for (const [nom, vp] of [["iPhone", { width: 390, height: 844 }], ["Bureau", { width: 1440, height: 900 }]]) {
  const p = await b.newPage({ viewport: vp, isMobile: nom === "iPhone", hasTouch: nom === "iPhone" });
  await p.goto(URL, { waitUntil: "networkidle" });
  const txt = norm(await p.locator("body").innerText());

  dit(`${nom} : la galerie s'ouvre`, txt.includes("Test paiement"));
  dit(`${nom} : toutes les photos sont visibles avant achat`,
      (await p.locator('button[aria-label^="Ouvrir la photo"]').count()) === 3, "3 sur 3");
  dit(`${nom} : la barre annonce le nombre de formules`, /5 formules disponibles/.test(txt), txt.match(/\d+ formules[^\n]*/)?.[0]);
  dit(`${nom} : et le prix d'entree`, /À partir de/.test(txt) && /Offert|0 €/.test(txt));

  await p.locator("button", { hasText: "Voir les formules" }).click();
  await p.waitForTimeout(500);
  const feuille = norm(await p.locator('[role="dialog"]').innerText());

  dit(`${nom} : les 5 formules sont listees`,
      ["1 photo offerte", "2 photos", "3 photos", "Toute la galerie", "Galerie + tirages"].every((n) => feuille.includes(n)));
  dit(`${nom} : l'offre gratuite s'affiche « Offert »`, /Offert/.test(feuille));
  dit(`${nom} : le prix est annonce fixe`, /ne change pas selon les photos/.test(feuille));
  // La mise en avant est celle configuree (2 photos a 1,50 EUR), PAS la plus chere.
  const misEnAvant = await p.locator('[role="dialog"] button:has-text("Recommandé")').innerText();
  dit(`${nom} : la mise en avant est celle configuree`, /2 photos/.test(norm(misEnAvant)), norm(misEnAvant).split("\n")[0]);

  // Formule a quota : la galerie passe en mode selection, prix fige.
  await p.locator('[role="dialog"] button', { hasText: "2 photos" }).first().click();
  await p.waitForTimeout(500);
  const apres = norm(await p.locator("body").innerText());
  dit(`${nom} : passage en mode selection`, /0 \/ 2 photos/.test(apres), apres.match(/\d \/ \d photos/)?.[0]);

  await p.locator('button[aria-label="Ajouter à la sélection"]').first().click();
  await p.waitForTimeout(300);
  const un = norm(await p.locator("body").innerText());
  dit(`${nom} : le compteur avance`, /1 \/ 2 photos/.test(un));
  dit(`${nom} : le prix n'a pas bouge`, /Continuer — 1,50 €/.test(un), un.match(/Continuer[^\n]*/)?.[0]);

  await p.locator('button[aria-label="Ajouter à la sélection"]').first().click();
  await p.waitForTimeout(300);
  const deux = norm(await p.locator("body").innerText());
  dit(`${nom} : quota atteint`, /2 \/ 2 photos/.test(deux));
  dit(`${nom} : le prix n'a toujours pas bouge`, /Continuer — 1,50 €/.test(deux));
  dit(`${nom} : les photos restantes ne sont plus cochables`,
      await p.locator('button[aria-label="Ajouter à la sélection"]').first().isDisabled());

  // On peut changer de formule sans perdre sa selection.
  await p.locator("button", { hasText: "changer de formule" }).click();
  await p.waitForTimeout(400);
  await p.locator('[role="dialog"] button', { hasText: "3 photos" }).first().click();
  await p.waitForTimeout(400);
  const change = norm(await p.locator("body").innerText());
  dit(`${nom} : changer de formule garde la selection`, /2 \/ 3 photos/.test(change), change.match(/\d \/ \d photos/)?.[0]);

  await p.locator("button", { hasText: "Continuer —" }).click();
  await p.waitForTimeout(600);
  const co = norm(await p.locator("form").first().innerText());
  dit(`${nom} : ecran de coordonnees`, /adresse e-mail/i.test(co));
  dit(`${nom} : recapitulatif = formule + nombre choisi`, /3 photos · 2 photos/.test(co), co.split("\n").find((l) => /photos ·/.test(l)) || "");
  await p.close();
}

const p = await b.newPage();
const urls = [];
p.on("response", (r) => urls.push(r.url()));
await p.goto(URL, { waitUntil: "networkidle" });
dit("aucun original servi a la page publique", !urls.some((u) => u.includes("sportvision-media-prive")));
await b.close();

console.log(ko === 0 ? "\ntout conforme" : `\n${ko} ecart(s)`);
process.exit(ko ? 1 : 0);
