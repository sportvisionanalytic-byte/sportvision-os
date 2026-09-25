// L'esquisse d'une page pendant qu'elle charge (25/09/2026).
//
// POURQUOI. Les pages de Connect ouvertes dans l'application répondent en une seconde environ,
// mesuré trois fois de suite sur le serveur réel : ce n'est pas un démarrage à froid, c'est leur
// temps normal. Pendant cette seconde, l'écran ne montrait qu'une roue qui tourne sur un fond
// vide — et une roue sur du vide, c'est exactement ce qu'on regarde quand on trouve une
// application lente.
//
// CE QUE CHANGE UNE ESQUISSE. Elle ne rend rien plus rapide : la page met toujours une seconde.
// Mais l'œil a quelque chose à lire tout de suite, la forme de ce qui arrive est déjà là, et la
// page qui s'affiche remplace des blocs au lieu d'apparaître dans le noir. C'est la différence
// entre attendre et voir quelque chose se construire.
//
// ON NE PROMET PAS CE QU'ON NE SAIT PAS. Les blocs n'imitent aucune donnée : ce sont des formes
// neutres. Dessiner de faux titres ou de faux montants ferait croire une demi-seconde à un
// contenu qui n'existe peut-être pas — plusieurs de ces pages sont vides aujourd'hui.
import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View, AccessibilityInfo } from "react-native";
import { C, E, R } from "../theme/couleurs";

export function Esquisse({ lignes = 4 }: { lignes?: number }) {
  const pulsation = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    let vivant = true;
    // `prefers-reduced-motion` : une personne qui a demandé moins d'animations reçoit des blocs
    // fixes. L'information est la même, elle ne clignote pas.
    AccessibilityInfo.isReduceMotionEnabled().then((reduit) => {
      if (!vivant || reduit) return;
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulsation, { toValue: 0.9, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(pulsation, { toValue: 0.45, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      ).start();
    });
    return () => { vivant = false; };
  }, [pulsation]);

  return (
    <View style={s.cadre} accessibilityLabel="Chargement de la page" accessibilityRole="progressbar">
      {Array.from({ length: lignes }).map((_, i) => (
        <Animated.View key={i} style={[s.carte, { opacity: pulsation }]}>
          <View style={[s.bloc, { width: `${58 + ((i * 13) % 26)}%` }]} />
          <View style={[s.bloc, s.fin, { width: `${34 + ((i * 17) % 22)}%` }]} />
        </Animated.View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  cadre: { ...StyleSheet.absoluteFill as object, padding: E.l, gap: E.m, backgroundColor: C.fond },
  carte: {
    backgroundColor: C.surface, borderRadius: R.m, padding: E.l, gap: E.s,
    borderWidth: StyleSheet.hairlineWidth, borderColor: C.bordure,
  },
  bloc: { height: 13, borderRadius: 6, backgroundColor: C.surfaceHaute },
  fin: { height: 10 },
});
