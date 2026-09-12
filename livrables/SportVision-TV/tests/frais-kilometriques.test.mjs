// Le montant suit le kilometrage (12/09/2026, signale par Fouka : « je change les kilometres et
// le tarif ne change pas »).
//
// LE DEFAUT. Le calcul automatique ne s'appliquait QUE si le champ Montant etait vide
// (`if(m&&!m.value)`). Or il se remplissait lui-meme des la premiere saisie : corriger ensuite le
// kilometrage ne changeait plus rien. On tapait 20 km, on corrigeait a 80, et le montant restait
// celui de 20. Le taux etait en plus ecrit en dur dans l'attribut HTML, a deux endroits.
//
// Ce test execute la vraie fonction du fichier de l'OS, avec un faux document : pas de copie de la
// regle ici, sinon le test ne surveillerait que lui-meme.
import { readFileSync } from "node:fs";
const html = readFileSync(new URL("../SportVision-OS-Full.html", import.meta.url), "utf8");
const bloc = html.match(/const TAUX_KM = [\s\S]*?\n}\n/)[0];

const champs = { "frais-km": { value: "", dataset: {} }, "frais-montant": { value: "", dataset: {} } };
globalThis.document = { getElementById: (id) => champs[id] ?? null };
const { fraisRecalculerMontant } = await import("data:text/javascript," + encodeURIComponent(bloc + "\nexport { fraisRecalculerMontant };"));

let ko = 0;
const dit = (n, ok, d = "") => { if (!ok) ko++; console.log((ok ? "OK   " : "KO   ") + n + (d ? "  (" + d + ")" : "")); };

champs["frais-km"].value = "20"; fraisRecalculerMontant();
dit("20 km donnent 6,50 €", champs["frais-montant"].value === 6.5, String(champs["frais-montant"].value));

// Le geste de Fouka : corriger le kilometrage apres coup.
champs["frais-km"].value = "80"; fraisRecalculerMontant();
dit("corriger a 80 km met bien a jour le montant", champs["frais-montant"].value === 26, String(champs["frais-montant"].value));

// Un montant saisi a la main fait foi et n'est plus ecrase.
champs["frais-montant"].dataset.manuel = "1";
champs["frais-montant"].value = 42;
champs["frais-km"].value = "10"; fraisRecalculerMontant();
dit("un montant saisi a la main n'est pas ecrase", champs["frais-montant"].value === 42, String(champs["frais-montant"].value));

// Effacer les km vide le montant calcule.
champs["frais-montant"].dataset.manuel = "0";
champs["frais-km"].value = ""; fraisRecalculerMontant();
dit("effacer les km vide le montant calcule", champs["frais-montant"].value === "", String(champs["frais-montant"].value));

console.log(ko === 0 ? "\ntout conforme" : `\n${ko} ecart(s)`);
process.exit(ko ? 1 : 0);
