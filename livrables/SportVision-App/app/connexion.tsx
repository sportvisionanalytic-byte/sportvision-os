// L'ecran de connexion (22/09/2026).
import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../src/lib/supabase";
import { useSession } from "../src/lib/session";
import { oublierPorte } from "../src/lib/espaces";
import { Bouton, Champ, Erreur, SousTitre, Titre } from "../src/ui/Base";
import { C, E, R } from "../src/theme/couleurs";

/** Supabase repond en anglais. Personne ne doit lire « Invalid login credentials ». */
function messageFrancais(brut: string): string {
  const m = brut.toLowerCase();
  if (m.includes("invalid login")) return "Adresse e-mail ou mot de passe incorrect.";
  if (m.includes("email not confirmed")) return "Votre adresse n'est pas encore confirmée. Ouvrez l'e-mail que nous vous avons envoyé.";
  if (m.includes("rate limit") || m.includes("too many")) return "Trop d'essais. Patientez une minute avant de réessayer.";
  if (m.includes("network") || m.includes("fetch")) return "Pas de connexion. Vérifiez votre réseau et réessayez.";
  return "Connexion impossible pour le moment. Réessayez dans un instant.";
}

export default function Connexion() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useSession();
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoye, setEnvoye] = useState(false);

  // Des qu'une session existe, on quitte cet ecran — que la connexion vienne du formulaire ou
  // d'une session restauree au demarrage. Sans cela, on reste sur le formulaire apres avoir
  // saisi le bon mot de passe : le defaut le plus deroutant qui soit.
  useEffect(() => {
    if (session) router.replace("/accueil");
  }, [session, router]);

  /** Revenir au choix des trois espaces : le choix memorise ne doit jamais enfermer. */
  async function changerEspace() {
    await oublierPorte();
    router.replace("/bienvenue");
  }

  async function connecter() {
    const adresse = email.trim().toLowerCase();
    if (!adresse || !motDePasse) { setErreur("Renseignez votre adresse e-mail et votre mot de passe."); return; }
    setEnCours(true); setErreur(null);
    const { error } = await supabase.auth.signInWithPassword({ email: adresse, password: motDePasse });
    // En cas de succes, la bascule est faite par l'effet ci-dessus, qui couvre aussi la session
    // restauree : un seul chemin de navigation, jamais deux.
    if (error) { setErreur(messageFrancais(error.message)); setEnCours(false); }
  }

  async function motDePasseOublie() {
    const adresse = email.trim().toLowerCase();
    if (!adresse) { setErreur("Entrez d'abord votre adresse e-mail, puis touchez « Mot de passe oublié »."); return; }
    setEnCours(true); setErreur(null);
    const { error } = await supabase.auth.resetPasswordForEmail(adresse, {
      redirectTo: "https://connect.sportvision-an.fr/reinitialiser",
    });
    setEnCours(false);
    if (error) setErreur(messageFrancais(error.message));
    else setEnvoye(true);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={[s.page, { paddingTop: insets.top + E.xl, paddingBottom: insets.bottom + E.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.entete}>
          <Image source={require("../assets/splash-icon.png")} style={s.logo} contentFit="contain" />
          <Titre>Bienvenue</Titre>
          <SousTitre>Vos photos, votre calendrier et vos contenus de club, au même endroit.</SousTitre>
        </View>

        <View style={{ gap: E.m }}>
          <Champ
            label="Adresse e-mail"
            value={email}
            onChangeText={(t) => { setEmail(t); setEnvoye(false); }}
            placeholder="vous@exemple.fr"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
          />
          <Champ
            label="Mot de passe"
            value={motDePasse}
            onChangeText={setMotDePasse}
            placeholder="Votre mot de passe"
            secureTextEntry
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={connecter}
          />

          <Erreur message={erreur} />
          {envoye ? (
            <View style={s.info}>
              <Text style={s.infoTexte}>
                Si un compte existe avec cette adresse, un e-mail vient de partir. Ouvrez-le depuis
                ce téléphone pour choisir un nouveau mot de passe.
              </Text>
            </View>
          ) : null}

          <Bouton titre="Se connecter" onPress={connecter} enCours={enCours} />

          <Pressable onPress={motDePasseOublie} style={s.lien} hitSlop={8}>
            <Text style={s.lienTexte}>Mot de passe oublié</Text>
          </Pressable>
        </View>

        <View style={s.pied}>
          <Text style={s.piedTexte}>Pas encore de compte ?</Text>
          <Pressable onPress={() => router.push("/creer-compte")} hitSlop={8}>
            <Text style={s.lienTexte}>Créer mon compte</Text>
          </Pressable>

          <Pressable onPress={changerEspace} hitSlop={8} style={{ paddingTop: E.m }}>
            <Text style={s.piedTexte}>
              Vous êtes d'un club ou de l'équipe SportVision ? <Text style={s.lienTexte}>Changer d'espace</Text>
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  page: { flexGrow: 1, paddingHorizontal: E.l, gap: E.xl, justifyContent: "center" },
  entete: { gap: E.s, alignItems: "flex-start" },
  logo: { width: 88, height: 88, marginBottom: E.s },
  lien: { alignSelf: "center", paddingVertical: E.s },
  lienTexte: { color: C.accentClair, fontSize: 14.5, fontWeight: "600" },
  pied: { alignItems: "center", gap: E.xs },
  piedTexte: { color: C.texteFaible, fontSize: 13.5 },
  info: {
    backgroundColor: "rgba(46,204,138,.10)", borderWidth: 1, borderColor: "rgba(46,204,138,.30)",
    borderRadius: R.m, padding: E.m,
  },
  infoTexte: { color: "#9FE8C6", fontSize: 13.5, lineHeight: 19 },
});
