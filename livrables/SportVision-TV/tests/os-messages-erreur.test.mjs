// Ce que l'utilisateur lit quand quelque chose echoue.
//
// Environ 180 endroits de l'OS ecrivaient `r.message||'Action impossible.'`. La phrase francaise
// n'etait donc utilisee que si Postgres ne disait rien, c'est-a-dire presque jamais : ce qui
// arrivait a l'ecran etait le message technique, avec les noms de tables et de contraintes.
//
// Le test verifie les deux moities du contrat : ce qui doit etre traduit l'est, et ce qui ne
// doit surtout pas l'etre (nos propres regles metier, redigees en francais) passe intact.

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
await page.goto(`http://localhost:${srv.address().port}/`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof msgErreur === "function");

let ok = 0, ko = 0;
const t = (nom, cond, detail = "") => {
  if (cond) { ok++; console.log(`  ok   ${nom}`); }
  else { ko++; console.log(`  KO   ${nom}${detail ? " — " + detail : ""}`); }
};
const trad = (err, repli) => page.evaluate(([e, r]) => msgErreur(e, r), [err, repli]);

// ── 1. Les erreurs techniques deviennent des phrases ────────────────────────
console.log("\n1. Les erreurs Postgres les plus frequentes");
const cas = [
  ["23505", 'duplicate key value violates unique constraint "clients_email_key"', "existe déjà"],
  ["23503", 'update or delete on table "clients" violates foreign key constraint "prestations_client_id_fkey"', "encore utilisé ailleurs"],
  ["23502", 'null value in column "nom" violates not-null constraint', "champ obligatoire"],
  ["42501", 'new row violates row-level security policy for table "prestations"', "droits nécessaires"],
  ["22P02", 'invalid input syntax for type uuid: "abc"', "bon format"],
  ["PGRST301", "JWT expired", "session a expiré"],
  ["57014", "canceling statement due to statement timeout", "trop de temps"],
];
for (const [code, brut, attendu] of cas) {
  const m = await trad({ code, message: brut }, "Action impossible.");
  t(`${code} → « ${m} »`, m.includes(attendu));
}

// ── 2. Rien de technique ne doit fuir a l'ecran ─────────────────────────────
console.log("\n2. Aucun detail technique ne parvient a l'utilisateur");
for (const [code, brut] of cas.map((c) => [c[0], c[1]])) {
  const m = await trad({ code, message: brut }, "Action impossible.");
  const fuite = /constraint|violates|null value|row-level|statement|invalid input|JWT|_key|_fkey|"/.test(m);
  t(`${code} ne laisse fuir ni nom de contrainte ni jargon`, !fuite, m);
}
const inconnu = await trad({ code: "XX999", message: 'PANIC: table "paiements" corrupted at block 42' }, "Mise à jour impossible.");
t("un code inconnu retombe sur la phrase de l'appelant", inconnu === "Mise à jour impossible.", inconnu);

// ── 3. Nos propres regles metier passent intactes ───────────────────────────
console.log("\n3. Les regles metier de nos fonctions SQL sont montrees telles quelles");
// RAISE EXCEPTION sans errcode donne P0001, et tous ces messages sont ecrits en francais
// pour l'utilisateur : les traduire reviendrait a les effacer.
for (const msg of [
  "Acceptation des CGV requise pour accepter ce devis",
  "Accès refusé : seul le staff SportVision peut créditer une organisation.",
  "Aucune invitation en attente trouvée pour ce club.",
]) {
  t(`« ${msg.slice(0, 44)}… » est conservé`, (await trad({ code: "P0001", message: msg }, "Action impossible.")) === msg);
}

// ── 4. Les cas ou il n'y a rien a traduire ──────────────────────────────────
console.log("\n4. Erreur reseau, erreur vide");
t("« Failed to fetch » devient une phrase sur le reseau",
  (await trad({ message: "Failed to fetch" }, "Action impossible.")).includes("Connexion perdue"));
t("NetworkError aussi",
  (await trad({ message: "NetworkError when attempting to fetch resource." }, "X")).includes("Connexion perdue"));
t("null retombe sur la phrase de l'appelant", (await trad(null, "Action impossible.")) === "Action impossible.");
t("sans phrase de repli, une formulation neutre", (await trad({ code: "XX999" }, undefined)) === "Action impossible.");

// ── 5. Le fichier n'affiche plus de message brut ────────────────────────────
console.log("\n5. Plus aucun affichage brut dans le fichier livre");
// Deux lectures brutes restent legitimes et sont donc exclues nommement :
//  - a l'interieur de msgErreur, qui doit bien examiner le message d'origine ;
//  - les deux endroits qui INSPECTENT le message pour decider d'un rattrapage (colonne
//    "description" pas encore migree) au lieu de l'afficher — cf. verification suivante.
const LEGITIMES = [/networkerror\|load failed/i, /\/description\/i\.test/];
const brutes = html.split("\n")
  .map((texte, i) => ({ n: i + 1, texte }))
  .filter((l) => /\b[A-Za-z_][A-Za-z0-9_]*\.message\s*\|\|\s*['"]/.test(l.texte)
    && !/^\s*(\/\/|\*)/.test(l.texte)
    && !LEGITIMES.some((re) => re.test(l.texte)));
t(`aucun \`x.message||'…'\` restant (${brutes.length} trouve(s))`, brutes.length === 0,
  brutes.slice(0, 3).map((l) => `l.${l.n}`).join(", "));

// Les deux endroits qui inspectent le message au lieu de l'afficher doivent avoir garde
// l'acces brut : les traduire rendrait leur test toujours faux, et le rattrapage silencieux.
const inspections = html.split("\n").filter((l) => /\/description\/i\.test\(r\.message/.test(l));
t("les tests logiques sur le message continuent de lire le message brut", inspections.length === 2, `${inspections.length} trouve(s)`);

console.log(`\n${ok}/${ok + ko} verifications passees.`);
await nav.close();
srv.close();
process.exit(ko ? 1 : 0);
