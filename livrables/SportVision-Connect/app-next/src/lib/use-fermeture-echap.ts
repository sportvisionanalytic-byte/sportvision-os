"use client";

import { useEffect } from "react";

/**
 * Échap ferme la fenêtre.
 *
 * ── Pourquoi ce fichier existe ──
 * Au 10/09/2026, Club+ comptait quinze fenêtres modales et AUCUNE ne réagissait à Échap. Relevé
 * pendant l'audit de pré-lancement : l'assistant d'onboarding s'ouvre en plein écran, intercepte
 * tous les clics, et ni Échap ni un clic sur le voile n'en sortent — seul un bouton précis. Une
 * personne qui ne le voit pas croit l'application bloquée.
 *
 * Décision de Fouka : « Échap doit fermer l'assistant / les modales principales. C'est très rapide
 * et ça évite une mauvaise habitude dans les composants. » D'où un utilitaire partagé plutôt que
 * quinze copies du même useEffect, qui auraient divergé à la première modification.
 *
 * ── Ce qu'il fait, et ce qu'il ne fait pas ──
 * L'écouteur est posé sur `document` en phase de capture, pour répondre même quand le focus est
 * dans un champ de la fenêtre. Il ne se pose que lorsque `actif` vaut true : une fenêtre fermée ne
 * doit pas écouter le clavier de toute la page.
 *
 * Il ne touche PAS au voile : cliquer à côté ne ferme rien, et c'est volontaire. Sur un formulaire
 * à moitié rempli, un clic maladroit qui efface la saisie est pire que pas de raccourci du tout.
 *
 * @param actif    la fenêtre est-elle ouverte
 * @param fermer   ce qu'il faut appeler pour la fermer
 */
export function useFermetureEchap(actif: boolean, fermer: () => void) {
  useEffect(() => {
    if (!actif) return;

    function surTouche(evenement: KeyboardEvent) {
      if (evenement.key !== "Escape") return;
      // `defaultPrevented` : un composant interne (une liste déroulante ouverte dans la fenêtre)
      // a déjà traité la touche pour se refermer lui-même. Fermer la fenêtre entière par-dessus
      // ferait disparaître deux choses d'un seul appui.
      if (evenement.defaultPrevented) return;
      evenement.preventDefault();
      fermer();
    }

    document.addEventListener("keydown", surTouche, true);
    return () => document.removeEventListener("keydown", surTouche, true);
  }, [actif, fermer]);
}
