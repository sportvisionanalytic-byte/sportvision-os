// LA GRILLE DU MOIS, ÉCRITE UNE FOIS (30/09/2026).
//
// Elle vivait dans `app/(app)/calendrier.tsx`. L'espace club en a besoin à l'identique : même
// quadrillage, mêmes pastilles, mêmes couleurs par genre. La recopier, c'était garantir qu'un jour
// les deux calendriers ne se ressembleraient plus tout à fait — et c'est précisément le défaut que
// Fouka a signalé trois fois sur Club+ (« on dirait le site web collé sur l'app »).
//
// Une pastille par genre d'événement, et le détail du jour touché en dessous. Sur un téléphone, la
// grille seule affiche des points illisibles : elle ne remplace pas la liste, elle la complète.
import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CarteEvenement } from "./Cartes";
import { versDate } from "../lib/dates";
import { type Evenement } from "../lib/donnees";
import { C, E, R } from "../theme/couleurs";
import { P } from "../theme/polices";

/** La semaine française commence le lundi. */
const JOURS_COURTS = ["L", "M", "M", "J", "V", "S", "D"];

export const COULEUR_GENRE: Record<string, string> = {
  match: C.accentClair, entrainement: C.cyan, evenement: C.violet, rendez_vous: C.alerte,
};

export function MoisGrille({
  mois, evenements, aujourdhui, jourChoisi, surJour, surEvenement, ecussonClub,
}: {
  /** Le mois affiché, au format « AAAA-MM ». */
  mois: string;
  evenements: Evenement[];
  aujourdhui: string;
  jourChoisi: string | null;
  surJour: (jour: string | null) => void;
  /** Sans cette fonction, les cartes du jour ouvert ne sont pas cliquables — c'est voulu côté club. */
  surEvenement?: (e: Evenement) => void;
  ecussonClub?: string | null;
}) {
  const annee = Number(mois.slice(0, 4));
  const numeroMois = Number(mois.slice(5, 7));
  const premier = new Date(annee, numeroMois - 1, 1);
  const nbJours = new Date(annee, numeroMois, 0).getDate();
  // getDay() rend 0 pour dimanche : on décale pour que la semaine commence le lundi.
  const decalage = (premier.getDay() + 6) % 7;

  const parJour = useMemo(() => {
    const carte = new Map<string, Evenement[]>();
    for (const e of evenements) {
      const liste = carte.get(e.date) ?? [];
      liste.push(e);
      carte.set(e.date, liste);
    }
    return carte;
  }, [evenements]);

  const cases: (string | null)[] = [
    ...Array.from({ length: decalage }, () => null),
    ...Array.from({ length: nbJours }, (_, i) =>
      `${annee}-${String(numeroMois).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`),
  ];

  const jour = jourChoisi && parJour.has(jourChoisi) ? jourChoisi : null;
  const duJour = jour ? parJour.get(jour) ?? [] : [];

  return (
    <View style={{ gap: E.m }}>
      <View style={s.grille}>
        {JOURS_COURTS.map((j, i) => (
          <Text key={`${j}-${i}`} style={s.enteteJour}>{j}</Text>
        ))}
        {cases.map((date, i) => {
          if (!date) return <View key={`vide-${i}`} style={s.caseJour} />;
          const dedans = parJour.get(date) ?? [];
          const actif = date === jour;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: actif, disabled: dedans.length === 0 }}
              // Un jour vide se dit « rien de prevu » : sans ca, la lecture vocale annonce
              // un numero seul et on ne sait pas s'il se passe quelque chose.
              accessibilityLabel={
                dedans.length
                  ? `${Number(date.slice(8, 10))}, ${dedans.length} ${dedans.length > 1 ? "evenements" : "evenement"}`
                  : `${Number(date.slice(8, 10))}, rien de prevu`
              }
              key={date}
              onPress={() => surJour(dedans.length ? (actif ? null : date) : null)}
              style={[s.caseJour, actif && s.caseActive, date === aujourdhui && !actif && s.caseAujourdhui]}
            >
              <Text style={[s.numeroJour, actif && { color: C.texte }, !dedans.length && { color: C.texteFaible }]}>
                {Number(date.slice(8, 10))}
              </Text>
              <View style={s.points}>
                {dedans.slice(0, 3).map((e, k) => (
                  <View key={k} style={[s.point, { backgroundColor: COULEUR_GENRE[e.genre] ?? C.texteFaible }]} />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>

      {jour ? (
        <View style={{ gap: E.s }}>
          <Text style={s.libelleSection}>
            {versDate(jour).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
          </Text>
          {duJour.map((e) => (
            <CarteEvenement
              key={e.id}
              e={e}
              ecussonClub={ecussonClub}
              onPress={surEvenement ? () => surEvenement(e) : undefined}
            />
          ))}
        </View>
      ) : (
        <Text style={s.aide}>Touchez un jour marqué pour voir ce qu'il contient.</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  grille: { flexDirection: "row", flexWrap: "wrap", backgroundColor: C.surface, borderRadius: R.xl, borderWidth: 1, borderColor: C.bordure, padding: E.s },
  enteteJour: { width: `${100 / 7}%`, textAlign: "center", color: C.texteFaible, fontFamily: P.texteFort, fontSize: 11, paddingBottom: E.xs },
  caseJour: { width: `${100 / 7}%`, height: 48, alignItems: "center", justifyContent: "center", gap: 3, borderRadius: R.m },
  caseActive: { backgroundColor: "rgba(36,84,255,.22)" },
  caseAujourdhui: { borderWidth: 1, borderColor: "rgba(0,199,255,.45)" },
  numeroJour: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: 14 },
  points: { flexDirection: "row", gap: 3, height: 5 },
  point: { width: 5, height: 5, borderRadius: 3 },
  libelleSection: { color: C.texte, fontFamily: P.titre, fontSize: 15, textTransform: "uppercase", letterSpacing: 0.9 },
  aide: { color: C.texteFaible, fontFamily: P.texte, fontSize: 13, textAlign: "center" },
});
