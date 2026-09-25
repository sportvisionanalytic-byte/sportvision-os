// Services (25/09/2026) : tout ce qui touche à l'argent et aux prestations.
//
// POURQUOI CET ONGLET EXISTE
//
// L'application couvrait six écrans quand Connect en a vingt-sept. Le plus gênant : une famille
// qui achetait un Pass Photo ne pouvait pas retrouver son reçu, et un joueur ne pouvait pas
// demander une prestation. Il fallait ouvrir le site, ce que personne ne fait après avoir
// installé une application.
//
// LES LIBELLÉS SONT CEUX DU SITE, mot pour mot — « Paiement collectif », et non « Cotisations ».
// Une famille qui commence sur le site et continue ici doit retrouver les mêmes noms ; deux
// vocabulaires pour la même chose, ce sont déjà deux produits dans sa tête.
//
// CE QUI EST NATIF ET CE QUI NE L'EST PAS. La réservation d'une prestation est ce que SportVision
// vend : elle sera écrite en natif. Le reste s'ouvre dans Connect, avec la session déjà faite —
// ce sont des écrans qui existent, testés et corrigés pendant des semaines, et les réécrire
// reviendrait à entretenir deux versions des mêmes règles jusqu'au jour où elles divergent.
//
// AUCUN PRIX, AUCUN BOUTON D'ACHAT DE CONTENU NUMÉRIQUE n'apparaît ici. Réserver une prestation,
// c'est commander un service réel — un photographe qui se déplace — ce que les règles de l'App
// Store autorisent expressément hors de leur système de paiement. Le Pass Photo, lui, est un
// contenu numérique : il reste hors de l'application.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Ecran, Section } from "../../src/ui/Ecran";
import { C, E, R, TOUCHE } from "../../src/theme/couleurs";
import { P } from "../../src/theme/polices";

function Ligne({
  icone, titre, detail, onPress, teinte,
}: {
  icone: keyof typeof Ionicons.glyphMap;
  titre: string;
  detail: string;
  onPress: () => void;
  teinte?: string;
}) {
  return (
    // Toute la ligne est tactile, et non la seule icone : viser 17 pixels au bord d'un terrain,
    // avec des gants, ca ne marche pas.
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${titre}. ${detail}`}
      style={({ pressed }) => [s.ligneHote, pressed ? { backgroundColor: "rgba(255,255,255,.04)" } : null]}
    >
      <View style={[s.rond, teinte ? { borderColor: teinte + "48", backgroundColor: teinte + "1F" } : null]}>
        <Ionicons name={icone} size={17} color={teinte ?? C.texteDoux} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.ligneTitre}>{titre}</Text>
        <Text style={s.ligneDetail} numberOfLines={2}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={C.texteFaible} />
    </Pressable>
  );
}

export default function Services() {
  const router = useRouter();

  return (
    <Ecran teinte="cyan">
      <Text style={s.titre}>Services</Text>
      <Text style={s.chapeau}>
        Demander une captation, participer à une collecte, retrouver vos reçus.
      </Text>

      <Section titre="Faire venir SportVision">
        <View style={s.groupe}>
          <Ligne
            icone="videocam-outline" teinte={C.accentClair}
            titre="Prestations"
            detail="Photo, vidéo, drone : voir les formules et demander une date"
            onPress={() => router.push("/connect/prestations")}
          />
          <Ligne
            icone="people-outline" teinte={C.cyan}
            titre="Paiement collectif"
            detail="Lancer une collecte entre parents, ou participer à celle du groupe"
            onPress={() => router.push("/connect/cotisations")}
          />
        </View>
      </Section>

      <Section titre="Mes paiements">
        <View style={s.groupe}>
          <Ligne
            icone="receipt-outline"
            titre="Mes commandes"
            detail="Ce que vous avez commandé, et où ça en est"
            onPress={() => router.push("/connect/commandes")}
          />
          <Ligne
            icone="document-text-outline"
            titre="Factures et paiements"
            detail="Vos factures, à télécharger à tout moment"
            onPress={() => router.push("/connect/factures")}
          />
        </View>
      </Section>

      <Section titre="Besoin d'aide ?">
        <View style={s.groupe}>
          <Ligne
            icone="help-buoy-outline"
            titre="Aide"
            detail="Les questions qu'on nous pose le plus souvent"
            onPress={() => router.push("/connect/aide")}
          />
        </View>
      </Section>
    </Ecran>
  );
}

const s = StyleSheet.create({
  titre: { color: C.texte, fontFamily: P.titre, fontSize: 28, letterSpacing: -0.6, marginBottom: 4 },
  chapeau: { color: C.texteDoux, fontFamily: P.texte, fontSize: 14.5, lineHeight: 21, marginBottom: E.m },
  groupe: {
    backgroundColor: C.surface, borderRadius: R.l,
    borderWidth: 1, borderColor: C.bordure, overflow: "hidden",
  },
  ligneHote: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    paddingHorizontal: E.m, paddingVertical: 13, minHeight: TOUCHE,
  },
  rond: {
    width: 34, height: 34, borderRadius: R.m, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.05)", borderWidth: 1, borderColor: "rgba(255,255,255,.08)",
  },
  ligneTitre: { color: C.texte, fontFamily: P.texteFort, fontSize: 15 },
  ligneDetail: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5, lineHeight: 17 },
});
