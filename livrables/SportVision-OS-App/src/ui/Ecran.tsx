// Le cadre commun a tous les ecrans : marges du telephone, glisser pour rafraichir, etat vide.
import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Lueur } from "./Fond";
import { retourner } from "../lib/retour";
import { C, E, R } from "../theme/couleurs";
import { P } from "../theme/polices";

export function Ecran({
  children, rafraichir, enCours, style, teinte, retour, retourLibelle,
}: {
  children: React.ReactNode;
  rafraichir?: () => void;
  enCours?: boolean;
  style?: ViewStyle;
  teinte?: "violet" | "cyan" | "bleu";
  /**
   * LA SORTIE D'UN ÉCRAN QUI N'EST PAS UN ONGLET (30/09/2026).
   *
   * Cinq écrans de l'OS ne tiennent pas dans la barre du bas — elle en porte cinq, l'application
   * en compte dix. On les atteint depuis « Mon espace », et sans cette flèche on n'en sortirait
   * QUE par un onglet : un écran dont la sortie n'est pas là où on est entré.
   *
   * La valeur est le REPLI, pas la destination : `retourner` recule d'un cran quand il y a un
   * cran, et ne se rabat sur ce chemin que si la pile est vide (notification, lien, application
   * relancée sur son dernier écran). La règle vit dans `src/lib/retour.ts`, pas ici.
   */
  retour?: string;
  retourLibelle?: string;
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
      {retour ? (
        <Pressable
          onPress={() => retourner(retour)}
          accessibilityRole="button"
          accessibilityLabel={`Revenir à ${retourLibelle ?? "Mon espace"}`}
          hitSlop={8}
          style={({ pressed }) => [s.retour, pressed ? { opacity: 0.7 } : null]}
        >
          <Ionicons name="chevron-back" size={18} color={C.texteDoux} />
          <Text style={s.retourTexte}>{retourLibelle ?? "Mon espace"}</Text>
        </Pressable>
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
  // La meme rangee que le retour d'une galerie : une seule facon de reculer dans toute l'app.
  retour: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start", marginBottom: -E.s },
  retourTexte: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 14 },
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
