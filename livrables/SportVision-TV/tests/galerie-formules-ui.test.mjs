// Le parcours multi-formules dans un vrai Chromium, sur la galerie EN PRODUCTION.
//
// Deux pieges appris ici : Intl.NumberFormat("fr-FR") insere une espace FINE INSECABLE (U+202F)
// avant le symbole euro, et innerText rend les libelles de champs en majuscules a cause du
// text-transform CSS. On normalise donc les espaces et on compare sans tenir compte de la casse.
//
// TROISIEME PIEGE, 12/09/2026 : ce test visait en dur le lien « test-paiement-u18 ». Cet album a
// ete archive et son lien desactive le 10/09 avec le reste du decor de test ; le test est devenu
// rouge sans qu'aucun defaut produit n'existe, exactement comme le test du filigrane avant lui.
// Il fabrique desormais sa propre galerie temoin, avec ses cinq formules, et la supprime apres.
import { chromium } from "/Users/fouka/Downloads/jarvis-starter-kit/livrables/SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { SB, enTeteAdmin } from "./_session-os.mjs";
import { creerGalerieTemoin } from "./_galerie-temoin.mjs";

const norm = (s) => s.replace(/[   ]/g, " ");
const api = (chemin, opts = {}) =>
  fetch(`${SB}/rest/v1/${chemin}`, { ...opts, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(opts.headers || {}) } });

const b = await chromium.launch();
let ko = 0;
const dit = (nom, ok, det = "") => { if (!ok) ko++; console.log((ok ? "OK   " : "KO   ") + nom + (det ? "  (" + det + ")" : "")); };

const temoin = await creerGalerieTemoin(b, { nom: "ZZ Galerie formules" });
// Le temoin arrive avec la formule « 2 photos » a 1,50 EUR, mise en avant. On ajoute les quatre
// autres pour retrouver l'eventail complet : une offerte, deux quotas, deux formules d'album.
await api("media_album_link_offers", { method: "POST", body: JSON.stringify([
  { link_id: temoin.lienId, label: "1 photo offerte", price_override_cents: 0, photos_allowance: 1, offer_type: "pack", display_order: 0 },
  { link_id: temoin.lienId, label: "3 photos", price_override_cents: 250, photos_allowance: 3, offer_type: "pack", display_order: 2 },
  { link_id: temoin.lienId, label: "Toute la galerie", price_override_cents: 900, photos_allowance: null, offer_type: "album_complet", display_order: 3 },
  { link_id: temoin.lienId, label: "Galerie + tirages", price_override_cents: 2500, photos_allowance: null, offer_type: "album_complet", display_order: 4 },
]) });

const URL = temoin.url;
const TITRE = "ZZ Galerie formules";

try {
for (const [nom, vp] of [["iPhone", { width: 390, height: 844 }], ["Bureau", { width: 1440, height: 900 }]]) {
  const p = await b.newPage({ viewport: vp, isMobile: nom === "iPhone", hasTouch: nom === "iPhone" });
  await p.goto(URL, { waitUntil: "networkidle" });
  const txt = norm(await p.locator("body").innerText());

  dit(`${nom} : la galerie s'ouvre`, txt.includes(TITRE));
  // Le temoin porte 3 photos, moins que la vitrine (12) : elles sont donc toutes montrees.
  dit(`${nom} : les photos de l'apercu sont visibles`,
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
await p.close();
} finally {
  const menage = await temoin.nettoyer();
  dit("la galerie temoin est supprimee, fichiers compris",
      menage.reste === 0 && !menage.fichierEncoreServi, `${menage.reste} ligne(s)`);
  await b.close();
}

console.log(ko === 0 ? "\ntout conforme" : `\n${ko} ecart(s)`);
process.exit(ko ? 1 : 0);
