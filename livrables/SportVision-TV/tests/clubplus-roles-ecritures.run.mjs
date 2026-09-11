// Joue un test SQL dans UNE transaction annulée, avec ou sans une migration injectée juste après
// son `begin;`. Sert à prouver une migration AVANT de l'exécuter en production : rouge sans elle,
// vert avec elle, et les suites voisines toujours vertes avec elle.
//
//   node livrables/SportVision-TV/tests/clubplus-roles-ecritures.run.mjs                  (base actuelle)
//   AVEC_MIGRATION=1 node livrables/SportVision-TV/tests/clubplus-roles-ecritures.run.mjs (migration comprise)
//   TEST=cm-cloisonnement.test.sql AVEC_MIGRATION=1 node …                                (non-régression)
//
// Par défaut : tests/clubplus-roles-ecritures.test.sql et migration-decisions-clubplus-01.
// MIGRATION=<fichier> pour une autre migration du dossier SportVision-TV.
//
// L'API Management s'exécute en postgres : c'est pour cela que les tests basculent eux-mêmes en
// `authenticated` avec le `sub` de chaque personne avant chaque essai — la RLS s'applique alors
// comme sous PostgREST. Rien n'est jamais validé : le test se termine par `rollback`, et la
// migration injectée perd ses propres `begin;` / `commit;`.

import { readFileSync } from "node:fs";
import { env, SB } from "./_session-os.mjs";

const REF = SB.replace(/^https:\/\/([a-z0-9]+)\..*$/, "$1");
const ici = (f) => new URL(f, import.meta.url).pathname;
const TEST = process.env.TEST || "clubplus-roles-ecritures.test.sql";
const MIGRATION = process.env.MIGRATION || "migration-decisions-clubplus-01-ecritures-par-role.sql";
let sql = readFileSync(ici(`./${TEST}`), "utf8");

if (process.env.AVEC_MIGRATION === "1") {
  // MIGRATION peut en lister plusieurs, séparées par des virgules, jouées dans cet ordre (ex. les
  // deux temps de club-donnees-restreintes, qui ne s'exécutent jamais l'un sans l'autre).
  const migration = MIGRATION.split(",").map((f) => f.trim()).filter(Boolean)
    .map((f) => readFileSync(ici(`../${f}`), "utf8")
      .replace(/^\s*begin;\s*$/m, "")
      .replace(/^\s*commit;\s*$/m, ""))
    .join("\n");
  if (/^\s*(begin|commit);\s*$/im.test(migration)) throw new Error("la migration contient encore un begin/commit : elle serait validée");
  // Fonction de remplacement, pas chaîne : dans une chaîne de remplacement, « $$ » devient « $ »,
  // et tous les corps de fonction de la migration seraient cassés.
  sql = sql.replace(/^begin;$/m, () => `begin;\n${migration}\n`);
}
if (!/\nrollback;\s*$/.test(sql)) throw new Error("le test doit se terminer par rollback");

const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
const d = await r.json().catch(() => null);
const avec = process.env.AVEC_MIGRATION === "1" ? `avec ${MIGRATION}` : "sans migration";
if (!Array.isArray(d)) {
  // Les suites « à l'ancienne » lèvent une exception qui liste leurs échecs.
  console.log(`KO  ${TEST} (${avec}) :`, String(d?.message || JSON.stringify(d)).slice(0, 1500));
  process.exit(1);
}
if (d.length && "verdict" in d[0]) {
  console.log(`ok  ${TEST} (${avec}) : ${d[0].verdict}`);
  process.exit(0);
}
let ko = 0;
for (const v of d) {
  if (v.ok !== "✅") ko++;
  console.log(`  ${v.ok === "✅" ? "ok  " : "KO  "} ${v.controle}  (attendu ${v.attendu}, obtenu ${v.obtenu})`);
}
console.log(`\n${d.length - ko}/${d.length} verifications passees (${avec}).`);
process.exit(ko ? 1 : 0);
