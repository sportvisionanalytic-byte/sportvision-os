import { chromium } from "/Users/fouka/Downloads/jarvis-starter-kit/livrables/SportVision-Connect/app-next/node_modules/playwright/index.mjs";

const URL = "https://connect.sportvision-an.fr/gallery/test-paiement-u18?k=z8Dk6uTkSSSlFRkvo42j2Ejv";
// Intl.NumberFormat("fr-FR") insere une espace FINE INSECABLE (U+202F) avant le symbole. Chercher
// "4 €" avec une espace ordinaire ne trouve rien : on normalise toutes les espaces avant de lire.
const norm = (s) => s.replace(/[   ]/g, " ");

const b = await chromium.launch();
let ko = 0;
const dit = (nom, ok, det = "") => { if (!ok) ko++; console.log((ok ? "OK   " : "KO   ") + nom + (det ? "  (" + det + ")" : "")); };

for (const [nom, vp] of [["iPhone", { width: 390, height: 844 }], ["Bureau", { width: 1440, height: 900 }]]) {
  const p = await b.newPage({ viewport: vp, isMobile: nom === "iPhone", hasTouch: nom === "iPhone" });
  await p.goto(URL, { waitUntil: "networkidle" });
  const txt = norm(await p.locator("body").innerText());

  dit(`${nom} : la galerie s'ouvre`, txt.includes("Test paiement"));
  dit(`${nom} : le prix est visible sans rien cocher`, txt.includes("4 €"));
  dit(`${nom} : la formule est nommee`, /Galerie complete \(test\)/.test(txt));
  dit(`${nom} : promesse d'acces annoncee`, /photos de la galerie/i.test(txt));
  dit(`${nom} : plus aucun panier`, !/panier/i.test(txt));
  dit(`${nom} : plus de coche de selection`, (await p.locator('button[aria-label*="election"]').count()) === 0);
  dit(`${nom} : pas de defilement horizontal`,
      await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  await p.locator('button[aria-label^="Ouvrir la photo"]').first().click();
  await p.waitForTimeout(600);
  dit(`${nom} : bouton d'achat dans la visionneuse`, /Débloquer/.test(norm(await p.locator('[role="dialog"]').innerText())));
  await p.locator('[role="dialog"] button[aria-label="Fermer"]').click();
  await p.waitForTimeout(400);

  // Les libelles de champs sont en petites capitales via CSS : innerText les rend en majuscules.
  // Le bouton de la barre d'achat porte le montant : on le cible par son role, pas par son texte.
  await p.locator("button", { hasText: /^\s*4/ }).last().click();
  await p.waitForTimeout(700);
  const co = norm(await p.locator("form").first().innerText());
  dit(`${nom} : ecran de coordonnees`, /adresse e-mail/i.test(co));
  dit(`${nom} : meme montant au paiement`, /4 €/.test(co), "aucun ecart d'affichage");
  dit(`${nom} : aucun compte exige`, /Aucun compte/.test(co));
  dit(`${nom} : recapitulatif = la formule`, /Galerie complete \(test\)/.test(co), co.split("\n").find((l) => /Galerie/.test(l)) || "");
  await p.close();
}

const p = await b.newPage();
const urls = [];
p.on("response", (r) => urls.push(r.url()));
await p.goto(URL, { waitUntil: "networkidle" });
dit("aucun original servi a la page publique", !urls.some((u) => u.includes("sportvision-media-prive")));
dit("les apercus viennent bien du bucket public", urls.some((u) => u.includes("galerie-previews")));
await b.close();

console.log(ko === 0 ? "\ntout conforme" : `\n${ko} ecart(s)`);
process.exit(ko ? 1 : 0);
