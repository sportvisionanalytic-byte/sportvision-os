// UNE BARRE DE CHOIX HORIZONTALE (30/09/2026).
//
// POURQUOI UNE BRIQUE ET PAS UNE COPIE. Le cockpit de `missions.tsx` dessine deja exactement cela
// pour ses groupes : une rangee de puces qui defile, un compteur dans chacune. Les quatre ecrans
// de production en ont besoin aussi, et pour deux usages : se joindre entre eux, et ranger leur
// propre contenu en sous-listes. Copier ces 30 lignes cinq fois, c'est la fabrique a « trois
// boutons legerement differents pour la meme action » que l'en-tete de `Base.tsx` raconte.
//
// Les valeurs visuelles sont celles du cockpit, sans une variation : meme hauteur de puce, meme
// bleu actif, meme badge de comptage. Deux palettes proches mais pas identiques, c'est le reproche
// numero un de Fouka.
import React, { useCallback, useEffect, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { C, E, R, TOUCHE } from "../theme/couleurs";
import { P } from "../theme/polices";

export interface Choix {
  cle: string;
  libelle: string;
  /** Le compte affiche dans la puce. Absent : aucun badge. Zero : un badge « 0 », et c'est voulu. */
  n?: number;
}

/**
 * Les choix VIDES restent affiches, avec leur zero.
 *
 * C'est la lecon du 30/09 : masquer un groupe vide a rendu « A planifier » invisible pendant des
 * mois, et personne ne pouvait deviner qu'il existait. Un zero se lit « il n'y a rien la » ;
 * une absence se lit « ca n'existe pas ».
 */
export function Barre({
  choix, actif, surChoix,
}: {
  choix: Choix[];
  actif: string;
  surChoix: (cle: string) => void;
}) {
  // LA PUCE ACTIVE DOIT ETRE ENTIEREMENT VISIBLE, ET ELLE NE L'ETAIT PAS (30/09/2026, vu a
  // l'ecran sur « Materiel »). La rangee defile, mais elle s'ouvrait toujours a gauche : la
  // quatrieme puce, celle de l'ecran ouvert, apparaissait coupee par le bord droit. On ne sait
  // alors pas si on lit un mot tronque ou un ecran mal charge.
  //
  // On retient donc l'abscisse de chaque puce a la pose, et on amene l'active dans le champ. Le
  // premier rendu compris : c'est justement celui ou l'on arrive sur un ecran deja selectionne.
  const vue = useRef<ScrollView | null>(null);
  const abscisses = useRef<Record<string, { x: number; l: number }>>({});
  const largeur = useRef(0);

  const montrer = useCallback((cle: string) => {
    const p = abscisses.current[cle];
    const dispo = largeur.current;
    if (!p || !dispo) return;
    // Rien a faire tant que la puce tient deja dans ce qu'on voit : un defilement gratuit se lit
    // comme un bougé de l'interface.
    const marge = 16;
    vue.current?.scrollTo({ x: Math.max(0, p.x - marge), animated: true });
  }, []);

  useEffect(() => { montrer(actif); }, [actif, montrer]);

  return (
    <ScrollView
      ref={vue}
      horizontal
      showsHorizontalScrollIndicator={false}
      onLayout={(e) => { largeur.current = e.nativeEvent.layout.width; montrer(actif); }}
      contentContainerStyle={{ gap: E.s, paddingRight: E.l }}
    >
      {choix.map((c) => {
        const cet = c.cle === actif;
        return (
          <Pressable
            key={c.cle}
            onLayout={(e) => {
              const { x, width } = e.nativeEvent.layout;
              abscisses.current[c.cle] = { x, l: width };
              if (c.cle === actif) montrer(actif);
            }}
            onPress={() => surChoix(c.cle)}
            accessibilityRole="button"
            accessibilityState={{ selected: cet }}
            accessibilityLabel={c.n === undefined ? c.libelle : `${c.libelle}, ${c.n}`}
            style={[s.puce, cet && s.puceActive]}
          >
            <Text style={[s.puceTexte, cet && s.puceTexteActif]}>{c.libelle}</Text>
            {c.n === undefined ? null : (
              <View style={[s.badge, cet && s.badgeActif]}>
                <Text style={[s.badgeTexte, cet && s.badgeTexteActif]}>{c.n}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  puce: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: E.m, height: TOUCHE - 6, borderRadius: R.pill,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  puceActive: { backgroundColor: "rgba(36,84,255,.20)", borderColor: "rgba(36,84,255,.55)" },
  puceTexte: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: 13 },
  puceTexteActif: { color: C.texte, fontFamily: P.texteFort },
  badge: { minWidth: 20, paddingHorizontal: 5, borderRadius: R.pill, backgroundColor: "rgba(255,255,255,.07)" },
  badgeActif: { backgroundColor: "rgba(255,255,255,.16)" },
  badgeTexte: { color: C.texteFaible, fontFamily: P.texteFort, fontSize: 11, textAlign: "center" },
  badgeTexteActif: { color: C.texte },
});
