// Lance suppression-compte-client.test.sql dans une transaction ANNULÉE, précédé de la migration
// migration-decisions-connect-v1-suppression-compte-client.sql (non exécutée en production à
// l'écriture de ce test, 10/09/2026). Rien n'est conservé : le fichier se termine par rollback.
//
// L'API Management s'exécute en postgres. Les vérifications de droits du fichier SQL changent de
// rôle (authenticated, anon, service_role) à l'intérieur de la transaction : ce sont les droits de
// ces rôles qui sont mesurés, pas ceux de postgres.
//
//   node livrables/SportVision-TV/tests/suppression-compte-client.test.mjs
//   MIGRATION=0 node livrables/SportVision-TV/tests/suppression-compte-client.test.mjs   (une fois la migration exécutée,
//                                                                                        ou pour voir le rouge avant)

import { readFileSync } from "node:fs";
import { env, SB } from "./_session-os.mjs";

const REF = SB.replace(/^https:\/\/([^.]+)\..*$/, "$1");
const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url).pathname, "utf8");
const test = lire("./suppression-compte-client.test.sql");
const migration = lire("../migration-decisions-connect-v1-suppression-compte-client.sql");

// Une seule transaction : on retire le begin/commit de la migration et le begin du test ; le
// rollback final du test annule tout, migration comprise.
const sansTransaction = (sql) => sql.split("\n").filter((l) => !/^\s*(begin|commit);\s*$/i.test(l)).join("\n");
const requete = process.env.MIGRATION === "0"
  ? test
  : "begin;\n" + sansTransaction(migration) + "\n" + sansTransaction(test).replace(/\n\s*rollback;\s*$/i, "") + "\nrollback;\n";

const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: requete }),
});
const corps = await r.text();
let verdict = null;
try { verdict = JSON.parse(corps)?.[0]?.verdict ?? null; } catch {}
if (r.ok && verdict?.startsWith("OK")) {
  console.log(`  ok   ${verdict}`);
  process.exit(0);
}
console.log(`  KO   HTTP ${r.status}\n${corps.replace(/\\n/g, "\n").slice(0, 2000)}`);
process.exit(1);
