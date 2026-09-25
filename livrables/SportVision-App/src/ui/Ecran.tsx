// Le cadre commun a tous les ecrans : marges du telephone, glisser pour rafraichir, etat vide.
import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Lueur } from "./Fond";
import { MODE_DEMO } from "../lib/demonstration";
import { C, E, R } from "../theme/couleurs";
import { P } from "../theme/polices";

export function Ecran({
  children, rafraichir, enCours, style, teinte,
}: {
  children: React.ReactNode;
  rafraichir?: () => void;
  enCours?: boolean;
  style?: ViewStyle;
  teinte?: "violet" | "cyan" | "bleu";
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: C.fond }}>
    <Lueur teinte={teinte} />
    <ScrollView
      style={{ flex: 1, backgroundColor: "transparent" }}
      contentContainerStyle={[
        // L'encoche en haut, la barre d'onglets en bas : sans ces marges, le titre passe sous
        // l'heure du telephone et la derniere ligne sous les onglets — constate sur « Se
        // deconnecter », coupe en deux par la barre.
        {
          paddingTop: insets.top + E.m,
          paddingBottom: insets.bottom + 72 + E.l,
          paddingHorizontal: E.l,
          gap: E.l,
        },
        style,
      ]}
      refreshControl={
        rafraichir
          ? <RefreshControl refreshing={!!enCours} onRefresh={rafraichir} tintColor={C.texteDoux} />
          : undefined
      }
    >
      {/* Personne ne doit croire que ces chiffres sont les siens. */}
      {MODE_DEMO ? (
        <View style={s.demo}>
          <Text style={s.demoTexte}>Mode démonstration · données fictives</Text>
        </View>
      ) : null}
      {children}
    </ScrollView>
    </View>
  );
}

export function Section({ titre, action, children }: { titre: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ gap: E.s }}>
      <View style={s.enteteSection}>
        <Text style={s.titreSection}>{titre}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

/**
 * Le chargement a échoué. À ne jamais confondre avec un état vide : « votre club n'a rien publié »
 * et « je n'ai pas pu joindre le serveur » n'appellent pas la même réaction de la personne.
 */
export function Probleme({ surReessayer }: { surReessayer?: () => void }) {
  return (
    <View style={s.probleme}>
      <Text style={s.problemeTitre}>Chargement impossible</Text>
      <Text style={s.problemeTexte}>
        Vérifiez votre connexion, puis réessayez. Si cela se reproduit, fermez et rouvrez
        l'application : votre session a peut-être expiré.
      </Text>
      {surReessayer ? (
        <Pressable onPress={surReessayer} accessibilityRole="button" accessibilityLabel="Réessayer le chargement" style={s.reessayer} hitSlop={8}>
          <Text style={s.reessayerTexte}>Réessayer</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Un vide explique vaut mieux qu'une page blanche : on dit pourquoi, pas seulement « rien ». */
export function Vide({ titre, texte }: { titre: string; texte: string }) {
  return (
    <View style={s.vide}>
      <Text style={s.videTitre}>{titre}</Text>
      <Text style={s.videTexte}>{texte}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  demo: {
    alignSelf: "flex-start", paddingHorizontal: E.s, paddingVertical: 5, borderRadius: R.pill,
    backgroundColor: "rgba(232,163,61,.14)", borderWidth: 1, borderColor: "rgba(232,163,61,.3)",
  },
  demoTexte: { color: C.alerteTexte, fontFamily: P.texteFort, fontSize: 11.5 },
  enteteSection: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: E.s },
  titreSection: { color: C.texte, fontFamily: P.titre, fontSize: 20, letterSpacing: -0.4 },
  vide: {
    borderWidth: 1, borderColor: C.bordureForte, borderStyle: "dashed", borderRadius: R.l,
    backgroundColor: "rgba(255,255,255,.035)", padding: E.l, gap: E.xs,
  },
  videTitre: { color: C.texte, fontFamily: P.titreFort, fontSize: 16 },
  probleme: {
    borderWidth: 1, borderColor: "rgba(240,68,94,.32)", borderRadius: R.l,
    backgroundColor: "rgba(240,68,94,.07)", padding: E.l, gap: E.s,
  },
  problemeTitre: { color: C.dangerTexte, fontFamily: P.titreFort, fontSize: 16 },
  problemeTexte: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
  reessayer: {
    alignSelf: "flex-start", minHeight: 40, justifyContent: "center",
    paddingHorizontal: E.m, borderRadius: R.pill,
    backgroundColor: "rgba(255,255,255,.08)", borderWidth: 1, borderColor: C.bordureForte,
  },
  reessayerTexte: { color: C.texte, fontFamily: P.texteFort, fontSize: 13.5 },
  videTexte: { color: C.texteDoux, fontFamily: P.texte, fontSize: 14, lineHeight: 20 },
});
