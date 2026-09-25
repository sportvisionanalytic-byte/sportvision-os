// Une page de Connect, vue depuis un navigateur (24/09/2026).
//
// Même raison que VueWeb.web.tsx : la vue web de React Native n'existe pas sur le web. Mais ici
// on peut faire mieux qu'expliquer — la personne EST déjà dans un navigateur, et la page
// demandée est une page de site. On lui donne donc le lien, elle y va directement.
import React, { forwardRef, useEffect, useImperativeHandle } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Bouton } from "./Base";
import { C, E, R } from "../theme/couleurs";
import { P } from "../theme/polices";
import type { PoigneeVueConnect, ProprietesVueConnect } from "./VueConnect";

export const VueConnect = forwardRef<PoigneeVueConnect, ProprietesVueConnect>(
  function VueConnectNavigateur({ source, surChargement, surHistorique }, ref) {
    useEffect(() => { surChargement(); surHistorique(false); }, [surChargement, surHistorique]);
    useImperativeHandle(ref, () => ({ reculer: () => {} }), []);

    // On ouvre la page telle quelle, sans les jetons : dans un navigateur, la session est déjà
    // dans les cookies du site. Le transport de session ne sert qu'à l'application.
    const adresse = (source.html.match(/name="next" value="([^"]*)"/) ?? [])[1] || "/dashboard";

    return (
      <View style={s.page}>
        <View style={s.rond}>
          <Ionicons name="open-outline" size={28} color={C.cyan} />
        </View>
        <Text style={s.titre}>Cette page s'ouvre sur le site</Text>
        <Text style={s.texte}>
          Dans l'application, elle s'affiche ici même. Depuis un navigateur, autant y aller
          directement.
        </Text>
        <View style={{ alignSelf: "stretch", maxWidth: 340, paddingTop: E.s }}>
          <Bouton
            titre="Ouvrir sur connect.sportvision-an.fr"
            onPress={() => Linking.openURL(`https://connect.sportvision-an.fr${adresse}`)}
          />
        </View>
      </View>
    );
  },
);

const s = StyleSheet.create({
  page: { flex: 1, alignItems: "center", justifyContent: "center", padding: E.xl, gap: E.m },
  rond: {
    width: 62, height: 62, borderRadius: R.xl, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,199,255,.12)", borderWidth: 1, borderColor: "rgba(0,199,255,.28)",
  },
  titre: { color: C.texte, fontFamily: P.titre, fontSize: 21, textAlign: "center", letterSpacing: -0.4 },
  texte: { color: C.texteDoux, fontFamily: P.texte, fontSize: 15, lineHeight: 22, textAlign: "center", maxWidth: 420 },
});
