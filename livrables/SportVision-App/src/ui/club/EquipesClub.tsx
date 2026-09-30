// LES ÉQUIPES DU CLUB, EN NATIF (30/09/2026).
//
// == CE QUE LA BASE CONTIENT VRAIMENT, ET CE QUE ÇA A CHANGÉ AU DESSIN =========================
//
// J'ai d'abord écrit cet écran avec un en-tête par catégorie, un effectif et une couleur d'équipe.
// Puis j'ai regardé les vraies lignes, et les trois idées tombaient :
//
//   - `club_teams.members` vaut 0 ou NULL sur les 55 équipes en base. La colonne existe, Club+ la
//     lit (`playerCount: row.members ?? 0`), aucun club ne l'a jamais remplie. Un écran fidèle au
//     premier jet aurait donc affiché « Effectif non renseigné » vingt-six fois de suite : une
//     colonne de reproches là où on cherche une équipe. On n'affiche le nombre que s'il existe.
//
//   - `club_teams.couleur` est NULL partout, et Club+ ne l'écrit nulle part. Un bandeau « couleur du
//     club » aurait donc été bleu sur toutes les cartes : de la décoration qui n'informe de rien.
//     La pastille porte la CATÉGORIE, qui est renseignée sur 55 lignes sur 55.
//
//   - 18 catégories pour 55 équipes, dont beaucoup n'en comptent qu'une, et 19 équipes dont le nom
//     EST la catégorie (« U10 » dans le groupe « U10 »). Dix-huit en-têtes pour cinquante-cinq
//     lignes, la moitié répétant la ligne suivante : on lit moins bien, pas mieux.
//
// D'OÙ CE DESSIN : une seule liste, déjà triée par âge, et une pastille de catégorie à gauche de
// chaque carte. C'est exactement la grammaire de `CarteEvenement`, qui porte sa date au même
// endroit — on réutilise le vocabulaire visuel de l'application au lieu d'en inventer un second.
//
// LES CATÉGORIES SONT LUES, PAS DÉCIDÉES ICI. Aucun seuil n'est écrit en dur. La règle « U10 et U11
// ensemble, séparé à partir de U12 » que Fouka veut pour les GALERIES est une décision de club :
// elle attend sa discussion avec les coachs et elle vivra en base, configurable par club.
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Ecran, Probleme, Vide } from "../Ecran";
import { type EquipeDuClub, type MonClub } from "../../lib/club";
import { C, E, R, TOUCHE } from "../../theme/couleurs";
import { P } from "../../theme/polices";

/** Au-delà, on cherche plutôt qu'on parcourt. En dessous, un champ de recherche encombre. */
const SEUIL_RECHERCHE = 8;

/**
 * Les teintes de la pastille : LES TROIS COULEURS DE MARQUE, ET PAS UNE DE PLUS.
 *
 * J'avais ajouté le vert et l'orange pour varier. Regardé sur le simulateur : « U8 » sortait en
 * vert et « U9 » en orange, c'est-à-dire dans les deux couleurs que toute l'application réserve au
 * succès et à l'alerte. Une catégorie d'âge n'est ni un succès ni une alerte. Une couleur qui veut
 * dire quelque chose ailleurs ne peut pas servir de décor ici.
 */
const TEINTES = [C.accent, C.cyan, C.violet];

export function EquipesClub({
  club, equipes, chargement, panne, surRecharger, surWeb,
}: {
  club: MonClub;
  equipes: EquipeDuClub[];
  chargement: boolean;
  panne: boolean;
  surRecharger: () => void;
  surWeb: (chemin: string) => void;
}) {
  const [recherche, setRecherche] = useState("");

  const filtrees = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    if (!q) return equipes;
    return equipes.filter((e) =>
      `${e.nom} ${e.categorie ?? ""} ${e.coach ?? ""}`.toLowerCase().includes(q));
  }, [equipes, recherche]);

  // Le total des joueurs ne s'affiche que s'il veut dire quelque chose : voir l'en-tête du fichier,
  // `members` est à zéro sur toutes les lignes en base aujourd'hui.
  const joueurs = equipes.reduce((total, e) => total + (e.effectif ?? 0), 0);
  const categories = new Set(equipes.map((e) => pastille(e).cle)).size;

  return (
    <Ecran enCours={chargement} teinte="violet" rafraichir={surRecharger}>
      <View style={{ gap: 4 }}>
        <Text style={s.titre}>Équipes</Text>
        <Text style={s.sous} numberOfLines={1}>
          {equipes.length
            ? [
                `${equipes.length} ${equipes.length > 1 ? "équipes" : "équipe"}`,
                categories > 1 ? `${categories} catégories` : null,
                joueurs ? `${joueurs} joueurs` : null,
              ].filter(Boolean).join(" · ")
            : club.nom}
        </Text>
      </View>

      {equipes.length > SEUIL_RECHERCHE ? (
        <View style={s.recherche}>
          <Ionicons name="search" size={17} color={C.texteFaible} />
          <TextInput
            value={recherche}
            onChangeText={setRecherche}
            placeholder="Rechercher une équipe, un coach"
            placeholderTextColor={C.texteFaible}
            style={s.champ}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Rechercher une équipe"
          />
          {recherche ? (
            <Pressable onPress={() => setRecherche("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Effacer la recherche">
              <Ionicons name="close-circle" size={18} color={C.texteFaible} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {chargement && !equipes.length ? (
        <View style={{ paddingVertical: E.xl * 2, alignItems: "center" }}>
          <ActivityIndicator color={C.accent} />
        </View>
      ) : panne ? (
        <Probleme surReessayer={surRecharger} />
      ) : filtrees.length ? (
        <View style={{ gap: E.s }}>
          {filtrees.map((e) => {
            const p = pastille(e);
            // La catégorie ne se répète pas quand le nom la porte déjà : « U10 » sous « U10 ».
            const categorieUtile = e.categorie && e.categorie.trim() !== e.nom.trim() ? e.categorie : null;
            const detail = e.coach ? `Coach ${e.coach}` : categorieUtile;
            return (
              <Pressable
                key={e.id}
                onPress={() => surWeb(`/teams/${e.id}`)}
                accessibilityRole="button"
                accessibilityLabel={[
                  e.nom,
                  e.coach ? `coach ${e.coach}` : "",
                  e.effectif ? `${e.effectif} joueurs` : "",
                ].filter(Boolean).join(", ")}
                style={({ pressed }) => [s.carte, pressed ? { opacity: 0.85 } : null]}
              >
                <View style={[s.pastille, { borderColor: p.teinte + "55" }]}>
                  <Text style={[s.pastilleTexte, { color: p.teinte }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
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
          })}
        </View>
      ) : (
        <Vide
          titre={equipes.length ? "Aucune équipe trouvée" : "Aucune équipe"}
          texte={
            equipes.length
              ? "Aucune équipe ne correspond à cette recherche. Essayez une catégorie, comme « U11 », ou le nom d'un coach."
              : "Créez les équipes du club dans Club+ : le calendrier, les effectifs et les galeries s'y rattachent ensuite."
          }
        />
      )}

      <Pressable
        onPress={() => surWeb("/teams")}
        accessibilityRole="button"
        accessibilityLabel="Gérer les équipes dans Club plus"
        style={({ pressed }) => [s.lienWeb, pressed ? { opacity: 0.85 } : null]}
      >
        <Ionicons name="settings-outline" size={16} color={C.texteDoux} />
        <Text style={s.lienWebTexte}>Créer ou modifier une équipe</Text>
        <Ionicons name="chevron-forward" size={15} color={C.texteFaible} />
      </Pressable>
    </Ecran>
  );
}

/**
 * La pastille de gauche : la catégorie de l'équipe, et sa teinte.
 *
 * L'âge quand il y en a un — « U14 », qui est le mot du club. Sinon les trois premières lettres de
 * la catégorie : « SEN » pour Seniors, « VÉT » pour Vétérans. Une abréviation normale, pas un code
 * inventé, et la catégorie complète reste écrite sur la carte quand elle diffère du nom.
 *
 * La teinte est DÉTERMINISTE : la même catégorie garde la même couleur d'un lancement à l'autre, et
 * d'un écran à l'autre. Une couleur qui change de place ne se lit plus, elle clignote.
 */
function pastille(e: EquipeDuClub): { cle: string; libelle: string; teinte: string } {
  const source = `${e.categorie ?? ""} ${e.nom}`;
  const age = source.match(/\bU\s?(\d{1,2})\b/i);
  const cle = age ? `u${age[1]}` : (e.categorie ?? "").trim().toLowerCase() || "autres";
  const libelle = age
    ? `U${age[1]}`
    : ((e.categorie ?? "").trim().slice(0, 3).toUpperCase() || "ÉQ");
  let somme = 0;
  for (let i = 0; i < cle.length; i++) somme = (somme + cle.charCodeAt(i)) % 997;
  return { cle, libelle, teinte: TEINTES[somme % TEINTES.length] };
}

const s = StyleSheet.create({
  titre: { color: C.texte, fontFamily: P.titre, fontSize: 26, letterSpacing: -0.6 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5 },

  recherche: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    height: 48, paddingHorizontal: E.m, borderRadius: R.l,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  champ: { flex: 1, color: C.texte, fontFamily: P.texte, fontSize: 15 },

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

  lienWeb: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    minHeight: TOUCHE, paddingHorizontal: E.m, borderRadius: R.l,
    backgroundColor: "rgba(255,255,255,.04)", borderWidth: 1, borderColor: C.bordure,
  },
  lienWebTexte: { flex: 1, color: C.texteDoux, fontFamily: P.texteFort, fontSize: 14 },
});
