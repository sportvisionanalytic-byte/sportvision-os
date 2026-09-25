// Les onglets du bas de l'OS se lisent en entier, sur un vrai ecran de telephone (25/09/2026).
//
// TROUVE EN MESURANT L'OS SUR UN IPHONE 14 (390 px), avant d'envisager d'en faire une
// application : un administrateur voyait « Tableau d… », « Prestatio… », « Vue d'en… ». Trois
// onglets sur cinq illisibles. Un operateur sur le terrain tape alors au hasard.
//
// LE RESTE DE L'OS ALLAIT BIEN, et c'est ce qui rend ce defaut notable : aucune fuite laterale,
// aucune erreur JavaScript, deux cibles tactiles trop petites sur quatre-vingt-trois. L'OS est
// deja pense pour le telephone. Seuls les libelles ne l'etaient pas.
//
// COUPER AU PREMIER MOT AVAIT DEJA ETE ESSAYE, ET RETIRE : « Mes prestations » et « Mes medias »
// donnaient deux onglets « Mes » indiscernables pour un photographe. On etait donc revenu au
// libelle complet, tronque par l'ellipsis — en echangeant un defaut contre un autre. La sortie
// est d'ecrire un nom court par onglet (BNAV_LB), au lieu de demander a une machine de couper.
//
// CE TEST MESURE LE RENDU, PAS LE CODE : il compare scrollWidth a clientWidth sur chaque libelle,
// c'est-a-dire ce que le navigateur a reellement du cacher. Un futur libelle trop long le fera
// echouer, quel que soit le chemin par lequel il est arrive.
import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { ouvrirOS, compte } from "./_session-os.mjs";

// Les quatre roles qui vont vraiment sur le terrain avec un telephone.
const ROLES = ["admin", "prod", "compta", "cm"];

let ok = 0;
const echecs = [];
const t = (nom, condition, detail = "") => {
  if (condition) { ok += 1; console.log("  ok  ", nom); }
  else { echecs.push(`${nom}${detail ? " — " + detail : ""}`); console.log("  KO  ", nom, detail); }
};

const nav = await chromium.launch();
try {
  for (const role of ROLES) {
    const c = await compte(`role=eq.${role}`);
    if (!c) { console.log(`  ··   aucun compte ${role} en base, role non mesure`); continue; }
    // 390 x 844 : un iPhone 14, l'ecran le plus courant.
    const { page } = await ouvrirOS(nav, c, { largeur: 390, hauteur: 844 });
    const onglets = await page.evaluate(() => [...document.querySelectorAll(".mbn-lb")].map((e) => ({
      texte: e.textContent.trim(),
      // Ce que le navigateur a du cacher : la seule mesure honnete de « ca ne tient pas ».
      coupe: e.scrollWidth > e.clientWidth + 1,
    })));
    const coupes = onglets.filter((o) => o.coupe).map((o) => o.texte);
    t(`${role} : les ${onglets.length} onglets se lisent en entier`, onglets.length > 0 && coupes.length === 0,
      coupes.length ? coupes.join(", ") : onglets.length === 0 ? "aucun onglet rendu" : "");
    // Deux onglets du meme nom sont pires qu'un nom coupe : on ne sait plus lequel on touche.
    const noms = onglets.map((o) => o.texte);
    t(`${role} : aucun onglet n'en double un autre`, new Set(noms).size === noms.length, noms.join(" | "));
    console.log(`       ${noms.join(" | ")}`);
    await page.context().close();
  }
} finally { await nav.close(); }

console.log(`\n${ok} verifications passees, ${echecs.length} echec(s).`);
if (echecs.length) { echecs.forEach((e) => console.log("  ❌ " + e)); process.exit(1); }
