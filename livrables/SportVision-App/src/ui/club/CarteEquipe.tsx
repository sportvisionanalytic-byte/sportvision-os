// LA LIGNE D'UNE ÉQUIPE, ÉCRITE UNE FOIS (30/09/2026).
//
// L'accueil du club montre « Mes équipes », l'onglet Équipes montre les vingt-six. Ce sont les
// mêmes objets, donc la même ligne : deux dessins voisins mais pas identiques, c'est exactement ce
// qui donne l'impression de deux écrans recollés.
//
// LA PASTILLE PORTE LA CATÉGORIE, et pas une couleur d'équipe. Vérifié en base le 30/09 :
// `club_teams.couleur` est NULL sur les 55 équipes, `categorie` est renseignée sur les 55. Une
// pastille de couleur aurait donc été bleue partout, c'est-à-dire décorative.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { type EquipeDuClub } from "../../lib/club";
import { C, E, R, TOUCHE } from "../../theme/couleurs";
import { P } from "../../theme/polices";

/** Les trois couleurs de marque, et pas une de plus : le vert et l'orange veulent dire succès et
 *  alerte partout ailleurs dans l'application. Une catégorie d'âge n'est ni l'un ni l'autre. */
const TEINTES = [C.accent, C.cyan, C.violet];

export function CarteEquipe({
  e, onPress, mienne,
}: {
  e: EquipeDuClub;
  onPress: () => void;
  /** Une équipe dont la personne a la charge : on lui dit alors où inviter ses joueurs. */
  mienne?: boolean;
}) {
  const p = pastille(e);
  // La catégorie ne se répète pas quand le nom la porte déjà : « U10 » sous une pastille « U10 ».
  const categorieUtile = e.categorie && e.categorie.trim() !== e.nom.trim() ? e.categorie : null;
  // SUR SES PROPRES ÉQUIPES, ON DIT OÙ INVITER. Fouka : « que le coach puisse inviter ses joueurs,
  // parents, etc. » Dans Club+, « Ajouter un joueur » vit sur la fiche de l'équipe, et un coach y a
  // le droit (canCreate : seuls `viewer` et `sponsor_manager` en sont exclus). On ne double donc pas
  // le bouton : on nomme ce que la carte ouvre, ce qui vaut mieux que deux cibles au même endroit.
  const detail = mienne
    ? "Effectif, calendrier, inviter un joueur"
    : (e.coach ? `Coach ${e.coach}` : categorieUtile);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[
        e.nom,
        mienne ? "ouvrir la fiche pour inviter un joueur" : "",
        e.coach && !mienne ? `coach ${e.coach}` : "",
        e.effectif ? `${e.effectif} joueurs` : "",
      ].filter(Boolean).join(", ")}
      style={({ pressed }) => [s.carte, pressed ? { opacity: 0.85 } : null]}
    >
      <View style={[s.pastille, { borderColor: p.teinte + "55" }]}>
        <Text
          style={[s.pastilleTexte, { color: p.teinte }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {p.libelle}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={s.nom} numberOfLines={1}>{e.nom}</Text>
        {detail ? <Text style={s.detail} numberOfLines={1}>{detail}</Text> : null}
      </View>
      {e.effectif ? (
        <View style={s.compteur}>
          <Ionicons name="people" size={12} color={C.texteDoux} />
          <Text style={s.compteurTexte}>{e.effectif}</Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={C.texteFaible} />
    </Pressable>
  );
}

/**
 * La pastille : la catégorie de l'équipe, et sa teinte.
 *
 * L'âge quand il y en a un — « U14 », qui est le mot du club. Sinon les trois premières lettres de
 * la catégorie : « SEN » pour Seniors, « VÉT » pour Vétérans, « GAR » pour Gardiens de but. Une
 * abréviation normale, pas un code inventé, et la catégorie complète reste écrite sur la carte
 * quand elle diffère du nom.
 *
 * La teinte est DÉTERMINISTE : la même catégorie garde la même couleur d'un écran à l'autre et
 * d'un lancement à l'autre. Une couleur qui change de place ne se lit plus, elle clignote.
 */
export function pastille(e: EquipeDuClub): { cle: string; libelle: string; teinte: string } {
  const source = `${e.categorie ?? ""} ${e.nom}`;
  const age = source.match(/\bU\s?(\d{1,2})\b/i);
  const cle = age ? `u${age[1]}` : (e.categorie ?? "").trim().toLowerCase() || "autres";
  const libelle = age ? `U${age[1]}` : ((e.categorie ?? "").trim().slice(0, 3).toUpperCase() || "ÉQ");
  let somme = 0;
  for (let i = 0; i < cle.length; i++) somme = (somme + cle.charCodeAt(i)) % 997;
  return { cle, libelle, teinte: TEINTES[somme % TEINTES.length] };
}

const s = StyleSheet.create({
  carte: {
    flexDirection: "row", alignItems: "center", gap: E.m,
    minHeight: TOUCHE + 14, padding: E.s, paddingRight: E.m,
    borderRadius: R.l, backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  // Les mêmes dimensions que la pastille de date de `CarteEvenement` : c'est la même place, donc
  // la même forme, sinon deux listes voisines ne s'alignent plus.
  pastille: {
    width: 46, height: 46, borderRadius: R.m, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 3, backgroundColor: "rgba(255,255,255,.04)", borderWidth: 1,
  },
  pastilleTexte: { fontFamily: P.titreFort, fontSize: 14, letterSpacing: -0.2 },
  nom: { color: C.texte, fontFamily: P.titreFort, fontSize: 15.5 },
  detail: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13 },
  compteur: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: E.s, paddingVertical: 4, borderRadius: R.pill,
    backgroundColor: "rgba(255,255,255,.05)", borderWidth: 1, borderColor: C.bordure,
  },
  compteurTexte: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 12 },
});
