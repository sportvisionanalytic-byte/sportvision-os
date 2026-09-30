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
import { CarteEquipe, pastille } from "./CarteEquipe";
import { mesEquipes, type EquipeDuClub, type MonClub } from "../../lib/club";
import { C, E, R, TOUCHE } from "../../theme/couleurs";
import { P } from "../../theme/polices";

/** Au-delà, on cherche plutôt qu'on parcourt. En dessous, un champ de recherche encombre. */
const SEUIL_RECHERCHE = 8;

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
  const miennes = useMemo(() => mesEquipes(club, equipes), [club, equipes]);

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
        <View style={{ gap: E.l }}>
          {/* MES ÉQUIPES D'ABORD, et c'est tout l'objet de la demande de Fouka : « il faut que le
              coach voie quelle catégorie il a ». Un coach ouvrait cet écran sur vingt-six équipes
              sans que rien ne désigne la sienne. La section disparaît d'elle-même pour qui n'a pas
              de périmètre — un président, un secrétaire : chez eux, tout le club est à eux. */}
          {!recherche.trim() && miennes.length ? (
            <View style={{ gap: E.s }}>
              <View style={s.enteteSection}>
                <Text style={s.libelleSection}>Mes équipes</Text>
                <Text style={s.compte}>{miennes.length}</Text>
              </View>
              {miennes.map((e) => (
                <CarteEquipe key={`mienne-${e.id}`} e={e} mienne onPress={() => surWeb(`/teams/${e.id}`)} />
              ))}
            </View>
          ) : null}

          <View style={{ gap: E.s }}>
            {!recherche.trim() && miennes.length ? (
              <View style={s.enteteSection}>
                <Text style={s.libelleSection}>Tout le club</Text>
                <Text style={s.compte}>{filtrees.length}</Text>
              </View>
            ) : null}
            {filtrees.map((e) => (
              <CarteEquipe key={e.id} e={e} onPress={() => surWeb(`/teams/${e.id}`)} />
            ))}
          </View>
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

const s = StyleSheet.create({
  titre: { color: C.texte, fontFamily: P.titre, fontSize: 26, letterSpacing: -0.6 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5 },

  recherche: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    height: 48, paddingHorizontal: E.m, borderRadius: R.l,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  champ: { flex: 1, color: C.texte, fontFamily: P.texte, fontSize: 15 },

  enteteSection: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: E.s },
  libelleSection: { color: C.texte, fontFamily: P.titre, fontSize: 15, textTransform: "uppercase", letterSpacing: 0.9 },
  compte: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5 },

  lienWeb: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    minHeight: TOUCHE, paddingHorizontal: E.m, borderRadius: R.l,
    backgroundColor: "rgba(255,255,255,.04)", borderWidth: 1, borderColor: C.bordure,
  },
  lienWebTexte: { flex: 1, color: C.texteDoux, fontFamily: P.texteFort, fontSize: 14 },
});
