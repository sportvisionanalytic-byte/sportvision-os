// Les initiales d'une personne, dans un carré. Repris de l'application des familles, où le même
// composant sert aux clubs — même forme, même rayon, même fond : c'est ce qui fait que les deux
// applications se ressemblent sans qu'on sache dire pourquoi.
//
// LA PHOTO EST ARRIVÉE ICI, ET PAS DANS UN COMPOSANT VOISIN (01/10/2026). `Ecusson` est déjà posé
// à six endroits : « Mon espace », la messagerie deux fois, le Centre, l'équipe et l'affectation.
// Écrire un « Avatar » à côté aurait donné deux ronds légèrement différents pour la même personne,
// ce qui est exactement le reproche numéro un de Fouka. `photo` est FACULTATIF : les six appels
// existants continuent de dessiner les initiales, et gagnent l'image le jour où on la leur passe.
//
// Mesuré en base : 5 profils sur 19 portent un `avatar_url`, tous au format embarqué
// `data:image/jpeg;base64,…` écrit par l'OS. `expo-image` lit ce format comme une adresse
// ordinaire. Les initiales restent DESSOUS plutôt qu'à la place : si l'image ne se décode pas,
// on voit « AB » et pas un carré vide.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { C, R } from "../theme/couleurs";
import { P } from "../theme/polices";

export function Ecusson({
  nom, taille = 46, photo,
}: { nom?: string | null; taille?: number; photo?: string | null }) {
  const initiales = (nom ?? "")
    .split(/\s+/)
    .map((m) => m.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .map((m) => m[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);

  const source = (photo ?? "").trim();

  return (
    <View style={[s.boite, { width: taille, height: taille, borderRadius: R.m }]}>
      <Text style={[s.texte, { fontSize: taille * 0.36 }]}>{initiales || "?"}</Text>
      {source ? (
        <Image
          source={{ uri: source }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          // Pas de fondu : cet écusson apparaît dans des listes qui défilent, et une image qui
          // s'allume à chaque ligne fait clignoter la liste entière.
          transition={0}
          accessibilityLabel={nom ? `Photo de ${nom}` : "Photo de profil"}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  boite: {
    alignItems: "center", justifyContent: "center", overflow: "hidden",
    backgroundColor: "rgba(255,255,255,.06)", borderWidth: 1, borderColor: C.bordure,
  },
  texte: { color: C.texteDoux, fontFamily: P.titreFort, letterSpacing: 0.5 },
});
