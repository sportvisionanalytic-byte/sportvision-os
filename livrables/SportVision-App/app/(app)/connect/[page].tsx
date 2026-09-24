// Les pages de Connect, dans l'application (24/09/2026).
//
// Mes commandes, mes factures, les cotisations, les rattachements, la reconnaissance et l'aide.
// Elles s'ouvrent ici avec la session déjà faite : personne ne retape son mot de passe.
//
// La barre compte autant que le contenu. Une page plein écran sans retour, c'est l'impasse :
// on l'a déjà vu en relecture, et c'est le moment où l'on ferme l'application.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { VueConnect, type PoigneeVueConnect } from "../../../src/ui/VueConnect";
import { PAGES, sourceConnect, type PageConnect, type SourceConnect } from "../../../src/lib/connect";
import { Bouton } from "../../../src/ui/Base";
import { C, E, R, TOUCHE } from "../../../src/theme/couleurs";
import { P } from "../../../src/theme/polices";

function estUnePage(v: unknown): v is PageConnect {
  return typeof v === "string" && v in PAGES;
}

export default function EcranConnect() {
  const { page } = useLocalSearchParams<{ page?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const vue = useRef<PoigneeVueConnect>(null);

  const cle: PageConnect = estUnePage(page) ? page : "aide";

  const [source, setSource] = useState<SourceConnect | null>(null);
  const [peutReculer, setPeutReculer] = useState(false);
  const [charge, setCharge] = useState(false);
  // Trois états séparés, parce qu'ils appellent trois réponses différentes : « je prépare »,
  // « je n'ai pas de session », « la page n'a pas répondu ». Les confondre, c'est afficher une
  // roue qui tourne à quelqu'un dont le problème ne se résoudra jamais tout seul.
  const [sansSession, setSansSession] = useState(false);
  const [panne, setPanne] = useState(false);

  const preparer = useCallback(async () => {
    setPanne(false);
    setCharge(false);
    const s = await sourceConnect(cle);
    if (!s) { setSansSession(true); return; }
    setSansSession(false);
    setSource(s);
  }, [cle]);

  useEffect(() => { preparer(); }, [preparer]);

  function retour() {
    if (peutReculer) { vue.current?.reculer(); return; }
    // Pas d'historique dans la page : le retour sort de l'écran, comme partout ailleurs.
    if (router.canGoBack()) router.back();
    else router.replace("/accueil");
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.fond }}>
      <View style={[s.barre, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={retour} hitSlop={10} style={s.boutonBarre} accessibilityLabel="Retour">
          <Ionicons name="chevron-back" size={20} color={C.texte} />
        </Pressable>
        <Text style={s.titre} numberOfLines={1}>{PAGES[cle].titre}</Text>
        <View style={{ width: TOUCHE }} />
      </View>

      {sansSession ? (
        <View style={s.centre}>
          <View style={s.rond}><Ionicons name="lock-closed-outline" size={26} color={C.cyan} /></View>
          <Text style={s.grosTexte}>Vous n'êtes plus connecté</Text>
          <Text style={s.petitTexte}>
            Votre session a expiré. Reconnectez-vous et cette page s'ouvrira sans rien redemander.
          </Text>
          <View style={{ alignSelf: "stretch", maxWidth: 320, paddingTop: E.s }}>
            <Bouton titre="Se connecter" onPress={() => router.replace("/connexion")} />
          </View>
        </View>
      ) : panne ? (
        <View style={s.centre}>
          <View style={s.rond}><Ionicons name="cloud-offline-outline" size={26} color={C.cyan} /></View>
          <Text style={s.grosTexte}>La page n'a pas répondu</Text>
          <Text style={s.petitTexte}>
            Vérifiez votre connexion. Vos données ne sont pas perdues, elles sont sur nos serveurs.
          </Text>
          <View style={{ alignSelf: "stretch", maxWidth: 320, paddingTop: E.s }}>
            <Bouton titre="Réessayer" onPress={preparer} secondaire />
          </View>
        </View>
      ) : source ? (
        <VueConnect
          ref={vue}
          source={source}
          surHistorique={setPeutReculer}
          surChargement={() => setCharge(true)}
          surPanne={() => setPanne(true)}
        />
      ) : null}

      {!charge && !sansSession && !panne ? (
        <View style={s.roue} pointerEvents="none">
          <ActivityIndicator color={C.accentClair} />
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  barre: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    paddingHorizontal: E.m, paddingBottom: 10,
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,.07)",
  },
  boutonBarre: {
    width: TOUCHE, height: TOUCHE, borderRadius: R.m,
    alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.05)",
  },
  titre: { flex: 1, color: C.texte, fontFamily: P.titre, fontSize: 16, letterSpacing: -0.2, textAlign: "center" },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: E.xl, gap: E.m },
  rond: {
    width: 58, height: 58, borderRadius: R.xl, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,199,255,.12)", borderWidth: 1, borderColor: "rgba(0,199,255,.28)",
  },
  grosTexte: { color: C.texte, fontFamily: P.titre, fontSize: 19, textAlign: "center", letterSpacing: -0.3 },
  petitTexte: { color: C.texteDoux, fontFamily: P.texte, fontSize: 14.5, lineHeight: 21, textAlign: "center", maxWidth: 340 },
  roue: { ...StyleSheet.absoluteFill as object, alignItems: "center", justifyContent: "center" },
});
