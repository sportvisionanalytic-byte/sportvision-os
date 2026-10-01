// LE CENTRE DE FORMATION : DEUX ÉCRANS, UNE PILE (01/10/2026).
//
// POURQUOI UN DOSSIER PLUTÔT QU'UN SEUL FICHIER. Jusqu'au 01/10, cet onglet était `formation.tsx`,
// un écran unique, et il ne pouvait rien ouvrir : le catalogue n'existait pas en base. Depuis les
// migrations v379 et v380, une formation porte jusqu'à 16 modules et 96 leçons, plus un quiz de 3 à
// 128 questions. Ça ne se déplie pas dans une carte : c'est un écran.
//
// LA PILE, PAS UNE SOUS-BARRE D'ONGLETS. Même raisonnement que `prod/_layout.tsx` : deux barres
// d'onglets empilées coûtent 100 points de hauteur sur 800. Et ici la relation est une vraie
// profondeur — on entre DANS une formation, on n'y navigue pas latéralement — donc on garde
// l'animation de glissement, contrairement aux quatre écrans de la production qui sont des onglets
// déguisés.
//
// `Tabs.Screen name="formation"` de `(app)/_layout.tsx` n'a pas eu besoin d'être touché : un
// dossier se monte sous le même nom qu'un fichier, exactement comme `prod`.
import React from "react";
import { Stack } from "expo-router";
import { C } from "../../../src/theme/couleurs";

export const unstable_settings = { initialRouteName: "index" };

export default function PileFormation() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: C.fond },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
