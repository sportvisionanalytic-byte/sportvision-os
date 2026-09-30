// Les initiales d'une personne, dans un carré. Repris de l'application des familles, où le même
// composant sert aux clubs — même forme, même rayon, même fond : c'est ce qui fait que les deux
// applications se ressemblent sans qu'on sache dire pourquoi.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { C, R } from "../theme/couleurs";
import { P } from "../theme/polices";

export function Ecusson({ nom, taille = 46 }: { nom?: string | null; taille?: number }) {
  const initiales = (nom ?? "")
    .split(/\s+/)
    .map((m) => m.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .map((m) => m[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);

  return (
    <View style={[s.boite, { width: taille, height: taille, borderRadius: R.m }]}>
      <Text style={[s.texte, { fontSize: taille * 0.36 }]}>{initiales || "?"}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  boite: {
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.06)", borderWidth: 1, borderColor: C.bordure,
  },
  texte: { color: C.texteDoux, fontFamily: P.titreFort, letterSpacing: 0.5 },
});
