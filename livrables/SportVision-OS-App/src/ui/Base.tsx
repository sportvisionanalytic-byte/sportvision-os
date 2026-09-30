// Les briques visuelles communes (22/09/2026, charte SportVision).
//
// Écrites une fois ici plutôt que copiées d'écran en écran : c'est la dispersion des styles qui,
// sur le site, a fini par produire trois boutons légèrement différents pour la même action.
import React from "react";
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View,
  type TextInputProps, type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { C, DEGRADE, E, R, TOUCHE } from "../theme/couleurs";
import { P, T } from "../theme/polices";

export function Titre({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <Text style={[s.titre, style as never]}>{children}</Text>;
}
export function SousTitre({ children }: { children: React.ReactNode }) {
  return <Text style={s.sousTitre}>{children}</Text>;
}
/**
 * `hauteur` existe pour les champs de TEXTE LONG (01/10/2026).
 *
 * Le rapport de mission et le signalement d'incident demandent quelques lignes. Passer `style`
 * depuis l'écran aurait écrasé tout le style du champ — fond, bordure, police, couleur du texte —
 * et produit un huitième champ légèrement différent des sept autres. Une seule valeur change,
 * c'est donc une seule valeur qu'on passe. Avec `multiline`, le texte se cale en haut : sans
 * `textAlignVertical`, Android le centre et la première ligne flotte au milieu du cadre.
 */
export function Champ({ label, hauteur, ...props }: TextInputProps & { label: string; hauteur?: number }) {
  return (
    <View style={{ gap: E.xs }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        placeholderTextColor={C.texteFaible}
        style={[
          s.champ,
          hauteur ? { height: hauteur, paddingTop: E.s, paddingBottom: E.s, textAlignVertical: "top" as const } : null,
        ]}
        // Le clavier ne doit jamais proposer de majuscule sur une adresse : c'est la première
        // cause d'échec de connexion sur téléphone.
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
      />
    </View>
  );
}

export function Bouton({
  titre, onPress, enCours, secondaire, discret, desactive, icone,
}: {
  titre: string;
  onPress: () => void;
  enCours?: boolean;
  secondaire?: boolean;
  discret?: boolean;
  desactive?: boolean;
  icone?: React.ReactNode;
}) {
  const inactif = desactive || enCours;
  const contenu = enCours
    ? <ActivityIndicator color={secondaire || discret ? C.texte : "#fff"} />
    : (
      <View style={s.boutonContenu}>
        {icone}
        <Text style={[s.boutonTexte, (secondaire || discret) && { color: C.texte }]}>{titre}</Text>
      </View>
    );

  // L'action principale porte le dégradé de la marque. Les autres restent sobres : si tout brille,
  // plus rien ne guide.
  if (!secondaire && !discret) {
    return (
      <Pressable
        onPress={inactif ? undefined : onPress}
        accessibilityRole="button"
        accessibilityLabel={titre}
        // « busy » pendant le chargement, « disabled » quand le bouton ne repond pas : sans ca,
        // la lecture vocale annonce un bouton actif qui ne fait rien, et on appuie dans le vide.
        accessibilityState={{ disabled: inactif, busy: !!enCours }}
        style={({ pressed }) => [pressed && !inactif ? { opacity: 0.85 } : null, inactif ? { opacity: 0.45 } : null]}
      >
        <LinearGradient
          colors={DEGRADE as unknown as [string, string, string]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={s.bouton}
        >
          {contenu}
        </LinearGradient>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={inactif ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={titre}
      accessibilityState={{ disabled: inactif, busy: !!enCours }}
      style={({ pressed }) => [
        s.bouton,
        discret ? s.boutonDiscret : s.boutonSecondaire,
        pressed && !inactif ? { opacity: 0.75 } : null,
        inactif ? { opacity: 0.45 } : null,
      ]}
    >
      {contenu}
    </Pressable>
  );
}

/**
 * UN CHOIX PARMI QUELQUES-UNS (01/10/2026).
 *
 * POURQUOI UNE BRIQUE ET PAS UN `Picker`. Le premier formulaire de l'application — déposer un
 * livrable — demande une catégorie et un type de média : deux listes fermées de quatre et huit
 * valeurs, venues de contraintes `CHECK` en base. Un menu déroulant natif cache ses options
 * derrière un geste, et sur iOS il ouvre une roue qui prend la moitié de l'écran pour quatre mots.
 * Des puces posées à plat se lisent toutes d'un coup, debout, sans rien ouvrir.
 *
 * LA DIFFERENCE AVEC `Barre` EST VOULUE. `Barre` navigue entre des listes et défile sur une seule
 * ligne ; ici on répond à une question, les puces reviennent à la ligne et il n'y a pas de
 * compteur. Le dessin reste celui de `Barre` — même hauteur, même bleu actif — parce que deux
 * palettes proches mais pas identiques, c'est le reproche numéro un de Fouka.
 */
export function Options({
  label, aide, choix, actif, surChoix,
}: {
  label: string;
  /** Une phrase sous les puces, qui change avec le choix : c'est là qu'on explique ce qu'il fait. */
  aide?: string | null;
  choix: { cle: string; libelle: string }[];
  actif: string;
  surChoix: (cle: string) => void;
}) {
  return (
    <View style={{ gap: E.xs }}>
      <Text style={s.label}>{label}</Text>
      <View style={s.options}>
        {choix.map((c) => {
          const cet = c.cle === actif;
          return (
            <Pressable
              key={c.cle}
              onPress={() => surChoix(c.cle)}
              accessibilityRole="radio"
              accessibilityState={{ selected: cet, checked: cet }}
              accessibilityLabel={c.libelle}
              style={({ pressed }) => [s.option, cet && s.optionActive, pressed ? { opacity: 0.8 } : null]}
            >
              <Text style={[s.optionTexte, cet && s.optionTexteActif]}>{c.libelle}</Text>
            </Pressable>
          );
        })}
      </View>
      {aide ? <Text style={s.aide}>{aide}</Text> : null}
    </View>
  );
}

/**
 * UNE CASE A COCHER, AVEC SA PHRASE (01/10/2026).
 *
 * React Native n'en fournit aucune sur iOS. Celle-ci existe pour une seule déclaration, et c'est la
 * plus lourde de l'application : « mes fichiers sont copiés et vérifiés ». C'est la seule preuve
 * qu'une carte mémoire peut être formatée, et deux règles en base s'y appuient. Une case de 16
 * points comme sur le web n'aurait pas tenu les 44 points du contrat : c'est toute la ligne qui est
 * la cible, texte compris.
 *
 * `verrouillee` sert à un état déjà acquis : on montre que c'est fait, on n'offre pas de le défaire.
 */
export function Case({
  texte, sous, cochee, surChangement, verrouillee,
}: {
  texte: string;
  sous?: string | null;
  cochee: boolean;
  surChangement?: () => void;
  verrouillee?: boolean;
}) {
  const inerte = verrouillee || !surChangement;
  return (
    <Pressable
      onPress={inerte ? undefined : surChangement}
      accessibilityRole="checkbox"
      accessibilityLabel={texte}
      accessibilityState={{ checked: cochee, disabled: inerte }}
      style={({ pressed }) => [s.case_, pressed && !inerte ? { opacity: 0.8 } : null]}
    >
      <View style={[s.coche, cochee && s.cocheActive]}>
        {cochee ? <Text style={s.cocheMarque}>✓</Text> : null}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={s.caseTexte}>{texte}</Text>
        {sous ? <Text style={s.caseSous}>{sous}</Text> : null}
      </View>
    </Pressable>
  );
}

/** Une pastille d'état : toujours un mot, jamais une couleur seule. */
export function Pastille({
  texte, ton = "neutre",
}: { texte: string; ton?: "neutre" | "succes" | "alerte" | "danger" | "info" }) {
  const couleur = ton === "succes" ? C.succes : ton === "alerte" ? C.alerte
    : ton === "danger" ? C.danger : ton === "info" ? C.cyan : C.texteDoux;
  return (
    <View style={[s.pastille, { backgroundColor: couleur + "1F", borderColor: couleur + "4D" }]}>
      <Text style={[s.pastilleTexte, { color: couleur }]}>{texte}</Text>
    </View>
  );
}

export function Erreur({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <View style={s.erreur}>
      <Text style={s.erreurTexte}>{message}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  titre: { color: C.texte, fontFamily: P.titre, fontSize: T.titreEcran, letterSpacing: -0.6 },
  sousTitre: { color: C.texteDoux, fontFamily: P.texte, fontSize: 15, lineHeight: 22 },
  texte: { color: C.texte, fontFamily: P.texte, fontSize: 15 },
  texteDoux: { color: C.texteDoux, fontFamily: P.texte, fontSize: 14, lineHeight: 20 },
  etiquette: {
    color: C.cyan, fontFamily: P.texteFort, fontSize: 11,
    textTransform: "uppercase", letterSpacing: 1,
  },
  label: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 12.5 },
  champ: {
    height: 52, borderRadius: R.l, paddingHorizontal: E.m,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
    color: C.texte, fontFamily: P.texte, fontSize: 16,
  },
  bouton: { minHeight: TOUCHE + 8, borderRadius: R.l, alignItems: "center", justifyContent: "center", paddingHorizontal: E.m },
  boutonContenu: { flexDirection: "row", alignItems: "center", gap: E.s },
  boutonSecondaire: { borderWidth: 1, borderColor: C.bordureForte, backgroundColor: "rgba(255,255,255,.05)" },
  boutonDiscret: { backgroundColor: "transparent" },
  boutonTexte: { color: "#fff", fontFamily: P.titreFort, fontSize: 15.5 },
  carte: {
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1,
    borderColor: C.bordure, padding: E.m,
  },
  aide: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12, lineHeight: 17 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: E.xs },
  option: {
    justifyContent: "center", paddingHorizontal: E.m, height: TOUCHE - 6, borderRadius: R.pill,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  optionActive: { backgroundColor: "rgba(36,84,255,.20)", borderColor: "rgba(36,84,255,.55)" },
  optionTexte: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: 13 },
  optionTexteActif: { color: C.texte, fontFamily: P.texteFort },

  // Toute la ligne est la cible, pas la case : 44 points au minimum (règle 8).
  case_: { flexDirection: "row", alignItems: "flex-start", gap: E.s, minHeight: TOUCHE, paddingVertical: E.xs },
  coche: {
    width: 22, height: 22, borderRadius: 6, marginTop: 1,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.05)", borderWidth: 1, borderColor: C.bordureForte,
  },
  cocheActive: { backgroundColor: "rgba(18,183,106,.18)", borderColor: "rgba(18,183,106,.55)" },
  cocheMarque: { color: C.succesTexte, fontFamily: P.texteFort, fontSize: 13, lineHeight: 15 },
  caseTexte: { color: C.texte, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
  caseSous: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12, lineHeight: 17 },

  pastille: { paddingHorizontal: E.s, paddingVertical: 5, borderRadius: R.pill, borderWidth: 1 },
  pastilleTexte: { fontFamily: P.texteFort, fontSize: 11.5 },
  erreur: {
    backgroundColor: "rgba(240,68,94,.12)", borderWidth: 1, borderColor: "rgba(240,68,94,.35)",
    borderRadius: R.l, padding: E.m,
  },
  erreurTexte: { color: C.dangerTexte, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
});
