// Les espaces Club+ et production, en attendant leur version native (22/09/2026).
//
// Ils s'ouvrent ici dans l'application, avec une vraie barre : un titre, un retour qui suit
// l'historique de la page, et surtout la sortie vers le choix d'espace. Une page plein écran sans
// barre, c'est exactement l'impasse qu'on veut éviter.
//
// Le contenu lui-même vient de src/ui/VueWeb, qui a deux versions : la vue web sur téléphone, un
// écran d'explication sur le web. C'est ce qui évite le message technique vu en relecture.
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { VueConnect, type PoigneeVueConnect } from "../src/ui/VueConnect";
import { sourceClubPlus, type SourceConnect } from "../src/lib/connect";
import { ADRESSES, oublierPorte, type Porte } from "../src/lib/espaces";
import { C, E, R, TOUCHE } from "../src/theme/couleurs";
import { P } from "../src/theme/polices";

const TITRES: Record<Exclude<Porte, "personnel">, string> = {
  club: "Espace club",
  sportvision: "Équipe de production",
};

export default function EspaceWeb() {
  const { porte } = useLocalSearchParams<{ porte?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const vue = useRef<PoigneeVueConnect>(null);
  // LA SESSION EST TRANSPORTEE (25/09/2026). Un coach qui ouvrait l'espace club devait ressaisir
  // son mot de passe alors que l'application connaissait deja sa session. Au bord d'un terrain,
  // personne ne retape un mot de passe : on referme et on appelle le club.
  const [source, setSource] = useState<SourceConnect | null>(null);
  const [sansSession, setSansSession] = useState(false);

  // La page qui transporte la session est fabriquee a l'ouverture de l'ecran, pas plus tot : elle
  // contient les jetons, et un jeton fabrique d'avance est un jeton qui vieillit en memoire.
  useEffect(() => {
    let vivant = true;
    (async () => {
      const s = await sourceClubPlus();
      if (!vivant) return;
      if (!s) { setSansSession(true); return; }
      setSource(s);
    })();
    return () => { vivant = false; };
  }, []);
  const [peutReculer, setPeutReculer] = useState(false);
  const [charge, setCharge] = useState(false);

  const cle: Exclude<Porte, "personnel"> = porte === "sportvision" ? "sportvision" : "club";

  async function changerEspace() {
    await oublierPorte();
    router.replace("/bienvenue");
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.fond }}>
      <View style={[s.barre, { paddingTop: insets.top + 6 }]}>
        <Pressable
          accessibilityRole="button" accessibilityLabel="Retour"
          onPress={() => vue.current?.reculer()}
          disabled={!peutReculer}
          hitSlop={10}
          style={[s.boutonBarre, !peutReculer && { opacity: 0.3 }]}
        >
          <Ionicons name="chevron-back" size={20} color={C.texte} />
        </Pressable>

        <Text style={s.titre} numberOfLines={1}>{TITRES[cle]}</Text>

        <Pressable onPress={changerEspace} accessibilityRole="button" accessibilityLabel="Changer d'espace" hitSlop={10} style={s.changer}>
          <Ionicons name="swap-horizontal" size={15} color={C.accentClair} />
          <Text style={s.changerTexte}>Changer</Text>
        </Pressable>
      </View>

      {sansSession ? (
        <View style={s.attente}>
          <Text style={s.titre}>Vous n'êtes plus connecté</Text>
        </View>
      ) : source ? (
        <VueConnect
          ref={vue}
          source={source}
          surHistorique={setPeutReculer}
          surChargement={() => setCharge(true)}
          surPanne={() => setCharge(true)}
        />
      ) : null}

      {!charge ? (
        <View style={s.attente} pointerEvents="none">
          <ActivityIndicator color={C.accent} />
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  barre: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    paddingHorizontal: E.m, paddingBottom: E.s,
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.bordure,
  },
  boutonBarre: { width: TOUCHE, height: TOUCHE, alignItems: "center", justifyContent: "center", marginLeft: -10 },
  titre: { flex: 1, color: C.texte, fontFamily: P.titreFort, fontSize: 16.5 },
  changer: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: E.m, minHeight: 36, borderRadius: R.pill,
    backgroundColor: "rgba(36,84,255,.16)", borderWidth: 1, borderColor: "rgba(36,84,255,.35)",
    justifyContent: "center",
  },
  changerTexte: { color: C.accentClair, fontFamily: P.texteFort, fontSize: 13 },
  attente: {
    position: "absolute", left: 0, right: 0, bottom: 0, top: 96,
    alignItems: "center", justifyContent: "center", backgroundColor: C.fond,
  },
});
