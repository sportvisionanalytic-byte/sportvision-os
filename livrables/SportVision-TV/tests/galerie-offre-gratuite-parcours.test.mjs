// Le parcours COMPLET d'une offre gratuite, comme le vivrait un parent : navigation privée, aucun
// compte, aucun appel serveur direct. On clique, on remplit, on télécharge.
//
// C'est la validation qui manquait : l'offre gratuite n'avait été essayée que par appel direct à
// la fonction, jamais depuis un navigateur.
import { chromium } from "/Users/fouka/Downloads/jarvis-starter-kit/livrables/SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { createHash } from "node:crypto";

const URL = "https://connect.sportvision-an.fr/gallery/test-paiement-u18?k=z8Dk6uTkSSSlFRkvo42j2Ejv";
const MAIL = process.env.SV_MAIL_GRATUIT || "zz-gratuit@sportvision-an.fr";
const norm = (s) => s.replace(/[   ]/g, " ");

const b = await chromium.launch();
let ko = 0;
const dit = (nom, ok, det = "") => { if (!ok) ko++; console.log((ok ? "OK   " : "KO   ") + nom + (det ? "  (" + det + ")" : "")); };

// Contexte neuf : ni session, ni stockage. C'est bien un visiteur qui découvre le lien.
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
await p.goto(URL, { waitUntil: "networkidle" });

dit("la galerie s'ouvre sans compte", /Test paiement/.test(await p.locator("body").innerText()));

await p.locator("button", { hasText: "Voir les formules" }).click();
await p.waitForTimeout(600);
const feuille = norm(await p.locator('[role="dialog"]').innerText());
dit("l'offre gratuite est proposee", /1 photo offerte/.test(feuille));
dit("et affichee « Offert », pas « 0,00 € »", /Offert/.test(feuille) && !/0,00/.test(feuille));

await p.locator('[role="dialog"] button', { hasText: "1 photo offerte" }).first().click();
await p.waitForTimeout(600);
dit("passage en mode selection", /0 \/ 1 photo/.test(norm(await p.locator("body").innerText())));

await p.locator('button[aria-label="Ajouter à la sélection"]').first().click();
await p.waitForTimeout(400);
const apres = norm(await p.locator("body").innerText());
dit("le compteur avance", /1 \/ 1 photo/.test(apres));
dit("le bouton n'annonce aucun prix", /Continuer — Offert/.test(apres) || /Continuer/.test(apres));
dit("les autres photos ne sont plus cochables",
    await p.locator('button[aria-label="Ajouter à la sélection"]').first().isDisabled());

await p.locator("button", { hasText: "Continuer" }).click();
await p.waitForTimeout(700);
const form = norm(await p.locator("form").first().innerText());
dit("l'ecran de coordonnees s'affiche", /adresse e-mail/i.test(form));
dit("le recapitulatif dit « Offert »", /Offert/.test(form), form.split("\n").find((l) => /Offert/.test(l)) || "");

await p.locator('input#co-nom').fill("Parent Test Gratuit");
await p.locator('input#co-email').fill(MAIL);
await p.locator('button[type="submit"]').click();

// Aucune redirection vers Stripe : on doit atterrir directement sur la commande.
await p.waitForURL(/\/gallery\/commande\//, { timeout: 30000 });
dit("aucun passage par Stripe", !p.url().includes("stripe.com"), p.url().replace(/\/[^/]+$/, "/…"));

await p.waitForLoadState("networkidle");
const commande = norm(await p.locator("body").innerText());
dit("la page de commande s'affiche", /Vos photos sont pr[eê]tes/i.test(commande));
dit("elle annonce « Offert »", /Offert/.test(commande));
dit("le bouton « Tout telecharger » est la", /Tout t[eé]l[eé]charger/.test(commande));
dit("Connect est propose APRES le telechargement",
    commande.indexOf("télécharger") < commande.indexOf("Connect") ||
    commande.indexOf("Télécharger") < commande.indexOf("Connect"));

// Le telechargement reel : c'est le seul test qui prouve que le fichier arrive.
const [dl] = await Promise.all([
  p.waitForEvent("download", { timeout: 30000 }),
  p.locator("a", { hasText: "Tout télécharger" }).first().click(),
]);
const chemin = await dl.path();
const buf = await import("node:fs").then((fs) => fs.readFileSync(chemin));
dit("l'archive est bien recue", buf.length > 1000, `${Math.round(buf.length / 1024)} Ko`);
dit("et c'est un vrai ZIP", buf[0] === 0x50 && buf[1] === 0x4b, `signature ${buf[0].toString(16)}${buf[1].toString(16)}`);
dit("empreinte enregistree", true, createHash("sha256").update(buf).digest("hex").slice(0, 16) + "…");

await ctx.close();
await b.close();
console.log(ko === 0 ? "\ntout conforme" : `\n${ko} ecart(s)`);
process.exit(ko ? 1 : 0);
