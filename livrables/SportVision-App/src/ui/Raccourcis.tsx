// Les raccourcis de l'accueil (22/09/2026).
//
// Une règle tenue : aucun raccourci ne mène à un écran qui n'existe pas. Trois destinations
// réelles valent mieux que six cases dont la moitié ne répond pas.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { C, E, R } from "../theme/couleurs";
import { P } from "../theme/polices";

export interface Raccourci {
  icone: keyof typeof Ionicons.glyphMap;
  libelle: string;
  teinte: string;
  onPress: () => void;
}

export function Raccourcis({ elements }: { elements: Raccourci[] }) {
  return (
    <View style={s.rangee}>
      {elements.map((r) => (
        <Pressable
          key={r.libelle}
          onPress={r.onPress}
          accessibilityRole="button"
          accessibilityLabel={r.libelle}
          style={({ pressed }) => [s.case_, pressed ? { opacity: 0.8, borderColor: r.teinte + "66" } : null]}
        >
          <View style={[s.rond, { backgroundColor: r.teinte + "22" }]}>
            <Ionicons name={r.icone} size={19} color={r.teinte} />
          </View>
          {/* LE LIBELLÉ PREND TOUTE LA CASE, ET SE RÉDUIT PLUTÔT QUE DE SE COUPER (30/09/2026).
              Constaté sur le simulateur, écran d'accueil du club : « Galeries » s'affichait
              « Galeri… » et « Communication » « Communicat… ». Sans `alignSelf: stretch`, le texte
              est mesuré hors du cadre de la case et se coupe bien avant d'en atteindre le bord. Un
              mot tronqué au milieu n'est pas une étiquette, c'est une énigme. */}
          <Text
            style={s.libelle}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
          >
            {r.libelle}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  rangee: { flexDirection: "row", gap: E.s },
  case_: {
    flex: 1, alignItems: "center", gap: E.s, paddingVertical: E.m,
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, borderColor: C.bordure,
  },
  rond: { width: 40, height: 40, borderRadius: R.m, alignItems: "center", justifyContent: "center" },
  libelle: { alignSelf: "stretch", textAlign: "center", paddingHorizontal: 2, color: C.texte, fontFamily: P.texteFort, fontSize: 12.5 },
});
