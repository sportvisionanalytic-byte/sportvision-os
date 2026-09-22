// Les cartes que plusieurs ecrans partagent : un evenement, un club, une galerie.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { C, E, R } from "../theme/couleurs";
import { P } from "../theme/polices";
import { heureCourte, jourNumero, moisCourt, quand } from "../lib/dates";
import type { Evenement } from "../lib/donnees";

const COULEUR_GENRE = {
  match: C.accent,
  entrainement: C.cyan,
  evenement: C.violet,
  rendez_vous: C.alerte,
} as const;

const ICONE_GENRE = {
  match: "football",
  entrainement: "fitness",
  evenement: "sparkles",
  rendez_vous: "calendar",
} as const;

/** L'ecusson du club, ou ses initiales. Jamais le mot « logo » dans un carre gris. */
export function Ecusson({
  url, nom, taille = 46, neutre,
}: { url?: string | null; nom?: string | null; taille?: number; neutre?: boolean }) {
  const style = { width: taille, height: taille, borderRadius: R.m };
  if (url) return <Image source={{ uri: url }} style={[style, { backgroundColor: "rgba(255,255,255,.06)" }]} contentFit="cover" />;

  // Un club adverse n'a pas d'ecusson chez nous, et ses initiales tirees de « Neuilly O. U18 1 »
  // donnaient « NOU », qui ne veut rien dire. Un blason neutre est plus honnete qu'un sigle faux.
  if (neutre) {
    return (
      <View style={[style, s.ecussonVide]}>
        <Ionicons name="shield-outline" size={taille * 0.46} color={C.texteFaible} />
      </View>
    );
  }

  // Deux lettres au plus, et jamais un numero d'equipe : « SF Villemomble » donne SFV, pas SV,
  // qu'on lirait SportVision.
  const initiales = (nom ?? "")
    .split(/\s+/)
    .filter((m) => m.length > 1 && !/^[uU]?\d/.test(m))
    .slice(0, 3)
    .map((m) => m[0]?.toUpperCase())
    .join("");
  return (
    <View style={[style, s.ecussonVide]}>
      <Text style={{ color: C.texteDoux, fontFamily: P.titre, fontSize: taille * 0.34 }}>{initiales || "SV"}</Text>
    </View>
  );
}

export function CarteEvenement({ e, onPress }: { e: Evenement; onPress?: () => void }) {
  const couleur = COULEUR_GENRE[e.genre];
  const heure = heureCourte(e.heure);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.carte, s.ligne, pressed && onPress ? { opacity: 0.8 } : null]}
    >
      <View style={[s.pastilleDate, { borderColor: couleur + "55" }]}>
        <Text style={s.pastilleJour}>{jourNumero(e.date)}</Text>
        <Text style={[s.pastilleMois, { color: couleur }]}>{moisCourt(e.date)}</Text>
      </View>

      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name={ICONE_GENRE[e.genre]} size={13} color={couleur} />
          <Text style={[s.genre, { color: couleur }]}>
            {e.genre === "match"
              // Le calendrier de la famille ne dit pas qui recoit : on ne l'invente pas.
              ? (e.domicile === undefined ? "Match" : e.domicile ? "Match · domicile" : "Match · extérieur")
              : e.genre === "entrainement" ? "Entraînement"
              : e.genre === "rendez_vous" ? "Rendez-vous" : "Événement"}
          </Text>
        </View>
        {/* Sur un match, on nomme l'adversaire. Repeter le nom de sa propre equipe dans le titre
            ne dit rien a celui qui en fait partie, et mange deux lignes sur trois. */}
        <Text style={s.titreCarte} numberOfLines={2}>
          {e.genre === "match" && e.adversaire ? e.adversaire : e.titre}
        </Text>
        <Text style={s.detail} numberOfLines={1}>
          {[quand(e.date), heure].filter(Boolean).join(" · ")}
        </Text>
        {e.lieu ? <Text style={s.detail} numberOfLines={1}>{e.lieu}</Text> : null}
        {e.genre === "match" && e.equipe ? <Text style={s.equipe}>{e.equipe}</Text> : null}
      </View>

      {/* Le score prend la place de la fleche : c'est ce qu'on vient lire sur un match joue. */}
      {e.score ? <Text style={s.score}>{e.score}</Text> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  carte: {
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, borderColor: C.bordure,
    padding: E.m,
  },
  ligne: { flexDirection: "row", alignItems: "center", gap: E.m },
  pastilleDate: {
    width: 52, height: 56, borderRadius: R.m, borderWidth: 1,
    alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.04)",
  },
  pastilleJour: { color: C.texte, fontFamily: P.titre, fontSize: 20, lineHeight: 24 },
  pastilleMois: { fontFamily: P.texteFort, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5 },
  genre: { fontFamily: P.texteFort, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.7 },
  titreCarte: { color: C.texte, fontFamily: P.titreFort, fontSize: 16 },
  detail: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5 },
  equipe: { color: C.texteFaible, fontFamily: P.texteMoyen, fontSize: 12 },
  score: { color: C.texte, fontFamily: P.titre, fontSize: 19, fontVariant: ["tabular-nums"] },
  ecussonVide: {
    backgroundColor: "rgba(255,255,255,.06)", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: C.bordure,
  },
});
