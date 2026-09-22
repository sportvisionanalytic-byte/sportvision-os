// Les briques visuelles communes (22/09/2026, charte SportVision).
//
// Écrites une fois ici plutôt que copiées d'écran en écran : c'est la dispersion des styles qui,
// sur le site, a fini par produire trois boutons légèrement différents pour la même action.
import React from "react";
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View,
  type TextInputProps, type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { C, DEGRADE, E, R, TOUCHE } from "../theme/couleurs";
import { P } from "../theme/polices";

export function Titre({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <Text style={[s.titre, style as never]}>{children}</Text>;
}
export function SousTitre({ children }: { children: React.ReactNode }) {
  return <Text style={s.sousTitre}>{children}</Text>;
}
export function Texte({ children, doux }: { children: React.ReactNode; doux?: boolean }) {
  return <Text style={doux ? s.texteDoux : s.texte}>{children}</Text>;
}

/** L'étiquette d'une section : petite, espacée, jamais un titre déguisé. */
export function Etiquette({ children, couleur }: { children: React.ReactNode; couleur?: string }) {
  return <Text style={[s.etiquette, couleur ? { color: couleur } : null]}>{children}</Text>;
}

export function Champ({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: E.xs }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        placeholderTextColor={C.texteFaible}
        style={s.champ}
        // Le clavier ne doit jamais proposer de majuscule sur une adresse : c'est la première
        // cause d'échec de connexion sur téléphone.
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
      />
    </View>
  );
}

export function Bouton({
  titre, onPress, enCours, secondaire, discret, desactive, icone,
}: {
  titre: string;
  onPress: () => void;
  enCours?: boolean;
  secondaire?: boolean;
  discret?: boolean;
  desactive?: boolean;
  icone?: React.ReactNode;
}) {
  const inactif = desactive || enCours;
  const contenu = enCours
    ? <ActivityIndicator color={secondaire || discret ? C.texte : "#fff"} />
    : (
      <View style={s.boutonContenu}>
        {icone}
        <Text style={[s.boutonTexte, (secondaire || discret) && { color: C.texte }]}>{titre}</Text>
      </View>
    );

  // L'action principale porte le dégradé de la marque. Les autres restent sobres : si tout brille,
  // plus rien ne guide.
  if (!secondaire && !discret) {
    return (
      <Pressable
        onPress={inactif ? undefined : onPress}
        style={({ pressed }) => [pressed && !inactif ? { opacity: 0.85 } : null, inactif ? { opacity: 0.45 } : null]}
      >
        <LinearGradient
          colors={DEGRADE as unknown as [string, string, string]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={s.bouton}
        >
          {contenu}
        </LinearGradient>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={inactif ? undefined : onPress}
      style={({ pressed }) => [
        s.bouton,
        discret ? s.boutonDiscret : s.boutonSecondaire,
        pressed && !inactif ? { opacity: 0.75 } : null,
        inactif ? { opacity: 0.45 } : null,
      ]}
    >
      {contenu}
    </Pressable>
  );
}

export function Carte({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.carte, style]}>{children}</View>;
}

/** Une pastille d'état : toujours un mot, jamais une couleur seule. */
export function Pastille({
  texte, ton = "neutre",
}: { texte: string; ton?: "neutre" | "succes" | "alerte" | "danger" | "info" }) {
  const couleur = ton === "succes" ? C.succes : ton === "alerte" ? C.alerte
    : ton === "danger" ? C.danger : ton === "info" ? C.cyan : C.texteDoux;
  return (
    <View style={[s.pastille, { backgroundColor: couleur + "1F", borderColor: couleur + "4D" }]}>
      <Text style={[s.pastilleTexte, { color: couleur }]}>{texte}</Text>
    </View>
  );
}

export function Erreur({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <View style={s.erreur}>
      <Text style={s.erreurTexte}>{message}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  titre: { color: C.texte, fontFamily: P.titre, fontSize: 27, letterSpacing: -0.6 },
  sousTitre: { color: C.texteDoux, fontFamily: P.texte, fontSize: 15, lineHeight: 22 },
  texte: { color: C.texte, fontFamily: P.texte, fontSize: 15 },
  texteDoux: { color: C.texteDoux, fontFamily: P.texte, fontSize: 14, lineHeight: 20 },
  etiquette: {
    color: C.cyan, fontFamily: P.texteFort, fontSize: 11,
    textTransform: "uppercase", letterSpacing: 1,
  },
  label: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 12.5 },
  champ: {
    height: 52, borderRadius: R.l, paddingHorizontal: E.m,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
    color: C.texte, fontFamily: P.texte, fontSize: 16,
  },
  bouton: { minHeight: TOUCHE + 8, borderRadius: R.l, alignItems: "center", justifyContent: "center", paddingHorizontal: E.m },
  boutonContenu: { flexDirection: "row", alignItems: "center", gap: E.s },
  boutonSecondaire: { borderWidth: 1, borderColor: C.bordureForte, backgroundColor: "rgba(255,255,255,.05)" },
  boutonDiscret: { backgroundColor: "transparent" },
  boutonTexte: { color: "#fff", fontFamily: P.titreFort, fontSize: 15.5 },
  carte: {
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1,
    borderColor: C.bordure, padding: E.m,
  },
  pastille: { paddingHorizontal: E.s, paddingVertical: 5, borderRadius: R.pill, borderWidth: 1 },
  pastilleTexte: { fontFamily: P.texteFort, fontSize: 11.5 },
  erreur: {
    backgroundColor: "rgba(240,68,94,.12)", borderWidth: 1, borderColor: "rgba(240,68,94,.35)",
    borderRadius: R.l, padding: E.m,
  },
  erreurTexte: { color: "#FFB4BD", fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
});
