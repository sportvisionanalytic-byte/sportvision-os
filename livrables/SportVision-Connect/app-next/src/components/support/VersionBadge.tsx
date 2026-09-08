"use client";

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
  const commit = process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "?";
  const contexte = process.env.NEXT_PUBLIC_BUILD_CONTEXT ?? "?";
  const brut = process.env.NEXT_PUBLIC_BUILD_DATE;

  // `timeZone` explicite, et c'est tout l'enjeu de ce composant (08/09/2026).
  //
  // Sans lui, toLocaleString suit le fuseau de la machine : UTC sur le serveur Netlify, Europe/Paris
  // dans le navigateur. Le serveur ecrivait « 14:18 », le client « 16:18 » — et React, constatant
  // que le texte differe, JETAIT tout le document rendu par le serveur pour le refaire cote client
  // (« The server HTML was replaced with client content in #document »). Sur toutes les pages.
  //
  // C'est ce qui pouvait faire apparaitre puis disparaitre des elements pendant une fraction de
  // seconde. Un horodatage de diagnostic ne doit pas couter le rendu serveur de l'application
  // entiere.
  //
  // Europe/Paris plutot que UTC : c'est le fuseau des utilisateurs, et celui que suppose deja tout
  // le reste du produit.
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
