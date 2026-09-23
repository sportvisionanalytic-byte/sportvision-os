// Le sélecteur d'enfant, commun aux trois onglets du parent.
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFamille } from "../lib/famille";
import { C, E, R, TOUCHE } from "../theme/couleurs";
import { P } from "../theme/polices";

export function SelecteurEnfant() {
  const { sportifs, choisi, choisir } = useFamille();
  // Un seul enfant : le choix n'existe pas, on n'affiche pas une barre pour un bouton unique.
  if (sportifs.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: E.s, paddingRight: E.l }}>
      {sportifs.map((s) => {
        const actif = choisi?.refId === s.refId && choisi?.kind === s.kind;
        return (
          <Pressable
            key={`${s.kind}:${s.refId}`}
            onPress={() => choisir(s)}
            accessibilityRole="button"
            accessibilityState={{ selected: actif }}
            accessibilityLabel={`Voir ${s.prenom}${s.enAttente ? ", rattachement en attente" : ""}`}
            style={[st.puce, actif && st.puceActive]}
          >
            <Text style={[st.texte, actif && st.texteActif]}>{s.prenom}</Text>
            {s.enAttente ? <View style={st.point} /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Le bandeau « vous consultez X » quand le parent n'a qu'un enfant, pour lever l'ambiguïté. */
export function BandeauEnfant() {
  const { choisi } = useFamille();
  if (!choisi) return null;
  return (
    <View style={st.bandeau}>
      <Text style={st.bandeauLabel}>Vous consultez</Text>
      <Text style={st.bandeauNom}>
        {choisi.prenom} {choisi.nom}
        {choisi.categorie ? ` · ${choisi.categorie}` : ""}
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  puce: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: E.m, height: TOUCHE, borderRadius: R.pill,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  puceActive: { backgroundColor: "rgba(79,125,255,.18)", borderColor: "rgba(79,125,255,.5)" },
  texte: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: 13.5 },
  texteActif: { color: C.texte },
  point: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.alerte },
  bandeau: { gap: 2 },
  bandeauLabel: { color: C.texteFaible, fontFamily: P.texteFort, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 },
  bandeauNom: { color: C.texte, fontFamily: P.titreFort, fontSize: 15.5 },
});
