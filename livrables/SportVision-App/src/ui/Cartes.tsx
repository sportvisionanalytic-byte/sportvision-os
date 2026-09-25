// Les cartes que plusieurs ecrans partagent : un evenement, un club, une galerie.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { C, E, R } from "../theme/couleurs";
import { P } from "../theme/polices";
import { heureCourte, jourNumero, moisCourt, quand } from "../lib/dates";
import { issueDuMatch, MOT_ISSUE, type Evenement } from "../lib/donnees";

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

  // LES INITIALES D'UN CLUB (corrigé le 25/09/2026)
  //
  // Signalé par Fouka : « il y a écrit SV ». Le code prenait la première lettre de chaque mot,
  // donc « SF Villemomble » donnait S + V = « SV » — c'est-à-dire SportVision, exactement ce que
  // le commentaire d'origine disait vouloir éviter. Il décrivait une intention que le code ne
  // tenait pas.
  //
  // Un sigle déjà écrit en majuscules se garde ENTIER : c'est le nom que le club se donne.
  // « SF Villemomble » → SFV, « RCP Fontainebleau » → RCP, « Villeneuve 340 SC » → VSC.
  // Les numéros d'équipe sont écartés : U18, 340, 1 ne disent rien d'un club.
  const initiales = (nom ?? "")
    .split(/\s+/)
    // La ponctuation ne fait pas partie d'un sigle : « Neuilly O. » donnait « NO. », avec le
    // point, dans un carre de quarante pixels.
    .map((m) => m.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((m) => m.length > 1 && !/^[uU]?\d/.test(m))
    .map((m) => (m === m.toUpperCase() ? m : m[0]?.toUpperCase() ?? ""))
    .join("")
    .slice(0, 3);

  // Aucune initiale exploitable : un blason neutre, jamais « SV ». Afficher le sigle de
  // SportVision à la place de l'écusson d'un club, c'est signer la photo d'un autre.
  if (!initiales) {
    return (
      <View style={[style, s.ecussonVide]}>
        <Ionicons name="shield-outline" size={taille * 0.46} color={C.texteFaible} />
      </View>
    );
  }
  return (
    <View style={[style, s.ecussonVide]}>
      <Text style={{ color: C.texteDoux, fontFamily: P.titre, fontSize: taille * 0.34 }}>{initiales}</Text>
    </View>
  );
}

/**
 * Une ligne du calendrier.
 *
 * LES DEUX ECUSSONS (25/09/2026). Signale par Fouka : « je vois toujours pas nos logos a nous ».
 * La carte n'en affichait aucun, et n'en recevait aucun — ni le notre, ni celui de l'adversaire.
 * Un match sans blason, c'est une ligne de tableur ; avec les deux, c'est une affiche.
 *
 * Le notre vient du club de la personne, l'adversaire de l'annuaire federal (130 adversaires de
 * la saison, tous enrichis le 25/09). Quand l'un manque, un blason neutre prend sa place : on ne
 * met jamais notre sigle a la place de l'ecusson d'un club.
 *
 * Ils ne s'affichent QUE sur un match. Un entrainement n'oppose personne, et deux blasons
 * identiques face a face n'auraient aucun sens.
 */
export function CarteEvenement({
  e, onPress, ecussonClub,
}: { e: Evenement; onPress?: () => void; ecussonClub?: string | null }) {
  const couleur = COULEUR_GENRE[e.genre];
  const heure = heureCourte(e.heure);
  const issue = issueDuMatch(e.score);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={[
        e.genre === "match" ? "Match" : e.genre === "entrainement" ? "Entraînement" : "Événement",
        e.genre === "match" && e.adversaire ? `contre ${e.adversaire}` : e.titre,
        quand(e.date),
        heure ?? "",
        e.score ? `score ${e.score}` : "",
      ].filter(Boolean).join(", ")}
      style={({ pressed }) => [s.carte, s.ligne, pressed && onPress ? { opacity: 0.8 } : null]}
    >
      <View style={[s.pastilleDate, { borderColor: couleur + "55" }]}>
        <Text style={s.pastilleJour}>{jourNumero(e.date)}</Text>
        <Text style={[s.pastilleMois, { color: couleur }]}>{moisCourt(e.date)}</Text>
      </View>

      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name={ICONE_GENRE[e.genre]} size={13} color={couleur} />
          <Text style={[s.genre, { color: e.statut ? C.alerte : couleur }]}>
            {e.statut === "reporte" ? "Match · reporté"
              : e.statut === "annule" ? "Match · annulé"
              : e.genre === "match"
              // Le calendrier de la famille ne dit pas qui recoit : on ne l'invente pas.
              ? (e.domicile === undefined ? "Match" : e.domicile ? "Match · domicile" : "Match · extérieur")
              : e.genre === "entrainement" ? "Entraînement"
              : e.genre === "rendez_vous" ? "Rendez-vous" : "Événement"}
          </Text>
        </View>
        {/* Sur un match, on nomme l'adversaire. Repeter le nom de sa propre equipe dans le titre
            ne dit rien a celui qui en fait partie, et mange deux lignes sur trois. */}
        <Text
          style={[s.titreCarte, e.statut === "annule" ? s.barre : null]}
          numberOfLines={2}
        >
          {e.genre === "match" && e.adversaire ? e.adversaire : e.titre}
        </Text>
        <Text style={s.detail} numberOfLines={1}>
          {[quand(e.date), heure].filter(Boolean).join(" · ")}
        </Text>
        {e.lieu ? <Text style={s.detail} numberOfLines={1}>{e.lieu}</Text> : null}
        {e.genre === "match" && e.equipe ? <Text style={s.equipe}>{e.equipe}</Text> : null}
      </View>

      {/* Les deux blasons, sur un match seulement. Petits : ils identifient, ils ne decorent pas,
          et la ligne doit rester lisible sur un telephone tenu d'une main. */}
      {e.genre === "match" ? (
        <View style={s.affiche}>
          <Ecusson url={ecussonClub} nom={e.equipe} taille={26} />
          <Text style={s.contre}>{e.domicile === false ? "@" : "vs"}</Text>
          <Ecusson url={e.ecussonAdversaire} nom={e.adversaire} taille={26} neutre={!e.ecussonAdversaire} />
        </View>
      ) : null}

      {/* Le score prend la place de la fleche : c'est ce qu'on vient lire sur un match joue.
          Le mot « victoire » ou « défaite » l'accompagne, parce qu'une couleur seule n'est pas
          lisible par tout le monde. */}
      {e.score ? (
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          <Text style={s.score}>{e.score}</Text>
          {issue ? (
            <Text style={[s.issue, { color: issue === "gagne" ? C.succes : issue === "perdu" ? C.danger : C.texteFaible }]}>
              {MOT_ISSUE[issue]}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  carte: {
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, borderColor: C.bordure,
    padding: E.m,
  },
  ligne: { flexDirection: "row", alignItems: "center", gap: E.m },
  affiche: { flexDirection: "row", alignItems: "center", gap: 5 },
  contre: { color: C.texteFaible, fontFamily: P.texteFort, fontSize: 10.5 },
  pastilleDate: {
    width: 52, height: 56, borderRadius: R.m, borderWidth: 1,
    alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.04)",
  },
  pastilleJour: { color: C.texte, fontFamily: P.titre, fontSize: 20, lineHeight: 24 },
  pastilleMois: { fontFamily: P.texteFort, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5 },
  genre: { fontFamily: P.texteFort, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.7 },
  titreCarte: { color: C.texte, fontFamily: P.titreFort, fontSize: 16 },
  // Un match annulé se lit barré : la couleur seule ne suffit pas, et le titre reste utile.
  barre: { textDecorationLine: "line-through", color: C.texteDoux },
  detail: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5 },
  equipe: { color: C.texteFaible, fontFamily: P.texteMoyen, fontSize: 12 },
  score: { color: C.texte, fontFamily: P.titre, fontSize: 19, fontVariant: ["tabular-nums"] },
  issue: { fontFamily: P.texteFort, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.6 },
  ecussonVide: {
    backgroundColor: "rgba(255,255,255,.06)", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: C.bordure,
  },
});
