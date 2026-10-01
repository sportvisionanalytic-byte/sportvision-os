// LE BANDEAU DE PARCOURS, EN HAUT DE L'ACCUEIL D'UN OPÉRATEUR (30/09/2026).
//
// Il existe parce que l'accueil était vide, et qu'il l'était pour TOUT LE MONDE : aucun des dix
// opérateurs n'a de mission à venir. Ce bandeau porte ce qui est vrai même ce jour-là — le grade,
// l'XP, ce qui a été fait.
//
// CE QU'IL NE FAIT PAS : calculer le grade. `profiles.grade` est posé par l'administration, il ne
// se déclenche pas tout seul au franchissement d'un seuil. Afficher un grade calculé
// contredirait le verrouillage des formations, qui lit cette colonne. On montre donc le grade
// ACCORDÉ, et l'XP sert seulement à dessiner la distance qui reste.
//
// POUR QUELQU'UN QUI N'A ENCORE RIEN, on invite au lieu de juger : « Débutant · 0 XP » posé en
// gros sur l'écran d'accueil de quelqu'un qui vient d'arriver, c'est un bulletin scolaire.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { Parcours as TypeParcours } from "../lib/os-formation";
import { C, E, R } from "../theme/couleurs";
import { P, T } from "../theme/polices";

export function BandeauParcours({
  parcours, missionsRealisees,
}: {
  parcours: TypeParcours;
  missionsRealisees: number;
}) {
  const g = parcours.grade;
  const debut = parcours.xp === 0 && parcours.mesFormations.length === 0;

  return (
    <Pressable
      onPress={() => router.push("/formation")}
      accessibilityRole="button"
      accessibilityLabel={
        debut
          ? "Commencer une formation"
          : `Grade ${g.nom}, ${parcours.xp} XP. Ouvrir le centre de formation.`
      }
      style={({ pressed }) => [s.bloc, pressed ? { opacity: 0.9 } : null]}
    >
      {debut ? (
        <View style={{ gap: 6 }}>
          {/* `ligneDebut` ET PAS `ligneHaut` (01/10/2026, vu à l'écran). `ligneHaut` écarte ses
              deux enfants aux deux bords, ce qui est juste pour « Grade · XP ». Ici les deux
              enfants sont une icône et le titre qu'elle annonce : écartés, l'icône restait collée
              au bord gauche et le titre partait vers la droite, sans rien entre les deux. On les
              colle, et le titre prend la place qui reste. */}
          <View style={s.ligneDebut}>
            <Ionicons name="school-outline" size={18} color={C.accentClair} />
            <Text style={s.gradeNom}>Votre parcours commence</Text>
          </View>
          <Text style={s.invite}>
            Les formations du Centre donnent de l'XP et des certifications. C'est ce qui fait
            monter votre grade, et le grade ouvre des missions.
          </Text>
          <Text style={s.lien}>Voir les formations</Text>
        </View>
      ) : (
        <View style={{ gap: E.s }}>
          <View style={s.ligneHaut}>
            <Text style={s.gradeNom}>{g.nom}</Text>
            <Text style={s.xp}>{parcours.xp.toLocaleString("fr-FR")} XP</Text>
          </View>

          {/* La barre n'apparaît qu'en cours de route. Au sommet, une barre pleine à 100 % se lit
              « il reste quelque chose » alors qu'il n'y a plus rien au-dessus. */}
          {g.suivant ? (
            <View style={{ gap: 5 }}>
              <View style={s.rail}>
                <View style={[s.jauge, { width: `${Math.max(2, Math.min(100, g.avancement))}%` }]} />
              </View>
              <Text style={s.reste}>
                {g.restant?.toLocaleString("fr-FR")} XP avant {g.suivant}
              </Text>
            </View>
          ) : (
            <Text style={s.reste}>Grade le plus élevé.</Text>
          )}

          <Text style={s.nuance}>
            Le grade est accordé par l'administration, il ne se déclenche pas au seuil.
          </Text>
        </View>
      )}

      <View style={s.separation} />

      <View style={s.chiffres}>
        <Chiffre n={missionsRealisees} libelle={missionsRealisees > 1 ? "missions" : "mission"} />
        <Chiffre n={parcours.terminees} libelle={parcours.terminees > 1 ? "formations" : "formation"} />
        <Chiffre n={parcours.certificationsActives} libelle={parcours.certificationsActives > 1 ? "certifications" : "certification"} />
      </View>
    </Pressable>
  );
}

/** Un zéro s'affiche, il ne se cache pas : « 0 certification » se lit, une case absente se devine. */
function Chiffre({ n, libelle }: { n: number; libelle: string }) {
  return (
    <View style={s.chiffre}>
      <Text style={[s.chiffreN, n === 0 ? { color: C.texteFaible } : null]}>{n}</Text>
      {/* `alignSelf: stretch` : sans lui, un libellé mesuré hors de sa colonne se tronque trop tôt. */}
      <Text style={s.chiffreL} numberOfLines={2}>{libelle}</Text>
    </View>
  );
}

/** Le kit qu'on a chez soi. Mesuré : une personne sur dix, mais c'est celle qui doit le ramener. */
export function CarteKit({ nom, depuis, reference }: { nom: string; depuis: string | null; reference: string | null }) {
  const jour = depuis ? new Date(depuis).toLocaleDateString("fr-FR") : null;
  return (
    <View style={s.kit}>
      <View style={s.kitRond}><Ionicons name="briefcase-outline" size={17} color={C.alerteTexte} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.kitTitre}>{nom} est chez vous</Text>
        <Text style={s.kitSous}>
          {[jour ? `Sorti le ${jour}` : null, reference ? `mission ${reference}` : null]
            .filter(Boolean).join(" · ")}
          {jour || reference ? ". " : ""}
          Son retour n'est pas enregistré : tant qu'il ne l'est pas, ce kit ne peut être réservé
          pour personne d'autre.
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bloc: {
    gap: E.m, padding: E.m, borderRadius: R.l,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  ligneHaut: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: E.s },
  ligneDebut: { flexDirection: "row", alignItems: "center", gap: E.s },
  gradeNom: { flexShrink: 1, color: C.texte, fontFamily: P.titre, fontSize: T.titreSection, letterSpacing: -0.4 },
  xp: { color: C.accentClair, fontFamily: P.texteFort, fontSize: 14 },
  rail: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,.08)", overflow: "hidden" },
  jauge: { height: 6, borderRadius: 3, backgroundColor: C.accentClair },
  reste: { color: C.texteDoux, fontFamily: P.texte, fontSize: 12.5 },
  nuance: { color: C.texteFaible, fontFamily: P.texte, fontSize: 11.5, lineHeight: 16 },
  invite: { alignSelf: "stretch", color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
  lien: { color: C.accentClair, fontFamily: P.texteFort, fontSize: 13.5 },
  separation: { height: StyleSheet.hairlineWidth, backgroundColor: C.bordure },
  chiffres: { flexDirection: "row", alignItems: "flex-start", gap: E.s },
  chiffre: { flex: 1, alignItems: "center", gap: 2 },
  chiffreN: { color: C.texte, fontFamily: P.titre, fontSize: 20, letterSpacing: -0.4 },
  chiffreL: { alignSelf: "stretch", color: C.texteDoux, fontFamily: P.texte, fontSize: 11.5, textAlign: "center", lineHeight: 15 },
  kit: {
    flexDirection: "row", alignItems: "flex-start", gap: E.m, padding: E.m, borderRadius: R.l,
    backgroundColor: "rgba(232,163,61,.07)", borderWidth: 1, borderColor: "rgba(232,163,61,.28)",
  },
  kitRond: {
    width: 32, height: 32, borderRadius: R.m, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(232,163,61,.12)", borderWidth: 1, borderColor: "rgba(232,163,61,.25)",
  },
  kitTitre: { alignSelf: "stretch", color: C.texte, fontFamily: P.texteFort, fontSize: 14.5 },
  kitSous: { alignSelf: "stretch", color: C.texteDoux, fontFamily: P.texte, fontSize: 12.5, lineHeight: 17.5 },
});
