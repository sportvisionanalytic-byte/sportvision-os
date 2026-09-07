// La couche de confirmation de l'OS, dans un vrai navigateur.
//
// Le point qui justifie son existence : openModal() n'a qu'une seule couche (il remplace le
// contenu de #sv-modal-ct). Demander confirmation depuis l'interieur d'un formulaire ouvert
// effacait donc ce formulaire, et c'est pour cette raison qu'une douzaine d'endroits
// appelaient le confirm() natif du navigateur. Le test verifie donc surtout la propriete qui
// permet de n'avoir plus qu'un seul mecanisme : le formulaire en dessous survit, saisie comprise.

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const OS = new URL("../SportVision-OS-Full.html", import.meta.url).pathname;
const html = readFileSync(OS, "utf8");

// Seule la racine sert la page : tout autre chemin (sw.js, version.json) doit repondre 404
// comme en production, sinon le navigateur recoit du HTML a la place d'un script et signale une
// erreur qui n'existe pas reellement.
const srv = createServer((req, res) => {
  if (req.url !== "/") return res.writeHead(404).end();
  res.writeHead(200, { "content-type": "text/html" }).end(html);
});
await new Promise((r) => srv.listen(0, r));
const url = `http://localhost:${srv.address().port}/`;

const nav = await chromium.launch();
const page = await nav.newPage();
const erreursJs = [];
page.on("pageerror", (e) => {
  const msg = String(e).split("\n")[0];
  // L'OS enregistre un service worker. Servi ici depuis un serveur de test qui ne connait que
  // la page, l'enregistrement echoue forcement : c'est un artefact du banc d'essai, pas un
  // defaut du produit (verifie separement sur le site deploye).
  if (/ServiceWorker/i.test(msg)) return;
  erreursJs.push(msg);
});
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof demanderConfirmation === "function");

let ok = 0, ko = 0;
const t = (nom, cond, detail = "") => {
  if (cond) { ok++; console.log(`  ok   ${nom}`); }
  else { ko++; console.log(`  KO   ${nom}${detail ? " — " + detail : ""}`); }
};
const visible = () => page.locator("#sv-confirm.on").isVisible();

// La couche s'affiche et prend le focus dans un requestAnimationFrame : ouvrir puis verifier
// dans la foulee testerait l'instant d'avant. On attend donc qu'elle soit reellement la.
async function ouvrir(expr) {
  await page.evaluate(expr);
  await page.waitForSelector("#sv-confirm.on", { state: "visible" });
  await page.waitForFunction(() => document.activeElement?.id === "sv-confirm-non");
}
// window.__r contient une promesse : la lire avec evaluate() l'attend. Si la confirmation n'a
// pas ete repondue, le test se figerait — d'ou la course contre une limite de temps, qui
// transforme un blocage en echec lisible.
const reponse = () =>
  Promise.race([
    page.evaluate(() => window.__r),
    new Promise((r) => setTimeout(() => r("PAS DE REPONSE"), 3000)),
  ]);

// ── 1. Le contrat de base ────────────────────────────────────────────────────
console.log("\n1. Repondre oui / non");
await ouvrir(() => { window.__r = demanderConfirmation("Supprimer ?", { action: "Supprimer" }); });
t("la couche s'affiche", await visible());
await page.click("#sv-confirm-non");
t("Annuler resout false", (await reponse()) === false);
t("la couche se referme", !(await visible()));

await ouvrir(() => { window.__r = demanderConfirmation("Supprimer ?"); });
await page.click("#sv-confirm-oui");
t("Confirmer resout true", (await reponse()) === true);

// ── 2. Ce pour quoi la couche existe ────────────────────────────────────────
console.log("\n2. Depuis un formulaire deja ouvert, le formulaire survit");
await page.evaluate(() => openModal('<input id="essai-champ"><button id="essai-btn">Envoyer</button>'));
await page.fill("#essai-champ", "saisie en cours");
await ouvrir(() => { window.__r = demanderConfirmation("Vraiment ?"); });
t("la modale reste ouverte derriere", await page.locator("#sv-modal.on").isVisible());
t("le champ existe toujours", await page.locator("#essai-champ").count() === 1);
t(
  "la saisie n'est pas perdue",
  (await page.inputValue("#essai-champ")) === "saisie en cours",
  await page.inputValue("#essai-champ"),
);
t("la confirmation est au-dessus", await page.evaluate(() =>
  Number(getComputedStyle(document.getElementById("sv-confirm")).zIndex) >
  Number(getComputedStyle(document.getElementById("sv-modal")).zIndex)));

// ── 3. Echap annule la confirmation, pas le formulaire ──────────────────────
console.log("\n3. Echap n'atteint que la couche du dessus");
await page.keyboard.press("Escape");
t("la confirmation est annulee", (await reponse()) === false);
t("la modale est toujours ouverte", await page.locator("#sv-modal.on").isVisible());
t("la saisie a survecu a Echap", (await page.inputValue("#essai-champ")) === "saisie en cours");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
t("un second Echap ferme bien la modale", !(await page.locator("#sv-modal.on").isVisible()));

// ── 4. Securite d'usage ─────────────────────────────────────────────────────
console.log("\n4. Rien ne se valide par inadvertance");
await ouvrir(() => { window.__r = demanderConfirmation("Action destructrice ?"); });
t("le focus est sur Annuler, jamais sur l'action", (await page.evaluate(() => document.activeElement?.id)) === "sv-confirm-non");
await page.keyboard.press("Enter");
t("Entree declenche donc Annuler", (await reponse()) === false);

await ouvrir(() => { window.__r = demanderConfirmation("Test ?"); });
await page.mouse.click(5, 5); // hors du cadre
t("un clic hors du cadre annule", (await reponse()) === false);

// ── 5. Le texte affiche ─────────────────────────────────────────────────────
console.log("\n5. Le message et le libelle de l'action");
await ouvrir(() => {
  window.__r = demanderConfirmation("Premiere ligne.\n\nSeconde ligne.", { titre: "Mon titre", action: "Tout effacer" });
});
t("le titre est repris", (await page.textContent("#sv-confirm-t")) === "Mon titre");
t("le bouton dit ce qui va se passer", (await page.textContent("#sv-confirm-oui")) === "Tout effacer");
t("la ligne vide fait deux paragraphes", await page.locator("#sv-confirm-m p").count() === 2);
t("le texte est echappe, jamais interprete", await page.evaluate(async () => {
  _confirmFermer(false);
  demanderConfirmation('<img src=x onerror="window.__xss=1">');
  await new Promise((r) => setTimeout(r, 50));
  const rendu = document.getElementById("sv-confirm-m").querySelector("img") === null && !window.__xss;
  _confirmFermer(false);
  return rendu;
}));

// ── 6. La forme historique continue de fonctionner ──────────────────────────
console.log("\n6. confirmerAction(msg, callback) — 16 appels existants");
await ouvrir(() => { window.__appele = false; confirmerAction("Supprimer ?", () => { window.__appele = true; }); });
await page.click("#sv-confirm-non");
await page.waitForTimeout(50);
t("le callback n'est PAS appele si on annule", (await page.evaluate(() => window.__appele)) === false);
await ouvrir(() => { confirmerAction("Supprimer ?", () => { window.__appele = true; }); });
await page.click("#sv-confirm-oui");
await page.waitForTimeout(50);
t("le callback est appele si on confirme", (await page.evaluate(() => window.__appele)) === true);
t("le HTML deja echappe par l'appelant est rendu tel quel", await page.evaluate(async () => {
  confirmerAction("Revoquer " + esc("Club de l'Yonne") + " ?", () => {});
  await new Promise((r) => setTimeout(r, 50));
  const txt = document.getElementById("sv-confirm-m").textContent;
  _confirmFermer(false);
  return txt === "Revoquer Club de l'Yonne ?";
}));

// ── 7. Deux confirmations ne se marchent pas dessus ─────────────────────────
console.log("\n7. Une confirmation ouverte pendant qu'une autre l'est deja");
t("la premiere promesse est resolue au lieu de rester suspendue", await page.evaluate(async () => {
  let a = "suspendue";
  demanderConfirmation("Premiere ?").then((v) => { a = v; });
  demanderConfirmation("Seconde ?");
  await new Promise((r) => setTimeout(r, 60));
  _confirmFermer(false);
  return a === false;
}));

// ── 8. Plus aucun confirm() natif dans le code livre ────────────────────────
console.log("\n8. Un seul mecanisme dans tout le fichier");
// `confirm(` suivi d'un guillemet : un appel reel. Les commentaires du fichier mentionnent
// « le confirm() natif » avec des parentheses vides pour expliquer pourquoi il a disparu, et ne
// doivent pas etre comptes comme du code.
const natifs = html.split("\n").filter((l) => /[^a-zA-Z_.]confirm\(['"`]/.test(l));
t(`aucun confirm() natif restant (${natifs.length} trouve(s))`, natifs.length === 0, natifs[0]?.trim().slice(0, 90));

// ── 9. Le focus entre dans les modales (defaut trouve en ecrivant ce test) ──
console.log("\n9. Le focus entre bien dans une modale ouverte");
await page.evaluate(() => openModal('<input id="m1"><button id="m2">Ok</button>'));
await page.waitForSelector("#sv-modal.on", { state: "visible" });
await page.waitForTimeout(80);
t(
  "le focus va au premier element de la modale, pas au fond de page",
  (await page.evaluate(() => document.activeElement?.id)) === "m1",
  await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName),
);
// Le piege de focus n'a de sens que si le focus y est entre : Tab depuis le dernier element
// doit revenir au premier, et non repartir dans la page derriere.
await page.keyboard.press("Tab");
t("Tab avance dans la modale", (await page.evaluate(() => document.activeElement?.id)) === "m2");
await page.keyboard.press("Tab");
t("Tab boucle sur le premier element", (await page.evaluate(() => document.activeElement?.id)) === "m1");
await page.evaluate(() => closeModal());

t("aucune erreur JavaScript pendant tout le test", erreursJs.length === 0, erreursJs.join(" | "));

console.log(`\n${ok}/${ok + ko} verifications passees.`);
await nav.close();
srv.close();
process.exit(ko ? 1 : 0);
