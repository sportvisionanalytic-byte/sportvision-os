// Un tarif ne doit jamais dire deux choses selon l'écran où on le lit (23/09/2026).
//
// Constat de l'audit du 23/09 : les tarifs Club+ vivaient à deux endroits sans lien entre eux.
// D'un côté `app-next/src/lib/plans.ts`, qui se présente lui-même comme « source de vérité
// unique » et qui alimente Club+ et Stripe. De l'autre la page `club-plus.html` du site
// vitrine, écrite à la main, que rien ne vérifiait.
//
// L'historique du fichier plans.ts raconte déjà trois désynchronisations réelles : des tarifs à
// 390 et 690 € qui n'ont jamais existé, une formule Performance sans engagement passée de 149 à
// 139 €, des crédits passés de 5/20 à 10/40. À chaque fois, un écran mentait à un client.
//
// On ne déplace pas ces prix en base : `catalogue_offres` sert aux prestations ponctuelles, et
// y glisser des abonnements les ferait apparaître comme réservables dans l'OS. On fait la seule
// chose qui protège vraiment : on vérifie que les deux endroits disent la même chose.
//
// Les prestations, elles, viennent déjà de la base et sont vérifiées ici aussi.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, "..", "..");

let ko = 0;
const verifier = (condition, message) => {
  if (condition) console.log("✅ " + message);
  else { console.log("❌ " + message); ko += 1; }
};

// ── Les tarifs de référence, lus dans le fichier qui fait foi ──────────────────────────────
const plans = readFileSync(
  join(racine, "SportVision-Connect", "app-next", "src", "lib", "plans.ts"), "utf8");

function tarif(code, champ) {
  // On isole le bloc de la formule, puis le champ demandé : chercher le champ dans tout le
  // fichier renverrait celui d'une autre formule.
  const bloc = plans.slice(plans.indexOf(`${code}: {`));
  const m = bloc.slice(0, 900).match(new RegExp(`${champ}:\\s*(\\d+)`));
  return m ? Number(m[1]) : null;
}

const attendus = {
  "Start, engagement 12 mois": tarif("club_plus_start", "monthlyPrice"),
  "Start, sans engagement": tarif("club_plus_start", "monthlyPriceNoCommitment"),
  "Performance, engagement 12 mois": tarif("club_plus_performance", "monthlyPrice"),
  "Performance, sans engagement": tarif("club_plus_performance", "monthlyPriceNoCommitment"),
};

for (const [quoi, valeur] of Object.entries(attendus)) {
  verifier(Number.isInteger(valeur) && valeur > 0, `plans.ts donne un tarif lisible pour ${quoi} : ${valeur} €`);
}

// ── Le site vitrine annonce-t-il les mêmes ? ───────────────────────────────────────────────
const vitrine = readFileSync(join(racine, "SportVision", "club-plus.html"), "utf8");

// L'espace insécable et l'espace ordinaire cohabitent dans la page : on accepte les deux.
const prixAffiches = new Set(
  [...vitrine.matchAll(/(\d{1,4})[  ]?€/g)].map((m) => Number(m[1])),
);

for (const [quoi, valeur] of Object.entries(attendus)) {
  verifier(prixAffiches.has(valeur), `le site affiche bien ${valeur} € pour ${quoi}`);
}

// Et surtout l'inverse : un prix d'abonnement affiché sur la page sans exister dans plans.ts
// est le signe qu'on a modifié le site et oublié l'application, ou le contraire.
const connus = new Set([
  ...Object.values(attendus),
  0,    // « Club+ Gratuit »
  120, 160, 180, 150, 40, // les prestations, qui viennent de catalogue_offres en base
  55, 70, // les formules de galerie photo, 2 et 3 matchs
  12,   // durée d'engagement en mois, pas un prix
]);
const inconnus = [...prixAffiches].filter((p) => !connus.has(p));
verifier(
  inconnus.length === 0,
  `aucun montant inexpliqué sur la page Club+${inconnus.length ? " (trouvés : " + inconnus.join(", ") + " €)" : ""}`,
);

console.log(ko === 0 ? "\nTout est vert." : `\n${ko} problème(s).`);
process.exit(ko === 0 ? 0 : 1);
