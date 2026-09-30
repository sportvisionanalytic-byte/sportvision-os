// L'OS COMPLET, DANS L'APPLICATION (30/09/2026).
//
// Tout ce que le natif ne sait pas encore faire vit ici, déjà connecté : la session est posée
// dans `localStorage` avant que la page ne se charge, exactement comme la suite de tests le fait
// avec Playwright. Personne ne saisit son mot de passe deux fois.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/lib/session";
import { VueOS, type PoigneeVueOS, type SessionOS } from "../../src/ui/VueOS";
import { OS_URL } from "../../src/lib/config-os";
import { C, E, R, TOUCHE } from "../../src/theme/couleurs";
import { P } from "../../src/theme/polices";

export default function EcranOS() {
  const insets = useSafeAreaInsets();
  const { moi } = useSession();
  const vue = useRef<PoigneeVueOS>(null);
  const [amorce, setAmorce] = useState<SessionOS | null>(null);
  const [charge, setCharge] = useState(false);
  const [panne, setPanne] = useState(false);
  const [peutReculer, setPeutReculer] = useState(false);

  const preparer = useCallback(async () => {
    setPanne(false); setCharge(false); setAmorce(null);
    const { data } = await supabase.auth.getSession();
    const s = data.session;
    if (!s?.access_token || !moi) return;
    setAmorce({
      jeton: s.access_token,
      rafraichissement: s.refresh_token ?? "",
      uid: moi.id,
      role: moi.role ?? "",
      prenom: moi.prenom,
    });
  }, [moi]);

  useEffect(() => { preparer(); }, [preparer]);

  return (
    <View style={{ flex: 1, backgroundColor: C.fond }}>
      <View style={[s.barre, { paddingTop: insets.top + 6 }]}>
        <Pressable
          onPress={() => (peutReculer ? vue.current?.reculer() : vue.current?.recharger())}
          accessibilityRole="button"
          accessibilityLabel={peutReculer ? "Retour" : "Recharger"}
          hitSlop={10}
          style={s.bouton}
        >
          <Ionicons name={peutReculer ? "chevron-back" : "refresh"} size={20} color={C.texte} />
        </Pressable>
        <Text style={s.titre} numberOfLines={1}>SportVision OS</Text>
        <View style={s.bouton} />
      </View>

      {amorce ? (
        panne ? (
          <View style={s.centre}>
            <Text style={s.gros}>L'OS n'a pas répondu</Text>
            <Text style={s.petit}>
              Vérifiez votre connexion. Rien n'est perdu : tout est sur nos serveurs.
            </Text>
            <Pressable onPress={preparer} accessibilityRole="button" accessibilityLabel="Réessayer" style={s.action}>
              <Text style={s.actionTexte}>Réessayer</Text>
            </Pressable>
          </View>
        ) : (
          <VueOS
            ref={vue}
            adresse={OS_URL}
            session={amorce}
            surHistorique={setPeutReculer}
            surChargement={() => setCharge(true)}
            surPanne={() => { setCharge(true); setPanne(true); }}
          />
        )
      ) : null}

      {!charge && !panne ? (
        <View style={s.attente} pointerEvents="none"><ActivityIndicator color={C.accent} /></View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  barre: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    paddingHorizontal: E.s, paddingBottom: E.s,
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.bordure,
  },
  bouton: { width: TOUCHE, height: TOUCHE, alignItems: "center", justifyContent: "center" },
  titre: { flex: 1, color: C.texte, fontFamily: P.titreFort, fontSize: 16.5, textAlign: "center" },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: E.xl, gap: E.s },
  gros: { color: C.texte, fontFamily: P.titreFort, fontSize: 18, textAlign: "center" },
  petit: { color: C.texteDoux, fontFamily: P.texte, fontSize: 14.5, lineHeight: 21, textAlign: "center", maxWidth: 320 },
  action: {
    marginTop: E.m, paddingHorizontal: E.xl, minHeight: TOUCHE, borderRadius: R.m,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.06)", borderWidth: 1, borderColor: C.bordure,
  },
  actionTexte: { color: C.texte, fontFamily: P.texteFort, fontSize: 15 },
  attente: {
    position: "absolute", left: 0, right: 0, bottom: 0, top: 96,
    alignItems: "center", justifyContent: "center", backgroundColor: C.fond,
  },
});
