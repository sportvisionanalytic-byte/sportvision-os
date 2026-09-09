// Une URL écrite par quelqu'un d'autre ne doit jamais s'exécuter dans la session du staff.
//
// Deux trous trouvés à l'audit du 09/09/2026, tous deux dans un attribut et non dans du texte :
//
//   1. `avis_clients.video_url` est écrit par le CLIENT (policy avis_client_insert) et partait
//      brut dans `href="${a.video_url}"` sur l'écran interne des avis.
//   2. `profiles.avatar_url` est modifiable par son propriétaire (policy « Mise à jour profil
//      personnel » : auth.uid() = id). N'importe quel membre du staff pouvait donc viser un
//      admin qui ouvre la messagerie ou l'annuaire.
//
// Le vecteur le plus vicieux n'est pas `javascript:` — il demande un clic. C'est le guillemet :
// il sort de l'attribut et permet d'ajouter un gestionnaire d'événement, qui se déclenche au
// survol ou au chargement de l'image, sans aucune action de la victime.
//
// Ce test rend le vrai HTML avec des charges réelles et vérifie qu'aucun gestionnaire n'est
// créé et qu'aucun schéma dangereux ne survit.

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../SportVision-OS-Full.html", import.meta.url).pathname, "utf8");
const srv = createServer((req, res) => {
  if (req.url !== "/") return res.writeHead(404).end();
  res.writeHead(200, { "content-type": "text/html" }).end(html);
});
await new Promise((r) => srv.listen(0, r));
const nav = await chromium.launch();
const page = await nav.newPage();
const erreursJs = [];
page.on("pageerror", (e) => { const m = String(e).split("\n")[0]; if (!/ServiceWorker/i.test(m)) erreursJs.push(m); });
await page.goto(`http://localhost:${srv.address().port}/`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof urlSure === "function");

let ok = 0, ko = 0;
const t = (nom, cond, detail = "") => {
  if (cond) { ok++; console.log(`  ok   ${nom}`); }
  else { ko++; console.log(`  KO   ${nom}${detail ? " — " + detail : ""}`); }
};

// ── 1. Le filtre lui-meme ────────────────────────────────────────────────────
console.log("\n1. urlSure() ne laisse passer que du web");
const cas = [
  ["https://drive.google.com/x", true, "une vraie URL passe"],
  ["http://exemple.test/a?b=c", true, "http aussi"],
  ["javascript:alert(1)", false, "javascript: est refusé"],
  ["JaVaScRiPt:alert(1)", false, "javascript: en casse mélangée aussi"],
  ["data:text/html,<script>alert(1)</script>", false, "data: est refusé"],
  ["vbscript:msgbox(1)", false, "vbscript: est refusé"],
  ["", false, "vide donne null"],
  ["   ", false, "espaces donnent null"],
];
for (const [entree, attenduOk, libelle] of cas) {
  const r = await page.evaluate((u) => urlSure(u), entree);
  t(libelle, attenduOk ? !!r : r === null, `urlSure(${JSON.stringify(entree)}) = ${JSON.stringify(r)}`);
}

// ── 2. Les charges reelles, rendues dans le vrai gabarit ────────────────────
console.log("\n2. Aucune charge ne cree de gestionnaire d'événement");

// Sortie d'attribut : c'est celle qui s'exécute sans clic.
const CHARGES = [
  `" onmouseover="window.__PWN=1" x="`,
  `" onerror="window.__PWN=1" x="`,
  `javascript:window.__PWN=1`,
  `https://ok.test/a" onload="window.__PWN=1`,
];

for (const charge of CHARGES) {
  const res = await page.evaluate((c) => {
    window.__PWN = 0;
    const hote = document.createElement("div");
    // Exactement les deux gabarits corrigés, recopiés depuis l'écran.
    const a = { video_url: c };
    const p = { avatar_url: c, av: c };
    const u = urlSure(a.video_url);
    hote.innerHTML =
      (u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">Voir</a>` : `<span>lien invalide</span>`) +
      `<img src="${esc(urlSure(p.avatar_url) || "")}">` +
      `<img src="${esc(urlSure(p.av) || "")}">`;
    document.body.appendChild(hote);
    const attributs = [...hote.querySelectorAll("*")].flatMap((el) => [...el.attributes].map((x) => x.name));
    const hrefs = [...hote.querySelectorAll("a")].map((el) => el.getAttribute("href") || "");
    const srcs = [...hote.querySelectorAll("img")].map((el) => el.getAttribute("src") || "");
    hote.remove();
    return { pwn: window.__PWN, attributs, hrefs, srcs };
  }, charge);

  const court = charge.slice(0, 26).replace(/\n/g, " ");
  t(`« ${court}… » : aucun gestionnaire injecté`,
    !res.attributs.some((a) => /^on/i.test(a)), res.attributs.join(","));
  t(`« ${court}… » : rien n'est exécuté`, res.pwn === 0);
  t(`« ${court}… » : aucun schéma dangereux dans href/src`,
    ![...res.hrefs, ...res.srcs].some((v) => /^\s*(javascript|data|vbscript):/i.test(v)),
    [...res.hrefs, ...res.srcs].join(" | "));
}

// ── 3. Le cas legitime continue de marcher ──────────────────────────────────
console.log("\n3. Un lien normal reste cliquable");
const normal = await page.evaluate(() => {
  const u = urlSure("https://drive.google.com/drive/folders/abc");
  const d = document.createElement("div");
  d.innerHTML = `<a href="${esc(u)}">Voir</a>`;
  const href = d.querySelector("a").getAttribute("href");
  return href;
});
t("une URL Drive légitime survit intacte", normal === "https://drive.google.com/drive/folders/abc", normal);

// ── 4. L'ecran utilise reellement le filtre ─────────────────────────────────
//
// Les sections precedentes prouvent que urlSure() fonctionne, pas que les gabarits s'en
// servent. Sans ce controle sur le source, quelqu'un pourrait recabler une URL brute demain et
// le test resterait vert. On interdit donc le motif fautif lui-meme.
console.log("\n4. Aucun href/src ne recoit plus d'URL brute");
const source = html.replace(/^\s*\/\/.*$/gm, "");   // on ignore les commentaires
const motifs = [
  ['href="${a.video_url}"', "avis client"],
  ['src="${p.avatar_url}"', "avatar profil"],
  ['src="${c.avatar_url}"', "avatar collaborateur"],
  ['src="${p.av}"', "avatar messagerie"],
  ['src="${who.av}"', "avatar interlocuteur"],
  ['href="${s.lien_visio}"', "lien visio formation"],
];
for (const [motif, quoi] of motifs) {
  t(`${quoi} : plus d'URL brute dans le gabarit`, !source.includes(motif), motif);
}
const restants = [...source.matchAll(/(href|src)="\$\{([^{}]{1,120})\}/g)]
  .map((m) => m[2].trim())
  .filter((e) => !/esc\(|urlSure\(|encodeURI|DATAURI|GAL_CLUBPLUS_URL|_escMsgHtml|createObjectURL|^url$|mapsUrl|telUrl|docsUrl|pennylane_public_url/.test(e));
t("aucun autre href/src non filtré n'a été ajouté", restants.length === 0, restants.join(" | "));

t("aucune erreur JavaScript pendant tout le test", erreursJs.length === 0, erreursJs.join(" / "));

console.log(`\n${ok}/${ok + ko} verifications passees.`);
await nav.close();
srv.close();
process.exit(ko ? 1 : 0);
