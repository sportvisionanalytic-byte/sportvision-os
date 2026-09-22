// Le prochain rendez-vous, en grand (22/09/2026).
//
// C'est la question que tout le monde se pose en ouvrant l'application : c'est quand, contre qui,
// et où. Elle mérite donc autre chose qu'une ligne de liste — un seul bloc fort, et le reste de
// l'écran reste calme.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { C, DEGRADE_DOUX, E, R } from "../theme/couleurs";
import { P } from "../theme/polices";
import { dateLongue, dateDuJourParis, heureCourte, versDate } from "../lib/dates";
import type { Evenement } from "../lib/donnees";
import { Ecusson } from "./Cartes";

/** « Aujourd'hui », « Demain », « Dans 5 jours ». Une distance, pas une date de plus. */
function distance(iso: string): string {
  const jour = versDate(dateDuJourParis()).getTime();
  const cible = versDate(iso).getTime();
  const jours = Math.round((cible - jour) / 86400000);
  if (jours <= 0) return "Aujourd'hui";
  if (jours === 1) return "Demain";
  if (jours < 7) return `Dans ${jours} jours`;
  if (jours < 14) return "La semaine prochaine";
  return `Dans ${Math.round(jours / 7)} semaines`;
}

export function Prochain({
  e, clubNom, clubLogoUrl, fond, onPress,
}: {
  e: Evenement;
  clubNom?: string | null;
  clubLogoUrl?: string | null;
  /** Une photographie de fond, quand on en a une pour ce club. Jamais obligatoire. */
  fond?: string | null;
  onPress?: () => void;
}) {
  const heure = heureCourte(e.heure);
  const match = e.genre === "match";
  const adversaire = e.adversaire ?? (match ? e.titre : null);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && onPress ? { opacity: 0.9 } : null]}>
      {/* Le degrade de marque sert de liseré, jamais de fond : le texte doit rester lisible. */}
      <LinearGradient
        colors={DEGRADE_DOUX as unknown as [string, string, string]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={s.liseret}
      >
        <View style={s.corps}>
          {fond ? (
            <>
              <Image source={{ uri: fond }} style={StyleSheet.absoluteFill} contentFit="cover" transition={180} />
              {/* Le voile : sans lui, le texte blanc devient illisible sur une photo claire. */}
              <LinearGradient
                colors={["rgba(7,10,23,.62)", "rgba(7,10,23,.86)", "rgba(7,10,23,.96)"]}
                style={StyleSheet.absoluteFill}
              />
            </>
          ) : null}
          <View style={s.haut}>
            <Text style={s.quand}>{distance(e.date)}</Text>
            {e.competition ? <Text style={s.competition} numberOfLines={1}>{e.competition}</Text> : null}
          </View>

          {match ? (
            <View style={s.affiche}>
              <View style={s.camp}>
                <Ecusson url={clubLogoUrl} nom={clubNom} taille={50} />
                <Text style={s.campNom} numberOfLines={2}>{e.equipe || clubNom || "Notre équipe"}</Text>
              </View>

              <View style={s.milieu}>
                <Text style={s.versus}>{e.score ? e.score : "vs"}</Text>
                {e.domicile === undefined ? null : (
                  <Text style={s.lieuType}>{e.domicile ? "à domicile" : "à l'extérieur"}</Text>
                )}
              </View>

              <View style={s.camp}>
                <Ecusson nom={adversaire} taille={50} neutre />
                <Text style={s.campNom} numberOfLines={2}>{adversaire || "Adversaire"}</Text>
              </View>
            </View>
          ) : (
            <Text style={s.titreSimple} numberOfLines={2}>{e.titre}</Text>
          )}

          <View style={s.pied}>
            <View style={s.info}>
              <Ionicons name="calendar-outline" size={14} color={C.texteDoux} />
              <Text style={s.infoTexte} numberOfLines={1}>
                {dateLongue(e.date)}{heure ? ` · ${heure}` : ""}
              </Text>
            </View>
            {e.lieu ? (
              <View style={s.info}>
                <Ionicons name="location-outline" size={14} color={C.texteDoux} />
                <Text style={s.infoTexte} numberOfLines={1}>{e.lieu}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

const s = StyleSheet.create({
  liseret: { borderRadius: R.l + 1, padding: 1 },
  corps: { backgroundColor: C.surfaceHaute, borderRadius: R.l, padding: E.l, gap: E.m, overflow: "hidden" },
  haut: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: E.s },
  quand: { color: C.cyan, fontFamily: P.titre, fontSize: 11.5, textTransform: "uppercase", letterSpacing: 1.1 },
  competition: { color: C.texteFaible, fontFamily: P.texteMoyen, fontSize: 11.5, flexShrink: 1 },
  affiche: { flexDirection: "row", alignItems: "flex-start", gap: E.s },
  camp: { flex: 1, alignItems: "center", gap: E.s },
  campNom: { color: C.texte, fontFamily: P.titreFort, fontSize: 14, textAlign: "center", lineHeight: 18 },
  milieu: { alignItems: "center", gap: 2, paddingTop: 10, minWidth: 72 },
  versus: { color: C.texte, fontFamily: P.titre, fontSize: 25, fontVariant: ["tabular-nums"] },
  lieuType: { color: C.texteFaible, fontFamily: P.texteMoyen, fontSize: 11.5 },
  titreSimple: { color: C.texte, fontFamily: P.titreFort, fontSize: 19, lineHeight: 25 },
  pied: { gap: 6, borderTopWidth: 1, borderTopColor: C.bordure, paddingTop: E.m },
  info: { flexDirection: "row", alignItems: "center", gap: 7 },
  infoTexte: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, flex: 1 },
});
