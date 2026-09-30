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
  club, titre, equipes, chargement, panne, surRecharger, surWeb, surInviter, inviteAutorisee,
}: {
  club: MonClub;
  /**
   * Le titre de l'écran, qui est celui de l'onglet.
   *
   * Vu sur le simulateur : l'onglet disait « Mon équipe » et l'écran « Équipes ». Deux noms pour
   * la même destination, c'est déjà une hésitation ; ici c'est en plus le nom que Club+ donne au
   * coach (« Mon équipe U16A »), donc le seul juste.
   */
  titre: string;
  equipes: EquipeDuClub[];
  chargement: boolean;
  panne: boolean;
  surRecharger: () => void;
  surWeb: (chemin: string) => void;
  /** Inviter dans une équipe, ou `undefined` si la base ne lui en donne pas le droit. */
  surInviter?: (e: EquipeDuClub) => void;
  /** Le droit d'inviter dans CETTE équipe. Absent : on ne propose rien. */
  inviteAutorisee?: (e: EquipeDuClub) => boolean;
}) {
  const [recherche, setRecherche] = useState("");

  /**
   * UN PÉRIMÈTRE BORNE LA LISTE, IL NE LA RANGE PAS (30/09/2026, décision de Fouka).
   *
   * « Faut pas que le coach voie tout. Faut qu'il voie uniquement ce qu'il a besoin de voir : son
   * équipe, ses effectifs, ses galeries à lui, ses matchs à lui. »
   *
   * Cet écran montrait « Mes équipes » puis « Tout le club », les vingt-six. C'était exactement le
   * mélange qu'il refuse. Quand la personne a un périmètre, la liste EST son périmètre ; les rôles
   * qui administrent — président, secrétaire, community manager, direction — n'en ont pas, et
   * voient donc tout, ce qui est leur métier.
   *
   * La base, elle, lui laisse lire les trente équipes du club : c'est l'écran qui borne ici, pas
   * la RLS. Signalé à Fouka, parce que ce n'est pas au téléphone de tenir cette frontière seul.
   */
  const miennes = useMemo(() => mesEquipes(club, equipes), [club, equipes]);
  const aUnPerimetre = club.equipes.length > 0;
  const visibles = aUnPerimetre ? miennes : equipes;

  const filtrees = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    if (!q) return visibles;
    return visibles.filter((e) =>
      `${e.nom} ${e.categorie ?? ""} ${e.coach ?? ""}`.toLowerCase().includes(q));
  }, [visibles, recherche]);

  // Le total des joueurs ne s'affiche que s'il veut dire quelque chose : voir l'en-tête du fichier,
  // `members` est à zéro sur toutes les lignes en base aujourd'hui.
  const joueurs = visibles.reduce((total, e) => total + (e.effectif ?? 0), 0);
  const categories = new Set(visibles.map((e) => pastille(e).cle)).size;

  return (
    <Ecran enCours={chargement} teinte="violet" rafraichir={surRecharger}>
      <View style={{ gap: 4 }}>
        <Text style={s.titre} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{titre}</Text>
        <Text style={s.sous} numberOfLines={1}>
          {visibles.length
            ? [
                `${visibles.length} ${visibles.length > 1 ? "équipes" : "équipe"}`,
                categories > 1 ? `${categories} catégories` : null,
                joueurs ? `${joueurs} joueurs` : null,
              ].filter(Boolean).join(" · ")
            : club.nom}
        </Text>
      </View>

      {/* Le seuil compte ce qu'on VOIT, pas ce que la base rend : un coach avait un champ de
          recherche au-dessus d'une seule équipe, parce que le club en compte trente. */}
      {visibles.length > SEUIL_RECHERCHE ? (
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
          {filtrees.map((e) => (
            <CarteEquipe
              key={e.id}
              e={e}
              mienne={aUnPerimetre}
              onPress={() => surWeb(`/teams/${e.id}`)}
              surInviter={surInviter && inviteAutorisee?.(e) ? () => surInviter(e) : undefined}
            />
          ))}
        </View>
      ) : (
        <Vide
          titre={visibles.length ? "Aucune équipe trouvée" : aUnPerimetre ? "Aucune équipe pour vous" : "Aucune équipe"}
          texte={
            visibles.length
              ? "Aucune équipe ne correspond à cette recherche. Essayez une catégorie, comme « U11 », ou le nom d'un coach."
              : aUnPerimetre
                // Le périmètre est un tableau de NOMS : une équipe renommée cesse d'y correspondre,
                // et l'écran se viderait sans rien dire. On nomme la cause, et qui la corrige.
                ? `Votre club vous a rattaché à ${club.equipes.join(", ")}, mais aucune équipe de ce nom n'existe aujourd'hui. Demandez-lui de mettre votre périmètre à jour.`
                : "Créez les équipes du club dans Club+ : le calendrier, les effectifs et les galeries s'y rattachent ensuite."
          }
        />
      )}

      {/* Créer ou renommer une équipe relève de la direction du club : on ne le propose pas à qui
          n'a qu'un périmètre. */}
      {aUnPerimetre ? null : (
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
      )}
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
