// Le calendrier Club+ tient-il le vrai Villemomble ?
//
// POURQUOI CE TEST. SF Villemomble porte 43 equipes, 425 matchs et 83 creneaux hebdomadaires, ce
// qui fait plus de 1200 occurrences sur un mois. C'est le club le plus lourd, et c'est exactement
// ce qu'un nouveau club de cette taille produira des le premier jour. Le calendrier n'avait jamais
// ete parcouru a ce volume : l'audit du 10/09/2026 le listait comme non verifie.
//
// Il mesure sur le site DEPLOYE, avec un vrai compte CM affilie aux deux clubs, et il regarde ce
// qui casse vraiment a ce volume : le temps de reponse, les evenements qui disparaissent d'une vue
// a l'autre, un tableau qui deborde de l'ecran sur telephone, et les doublons.
//
// UN PIEGE RENCONTRE EN CHEMIN, garde ici parce qu'il reviendra : l'assistant « Onboarding Full
// Communication » s'ouvre tout seul en modale plein ecran des qu'un CM ouvre un club dont
// l'onboarding n'est pas fini, et intercepte TOUS les clics. Ni Echap ni le voile ne le ferment.
// Une premiere version de ce test en concluait que la navigation etait cassee. Elle ne l'etait pas.

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { ouvrirClubPlus, ouvrirLeClub, allerA, vraiesErreursCP } from "./_session-clubplus.mjs";
import { rapporteur, SB, enTeteAdmin } from "./_session-os.mjs";

const CM = "chris2brazza@gmail.com";   // compte de test de Fouka, affilie aux deux clubs
const CLUB = "SF Villemomble";
const { t, bilan } = rapporteur();

// Les categories reelles du club, lues en base : le test se compare au monde, pas a lui-meme.
async function categoriesDuClub(nom) {
  const club = (await (await fetch(`${SB}/rest/v1/clubs?select=id&nom=eq.${encodeURIComponent(nom)}`, { headers: enTeteAdmin })).json())[0];
  if (!club) return [];
  const equipes = await (await fetch(
    `${SB}/rest/v1/club_teams?select=categorie,archivee&club_id=eq.${club.id}`, { headers: enTeteAdmin })).json();
  return [...new Set((equipes || []).filter((e) => !e.archivee && e.categorie).map((e) => e.categorie))].sort();
}

const navigateur = await chromium.launch();
const { page, erreurs } = await ouvrirClubPlus(navigateur, CM);

t("le CM arrive sur la liste de ses clubs", /dashboard/.test(page.url()), page.url());
t("l'assistant d'onboarding se laisse ecarter", await ouvrirLeClub(page, CLUB));

// ── Chargement ──────────────────────────────────────────────────────────────
const ms = await allerA(page, "Calendrier");
t("le calendrier s'ouvre", /calendar/.test(page.url()), page.url());
// 15 s est genereux : au-dela, ce n'est plus une page lente, c'est une page qu'on n'ouvre pas.
t(`il s'affiche en moins de 15 s (${(ms / 1000).toFixed(1)} s)`, ms < 15000, `${(ms / 1000).toFixed(1)} s`);

const compteur = async () => {
  const txt = (await page.evaluate(() => document.body.innerText)) || "";
  const m = txt.match(/(\d+)\s*\/\s*(\d+)\s*[ée]v[ée]nements/i);
  return m ? { affiches: +m[1], total: +m[2] } : null;
};
const c0 = await compteur();
t("il annonce un nombre d'evenements", !!c0, "aucun compteur « n / n evenements » trouve");
if (c0) {
  console.log(`       volume mesure : ${c0.total} evenements`);
  t(`le volume est bien celui d'un gros club (${c0.total})`, c0.total > 500, `${c0.total} seulement`);
  t("aucun evenement n'est filtre par defaut", c0.affiches === c0.total, `${c0.affiches} sur ${c0.total}`);
}

// ── Les quatre vues ─────────────────────────────────────────────────────────
for (const vue of ["Mois", "Semaine", "Jour", "Liste"]) {
  const bouton = page.locator("button", { hasText: new RegExp(`^${vue}$`) }).first();
  if (!(await bouton.count())) { t(`la vue ${vue} existe`, false, "bouton introuvable"); continue; }
  await bouton.click();
  await page.waitForTimeout(3500);
  const texte = (await page.evaluate(() => document.body.innerText)) || "";
  t(`la vue ${vue} s'affiche sans se vider`, texte.length > 800, `${texte.length} caracteres`);
  const deborde = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  t(`la vue ${vue} ne deborde pas horizontalement`, !deborde);
}

// ── Le selecteur d'equipes, hierarchique ───────────────────────────────────
// Ce n'est pas un <select> : c'est un bouton qui ouvre une liste groupee par categorie, avec le
// nombre d'equipes de chaque categorie (Seniors 4, U18 3, U16 2...). Une premiere version de ce
// test cherchait un <select> et concluait a tort que le selecteur n'existait pas.
await page.locator("button", { hasText: /^Mois$/ }).first().click();
await page.waitForTimeout(2500);

const boutonEquipes = page.locator("button").filter({ hasText: /toutes les [ée]quipes/i }).first();
t("le selecteur d'equipes est present", await boutonEquipes.count() > 0);

if (await boutonEquipes.count()) {
  await boutonEquipes.click();
  await page.waitForTimeout(2500);
  const liste = await page.evaluate(() => {
    const zones = [...document.querySelectorAll("[role=listbox],[role=menu],ul,div")].filter((e) => {
      const txt = e.innerText || "";
      return /toutes les [ée]quipes/i.test(txt) && txt.length < 6000
        && e.querySelectorAll("button,li,[role=option]").length > 3;
    });
    if (!zones.length) return null;
    const z = zones[zones.length - 1];
    return [...z.querySelectorAll("button,li,[role=option]")].map((x) => x.textContent.trim()).filter(Boolean);
  });
  t("il ouvre une liste d'equipes", Array.isArray(liste) && liste.length > 3,
    Array.isArray(liste) ? `${liste.length} entrees` : "aucune liste");

  if (Array.isArray(liste)) {
    console.log(`       ${liste.length} entrees : ${liste.slice(0, 8).join(" / ")}`);
    // On compare a ce que porte REELLEMENT le club, lu en base au moment du test. Une premiere
    // version additionnait les chiffres en fin de libelle : « U18 » suivi de « 3 » se lit « U183 »
    // dans le texte rendu, et la somme donnait 1433. Un controle qui calcule un nombre denue de
    // sens et passe au vert ne vaut pas mieux que pas de controle.
    const categoriesEnBase = await categoriesDuClub(CLUB);
    const manquantes = categoriesEnBase.filter((c) => !liste.some((e) => e.startsWith(c)));
    t(`le selecteur propose les ${categoriesEnBase.length} categories du club`, manquantes.length === 0,
      manquantes.length ? `absentes : ${manquantes.join(", ")}` : "");
    t("une entree « Toutes les equipes » ouvre la liste", /toutes les [ée]quipes/i.test(liste[0] || ""), liste[0] || "");
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(1200);
}

// ── Doublons ────────────────────────────────────────────────────────────────
// Le meme match affiche deux fois le meme jour est le defaut le plus courant d'un calendrier qui
// agrege plusieurs sources. On regarde le rendu, pas la base.
const doublons = await page.evaluate(() => {
  const cellules = [...document.querySelectorAll("[class*=grid] > div, td")];
  let pires = 0, ou = "";
  for (const c of cellules) {
    const libelles = [...c.querySelectorAll("*")]
      .map((e) => (e.childElementCount === 0 ? (e.textContent || "").trim() : ""))
      .filter((s) => s.length > 3 && s.length < 60);
    const vus = new Map();
    for (const l of libelles) vus.set(l, (vus.get(l) || 0) + 1);
    for (const [l, n] of vus) if (n > 2 && n > pires) { pires = n; ou = l; }
  }
  return { pires, ou };
});
t("aucun libelle repete anormalement dans une meme case", doublons.pires === 0,
  doublons.ou ? `« ${doublons.ou} » apparait ${doublons.pires} fois` : "");

// ── Trois largeurs ──────────────────────────────────────────────────────────
for (const [nom, largeur] of [["telephone", 390], ["tablette", 768], ["bureau", 1440]]) {
  await page.setViewportSize({ width: largeur, height: 900 });
  await page.waitForTimeout(2500);
  const deborde = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  const texte = (await page.evaluate(() => document.body.innerText)) || "";
  t(`a ${largeur} px (${nom}) la page ne deborde pas`, !deborde,
    `scrollWidth ${await page.evaluate(() => document.documentElement.scrollWidth)} pour ${largeur}`);
  t(`a ${largeur} px (${nom}) le calendrier affiche encore son contenu`, texte.length > 500, `${texte.length} caracteres`);
}

// ── Bascule d'un club a l'autre ─────────────────────────────────────────────
// Une fois un club ouvert, /clubplus/dashboard y reste colle : il ne ramene PAS a la liste des
// clubs. La bascule passe uniquement par le bouton d'entete, qui deroule « Structures clientes ».
// Une premiere version de ce test revenait par l'URL, ne changeait donc jamais de club, et
// concluait a une fuite de donnees entre clubs. Il n'y en avait pas.
await page.setViewportSize({ width: 1440, height: 900 });
const enteteClub = page.locator("button").filter({ hasText: CLUB }).first();
t("l'entete propose un selecteur de structure", await enteteClub.count() > 0);

if (await enteteClub.count()) {
  await enteteClub.click();
  await page.waitForTimeout(2500);
  const autre = page.locator("text=Villeneuve 340 SC").first();
  t("les deux structures du CM sont proposees", await autre.count() > 0);
  if (await autre.count()) {
    await autre.click();
    await page.waitForTimeout(7000);
    const texte = (await page.evaluate(() => document.body.innerText)) || "";
    t("l'espace bascule bien sur l'autre structure", /Villeneuve 340 SC/.test(texte.slice(0, 400)),
      texte.slice(0, 120));

    await allerA(page, "Calendrier");
    const c2 = await compteur();
    if (c2) console.log(`       Villeneuve 340 SC : ${c2.total} evenements contre ${c0 ? c0.total : "?"} sur ${CLUB}`);
    // Villeneuve porte 2 equipes contre 43 : l'ecart doit se voir. Deux volumes identiques
    // signifieraient que le calendrier n'a pas suivi la bascule.
    t("le calendrier du second club porte SES donnees, pas celles du premier",
      !c0 || !c2 || c2.total !== c0.total,
      c2 && c0 ? `${c2.total} evenements ici contre ${c0.total} sur ${CLUB}` : "compteur indisponible");
  }
}

t("aucune erreur JavaScript sur tout le parcours", vraiesErreursCP(erreurs).length === 0,
  vraiesErreursCP(erreurs).slice(0, 4).join("\n       "));

await navigateur.close();
process.exit(bilan() ? 1 : 0);
