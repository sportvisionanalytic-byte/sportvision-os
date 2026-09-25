// Le bandeau du parent : qui il consulte, comment changer, comment en ajouter un.
//
// CE QUI N'ALLAIT PAS (signalé par Fouka le 25/09/2026)
//
// « J'ai l'impression que je suis un joueur, alors que je dois sentir que je suis un parent. »
// Il avait raison, et la cause tenait en une ligne : le sélecteur ne s'affichait qu'à partir de
// deux enfants, et le bandeau avec lui. Un parent d'un seul enfant voyait donc un écran
// strictement identique à celui d'un joueur — son propre prénom nulle part, celui de son enfant
// nulle part, et aucun moyen d'en ajouter un deuxième.
//
// Le raisonnement d'origine n'était pas absurde : « un seul enfant, pas de choix à faire, donc
// pas de barre de choix ». Mais il confondait deux besoins. Choisir, oui, ça demande au moins
// deux options. SAVOIR DE QUI ON PARLE, non : c'est justement quand l'écran ressemble à celui
// d'un joueur qu'il faut le dire.
//
// Le bandeau s'affiche donc toujours, dès qu'un enfant est choisi. Et « Ajouter un enfant » est
// visible en permanence : un parent dont le deuxième enfant vient de s'inscrire au club ne doit
// pas avoir à deviner que ça se passe ailleurs.
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useFamille } from "../lib/famille";
import { C, E, R, TOUCHE } from "../theme/couleurs";
import { P } from "../theme/polices";

/** La barre de choix. Elle n'a de sens qu'à partir de deux enfants — là, le raisonnement tient. */
export function SelecteurEnfant() {
  const { sportifs, choisi, choisir } = useFamille();
  if (sportifs.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: E.s, paddingRight: E.l }}>
      {sportifs.map((s) => {
        const actif = choisi?.refId === s.refId && choisi?.kind === s.kind;
        return (
          <Pressable
            key={`${s.kind}:${s.refId}`}
            onPress={() => choisir(s)}
            accessibilityRole="button"
            accessibilityState={{ selected: actif }}
            accessibilityLabel={`Voir ${s.prenom}${s.enAttente ? ", rattachement en attente" : ""}`}
            style={[st.puce, actif && st.puceActive]}
          >
            <Text style={[st.texte, actif && st.texteActif]}>{s.prenom}</Text>
            {s.enAttente ? <View style={st.point} /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * « Vous consultez X », et le moyen d'en ajouter un autre.
 *
 * Affiché QUEL QUE SOIT le nombre d'enfants : c'est la seule chose qui distingue l'écran d'un
 * parent de celui d'un joueur.
 */
export function BandeauEnfant() {
  const { choisi, sportifs } = useFamille();
  const router = useRouter();
  if (!choisi) return null;

  return (
    <View style={st.bandeau}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={st.bandeauLabel}>
          {sportifs.length > 1 ? "Vous consultez" : "Espace parent · vous consultez"}
        </Text>
        <Text style={st.bandeauNom} numberOfLines={1}>
          {choisi.prenom} {choisi.nom}
          {choisi.categorie ? ` · ${choisi.categorie}` : ""}
        </Text>
        {choisi.enAttente ? (
          <Text style={st.attente}>Rattachement en attente de validation par le club</Text>
        ) : null}
      </View>

      <Pressable
        onPress={() => router.push("/connect/affiliations")}
        accessibilityRole="button"
        accessibilityLabel="Ajouter un enfant"
        hitSlop={8}
        style={({ pressed }) => [st.ajouter, pressed ? { opacity: 0.8 } : null]}
      >
        <Ionicons name="add" size={16} color={C.accentClair} />
        <Text style={st.ajouterTexte}>Ajouter</Text>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  puce: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: E.m, height: TOUCHE, borderRadius: R.pill,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  puceActive: { backgroundColor: "rgba(79,125,255,.18)", borderColor: "rgba(79,125,255,.5)" },
  texte: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: 13.5 },
  texteActif: { color: C.texte },
  point: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.alerte },
  bandeau: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, borderColor: C.bordure,
    paddingHorizontal: E.m, paddingVertical: 11,
  },
  bandeauLabel: {
    color: C.texteFaible, fontFamily: P.texteFort, fontSize: 10.5,
    textTransform: "uppercase", letterSpacing: 0.8,
  },
  bandeauNom: { color: C.texte, fontFamily: P.titreFort, fontSize: 15.5 },
  attente: { color: C.alerte, fontFamily: P.texte, fontSize: 11.5, lineHeight: 16 },
  ajouter: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 11, height: 34, borderRadius: R.pill,
    backgroundColor: "rgba(22,134,255,.14)", borderWidth: 1, borderColor: "rgba(22,134,255,.3)",
  },
  ajouterTexte: { color: C.accentClair, fontFamily: P.texteFort, fontSize: 12.5 },
});
