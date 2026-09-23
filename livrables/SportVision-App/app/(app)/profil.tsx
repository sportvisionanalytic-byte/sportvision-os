// Mon profil (22/09/2026, refonte) : qui je suis pour l'application, et comment en sortir.
//
// Rangé par sections, parce qu'une liste de neuf lignes au même niveau oblige à tout lire pour
// trouver une chose. « Changer d'espace » est remonté au-dessus : c'est une action fréquente,
// elle n'a rien à faire au milieu des informations personnelles.
import React, { useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSession } from "../../src/lib/session";
import { supprimerMonCompte } from "../../src/lib/compte";
import { useFamille } from "../../src/lib/famille";
import { oublierPorte } from "../../src/lib/espaces";
import { MODE_DEMO } from "../../src/lib/demonstration";
import { Ecran, Section } from "../../src/ui/Ecran";
import { Ecusson } from "../../src/ui/Cartes";
import { Pastille } from "../../src/ui/Base";
import { C, E, R, TOUCHE } from "../../src/theme/couleurs";
import { P } from "../../src/theme/polices";

function Ligne({
  icone, titre, detail, onPress, danger,
}: {
  icone: keyof typeof Ionicons.glyphMap;
  titre: string;
  detail?: string;
  onPress?: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={detail ? `${titre}. ${detail}` : titre}
      style={({ pressed }) => [s.ligne, pressed && onPress ? { backgroundColor: "rgba(255,255,255,.04)" } : null]}
    >
      <Ionicons name={icone} size={18} color={danger ? C.danger : C.texteDoux} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.ligneTitre, danger && { color: C.danger }]}>{titre}</Text>
        {detail ? <Text style={s.ligneDetail} numberOfLines={2}>{detail}</Text> : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={16} color={C.texteFaible} /> : null}
    </Pressable>
  );
}

export default function Profil() {
  const { session, profil, deconnexion } = useSession();
  const famille = useFamille();
  const router = useRouter();
  const [sortie, setSortie] = useState(false);
  const [suppression, setSuppression] = useState(false);
  const parent = profil?.espace === "parent";

  const clubNom = parent ? (famille.detail?.clubNom ?? famille.choisi?.clubNom) : profil?.clubNom;
  const clubLogo = parent ? famille.detail?.clubLogoUrl : profil?.clubLogoUrl;
  const equipeNom = parent ? famille.detail?.categorie : profil?.equipeNom;
  const affilie = parent ? famille.choisi?.enAttente === false : !!profil?.affilie;

  /** Revenir à la porte d'entrée sans se déconnecter : on change d'espace, pas de compte. */
  async function changerEspace() {
    await oublierPorte();
    router.replace("/bienvenue");
  }

  function demanderDeconnexion() {
    // En démonstration, il n'y a pas de vraie session à fermer : on renvoie vers l'écran de
    // connexion, sinon le bouton ne mène nulle part.
    if (MODE_DEMO) { router.replace("/connexion"); return; }
    // Une déconnexion se confirme : sur un téléphone, le doigt glisse, et retrouver son mot de
    // passe au bord d'un terrain n'a rien d'évident.
    Alert.alert("Se déconnecter", "Vous devrez saisir à nouveau votre mot de passe.", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Se déconnecter", style: "destructive",
        onPress: async () => { setSortie(true); await deconnexion(); },
      },
    ]);
  }

  /**
   * Supprimer son compte depuis l'application.
   *
   * Apple l'exige de toute application qui permet d'en créer un, et c'est une bonne règle : un
   * compte qu'on ne peut fermer que par e-mail n'est pas vraiment le sien. Deux confirmations,
   * parce que c'est sans retour.
   *
   * Ce qui part et ce qui reste est décidé en base (supprimer_compte_client) : les factures et les
   * commandes sont conservées, la loi l'impose, mais elles sont détachées et anonymisées.
   */
  function demanderSuppression() {
    if (MODE_DEMO) {
      Alert.alert(
        "Mode démonstration",
        "La suppression de compte fonctionne dans l'application, mais elle est désactivée ici : ce compte est fictif.",
      );
      return;
    }
    Alert.alert(
      "Supprimer mon compte",
      "Votre compte, votre rattachement au club et vos accès aux galeries seront supprimés. "
      + "Vos factures éventuelles sont conservées et anonymisées, comme la loi l'impose. "
      + "Cette action est définitive.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Continuer",
          style: "destructive",
          onPress: () => Alert.alert(
            "Vous êtes sûr ?",
            "Il n'y a pas de retour en arrière. Vous devrez recréer un compte et redemander votre rattachement au club.",
            [
              { text: "Annuler", style: "cancel" },
              {
                text: "Supprimer définitivement",
                style: "destructive",
                onPress: async () => {
                  setSuppression(true);
                  const r = await supprimerMonCompte();
                  setSuppression(false);
                  if (r.ok) {
                    await deconnexion();
                    router.replace("/connexion");
                  } else {
                    Alert.alert("Suppression impossible", r.message);
                  }
                },
              },
            ],
          ),
        },
      ],
    );
  }

  const version = Constants.expoConfig?.version ?? "1.0.0";

  return (
    <Ecran teinte="violet">
      <Text style={s.titre}>Mon profil</Text>

      <View style={s.identite}>
        <Ecusson url={clubLogo} nom={clubNom ?? profil?.prenom} taille={54} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={s.nom} numberOfLines={1}>{profil?.prenom || "Mon compte"}</Text>
          <Text style={s.detail} numberOfLines={1}>{session?.user?.email ?? ""}</Text>
          <View style={{ flexDirection: "row" }}>
            <Pastille
              ton={affilie ? "succes" : "alerte"}
              texte={parent
                ? (affilie ? "Parent affilié" : "Rattachement en attente")
                : (affilie ? "Joueur affilié" : "Affiliation en attente")}
            />
          </View>
        </View>
      </View>

      <View style={s.groupe}>
        <Ligne
          icone="swap-horizontal-outline" titre="Changer d'espace"
          detail="Joueur ou parent, espace club, équipe de production"
          onPress={changerEspace}
        />
      </View>

      <Section titre="Mon compte">
        <View style={s.groupe}>
          <Ligne
            icone="person-circle-outline" titre="Mes informations"
            detail="Nom, adresse e-mail, mot de passe"
            onPress={() => Linking.openURL("https://connect.sportvision-an.fr/profil")}
          />
          <Ligne
            icone="trash-outline"
            titre={suppression ? "Suppression en cours…" : "Supprimer mon compte"}
            detail="Définitif, sans retour en arrière"
            danger
            onPress={suppression ? undefined : demanderSuppression}
          />
        </View>
      </Section>

      <Section titre={parent ? "Son club" : "Mon club"}>
        <View style={s.groupe}>
          <Ligne
            icone="shield-checkmark-outline"
            titre={clubNom ?? "Aucun club"}
            detail={affilie ? "Affiliation validée par le club" : "En attente de validation par le club"}
          />
          {equipeNom ? <Ligne icone="shirt-outline" titre={equipeNom} detail="Équipe" /> : null}
        </View>
      </Section>

      <Section titre="Mes accès">
        <View style={s.groupe}>
          <Ligne
            icone="key-outline" titre="Comment j'accède aux photos"
            detail="Ce qu'est le Pass Photo et qui le transmet"
            onPress={() => router.push("/acces")}
          />
        </View>
      </Section>

      {MODE_DEMO ? (
        <Section titre="Démonstration">
          <View style={s.groupe}>
            <Ligne
              icone="log-in-outline" titre="Voir le tunnel de connexion"
              detail="L'écran que voit une personne non connectée"
              onPress={() => router.push("/connexion")}
            />
            <Ligne
              icone="person-add-outline" titre="Voir le tunnel d'inscription"
              detail="Profil, informations, club"
              onPress={() => router.push("/creer-compte")}
            />
          </View>
        </Section>
      ) : null}

      <Section titre="Assistance">
        <View style={s.groupe}>
          <Ligne
            icone="mail-outline" titre="Nous écrire" detail="contact@sportvision-an.fr"
            onPress={() => Linking.openURL("mailto:contact@sportvision-an.fr")}
          />
          <Ligne
            icone="document-text-outline" titre="Conditions et confidentialité"
            onPress={() => Linking.openURL("https://sportvision-an.fr/confidentialite")}
          />
          <Ligne icone="information-circle-outline" titre="Version" detail={`SportVision ${version}`} />
        </View>
      </Section>

      <View style={s.groupe}>
        <Ligne
          icone="log-out-outline"
          titre={sortie ? "Déconnexion…" : "Se déconnecter"}
          danger
          onPress={sortie ? undefined : demanderDeconnexion}
        />
      </View>
    </Ecran>
  );
}

const s = StyleSheet.create({
  titre: { color: C.texte, fontFamily: P.titre, fontSize: 26, letterSpacing: -0.6 },
  identite: {
    flexDirection: "row", alignItems: "center", gap: E.m,
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, borderColor: C.bordure, padding: E.m,
  },
  nom: { color: C.texte, fontFamily: P.titre, fontSize: 20, letterSpacing: -0.4 },
  detail: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13 },
  groupe: {
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, borderColor: C.bordure,
    overflow: "hidden",
  },
  ligne: {
    flexDirection: "row", alignItems: "center", gap: E.m,
    paddingHorizontal: E.m, paddingVertical: E.m, minHeight: TOUCHE + 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.bordure,
  },
  ligneTitre: { color: C.texte, fontFamily: P.texteFort, fontSize: 15 },
  ligneDetail: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5, lineHeight: 17 },
});
