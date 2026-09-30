// MON PROFIL, EN NATIF (30/09/2026).
//
// Deuxième des quatre écrans que Fouka a choisis. Court, sans règle métier : prénom, nom,
// téléphone. C'est exactement le genre d'écran où une page web dans un cadre se voit le plus —
// un clavier qui pousse la page, un champ qui saute, un bouton qu'on cherche.
//
// CE QU'IL NE PROPOSE PAS, ET POURQUOI :
//
//   · LA PHOTO. Fouka l'a citée, et elle n'existe nulle part : Club+ a retiré « Changer la
//     photo » le 31/08/2026 faute de bucket Storage et de colonne `avatar_url`. Un bouton qui ne
//     mène à rien vaut moins que son absence. L'écusson reste les initiales, comme sur le site.
//
//   · L'ADRESSE E-MAIL. Elle s'affiche, elle ne se modifie pas : la changer est une procédure
//     d'authentification — un lien de confirmation sur l'ancienne ET la nouvelle adresse — pas un
//     champ de formulaire. Club+ la montre désactivée, on fait pareil et on le dit.
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Bouton, Champ, Erreur } from "../Base";
import { Ecusson } from "../Cartes";
import { enregistrerMonProfil, lireMonProfil } from "../../lib/club-profil";
import { C, E, R, TOUCHE } from "../../theme/couleurs";
import { P } from "../../theme/polices";

export function MonProfil({
  visible, secours, roleLibelle, clubNom, surFermer, surEnregistre,
}: {
  visible: boolean;
  /** Ce que le club a saisi, pour pré-remplir un profil jamais rempli. */
  secours?: { prenom?: string | null; nom?: string | null };
  roleLibelle?: string | null;
  clubNom?: string | null;
  surFermer: () => void;
  /** Appelé après un enregistrement réussi : l'accueil doit changer de « Bonjour ». */
  surEnregistre: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [chargement, setChargement] = useState(false);
  const [souci, setSouci] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [email, setEmail] = useState("");
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");

  const charger = useCallback(async () => {
    setChargement(true); setSouci(null);
    try {
      const p = await lireMonProfil(secours);
      if (!p) { setSouci("Votre session a expiré. Reconnectez-vous."); return; }
      setPrenom(p.prenom); setNom(p.nom); setTelephone(p.telephone); setEmail(p.email);
    } catch {
      setSouci("Le profil n'a pas pu être chargé. Vérifiez votre connexion.");
    } finally {
      setChargement(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secours?.prenom, secours?.nom]);

  useEffect(() => { if (visible) charger(); }, [visible, charger]);

  async function enregistrer() {
    // UN PRÉNOM VIDE N'EST PAS UNE CORRECTION. Sans cette garde, quelqu'un qui efface le champ
    // pour le retaper et appuie trop vite se retrouverait salué « Bonjour » tout court partout.
    if (!prenom.trim()) { setSouci("Votre prénom est nécessaire : il s'affiche dans votre club."); return; }
    setEnvoi(true); setSouci(null);
    try {
      await enregistrerMonProfil({ prenom, nom, telephone });
      surEnregistre();
      surFermer();
    } catch (e) {
      setSouci(e instanceof Error ? e.message : "L'enregistrement n'a pas abouti.");
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={surFermer}>
      <Pressable style={s.voile} onPress={surFermer} accessibilityLabel="Fermer" />
      <View style={[s.feuille, { paddingBottom: insets.bottom + E.m }]}>
        <View style={s.poignee} />
        <ScrollView
          contentContainerStyle={{ gap: E.l, paddingBottom: E.xl }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.entete}>
            <Ecusson nom={`${prenom} ${nom}`.trim() || "Moi"} taille={52} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.titre}>Mon profil</Text>
              <Text style={s.sous} numberOfLines={1}>
                {[clubNom, roleLibelle].filter(Boolean).join(" · ") || "Mon compte SportVision"}
              </Text>
            </View>
          </View>

          {chargement ? (
            <View style={{ paddingVertical: E.xl * 2, alignItems: "center" }}>
              <ActivityIndicator color={C.accent} />
            </View>
          ) : (
            <>
              <Champ
                label="Prénom"
                value={prenom}
                onChangeText={setPrenom}
                placeholder="Votre prénom"
                autoCapitalize="words"
                textContentType="givenName"
              />
              <Champ
                label="Nom"
                value={nom}
                onChangeText={setNom}
                placeholder="Votre nom"
                autoCapitalize="words"
                textContentType="familyName"
              />
              <Champ
                label="Téléphone"
                value={telephone}
                onChangeText={setTelephone}
                placeholder="06 12 34 56 78"
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
              />

              <View style={{ gap: E.xs }}>
                <Text style={s.label}>Adresse e-mail</Text>
                <View style={s.fige}>
                  <Text style={s.figeTexte} numberOfLines={1}>{email || "—"}</Text>
                  <Ionicons name="lock-closed-outline" size={15} color={C.texteFaible} />
                </View>
                <Text style={s.aide}>
                  Changer d'adresse demande une confirmation par e-mail. Écrivez-nous depuis
                  « Messages » et nous nous en occupons.
                </Text>
              </View>

              <Erreur message={souci} />
              <Bouton titre="Enregistrer" onPress={enregistrer} enCours={envoi} />
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  voile: { ...(StyleSheet.absoluteFill as object), backgroundColor: "rgba(0,0,0,.6)" },
  feuille: {
    position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "92%",
    backgroundColor: C.surface, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl,
    paddingHorizontal: E.l, paddingTop: E.s,
    borderTopWidth: 1, borderTopColor: C.bordure,
  },
  poignee: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: C.bordure, marginBottom: E.m },
  entete: { flexDirection: "row", alignItems: "center", gap: E.m },
  titre: { color: C.texte, fontFamily: P.titre, fontSize: 24, letterSpacing: -0.5 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5 },
  label: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 12.5 },
  fige: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    height: 52, borderRadius: R.l, paddingHorizontal: E.m,
    backgroundColor: "rgba(255,255,255,.03)", borderWidth: 1, borderColor: C.bordure,
  },
  figeTexte: { flex: 1, color: C.texteFaible, fontFamily: P.texte, fontSize: 15 },
  aide: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5, lineHeight: 18 },
});
