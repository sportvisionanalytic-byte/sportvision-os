// L'espace club et l'espace production, vus depuis un navigateur (22/09/2026).
//
// La vue web de React Native n'existe pas sur le web : l'ancienne version affichait un message
// technique en rouge, puis tournait sans fin. On explique à la place, dans la langue de la
// personne, et on lui rend la main.
import React, { forwardRef, useEffect, useImperativeHandle } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Bouton } from "./Base";
import { C, E, R } from "../theme/couleurs";
import { P } from "../theme/polices";
import type { PoigneeVueWeb, ProprietesVueWeb } from "./VueWeb";

export const VueWeb = forwardRef<PoigneeVueWeb, ProprietesVueWeb>(function VueWebNavigateur(
  { surChargement, surHistorique, surRetourChoix },
  ref,
) {
  // Rien ne charge : on éteint tout de suite la roue et le bouton de retour.
  useEffect(() => { surChargement(); surHistorique(false); }, [surChargement, surHistorique]);
  useImperativeHandle(ref, () => ({ reculer: () => {} }), []);

  return (
    <View style={s.page}>
      <View style={s.rond}>
        <Ionicons name="phone-portrait-outline" size={28} color={C.cyan} />
      </View>
      <Text style={s.titre}>Cet espace s'ouvre dans l'application</Text>
      <Text style={s.texte}>
        L'espace club et l'espace de production fonctionnent dans l'application SportVision, sur
        iPhone et sur Android. Cette démonstration web ne les ouvre pas.
      </Text>
      <Text style={s.faible}>
        Sur un téléphone, ils s'affichent ici même, avec un retour et le changement d'espace.
      </Text>
      <View style={{ alignSelf: "stretch", maxWidth: 340, paddingTop: E.s }}>
        <Bouton titre="Revenir au choix d'espace" onPress={surRetourChoix} secondaire />
      </View>
    </View>
  );
});

const s = StyleSheet.create({
  page: { flex: 1, alignItems: "center", justifyContent: "center", padding: E.xl, gap: E.m },
  rond: {
    width: 62, height: 62, borderRadius: R.xl, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,199,255,.12)", borderWidth: 1, borderColor: "rgba(0,199,255,.28)",
  },
  titre: { color: C.texte, fontFamily: P.titre, fontSize: 21, textAlign: "center", letterSpacing: -0.4 },
  texte: { color: C.texteDoux, fontFamily: P.texte, fontSize: 15, lineHeight: 22, textAlign: "center", maxWidth: 420 },
  faible: { color: C.texteFaible, fontFamily: P.texte, fontSize: 13, lineHeight: 19, textAlign: "center", maxWidth: 420 },
});
