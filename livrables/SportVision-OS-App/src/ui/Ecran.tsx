// Le cadre commun a tous les ecrans : marges du telephone, glisser pour rafraichir, etat vide.
import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Lueur } from "./Fond";
import { Marque, Medaillon } from "./Marque";
import { Apparition } from "./Mouvement";
import { retourner } from "../lib/retour";
import { C, E, R, TOUCHE } from "../theme/couleurs";
import { P, T } from "../theme/polices";

export function Ecran({
  children, rafraichir, enCours, style, teinte, retour, retourLibelle,
}: {
  children: React.ReactNode;
  rafraichir?: () => void;
  enCours?: boolean;
  style?: ViewStyle;
  teinte?: "violet" | "cyan" | "bleu";
  /**
   * LA SORTIE D'UN ÉCRAN QUI N'EST PAS UN ONGLET (30/09/2026).
   *
   * Cinq écrans de l'OS ne tiennent pas dans la barre du bas — elle en porte cinq, l'application
   * en compte dix. On les atteint depuis « Mon espace », et sans cette flèche on n'en sortirait
   * QUE par un onglet : un écran dont la sortie n'est pas là où on est entré.
   *
   * La valeur est le REPLI, pas la destination : `retourner` recule d'un cran quand il y a un
   * cran, et ne se rabat sur ce chemin que si la pile est vide (notification, lien, application
   * relancée sur son dernier écran). La règle vit dans `src/lib/retour.ts`, pas ici.
   */
  retour?: string;
  retourLibelle?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: C.fond }}>
    <Lueur teinte={teinte} />
    <ScrollView
      style={{ flex: 1, backgroundColor: "transparent" }}
      contentContainerStyle={[
        // L'encoche en haut, la barre d'onglets en bas : sans ces marges, le titre passe sous
        // l'heure du telephone et la derniere ligne sous les onglets — constate sur « Se
        // deconnecter », coupe en deux par la barre.
        {
          paddingTop: insets.top + E.m,
          paddingBottom: insets.bottom + 72 + E.l,
          paddingHorizontal: E.l,
          gap: E.l,
        },
        style,
      ]}
      refreshControl={
        rafraichir
          ? <RefreshControl refreshing={!!enCours} onRefresh={rafraichir} tintColor={C.texteDoux} />
          : undefined
      }
      // LE CLAVIER NE DOIT PAS RECOUVRIR LE CHAMP QU'ON REMPLIT (01/10/2026).
      //
      // Jusqu'ici aucun écran d'`Ecran` ne portait de champ de saisie : le seul formulaire de
      // l'application, la connexion, dessine son propre `KeyboardAvoidingView`. « Mes livrables »
      // est le premier à demander une adresse DANS une liste qui défile, et sans ces deux réglages
      // le champ passe sous le clavier dès qu'on est au bas de la page.
      //
      // `automaticallyAdjustKeyboardInsets` est le mécanisme d'iOS lui-même : il ajoute la hauteur
      // du clavier au bas du contenu. Il ne change rien aux écrans sans champ.
      // `keyboardShouldPersistTaps` évite le geste perdu : sans lui, la première pression sur un
      // bouton ne fait que fermer le clavier, et il faut appuyer deux fois pour envoyer.
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
    >
      {retour ? (
        <Pressable
          onPress={() => retourner(retour)}
          accessibilityRole="button"
          accessibilityLabel={`Revenir à ${retourLibelle ?? "Mon espace"}`}
          hitSlop={8}
          style={({ pressed }) => [s.retour, pressed ? { opacity: 0.7 } : null]}
        >
          <Ionicons name="chevron-back" size={18} color={C.texteDoux} />
          <Text style={s.retourTexte}>{retourLibelle ?? "Mon espace"}</Text>
        </Pressable>
      ) : null}

      {/* L'APPARITION SE POSE ICI, ET NULLE PART AILLEURS (01/10/2026).
          Un seul endroit pour toute l'application : quinze écrans qui s'animeraient chacun à leur
          façon, c'est la même dérive que les trois tailles de titre. L'écart de dix points est
          repris tel quel quand « Réduire les animations » est actif : voir `Mouvement.tsx`.
          `gap` est recopié ici parce que ce conteneur remplace la pile directe du ScrollView :
          sans lui, les blocs des écrans se colleraient les uns aux autres. */}
      <Apparition style={{ gap: E.l }}>{children}</Apparition>
    </ScrollView>
    </View>
  );
}

export function Section({ titre, action, children }: { titre: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ gap: E.s }}>
      <View style={s.enteteSection}>
        <Text style={s.titreSection}>{titre}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

/**
 * Le chargement a échoué. À ne jamais confondre avec un état vide : « votre club n'a rien publié »
 * et « je n'ai pas pu joindre le serveur » n'appellent pas la même réaction de la personne.
 */
export function Probleme({ surReessayer }: { surReessayer?: () => void }) {
  return (
    <View style={s.probleme}>
      <Text style={s.problemeTitre}>Chargement impossible</Text>
      <Text style={s.problemeTexte}>
        Vérifiez votre connexion, puis réessayez. Si cela se reproduit, fermez et rouvrez
        l'application : votre session a peut-être expiré.
      </Text>
      {surReessayer ? (
        <Pressable onPress={surReessayer} accessibilityRole="button" accessibilityLabel="Réessayer le chargement" style={s.reessayer} hitSlop={8}>
          <Text style={s.reessayerTexte}>Réessayer</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * L'ÉTAT VIDE EST LE CAS NORMAL DE CETTE APPLICATION (revu le 01/10/2026).
 *
 * CE QUI A ÉTÉ VU À L'ÉCRAN, compte de recette, rôle photo, aucune mission : l'Accueil, Mes
 * missions, Mon planning, Mes livrables, les Galeries et le Centre de formation montrent TOUS le
 * même rectangle en pointillés de deux cents points, suivi de six cents points de noir. Six écrans
 * qu'on ne distingue pas les uns des autres. Et ce n'est pas un cas limite : mesuré le 30/09,
 * aucun des dix opérateurs n'a de mission à venir.
 *
 * CE QUI CHANGE, ET POURQUOI :
 *
 *   · LES POINTILLÉS PARTENT. Une bordure en pointillés est la convention du « emplacement vide,
 *     à remplir » : elle dit que l'écran n'est pas fini, alors que l'écran est juste. Un fond de
 *     surface et un filet de marque en haut disent l'inverse : ce bloc est le contenu.
 *
 *   · UN MÉDAILLON. Le rond au dégradé SportVision donne au bloc une raison d'occuper la place
 *     qu'il prend, et redit la marque sur des écrans qui ne la portaient nulle part.
 *
 *   · UNE SORTIE. Règle 7 du contrat : on dit pourquoi c'est vide ET ce qu'il faut faire. La
 *     phrase le disait déjà, mais elle désignait souvent un autre écran de l'application sans
 *     qu'on puisse y aller. `action` rend ce geste possible au lieu de le décrire.
 *
 * `icone` et `action` sont FACULTATIFS : les quarante-cinq appels existants continuent de
 * fonctionner sans être touchés, et gagnent quand même le nouveau dessin.
 *
 * RÈGLE 5 DU CONTRAT : `action` ne mène qu'à un écran que l'application sait dessiner. Un bouton
 * qui mène à un refus, ou à rien, est une promesse cassée — mieux vaut la phrase seule.
 */
export function Vide({
  titre, texte, icone, action,
}: {
  titre: string;
  texte: string;
  icone?: keyof typeof Ionicons.glyphMap;
  action?: { libelle: string; surPression: () => void };
}) {
  return (
    <View style={s.vide}>
      {/* SANS ICÔNE, C'EST LE LOGO. Une icône générique — un rond, un point d'information — ne
          dirait rien de plus que le titre juste dessous. Le logo, lui, dit où l'on est : c'est le
          seul endroit de ces six écrans où la marque apparaissait, et elle n'y était pas. Les
          appels qui ont un vrai symbole à montrer le passent et gagnent le médaillon. */}
      {icone ? <Medaillon icone={icone} taille={44} /> : <Marque taille={44} />}
      <View style={{ gap: E.xs }}>
        {/* `alignSelf: stretch` sur les deux : sans lui, un texte mesuré hors de sa colonne se
            tronque trop tôt. Défaut déjà payé deux fois dans l'application des familles. */}
        <Text style={s.videTitre}>{titre}</Text>
        <Text style={s.videTexte}>{texte}</Text>
      </View>
      {action ? (
        <Pressable
          onPress={action.surPression}
          accessibilityRole="button"
          accessibilityLabel={action.libelle}
          hitSlop={8}
          style={({ pressed }) => [s.videAction, pressed ? { opacity: 0.75 } : null]}
        >
          <Text style={s.videActionTexte}>{action.libelle}</Text>
          <Ionicons name="chevron-forward" size={15} color={C.texte} />
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  // La meme rangee que le retour d'une galerie : une seule facon de reculer dans toute l'app.
  retour: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start", marginBottom: -E.s },
  retourTexte: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 14 },
  demo: {
    alignSelf: "flex-start", paddingHorizontal: E.s, paddingVertical: 5, borderRadius: R.pill,
    backgroundColor: "rgba(232,163,61,.14)", borderWidth: 1, borderColor: "rgba(232,163,61,.3)",
  },
  demoTexte: { color: C.alerteTexte, fontFamily: P.texteFort, fontSize: 11.5 },
  enteteSection: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: E.s },
  titreSection: { color: C.texte, fontFamily: P.titre, fontSize: T.titreSection, letterSpacing: -0.4 },
  vide: {
    // Le rayon d'un BLOC pleine largeur, pas celui d'une carte : l'état vide n'est pas une ligne
    // de liste parmi d'autres, il tient la place de la liste entière.
    borderWidth: 1, borderColor: C.bordure, borderRadius: R.xl,
    backgroundColor: C.surface, padding: E.l, gap: E.m,
  },
  videTitre: { alignSelf: "stretch", color: C.texte, fontFamily: P.titre, fontSize: T.titreBloc, letterSpacing: -0.3 },
  videTexte: { alignSelf: "stretch", color: C.texteDoux, fontFamily: P.texte, fontSize: T.corps, lineHeight: T.corpsHauteur },
  videAction: {
    flexDirection: "row", alignItems: "center", gap: E.xs,
    alignSelf: "flex-start", minHeight: TOUCHE, paddingHorizontal: E.m, borderRadius: R.pill,
    backgroundColor: "rgba(255,255,255,.07)", borderWidth: 1, borderColor: C.bordureForte,
  },
  videActionTexte: { color: C.texte, fontFamily: P.texteFort, fontSize: T.detail },
  probleme: {
    borderWidth: 1, borderColor: "rgba(240,68,94,.32)", borderRadius: R.l,
    backgroundColor: "rgba(240,68,94,.07)", padding: E.l, gap: E.s,
  },
  problemeTitre: { color: C.dangerTexte, fontFamily: P.titreFort, fontSize: T.titreBloc },
  problemeTexte: { color: C.texteDoux, fontFamily: P.texte, fontSize: T.detail, lineHeight: T.detailHauteur },
  reessayer: {
    alignSelf: "flex-start", minHeight: TOUCHE, justifyContent: "center",
    paddingHorizontal: E.m, borderRadius: R.pill,
    backgroundColor: "rgba(255,255,255,.08)", borderWidth: 1, borderColor: C.bordureForte,
  },
  reessayerTexte: { color: C.texte, fontFamily: P.texteFort, fontSize: T.detail },
});
