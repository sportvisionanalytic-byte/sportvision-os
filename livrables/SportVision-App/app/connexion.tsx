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
import { oublierPorte, porteMemorisee, type Porte } from "../src/lib/espaces";
import { MODE_DEMO } from "../src/lib/demonstration";
import { Bouton, Champ, Erreur, SousTitre, Titre } from "../src/ui/Base";
import { C, E, R } from "../src/theme/couleurs";
import { P } from "../src/theme/polices";

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
    // En démonstration, une session factice existe en permanence : sans cette exception, cet
    // écran renverrait aussitôt vers l'accueil et personne ne pourrait le relire.
    if (MODE_DEMO) return;
    if (!session) return;
    // ON REVIENT DANS L'ESPACE QU'ON AVAIT CHOISI (29/09/2026).
    //
    // Après la connexion, cet écran envoyait TOUJOURS vers l'accueil personnel. Un coach qui avait
    // choisi « Espace club », à qui on demandait son mot de passe pour cette raison précise,
    // arrivait dans l'espace joueur — et devait retrouver seul le chemin de son club. Le choix
    // était mémorisé : on ne le lisait pas.
    porteMemorisee().then((p) => {
      if (p === "club" || p === "sportvision") {
        router.replace({ pathname: "/espace-web", params: { porte: p } });
      } else {
        router.replace("/accueil");
      }
    }).catch(() => router.replace("/accueil"));
  }, [session, router]);

  // L'ÉCRAN DOIT DIRE POUR QUEL ESPACE IL DEMANDE LE MOT DE PASSE (29/09/2026).
  //
  // Fouka, arrivant par « Espace club » : « j'ai l'impression que je me connecte sur Connect ».
  // Il avait raison, et c'était pire que neutre. Cet écran annonçait « Vos photos, votre
  // calendrier », le discours de l'espace personnel ; il proposait en bas « Vous êtes d'un club ?
  // Changer d'espace », donc il lui disait qu'il s'était trompé d'endroit alors qu'il était
  // exactement au bon ; et son « Créer mon compte » fabrique un compte PERSONNEL — un coach qui
  // appuie là se crée le mauvais compte, et ne trouve ensuite rien dans son espace club.
  //
  // Un écran de connexion qui ne dit pas où il mène fait douter de l'adresse qu'on y tape.
  const [porte, setPorte] = useState<Porte | null>(null);
  useEffect(() => { porteMemorisee().then((p) => setPorte(p)); }, []);
  const pourLeClub = porte === "club" || porte === "sportvision";

  /** Revenir au choix des trois espaces : le choix memorise ne doit jamais enfermer. */
  async function changerEspace() {
    await oublierPorte();
    router.replace("/bienvenue");
  }

  async function connecter() {
    if (MODE_DEMO) { router.replace("/accueil"); return; }
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
          <Titre>{pourLeClub ? "Votre espace club" : "Bienvenue"}</Titre>
          <SousTitre>
            {porte === "sportvision"
              ? "Connectez-vous avec votre compte SportVision."
              : pourLeClub
                ? "Connectez-vous avec l'accès qui vous a été donné."
                : "Vos photos, votre calendrier et vos contenus de club, au même endroit."}
          </SousTitre>
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

          <Pressable onPress={motDePasseOublie} accessibilityRole="link" accessibilityLabel="Mot de passe oublié" style={s.lien} hitSlop={8}>
            <Text style={s.lienTexte}>Mot de passe oublié</Text>
          </Pressable>
        </View>

        <View style={s.pied}>
          {/* « CRÉER MON COMPTE » N'EXISTE PAS SUR LE CHEMIN DU CLUB : il fabrique un compte
              personnel. On dit d'où vient un accès club au lieu d'offrir le mauvais bouton. */}
          {pourLeClub ? (
            <Text style={[s.piedTexte, { textAlign: "center" }]}>
              {porte === "sportvision"
                ? "Votre accès est créé par l'équipe SportVision."
                /* LA RÈGLE, DITE PAR FOUKA LE 29/09/2026 : « tu ne peux pas créer un compte Club+.
                   Pour avoir Club+, c'est nous qui devons te donner un accès ou un lien. » Ma
                   première version disait « votre club vous envoie une invitation », ce qui laissait
                   croire à un club non client qu'il pouvait démarrer seul. On nomme SportVision en
                   premier, et le club ensuite, pour le coach que son président ajoute lui-même. */
                : "Votre accès vous est donné par SportVision, ou par votre club s'il utilise déjà Club+."}
            </Text>
          ) : (
            <>
              <Text style={s.piedTexte}>Pas encore de compte ?</Text>
              <Pressable onPress={() => router.push("/creer-compte")} accessibilityRole="link" accessibilityLabel="Créer mon compte" hitSlop={8}>
                <Text style={s.lienTexte}>Créer mon compte</Text>
              </Pressable>
            </>
          )}

          <Pressable onPress={changerEspace} accessibilityRole="link" accessibilityLabel="Changer d'espace" hitSlop={8} style={{ paddingTop: E.m }}>
            <Text style={s.piedTexte}>
              {pourLeClub
                ? <>Ce n'est pas votre cas ? <Text style={s.lienTexte}>Changer d'espace</Text></>
                : <>Vous êtes d'un club ou de l'équipe SportVision ? <Text style={s.lienTexte}>Changer d'espace</Text></>}
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
  lienTexte: { color: C.accentClair, fontFamily: P.texteFort, fontSize: 14.5 },
  pied: { alignItems: "center", gap: E.xs },
  piedTexte: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, textAlign: "center" },
  info: {
    backgroundColor: "rgba(46,204,138,.10)", borderWidth: 1, borderColor: "rgba(46,204,138,.30)",
    borderRadius: R.m, padding: E.m,
  },
  infoTexte: { color: C.succesTexte, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
});
