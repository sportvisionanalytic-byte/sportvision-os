// Les briques visuelles communes (22/09/2026).
//
// Ecrites une fois ici plutot que copiees d'ecran en ecran : c'est la dispersion des styles qui,
// sur le site, a fini par produire trois boutons legerement differents pour la meme action.
import React from "react";
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View,
  type TextInputProps, type ViewStyle,
} from "react-native";
import { C, E, R } from "../theme/couleurs";

export function Titre({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <Text style={[s.titre, style as never]}>{children}</Text>;
}
export function SousTitre({ children }: { children: React.ReactNode }) {
  return <Text style={s.sousTitre}>{children}</Text>;
}
export function Texte({ children, doux }: { children: React.ReactNode; doux?: boolean }) {
  return <Text style={doux ? s.texteDoux : s.texte}>{children}</Text>;
}

export function Champ({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: E.xs }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        placeholderTextColor={C.texteFaible}
        style={s.champ}
        // Le clavier ne doit jamais proposer de majuscule sur une adresse : c'est la premiere
        // cause d'echec de connexion sur telephone.
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
      />
    </View>
  );
}

export function Bouton({
  titre, onPress, enCours, secondaire, desactive,
}: { titre: string; onPress: () => void; enCours?: boolean; secondaire?: boolean; desactive?: boolean }) {
  const inactif = desactive || enCours;
  return (
    <Pressable
      onPress={inactif ? undefined : onPress}
      style={({ pressed }) => [
        s.bouton,
        secondaire ? s.boutonSecondaire : s.boutonPrincipal,
        // Le retour au toucher : sans lui, on ne sait pas si l'appui a ete pris en compte, et on
        // appuie deux fois.
        pressed && !inactif ? { opacity: 0.75 } : null,
        inactif ? { opacity: 0.5 } : null,
      ]}
    >
      {enCours ? <ActivityIndicator color={secondaire ? C.texte : "#fff"} />
        : <Text style={[s.boutonTexte, secondaire && { color: C.texte }]}>{titre}</Text>}
    </Pressable>
  );
}

export function Carte({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.carte, style]}>{children}</View>;
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
  titre: { color: C.texte, fontSize: 27, fontWeight: "800", letterSpacing: -0.5 },
  sousTitre: { color: C.texteDoux, fontSize: 15, lineHeight: 22 },
  texte: { color: C.texte, fontSize: 15 },
  texteDoux: { color: C.texteDoux, fontSize: 14, lineHeight: 20 },
  label: { color: C.texteDoux, fontSize: 12.5, fontWeight: "600" },
  champ: {
    height: 52, borderRadius: R.m, paddingHorizontal: E.m,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
    color: C.texte, fontSize: 16,
  },
  bouton: { height: 52, borderRadius: R.m, alignItems: "center", justifyContent: "center" },
  boutonPrincipal: { backgroundColor: C.accent },
  boutonSecondaire: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.bordureForte },
  boutonTexte: { color: "#fff", fontSize: 16, fontWeight: "700" },
  carte: {
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1,
    borderColor: C.bordure, padding: E.m,
  },
  erreur: {
    backgroundColor: "rgba(240,68,94,.12)", borderWidth: 1, borderColor: "rgba(240,68,94,.35)",
    borderRadius: R.m, padding: E.m,
  },
  erreurTexte: { color: "#FFB4BD", fontSize: 13.5, lineHeight: 19 },
});
