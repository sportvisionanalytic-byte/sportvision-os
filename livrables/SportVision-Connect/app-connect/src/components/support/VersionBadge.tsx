"use client";

import { BUILD_COMMIT, BUILD_CONTEXT, BUILD_DATE } from "@/lib/build-info";

// Marqueur de version, discret, en bas d'écran.
//
// Il ne sert qu'au support : quand quelqu'un dit « je ne vois pas le nouveau bouton », on compare
// deux chaînes au lieu de supposer. Les valeurs sont figées AU BUILD (next.config), donc elles
// décrivent le code réellement servi — pas ce que la base ou le dépôt contiennent.
//
// Volontairement en texte gris minuscule et non un badge coloré : ce n'est pas une information
// pour le client, c'est un outil de diagnostic qui doit se trouver quand on le cherche et
// disparaître le reste du temps.

export function VersionBadge() {
  // Constantes figees au build (scripts/figer-build.mjs). Passer par process.env ne
  // suffisait pas : le serveur relit next.config a l execution et reevaluait la date a
  // chaque rendu, ce qui faisait diverger serveur et client d une minute a l autre.
  const commit = BUILD_COMMIT;
  const contexte = BUILD_CONTEXT;
  const brut = BUILD_DATE;

  // `timeZone` explicite : sans lui, toLocaleString suit le fuseau de la machine — UTC sur le
  // serveur, Europe/Paris dans le navigateur. Le texte differait, et React jetait tout le document
  // rendu par le serveur pour le refaire cote client, sur chaque page. Meme correctif que dans
  // Club+ (08/09/2026), le composant est jumeau.
  const quand = brut
    ? new Date(brut).toLocaleString("fr-FR", {
        timeZone: "Europe/Paris",
        day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : "";
  const libelle =
    (contexte === "production" ? "Production" : contexte === "local" ? "Local" : contexte) +
    ` · build ${commit}` + (quand ? ` · ${quand}` : "");

  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(libelle).catch(() => {})}
      title="Version déployée — cliquer pour copier"
      className="w-full px-3 py-2 text-left text-[9.5px] text-text-faint/70 hover:text-text-tertiary"
    >
      {libelle}
    </button>
  );
}
