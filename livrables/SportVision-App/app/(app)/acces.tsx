// Comprendre l'accès aux photos (22/09/2026).
//
// Pourquoi cet écran existe : une galerie verrouillée doit pouvoir s'expliquer, sans devenir une
// page de vente. L'App Store interdit à une application de vendre du contenu numérique hors de son
// système de paiement, et interdit même d'y renvoyer. Cet écran explique donc ce qu'est le Pass
// Photo et qui le distribue. Aucun prix, aucun bouton d'achat, aucun lien de paiement : ce n'est
// pas une précaution excessive, c'est un motif de refus classique.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSession } from "../../src/lib/session";
import { Ecran } from "../../src/ui/Ecran";
import { C, E, R, TOUCHE } from "../../src/theme/couleurs";
import { P } from "../../src/theme/polices";

const POINTS: { icone: keyof typeof Ionicons.glyphMap; titre: string; texte: string }[] = [
  {
    icone: "camera-outline",
    titre: "SportVision photographie le match",
    texte: "Les photos sont triées, retouchées, puis publiées dans une galerie réservée à l'équipe.",
  },
  {
    icone: "person-circle-outline",
    titre: "Vos photos sont repérées",
    texte: "Celles où vous apparaissez vous sont signalées, sans que personne d'autre ne les voie.",
  },
  {
    icone: "key-outline",
    titre: "Le Pass Photo ouvre la galerie",
    texte: "Il est mis en place par votre club. Une fois actif, toutes les galeries de la saison s'ouvrent ici, sans rien de plus à faire.",
  },
];

export default function Acces() {
  const router = useRouter();
  const { profil } = useSession();

  return (
    <Ecran teinte="violet">
      <Pressable onPress={() => router.back()} style={s.retour} hitSlop={10}>
        <Ionicons name="chevron-back" size={18} color={C.texteDoux} />
        <Text style={s.retourTexte}>Photos</Text>
      </Pressable>

      <View style={{ gap: E.xs }}>
        <Text style={s.titre}>Comment j'accède aux photos</Text>
        <Text style={s.sous}>
          {profil?.equipeNom
            ? `Les galeries de l'équipe ${profil.equipeNom} suivent toutes le même chemin.`
            : "Les galeries de votre équipe suivent toutes le même chemin."}
        </Text>
      </View>

      <View style={{ gap: E.s }}>
        {POINTS.map((p, i) => (
          <View key={p.titre} style={s.etape}>
            <View style={s.numero}>
              <Text style={s.numeroTexte}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={s.etapeTitre}>{p.titre}</Text>
              <Text style={s.etapeTexte}>{p.texte}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={s.note}>
        <Ionicons name="information-circle-outline" size={17} color={C.cyan} />
        <Text style={s.noteTexte}>
          Une galerie reste fermée ? Rapprochez-vous de votre club : c'est lui qui décide des
          rencontres couvertes et des accès ouverts aux familles.
        </Text>
      </View>
    </Ecran>
  );
}

const s = StyleSheet.create({
  retour: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start", minHeight: TOUCHE - 10 },
  retourTexte: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: 14.5 },
  titre: { color: C.texte, fontFamily: P.titre, fontSize: 25, letterSpacing: -0.5 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: 14.5, lineHeight: 20 },
  etape: {
    flexDirection: "row", gap: E.m, alignItems: "flex-start",
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, borderColor: C.bordure, padding: E.m,
  },
  numero: {
    width: 30, height: 30, borderRadius: R.pill, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(131,45,255,.18)", borderWidth: 1, borderColor: "rgba(131,45,255,.4)",
  },
  numeroTexte: { color: "#C9A7FF", fontFamily: P.titre, fontSize: 13 },
  etapeTitre: { color: C.texte, fontFamily: P.titreFort, fontSize: 15.5 },
  etapeTexte: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
  note: {
    flexDirection: "row", gap: E.s, alignItems: "flex-start",
    backgroundColor: "rgba(0,199,255,.08)", borderWidth: 1, borderColor: "rgba(0,199,255,.25)",
    borderRadius: R.l, padding: E.m,
  },
  noteTexte: { flex: 1, color: "#A9E8F8", fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
});
