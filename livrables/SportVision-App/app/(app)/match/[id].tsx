// La fiche d'un match (22/09/2026).
//
// Avant le match, ce qu'on vient chercher c'est l'heure, le lieu et comment y aller. Après, c'est
// le score et les photos. L'écran met donc l'accent ailleurs selon qu'il est joué ou non.
//
// Ce qu'il ne montre pas : la convocation et la composition. Elles sont volontairement fermées aux
// joueurs et aux parents (v242, décision du 12/09/2026) pour que le coach compose sans que chacun
// découvre en direct qu'il n'est pas retenu.
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { issueDuMatch, lireMatch, MOT_ISSUE, type Evenement } from "../../../src/lib/donnees";
import { dateLongue, dateDuJourParis, heureCourte } from "../../../src/lib/dates";
import { useSession } from "../../../src/lib/session";
import { FOND_MATCH_DEMO, MODE_DEMO } from "../../../src/lib/demonstration";
import { Ecran, Vide } from "../../../src/ui/Ecran";
import { Ecusson } from "../../../src/ui/Cartes";
import { Bouton } from "../../../src/ui/Base";
import { C, E, R, TOUCHE } from "../../../src/theme/couleurs";
import { P } from "../../../src/theme/polices";

export default function FicheMatch() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { profil } = useSession();
  const [match, setMatch] = useState<Evenement | null>(null);
  const [chargement, setChargement] = useState(true);

  const charger = useCallback(async () => {
    if (!id) { setChargement(false); return; }
    setChargement(true);
    try { setMatch(await lireMatch(id)); }
    finally { setChargement(false); }
  }, [id]);

  useEffect(() => { charger(); }, [charger]);

  const issue = issueDuMatch(match?.score);
  const joue = !!match?.score;
  const heure = heureCourte(match?.heure);
  const passe = match ? match.date < dateDuJourParis() : false;

  /** L'itinéraire s'ouvre dans l'application de cartes du téléphone. */
  function ouvrirItineraire() {
    if (!match?.lieu) return;
    const adresse = encodeURIComponent(match.lieu);
    const url = Platform.OS === "ios"
      ? `http://maps.apple.com/?q=${adresse}`
      : `geo:0,0?q=${adresse}`;
    Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${adresse}`));
  }

  return (
    <Ecran enCours={chargement} rafraichir={charger} teinte="bleu">
      <Pressable onPress={() => router.back()} style={s.retour} hitSlop={10}>
        <Ionicons name="chevron-back" size={18} color={C.texteDoux} />
        <Text style={s.retourTexte}>Calendrier</Text>
      </Pressable>

      {chargement && !match ? (
        <View style={{ paddingVertical: E.xl * 2, alignItems: "center" }}>
          <ActivityIndicator color={C.accent} />
        </View>
      ) : !match ? (
        <Vide titre="Match introuvable" texte="Ce match n'existe plus, ou il ne fait pas partie de votre équipe." />
      ) : (
        <>
          <View style={s.affiche}>
            {MODE_DEMO ? (
              <Image source={{ uri: FOND_MATCH_DEMO }} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} />
            ) : null}
            <LinearGradient
              colors={["rgba(7,10,23,.55)", "rgba(7,10,23,.88)", "rgba(7,10,23,.97)"]}
              style={StyleSheet.absoluteFill}
            />
            <View style={s.afficheContenu}>
              {match.competition ? <Text style={s.competition} numberOfLines={1}>{match.competition}</Text> : null}

              <View style={s.camps}>
                <View style={s.camp}>
                  <Ecusson url={profil?.clubLogoUrl} nom={profil?.clubNom} taille={54} />
                  <Text style={s.campNom} numberOfLines={2}>{match.equipe || profil?.clubNom || "Notre équipe"}</Text>
                </View>

                <View style={s.milieu}>
                  <Text style={s.score}>{joue ? match.score : "vs"}</Text>
                  {issue ? (
                    <Text style={[s.issue, { color: issue === "gagne" ? C.succes : issue === "perdu" ? C.danger : C.texteDoux }]}>
                      {MOT_ISSUE[issue]}
                    </Text>
                  ) : (
                    <Text style={s.lieuType}>
                      {match.domicile === undefined ? "" : match.domicile ? "à domicile" : "à l'extérieur"}
                    </Text>
                  )}
                </View>

                <View style={s.camp}>
                  <Ecusson nom={match.adversaire} taille={54} neutre />
                  <Text style={s.campNom} numberOfLines={2}>{match.adversaire || "Adversaire"}</Text>
                </View>
              </View>
            </View>
          </View>

          <View style={s.bloc}>
            <Ligne icone="calendar-outline" titre={dateLongue(match.date)} detail={heure ? `Coup d'envoi à ${heure}` : undefined} />
            {match.lieu ? <Ligne icone="location-outline" titre={match.lieu} detail={match.domicile === false ? "Déplacement" : "Réception"} /> : null}
            {match.equipe ? <Ligne icone="shirt-outline" titre={match.equipe} detail="Votre équipe" /> : null}
          </View>

          {match.lieu && !passe ? (
            <Bouton
              titre="Ouvrir l'itinéraire"
              secondaire
              onPress={ouvrirItineraire}
              icone={<Ionicons name="navigate-outline" size={17} color={C.texte} />}
            />
          ) : null}

          {passe ? (
            <Pressable onPress={() => router.push("/photos")} style={({ pressed }) => [s.photos, pressed ? { opacity: 0.85 } : null]}>
              <View style={s.photosIcone}>
                <Ionicons name="images" size={20} color={C.accentClair} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.photosTitre}>Les photos de ce match</Text>
                <Text style={s.detail}>Si SportVision était présent, la galerie est dans « Mes photos ».</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.texteFaible} />
            </Pressable>
          ) : null}
        </>
      )}
    </Ecran>
  );
}

function Ligne({ icone, titre, detail }: { icone: keyof typeof Ionicons.glyphMap; titre: string; detail?: string }) {
  return (
    <View style={s.ligne}>
      <Ionicons name={icone} size={18} color={C.texteDoux} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.ligneTitre}>{titre}</Text>
        {detail ? <Text style={s.detail}>{detail}</Text> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  retour: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start", minHeight: TOUCHE - 10 },
  retourTexte: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: 14.5 },
  affiche: { borderRadius: R.xl, overflow: "hidden", backgroundColor: C.surfaceHaute, minHeight: 210, justifyContent: "center" },
  afficheContenu: { padding: E.l, gap: E.m },
  competition: { color: C.cyan, fontFamily: P.texteFort, fontSize: 11.5, textTransform: "uppercase", letterSpacing: 1, textAlign: "center" },
  camps: { flexDirection: "row", alignItems: "flex-start", gap: E.s },
  camp: { flex: 1, alignItems: "center", gap: E.s },
  campNom: { color: C.texte, fontFamily: P.titreFort, fontSize: 14, textAlign: "center", lineHeight: 18 },
  milieu: { alignItems: "center", gap: 3, paddingTop: 12, minWidth: 92 },
  score: { color: C.texte, fontFamily: P.titre, fontSize: 30, fontVariant: ["tabular-nums"] },
  issue: { fontFamily: P.texteFort, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 },
  lieuType: { color: C.texteDoux, fontFamily: P.texte, fontSize: 12 },
  bloc: { backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, borderColor: C.bordure, overflow: "hidden" },
  ligne: {
    flexDirection: "row", alignItems: "center", gap: E.m, padding: E.m,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.bordure,
  },
  ligneTitre: { color: C.texte, fontFamily: P.texteFort, fontSize: 15 },
  detail: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13 },
  photos: {
    flexDirection: "row", alignItems: "center", gap: E.m,
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, borderColor: C.bordure, padding: E.m,
  },
  photosIcone: { width: 42, height: 42, borderRadius: R.m, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(36,84,255,.16)" },
  photosTitre: { color: C.texte, fontFamily: P.titreFort, fontSize: 15.5 },
});
