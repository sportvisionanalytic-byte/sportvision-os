// Les espaces Club+ et production, en attendant leur version native (22/09/2026).
//
// Ils s'ouvrent ici dans l'application, avec une vraie barre : un titre, un retour qui suit
// l'historique de la page, et surtout la sortie vers le choix d'espace. Une page plein écran sans
// barre, c'est exactement l'impasse qu'on veut éviter.
//
// Le contenu lui-même vient de src/ui/VueWeb, qui a deux versions : la vue web sur téléphone, un
// écran d'explication sur le web. C'est ce qui évite le message technique vu en relecture.
import React, { useCallback, useEffect, useRef, useState } from "react";
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
  /** La page n'a pas répondu. Distinct de « pas de session » : deux causes, deux réponses. */
  const [panne, setPanne] = useState(false);

  // La page qui transporte la session est fabriquee a l'ouverture de l'ecran, pas plus tot : elle
  // contient les jetons, et un jeton fabrique d'avance est un jeton qui vieillit en memoire.
  const preparer = useCallback(async () => {
    setPanne(false); setCharge(false); setSource(null);
    const s = await sourceClubPlus();
    if (!s) { setSansSession(true); return; }
    setSansSession(false);
    setSource(s);
  }, []);

  useEffect(() => { preparer(); }, [preparer]);

  /**
   * CLUB+ RENVOIE VERS SA PAGE DE CONNEXION QUAND IL NE RECONNAIT PLUS LA SESSION (29/09/2026).
   *
   * L'écran Connect refait le pont dans ce cas depuis le 28/09. Celui-ci ne le faisait pas : un
   * coach dont les cookies avaient expiré tombait sur un formulaire de connexion à l'intérieur de
   * l'application, sans rien pour en sortir. Au bord d'un terrain, on referme et on appelle le club.
   */
  const dejaRefait = useRef(false);
  const surAdresse = useCallback((url: string) => {
    if (!url.includes("/auth/login") && !url.includes("/clubplus/login")) return;
    if (dejaRefait.current) { setSansSession(true); return; }
    dejaRefait.current = true;
    preparer();
  }, [preparer]);
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
        {/* UN BOUTON GRISE N'EST PAS UNE SORTIE (29/09/2026). Quand la page n'a plus d'historique,
            le retour etait desactive : l'ecran n'avait plus qu'une issue, « Changer », qui fait
            sortir de l'espace entier. On revient a l'accueil de Club+ plutot que de ne rien faire. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={peutReculer ? "Retour" : "Revenir à l'accueil du club"}
          onPress={() => (peutReculer ? vue.current?.reculer() : vue.current?.allerA(`${ADRESSES[cle]}/clubplus/dashboard`))}
          hitSlop={10}
          style={s.boutonBarre}
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
      ) : panne ? (
        <View style={s.attente}>
          <Text style={s.grosTexte}>La page n'a pas répondu</Text>
          <Text style={s.petitTexte}>
            Vérifiez votre connexion. Rien n'est perdu, vos données sont sur nos serveurs.
          </Text>
          <Pressable
            accessibilityRole="button" accessibilityLabel="Réessayer"
            onPress={() => { dejaRefait.current = false; preparer(); }}
            style={({ pressed }) => [s.reessayer, pressed ? { opacity: 0.85 } : null]}
          >
            <Text style={s.reessayerTexte}>Réessayer</Text>
          </Pressable>
        </View>
      ) : source ? (
        <VueConnect
          ref={vue}
          source={source}
          surHistorique={setPeutReculer}
          surAdresse={surAdresse}
          surChargement={() => setCharge(true)}
          surPanne={() => { setCharge(true); setPanne(true); }}
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
  grosTexte: { color: C.texte, fontFamily: P.titreFort, fontSize: 18, textAlign: "center" },
  petitTexte: { color: C.texteDoux, fontFamily: P.texte, fontSize: 14.5, lineHeight: 21, textAlign: "center", maxWidth: 320, marginTop: 6 },
  reessayer: {
    marginTop: E.m, paddingHorizontal: E.xl, minHeight: TOUCHE, borderRadius: R.m,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.06)", borderWidth: 1, borderColor: C.bordure,
  },
  reessayerTexte: { color: C.texte, fontFamily: P.texteFort, fontSize: 15 },
  attente: {
    position: "absolute", left: 0, right: 0, bottom: 0, top: 96,
    alignItems: "center", justifyContent: "center", backgroundColor: C.fond,
  },
});
