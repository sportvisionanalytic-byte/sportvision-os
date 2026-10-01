// MON ESPACE (30/09/2026). Qui je suis, ce que la barre du bas ne porte pas, et la sortie.
//
// CET ÉCRAN EST DEVENU LA PORTE DES CINQ AUTRES. La barre du bas tient cinq onglets, l'application
// compte dix écrans : ceux qu'on ouvre debout sont dans la barre, ceux qu'on consulte assis sont
// ici. Le raisonnement complet est dans l'en-tête de `_layout.tsx` ; ce fichier n'en est que la
// conséquence, et il ne décide rien de son côté.
//
// CET ÉCRAN RESTE SANS FORMULAIRE, MAIS IL EN OUVRE UN (01/10/2026). Fouka : « quand je vais dans
// mon profil, je peux même pas modifier mon profil, je peux même pas modifier mes informations.
// Ajouter une photo de profil. » La règle qui était écrite ici — dupliquer un formulaire en ferait
// deux à tenir à jour — n'était pas fausse, elle était appliquée au mauvais endroit : elle interdit
// d'INVENTER des champs, pas d'offrir ceux de l'OS. « Mon profil » est donc un écran à part,
// `mon-profil.tsx`, qui porte exactement les champs de l'écran « Mon profil » de l'OS, dans son
// ordre et avec ses mots. Celui-ci reste une porte.
//
// LES ENTRÉES DÉPENDENT DU MÉTIER, PAS DE CE QUE LA BASE ACCEPTERA. « Mon planning » n'apparaît
// que pour la production, parce que c'est le seul métier pour qui il n'est pas déjà un onglet. Les
// quatre autres entrées sont là pour tout le monde : la RLS décide de leur contenu, et chacun de
// ces écrans explique son propre vide plutôt que de s'afficher blanc (règle 7 du contrat).
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Ecran, Section } from "../../src/ui/Ecran";
import { Ecusson } from "../../src/ui/Ecusson";
import { estOperateur, estProduction, useSession } from "../../src/lib/session";
import { C, E, R, TOUCHE } from "../../src/theme/couleurs";
import { P, T } from "../../src/theme/polices";

export default function Profil() {
  const { moi, deconnexion, session } = useSession();
  const nom = `${moi?.prenom ?? ""} ${moi?.nom ?? ""}`.trim();
  const production = estProduction(moi?.role ?? null);
  // Qui va sur le terrain, encadrant compris : c'est la population qui dépose des livrables.
  const operateurOuProduction = estOperateur(moi?.role ?? null) || production;

  return (
    <Ecran teinte="violet">
      {/* L'EN-TÊTE OUVRE « MON PROFIL », ET C'EST LE GESTE QU'ON FAIT SPONTANÉMENT. Toucher sa
          propre photo pour la changer est la convention de toutes les applications ; l'entrée de
          liste juste dessous existe quand même, parce qu'une zone cliquable sans flèche ni libellé
          ne se devine pas. */}
      <Pressable
        onPress={() => router.push("/mon-profil" as never)}
        accessibilityRole="button"
        accessibilityLabel="Modifier mon profil"
        style={({ pressed }) => [s.entete, pressed ? { opacity: 0.8 } : null]}
      >
        <Ecusson nom={nom || "Moi"} taille={52} photo={moi?.avatarUrl} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.titre} numberOfLines={1}>{nom || "Mon compte"}</Text>
          <Text style={s.sous} numberOfLines={1}>{moi?.metier ?? "SportVision"}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={C.texteFaible} />
      </Pressable>

      <Section titre="Mes écrans">
        <View style={s.bloc}>
          {/* EN PREMIER, PARCE QUE C'EST CE QU'ON VIENT CHERCHER ICI. Les cinq autres entrées sont
              des écrans de travail ; celle-ci est la raison pour laquelle on touche « Mon
              espace » quand on ne cherche pas une mission. */}
          <Acces
            chemin="/mon-profil"
            icone="person-circle-outline"
            titre="Mon profil"
            sous="Ma photo, mes coordonnées, mes infos pratiques"
          />
          {/* Le planning n'est ici QUE pour la production : pour tous les autres métiers, c'est
              déjà le troisième onglet de la barre. Deux chemins vers le même écran, dont un
              masqué, c'est un doute sur lequel est le vrai. */}
          {production ? (
            <Acces
              chemin="/planning"
              icone="list"
              titre="Mon planning"
              sous="Mes propres prestations, celles où je suis sur le terrain"
            />
          ) : null}
          {/* MES LIVRABLES N'EST PAS POUR TOUT LE MONDE, ET LE MOT « TERRAIN » DIT POURQUOI.
              On y dépose le lien de ses photos ou de son montage sur une mission où l'on est
              affecté. Mesuré : seuls les rôles `photo`, `prod` et `admin` ont des affectations, et
              seuls Antoine (photo), Mikael (prod) et Fouka (admin) ont déjà déposé un lien. Un
              community manager ou la comptabilité n'y trouverait qu'un écran vide, à jamais.

              LA PRODUCTION Y A DROIT AUSSI, ET C'EST UNE LEÇON DU 27/09 : Mikael encadre le pôle
              Football ET porte quatre missions sur le terrain ; il ne pouvait pas livrer ses
              propres photos parce qu'aucun écran ne le lui offrait, alors que la base l'acceptait.
              Le même écran sert les deux, il ne montre que SES missions à lui. */}
          {operateurOuProduction ? (
            <Acces
              chemin="/livrables"
              icone="cloud-upload-outline"
              titre="Mes livrables"
              sous="Déposer mes liens, suivre ce que la production en dit"
            />
          ) : null}
          <Acces
            chemin="/revenus"
            icone="cash-outline"
            titre="Mes revenus"
            sous="Montants versés, reste à verser, ajustements"
          />
          <Acces
            chemin="/galeries"
            icone="images-outline"
            titre="Galeries photo"
            sous="Les albums des missions"
          />
          <Acces
            chemin="/formation"
            icone="school-outline"
            titre="Centre de formation"
            sous="Mes formations suivies et mes certifications"
          />
          <Acces
            chemin="/centre"
            icone="book-outline"
            titre="Le Centre SportVision"
            sous="Check-lists et fiches, cherchables sur le terrain"
            dernier
          />
        </View>
      </Section>

      <Section titre="Mon compte">
        <View style={s.bloc}>
          {/* PAS DE TIRET EN GUISE DE VALEUR (01/10/2026). Un « — » dans une colonne de valeurs ne se
              lit pas : on ne sait pas si la donnée manque, si elle se charge, ou si l'écran est
              cassé. Ces deux lignes ont toujours une valeur pour quelqu'un de connecté ; le
              repli dit ce qui se passe le jour où elle manque. */}
          <Ligne libelle="Adresse e-mail" valeur={session?.user?.email ?? "Non renseignée"} />
          <Ligne libelle="Rôle" valeur={moi?.metier ?? "Non renseigné"} />
        </View>
      </Section>

      <Pressable
        onPress={deconnexion}
        accessibilityRole="button"
        accessibilityLabel="Se déconnecter"
        style={({ pressed }) => [s.sortie, pressed ? { opacity: 0.85 } : null]}
      >
        <View style={s.rond}><Ionicons name="log-out-outline" size={17} color={C.alerteTexte} /></View>
        <Text style={[s.sortieTexte, { color: C.alerteTexte }]}>Se déconnecter</Text>
      </Pressable>

      <Text style={s.pied}>
        Vos coordonnées bancaires et vos documents restent sur l'OS, depuis un ordinateur : ce
        sont des démarches qu'on ne fait pas debout, et l'application ne fait pas semblant.
      </Text>
    </Ecran>
  );
}

/** Une entrée vers un écran hors de la barre. `push` et pas `replace` : la flèche d'`Ecran` doit
 *  avoir un cran où reculer, sinon elle se rabat sur le repli et on perd d'où l'on venait. */
function Acces({
  chemin, icone, titre, sous, dernier,
}: {
  chemin: string;
  icone: keyof typeof Ionicons.glyphMap;
  titre: string;
  sous: string;
  dernier?: boolean;
}) {
  return (
    <Pressable
      onPress={() => router.push(chemin as never)}
      accessibilityRole="button"
      accessibilityLabel={titre}
      style={({ pressed }) => [s.acces, dernier ? { borderBottomWidth: 0 } : null, pressed ? { backgroundColor: "rgba(255,255,255,.05)" } : null]}
    >
      <View style={s.rond}><Ionicons name={icone} size={17} color={C.accentClair} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.accesTitre}>{titre}</Text>
        <Text style={s.accesSous}>{sous}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={C.texteFaible} />
    </Pressable>
  );
}

function Ligne({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <View style={s.ligne}>
      <Text style={s.libelle}>{libelle}</Text>
      {/* PAS DE `numberOfLines={1}` SUR UNE ADRESSE (01/10/2026). Celle du compte de recette
          tient tout juste sur la largeur d'un iPhone 17 ; une adresse plus longue, et elle se
          coupait au milieu. Un texte tronqué est un bug, pas une mise en page : on laisse la
          valeur passer à la ligne, la rangée grandit. */}
      <Text style={s.valeur} numberOfLines={2}>{valeur}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  entete: { flexDirection: "row", alignItems: "center", gap: E.m },
  titre: { color: C.texte, fontFamily: P.titre, fontSize: T.titreEcran, letterSpacing: -0.6 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: T.sousEcran, lineHeight: T.sousEcranHauteur },
  bloc: { borderRadius: R.l, backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure, overflow: "hidden" },
  ligne: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: E.m,
    paddingHorizontal: E.m, minHeight: TOUCHE + 6,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.bordure,
  },
  acces: {
    flexDirection: "row", alignItems: "center", gap: E.m,
    paddingHorizontal: E.m, paddingVertical: E.s, minHeight: TOUCHE + 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.bordure,
  },
  // `alignSelf: stretch` : sans lui, un titre mesuré hors de sa colonne se tronque trop tôt.
  // Défaut payé deux fois dans l'application des familles, le 29/09.
  accesTitre: { alignSelf: "stretch", color: C.texte, fontFamily: P.texteFort, fontSize: 15 },
  accesSous: { alignSelf: "stretch", color: C.texteDoux, fontFamily: P.texte, fontSize: 12.5, lineHeight: 17 },
  libelle: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: 13.5 },
  valeur: { flexShrink: 1, color: C.texte, fontFamily: P.texteFort, fontSize: 13.5, textAlign: "right" },
  sortie: {
    flexDirection: "row", alignItems: "center", gap: E.m,
    minHeight: TOUCHE, paddingHorizontal: E.m, borderRadius: R.l,
    backgroundColor: "rgba(255,255,255,.04)", borderWidth: 1, borderColor: C.bordure,
  },
  rond: {
    width: 32, height: 32, borderRadius: R.m, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.05)", borderWidth: 1, borderColor: C.bordure,
  },
  sortieTexte: { flex: 1, fontFamily: P.texte, fontSize: 15 },
  pied: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5, lineHeight: 18 },
});
