// Mon profil (22/09/2026) : qui je suis pour l'application, et comment en sortir.
import React, { useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSession } from "../../src/lib/session";
import { oublierPorte } from "../../src/lib/espaces";
import { Ecran, Section } from "../../src/ui/Ecran";
import { Ecusson } from "../../src/ui/Cartes";
import { C, E, R } from "../../src/theme/couleurs";

function Ligne({
  icone, titre, detail, onPress, danger,
}: { icone: keyof typeof Ionicons.glyphMap; titre: string; detail?: string; onPress?: () => void; danger?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [s.ligne, pressed && onPress ? { opacity: 0.8 } : null]}
    >
      <Ionicons name={icone} size={18} color={danger ? C.danger : C.texteDoux} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.ligneTitre, danger && { color: C.danger }]}>{titre}</Text>
        {detail ? <Text style={s.ligneDetail} numberOfLines={1}>{detail}</Text> : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={16} color={C.texteFaible} /> : null}
    </Pressable>
  );
}

export default function Profil() {
  const { session, profil, deconnexion } = useSession();
  const router = useRouter();
  const [sortie, setSortie] = useState(false);

  /** Revenir a la porte d'entree sans se deconnecter : on change d'espace, pas de compte. */
  async function changerEspace() {
    await oublierPorte();
    router.replace("/bienvenue");
  }

  function demanderDeconnexion() {
    // Une deconnexion se confirme : sur un telephone, le doigt glisse, et retrouver son mot de
    // passe au bord d'un terrain n'a rien d'evident.
    Alert.alert("Se déconnecter", "Vous devrez saisir à nouveau votre mot de passe.", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Se déconnecter", style: "destructive",
        onPress: async () => { setSortie(true); await deconnexion(); },
      },
    ]);
  }

  const version = Constants.expoConfig?.version ?? "1.0.0";

  return (
    <Ecran>
      <Text style={s.titre}>Mon profil</Text>

      <View style={s.carteIdentite}>
        <Ecusson url={profil?.clubLogoUrl} nom={profil?.clubNom ?? profil?.prenom} taille={56} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.nom}>{profil?.prenom || "Mon compte"}</Text>
          <Text style={s.detail} numberOfLines={1}>{session?.user?.email ?? ""}</Text>
          {profil?.clubNom ? (
            <Text style={s.detail} numberOfLines={1}>
              {[profil.clubNom, profil.equipeNom].filter(Boolean).join(" · ")}
            </Text>
          ) : null}
        </View>
      </View>

      <Section titre="Mon compte">
        <View style={s.groupe}>
          <Ligne
            icone="person-circle-outline" titre="Mes informations"
            detail="Modifier mon nom, mon adresse, mon mot de passe"
            onPress={() => Linking.openURL("https://connect.sportvision-an.fr/profil")}
          />
          <Ligne
            icone="shield-checkmark-outline" titre="Mon club"
            detail={profil?.affilie ? "Affiliation validée" : "Affiliation en attente du club"}
            onPress={() => Linking.openURL("https://connect.sportvision-an.fr/affiliations")}
          />
          <Ligne
            icone="receipt-outline" titre="Mes commandes"
            onPress={() => Linking.openURL("https://connect.sportvision-an.fr/commandes")}
          />
          <Ligne
            icone="swap-horizontal-outline" titre="Changer d'espace"
            detail="Joueur ou parent, mon club, équipe SportVision"
            onPress={changerEspace}
          />
        </View>
      </Section>

      <Section titre="Aide">
        <View style={s.groupe}>
          <Ligne
            icone="mail-outline" titre="Nous écrire"
            detail="contact@sportvision-an.fr"
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
  titre: { color: C.texte, fontSize: 25, fontWeight: "800", letterSpacing: -0.5 },
  carteIdentite: {
    flexDirection: "row", alignItems: "center", gap: E.m,
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, borderColor: C.bordure, padding: E.m,
  },
  nom: { color: C.texte, fontSize: 19, fontWeight: "700" },
  detail: { color: C.texteDoux, fontSize: 13 },
  groupe: {
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, borderColor: C.bordure,
    overflow: "hidden",
  },
  ligne: {
    flexDirection: "row", alignItems: "center", gap: E.m,
    paddingHorizontal: E.m, paddingVertical: E.m,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.bordure,
  },
  ligneTitre: { color: C.texte, fontSize: 15, fontWeight: "600" },
  ligneDetail: { color: C.texteFaible, fontSize: 12.5 },
});
