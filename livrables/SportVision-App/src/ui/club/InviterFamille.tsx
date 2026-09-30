// INVITER UN JOUEUR OU UN PARENT, EN NATIF (30/09/2026).
//
// Quatrième et dernier des écrans choisis par Fouka. Il en a donné l'intention ainsi : « que le
// coach puisse inviter ses joueurs, parents ».
//
// CE QUE LA BASE DIT AUJOURD'HUI, ET QU'IL FAUT DIRE AUSSI : un coach n'a PAS ce droit —
// `peut_operer_club` rend faux pour lui, et c'est ce que l'edge function exige. L'écran demande
// donc le droit AVANT de proposer le formulaire, et explique à qui s'adresser plutôt que de faire
// échouer un envoi. Ouvrir l'invitation aux coachs est une décision de droits, elle se prend en
// base ; le jour où elle est prise, cet écran s'ouvre tout seul.
//
// DEUX INVITATIONS, DEUX FORMES. Un JOUEUR rejoint une équipe et on lui connaît une date de
// naissance ; un PARENT suit un enfant, et sans cet enfant désigné aucun lien parent/enfant n'est
// créé — c'est le défaut corrigé côté site le 12/09. Le formulaire change donc vraiment de forme,
// il ne grise pas des champs.
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Bouton, Champ, Erreur } from "../Base";
import {
  inviter, lireEffectif, peutInviter,
  type CibleInvitation, type JoueurDeLEquipe,
} from "../../lib/club-inviter";
import { type EquipeDuClub } from "../../lib/club";
import { C, E, R, TOUCHE } from "../../theme/couleurs";
import { P } from "../../theme/polices";

export function InviterFamille({
  clubId, equipe, surFermer,
}: {
  clubId: string;
  /** L'équipe depuis laquelle on invite. `null` ferme la feuille. */
  equipe: EquipeDuClub | null;
  surFermer: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [droit, setDroit] = useState<boolean | null>(null);
  const [cible, setCible] = useState<CibleInvitation>("joueur");
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [naissance, setNaissance] = useState("");
  const [effectif, setEffectif] = useState<JoueurDeLEquipe[]>([]);
  const [enfant, setEnfant] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [souci, setSouci] = useState<string | null>(null);
  const [reussite, setReussite] = useState<string | null>(null);

  const preparer = useCallback(async () => {
    setDroit(null); setSouci(null); setReussite(null);
    setPrenom(""); setNom(""); setEmail(""); setNaissance(""); setEnfant(null); setCible("joueur");
    setDroit(await peutInviter(clubId));
    if (equipe) {
      try { setEffectif(await lireEffectif(equipe.id)); } catch { setEffectif([]); }
    }
  }, [clubId, equipe]);

  useEffect(() => { if (equipe) preparer(); }, [equipe, preparer]);

  async function envoyer() {
    if (!equipe) return;
    if (!prenom.trim() || !nom.trim()) { setSouci("Le prénom et le nom sont nécessaires."); return; }
    // UNE ADRESSE SANS ARROBASE N'EST PAS UNE ADRESSE. On le dit ici plutôt que de laisser partir
    // une invitation qui n'arrivera nulle part et que personne ne viendra réclamer.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setSouci("Vérifiez l'adresse e-mail."); return; }
    if (cible === "parent" && !enfant) { setSouci("Choisissez l'enfant que ce parent suivra."); return; }
    if (cible === "joueur" && naissance.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(naissance.trim())) {
      setSouci("La date de naissance s'écrit AAAA-MM-JJ, par exemple 2012-04-27."); return;
    }

    setEnvoi(true); setSouci(null); setReussite(null);
    try {
      const r = await inviter({
        cible, email, prenom, nom, clubId,
        equipeId: equipe.id,
        dateNaissance: naissance.trim() || null,
        joueurId: enfant,
      });
      setReussite(r.dejaInvitee
        ? `${prenom.trim()} avait déjà été invité : l'invitation a été renvoyée.`
        : `Invitation envoyée à ${email.trim()}.`);
      setPrenom(""); setNom(""); setEmail(""); setNaissance(""); setEnfant(null);
    } catch (e) {
      setSouci(e instanceof Error ? e.message : "L'invitation n'est pas partie.");
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal visible={!!equipe} animationType="slide" transparent onRequestClose={surFermer}>
      <Pressable style={s.voile} onPress={surFermer} accessibilityLabel="Fermer" />
      <View style={[s.feuille, { paddingBottom: insets.bottom + E.m }]}>
        <View style={s.poignee} />
        <ScrollView
          contentContainerStyle={{ gap: E.l, paddingBottom: E.xl }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: 2 }}>
            <Text style={s.titre}>Inviter</Text>
            <Text style={s.sous}>{equipe?.nom ?? ""}</Text>
          </View>

          {droit === null ? (
            <View style={{ paddingVertical: E.xl * 2, alignItems: "center" }}>
              <ActivityIndicator color={C.accent} />
            </View>
          ) : !droit ? (
            /* PAS DE FORMULAIRE QU'ON NE PEUT PAS ENVOYER, et on dit à qui s'adresser. Laisser le
               formulaire pour finir sur « Non autorisé sur ce club », ce serait exactement le
               bouton actif que Club+ montre aujourd'hui à un coach. */
            <View style={s.avis}>
              <View style={s.rondAvis}><Ionicons name="lock-closed" size={18} color={C.alerteTexte} /></View>
              <View style={{ flex: 1, gap: E.xs }}>
                <Text style={s.avisTitre}>Les invitations passent par la direction du club</Text>
                <Text style={s.avisTexte}>
                  Faire entrer un joueur ou un parent dans le club est réservé à son administrateur,
                  à son président et à votre Community Manager SportVision. Demandez-leur : ils
                  reçoivent le nom et l'adresse, l'invitation part dans la foulée.
                </Text>
              </View>
            </View>
          ) : (
            <>
              <View style={s.segments}>
                {(["joueur", "parent"] as const).map((c) => {
                  const actif = c === cible;
                  return (
                    <Pressable
                      key={c}
                      onPress={() => { setCible(c); setSouci(null); setReussite(null); }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: actif }}
                      accessibilityLabel={c === "joueur" ? "Inviter un joueur" : "Inviter un parent"}
                      style={[s.segment, actif && s.segmentActif]}
                    >
                      <Text style={[s.segmentTexte, actif && s.segmentTexteActif]}>
                        {c === "joueur" ? "Un joueur" : "Un parent"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Champ label="Prénom" value={prenom} onChangeText={setPrenom} placeholder="Prénom" autoCapitalize="words" />
              <Champ label="Nom" value={nom} onChangeText={setNom} placeholder="Nom" autoCapitalize="words" />
              <Champ
                label="Adresse e-mail"
                value={email}
                onChangeText={setEmail}
                placeholder="prenom.nom@exemple.fr"
                keyboardType="email-address"
                textContentType="emailAddress"
              />

              {cible === "joueur" ? (
                <Champ
                  label="Date de naissance (facultatif)"
                  value={naissance}
                  onChangeText={setNaissance}
                  placeholder="2012-04-27"
                  keyboardType="numbers-and-punctuation"
                />
              ) : (
                <View style={{ gap: E.xs }}>
                  <Text style={s.label}>L'enfant qu'il suivra</Text>
                  {effectif.length ? (
                    <View style={s.enfants}>
                      {effectif.map((j) => {
                        const actif = j.id === enfant;
                        return (
                          <Pressable
                            key={j.id}
                            onPress={() => setEnfant(actif ? null : j.id)}
                            accessibilityRole="button"
                            accessibilityState={{ selected: actif }}
                            accessibilityLabel={j.nom}
                            style={[s.puce, actif && s.puceActive]}
                          >
                            <Text style={[s.puceTexte, actif && s.puceTexteActif]}>{j.nom}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : (
                    <Text style={s.aide}>
                      Aucun joueur n'est encore inscrit dans cette équipe. Invitez d'abord l'enfant,
                      puis son parent : sans enfant désigné, le lien parent/enfant n'est pas créé.
                    </Text>
                  )}
                </View>
              )}

              <Erreur message={souci} />
              {reussite ? (
                <View style={s.reussite}>
                  <Ionicons name="checkmark-circle" size={17} color={C.succes} />
                  <Text style={s.reussiteTexte}>{reussite}</Text>
                </View>
              ) : null}

              <Bouton
                titre={cible === "joueur" ? "Inviter ce joueur" : "Inviter ce parent"}
                onPress={envoyer}
                enCours={envoi}
                desactive={cible === "parent" && !effectif.length}
              />
              <Text style={s.aide}>
                L'invité reçoit un e-mail, choisit son mot de passe et crée sa fiche lui-même. Rien
                n'est visible de lui tant qu'il n'a pas accepté.
              </Text>
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
  titre: { color: C.texte, fontFamily: P.titre, fontSize: 24, letterSpacing: -0.5 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5 },
  label: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 12.5 },
  aide: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5, lineHeight: 18 },

  segments: { flexDirection: "row", gap: 4, backgroundColor: "rgba(255,255,255,.04)", padding: 4, borderRadius: R.pill, borderWidth: 1, borderColor: C.bordure },
  segment: { flex: 1, minHeight: 40, borderRadius: R.pill, alignItems: "center", justifyContent: "center" },
  segmentActif: { backgroundColor: "rgba(36,84,255,.24)" },
  segmentTexte: { color: C.texteFaible, fontFamily: P.texteMoyen, fontSize: 13.5 },
  segmentTexteActif: { color: C.texte, fontFamily: P.texteFort },

  enfants: { flexDirection: "row", flexWrap: "wrap", gap: E.s },
  puce: {
    paddingHorizontal: E.m, minHeight: TOUCHE - 6, justifyContent: "center", borderRadius: R.pill,
    backgroundColor: "rgba(255,255,255,.04)", borderWidth: 1, borderColor: C.bordure,
  },
  puceActive: { backgroundColor: "rgba(36,84,255,.20)", borderColor: "rgba(36,84,255,.55)" },
  puceTexte: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: 13 },
  puceTexteActif: { color: C.texte, fontFamily: P.texteFort },

  avis: {
    flexDirection: "row", gap: E.m, padding: E.l, borderRadius: R.l,
    backgroundColor: "rgba(232,163,61,.08)", borderWidth: 1, borderColor: "rgba(232,163,61,.3)",
  },
  rondAvis: { width: 36, height: 36, borderRadius: R.m, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(232,163,61,.14)" },
  avisTitre: { color: C.alerteTexte, fontFamily: P.titreFort, fontSize: 15.5 },
  avisTexte: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },

  reussite: {
    flexDirection: "row", alignItems: "center", gap: E.s, padding: E.m, borderRadius: R.l,
    backgroundColor: "rgba(40,190,120,.10)", borderWidth: 1, borderColor: "rgba(40,190,120,.32)",
  },
  reussiteTexte: { flex: 1, color: C.texte, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
});
