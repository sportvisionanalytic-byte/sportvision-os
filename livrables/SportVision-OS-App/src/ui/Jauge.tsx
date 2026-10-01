// UNE BARRE DE PROGRESSION (01/10/2026).
//
// POURQUOI UNE BRIQUE ET PAS UNE COPIE. Elle était écrite dans `formation.tsx`, et l'écran d'une
// formation en a besoin aussi, pour l'avancement des leçons et pour l'avancement d'un quiz en cours
// de réponse. Trois copies de dix lignes, c'est la fabrique à « trois barres légèrement différentes
// pour la même chose » que l'en-tête de `Base.tsx` raconte.
//
// À NE PAS CONFONDRE AVEC `Barre` : celle-là est une rangée de puces qui navigue, celle-ci est une
// jauge qui se remplit. Les deux noms sont proches, les deux objets n'ont rien à voir.
import React from "react";
import { StyleSheet, View } from "react-native";
import { C, R } from "../theme/couleurs";

export function Jauge({ avancement, couleur }: { avancement: number; couleur: string }) {
  return (
    <View
      style={s.barre}
      accessibilityRole="progressbar"
      accessibilityValue={{ now: avancement, min: 0, max: 100 }}
    >
      {/* UNE JAUGE À ZÉRO DOIT QUAND MÊME SE LIRE COMME UNE JAUGE (01/10/2026, vu à l'écran).
          Avec 0 % de remplissage, il ne restait qu'un filet gris sur toute la largeur : on le lit
          comme un trait de séparation, pas comme « il reste tout à faire ». Deux pour cent de
          couleur au départ suffisent à dire que c'est une barre qui se remplit. La valeur annoncée
          à la lecture vocale, elle, reste le vrai avancement. */}
      <View
        style={[
          s.remplie,
          { width: `${Math.max(2, Math.min(100, avancement))}%`, backgroundColor: couleur },
        ]}
      />
    </View>
  );
}

const s = StyleSheet.create({
  barre: { height: 6, borderRadius: R.pill, backgroundColor: "rgba(255,255,255,.09)", overflow: "hidden" },
  remplie: { height: "100%", borderRadius: R.pill },
});
