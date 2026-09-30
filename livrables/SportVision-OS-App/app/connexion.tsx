// LA CONNEXION À L'OS (30/09/2026).
//
// UN SEUL CHEMIN, ET PAS D'INSCRIPTION. Personne ne crée un compte SportVision depuis cette
// application : on entre dans l'équipe par une invitation envoyée depuis l'OS, jamais en
// s'inscrivant soi-même. Un bouton « créer un compte » ici serait une porte qui ne mène nulle
// part, et la règle est la même que pour Club+ : « tu ne peux pas créer un compte, c'est nous qui
// devons te donner un accès ».
import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../src/lib/supabase";
import { Bouton, Champ, Erreur, SousTitre, Titre } from "../src/ui/Base";
import { Marque } from "../src/ui/Marque";
import { C, E, R } from "../src/theme/couleurs";
import { P } from "../src/theme/polices";

export default function Connexion() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [mdp, setMdp] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [souci, setSouci] = useState<string | null>(null);
  const [envoiLien, setEnvoiLien] = useState(false);
  const [lienEnvoye, setLienEnvoye] = useState(false);

  async function entrer() {
    if (!email.trim() || !mdp) { setSouci("Renseignez votre adresse et votre mot de passe."); return; }
    setEnCours(true); setSouci(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(), password: mdp,
    });
    setEnCours(false);
    if (error) { setSouci(lisible(error.message)); return; }
    router.replace("/missions");
  }

  /**
   * Le lien par e-mail, pour qui n'a pas de mot de passe.
   *
   * Beaucoup de comptes de l'équipe ont été créés par invitation et n'en ont jamais posé. Sans
   * cette porte, ils seraient devant un formulaire qu'ils ne peuvent pas remplir — et le seul
   * recours serait de téléphoner.
   */
  async function envoyerLien() {
    if (!email.trim()) { setSouci("Renseignez votre adresse e-mail."); return; }
    setEnvoiLien(true); setSouci(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false },
    });
    setEnvoiLien(false);
    if (error) { setSouci(lisible(error.message)); return; }
    setLienEnvoye(true);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.fond }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        {/* LE MÊME LOGO QUE LES ÉTATS VIDES (01/10/2026). Cet écran dessinait le sien : une
            `Image` avec son rayon à 18 écrit en dur, quand le thème n'a ni 18 ni de brique
            pour ça. `Marque` est cette brique, et elle sert maintenant aussi dans `Vide` :
            une seule façon de poser le logo dans toute l'application. */}
        <Marque taille={76} />
        <View style={{ gap: E.xs }}>
          <Titre>SportVision OS</Titre>
          <SousTitre>L'espace de l'équipe : vos missions, vos livraisons, votre planning.</SousTitre>
        </View>

        <View style={{ gap: E.m }}>
          <Champ
            label="Adresse e-mail"
            value={email}
            onChangeText={(v) => { setEmail(v); setLienEnvoye(false); }}
            placeholder="prenom@sportvision-an.fr"
            keyboardType="email-address"
            textContentType="emailAddress"
          />
          <Champ
            label="Mot de passe"
            value={mdp}
            onChangeText={setMdp}
            placeholder="Votre mot de passe"
            secureTextEntry
            textContentType="password"
          />

          <Erreur message={souci} />
          {lienEnvoye ? (
            <View style={s.envoye}>
              <Text style={s.envoyeTexte}>
                Lien envoyé à {email.trim()}. Ouvrez-le depuis ce téléphone : il vous connecte
                directement, sans mot de passe.
              </Text>
            </View>
          ) : null}

          <Bouton titre="Entrer" onPress={entrer} enCours={enCours} />
          <Pressable
            onPress={envoyerLien}
            accessibilityRole="button"
            accessibilityLabel="Recevoir un lien de connexion par e-mail"
            style={({ pressed }) => [s.lien, pressed ? { opacity: 0.8 } : null]}
          >
            <Text style={s.lienTexte}>
              {envoiLien ? "Envoi…" : "Je n'ai pas de mot de passe, m'envoyer un lien"}
            </Text>
          </Pressable>
        </View>

        <Text style={s.pied}>
          On rejoint l'équipe SportVision par une invitation, jamais en s'inscrivant. Si vous n'avez
          pas encore de compte, demandez-le à l'administration.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Les messages de l'API sont en anglais : on ne les montre pas tels quels. */
function lisible(brut: string): string {
  if (/invalid login credentials/i.test(brut)) return "Adresse ou mot de passe incorrect.";
  if (/email not confirmed/i.test(brut)) return "Votre adresse n'est pas encore confirmée. Regardez vos e-mails.";
  if (/signups not allowed|not found/i.test(brut)) return "Aucun compte SportVision avec cette adresse.";
  if (/rate|too many/i.test(brut)) return "Trop de tentatives. Réessayez dans quelques minutes.";
  if (/network|fetch/i.test(brut)) return "Pas de connexion. Réessayez une fois le réseau revenu.";
  return "La connexion n'a pas abouti. Réessayez dans un instant.";
}

const s = StyleSheet.create({
  page: { flexGrow: 1, justifyContent: "center", padding: E.l, gap: E.xl },
  lien: { alignSelf: "center", paddingVertical: E.s, paddingHorizontal: E.m, minHeight: 44, justifyContent: "center" },
  lienTexte: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 13.5, textAlign: "center" },
  envoye: {
    padding: E.m, borderRadius: R.m,
    backgroundColor: "rgba(0,199,255,.10)", borderWidth: 1, borderColor: "rgba(0,199,255,.32)",
  },
  envoyeTexte: { color: C.texte, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
  pied: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5, textAlign: "center", lineHeight: 18 },
});
