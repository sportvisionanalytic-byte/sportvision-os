// ACCEPTER UN JOUEUR DANS SON ÉQUIPE, DEPUIS LE TÉLÉPHONE (30/09/2026).
//
// Fouka : « il faut qu'un coach puisse accepter un parent, accepter que c'est bien lui, ou
// accepter qu'il fait bien partie de son équipe ». C'est déjà son droit en base — ce qui manquait,
// c'était de pouvoir le faire là où il est, c'est-à-dire rarement devant un ordinateur.
//
// CE QUI EST EN ATTENTE PASSE DEVANT. Une demande traitée n'appelle plus aucun geste : elle
// descend sous « Déjà traitées », repliée derrière son nombre. L'écran ouvre sur ce qui attend
// quelqu'un, pas sur un historique.
//
// LE REFUS DEMANDE UN MOTIF, et c'est délibéré : la famille le lit. « Refusée », tout court, fait
// rappeler le club — ce qui coûte plus cher que la phrase qu'on n'a pas écrite.
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Ecran, Probleme, Vide } from "../Ecran";
import { Erreur, Pastille } from "../Base";
import {
  accepter, estClose, lireAffiliations, refuser,
  type DemandeAffiliation,
} from "../../lib/club-affiliations";
import { dateLongue } from "../../lib/dates";
import { C, E, R, TOUCHE } from "../../theme/couleurs";
import { P } from "../../theme/polices";

/** Le mot qu'on montre pour chaque statut. Ceux de la base sont des identifiants, pas des phrases. */
const MOTS: Record<string, { texte: string; ton: "alerte" | "info" | "succes" | "danger" }> = {
  a_verifier: { texte: "À vérifier", ton: "alerte" },
  autorisation_manquante: { texte: "Autorisation parentale manquante", ton: "alerte" },
  en_attente_parent: { texte: "En attente du parent", ton: "info" },
  pret_a_valider: { texte: "Prêt à valider", ton: "info" },
  doublon_signale: { texte: "Doublon signalé", ton: "alerte" },
  transferee_admin: { texte: "Transmise à la direction", ton: "info" },
  validee: { texte: "Validée", ton: "succes" },
  refusee: { texte: "Refusée", ton: "danger" },
};

export function AffiliationsClub({ clubId, perimetre }: { clubId: string; perimetre: string[] }) {
  const [demandes, setDemandes] = useState<DemandeAffiliation[] | null>(null);
  const [panne, setPanne] = useState(false);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [souci, setSouci] = useState<string | null>(null);
  const [refusOuvert, setRefusOuvert] = useState<string | null>(null);
  const [motif, setMotif] = useState("");
  const [historiqueOuvert, setHistoriqueOuvert] = useState(false);

  const charger = useCallback(async () => {
    setPanne(false); setSouci(null);
    try { setDemandes(await lireAffiliations(clubId)); }
    catch { setPanne(true); }
  }, [clubId]);

  useEffect(() => { charger(); }, [charger]);

  async function agir(d: DemandeAffiliation, action: "accepter" | "refuser") {
    setEnCours(d.id); setSouci(null);
    try {
      if (action === "accepter") await accepter(d);
      else await refuser(d, motif);
      setRefusOuvert(null); setMotif("");
      await charger();
    } catch (e) {
      setSouci(e instanceof Error ? e.message : "L'opération n'a pas abouti.");
    } finally {
      setEnCours(null);
    }
  }

  const liste = demandes ?? [];
  const enAttente = liste.filter((d) => !estClose(d));
  const traitees = liste.filter(estClose);

  return (
    <Ecran enCours={demandes === null} teinte="violet" rafraichir={charger}>
      <View style={{ gap: 4 }}>
        <Text style={s.titre}>Affiliations</Text>
        <Text style={s.sous} numberOfLines={1}>
          {perimetre.length ? perimetre.join(" · ") : "Tout le club"}
        </Text>
      </View>

      <Erreur message={souci} />

      {demandes === null ? (
        <View style={{ paddingVertical: E.xl * 2, alignItems: "center" }}>
          <ActivityIndicator color={C.accent} />
        </View>
      ) : panne ? (
        <Probleme surReessayer={charger} />
      ) : (
        <>
          {enAttente.length ? (
            <View style={{ gap: E.s }}>
              {enAttente.map((d) => (
                <View key={d.id} style={s.carte}>
                  <View style={s.entete}>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={s.nom} numberOfLines={1}>{d.joueur}</Text>
                      <Text style={s.detail} numberOfLines={1}>
                        {[d.equipe, d.creeLe ? dateLongue(d.creeLe.slice(0, 10)) : null]
                          .filter(Boolean).join(" · ")}
                      </Text>
                    </View>
                    <Pastille
                      ton={MOTS[d.statut]?.ton ?? "neutre"}
                      texte={MOTS[d.statut]?.texte ?? d.statut}
                    />
                  </View>

                  {/* EN MODE DOUBLE, LE COACH CONFIRME ET NE VALIDE PAS, et le bouton le dit :
                      promettre « valider » pour finir sur « seul un administrateur peut valider »
                      serait une promesse cassée de plus. */}
                  {refusOuvert === d.id ? (
                    <View style={{ gap: E.s }}>
                      <TextInput
                        value={motif}
                        onChangeText={setMotif}
                        placeholder="Pourquoi ? La famille le lira."
                        placeholderTextColor={C.texteFaible}
                        style={s.motif}
                        multiline
                        accessibilityLabel="Motif du refus"
                      />
                      <View style={s.actions}>
                        <Pressable
                          onPress={() => { setRefusOuvert(null); setMotif(""); }}
                          accessibilityRole="button" accessibilityLabel="Annuler le refus"
                          style={({ pressed }) => [s.bouton, s.secondaire, pressed ? { opacity: 0.8 } : null]}
                        >
                          <Text style={s.secondaireTexte}>Annuler</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => agir(d, "refuser")}
                          accessibilityRole="button" accessibilityLabel={`Refuser ${d.joueur}`}
                          style={({ pressed }) => [s.bouton, s.refus, pressed ? { opacity: 0.85 } : null]}
                        >
                          {enCours === d.id
                            ? <ActivityIndicator color={C.dangerTexte} />
                            : <Text style={s.refusTexte}>Refuser</Text>}
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <View style={s.actions}>
                      <Pressable
                        onPress={() => { setRefusOuvert(d.id); setMotif(""); }}
                        accessibilityRole="button" accessibilityLabel={`Refuser ${d.joueur}`}
                        style={({ pressed }) => [s.bouton, s.secondaire, pressed ? { opacity: 0.8 } : null]}
                      >
                        <Text style={s.secondaireTexte}>Refuser</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => agir(d, "accepter")}
                        accessibilityRole="button"
                        accessibilityLabel={`Accepter ${d.joueur} dans ${d.equipe ?? "l'équipe"}`}
                        style={({ pressed }) => [s.bouton, s.accepte, pressed ? { opacity: 0.85 } : null]}
                      >
                        {enCours === d.id ? (
                          <ActivityIndicator color={C.succes} />
                        ) : (
                          <>
                            <Ionicons name="checkmark" size={16} color={C.succes} />
                            <Text style={s.accepteTexte}>
                              {d.mode === "double" && !d.confirmeeParEducateur ? "Confirmer" : "Accepter"}
                            </Text>
                          </>
                        )}
                      </Pressable>
                    </View>
                  )}
                </View>
              ))}
            </View>
          ) : (
            <Vide
              titre="Rien en attente"
              texte={
                perimetre.length
                  ? "Personne ne demande à rejoindre vos équipes en ce moment. Les demandes arrivent quand une famille saisit le code d'équipe ou répond à une invitation."
                  : "Aucune demande d'adhésion en attente dans ce club."
              }
            />
          )}

          {traitees.length ? (
            <View style={{ gap: E.s }}>
              <Pressable
                onPress={() => setHistoriqueOuvert((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: historiqueOuvert }}
                accessibilityLabel={`Déjà traitées, ${traitees.length}`}
                style={({ pressed }) => [s.replie, pressed ? { opacity: 0.85 } : null]}
              >
                <Text style={s.replieTexte}>Déjà traitées</Text>
                <Text style={s.replieCompte}>{traitees.length}</Text>
                <Ionicons name={historiqueOuvert ? "chevron-up" : "chevron-down"} size={16} color={C.texteFaible} />
              </Pressable>
              {historiqueOuvert
                ? traitees.map((d) => (
                    <View key={d.id} style={[s.carte, { opacity: 0.75 }]}>
                      <View style={s.entete}>
                        <View style={{ flex: 1, gap: 3 }}>
                          <Text style={s.nom} numberOfLines={1}>{d.joueur}</Text>
                          <Text style={s.detail} numberOfLines={2}>
                            {[d.equipe, d.motifRefus].filter(Boolean).join(" · ")}
                          </Text>
                        </View>
                        <Pastille
                          ton={MOTS[d.statut]?.ton ?? "neutre"}
                          texte={MOTS[d.statut]?.texte ?? d.statut}
                        />
                      </View>
                    </View>
                  ))
                : null}
            </View>
          ) : null}
        </>
      )}
    </Ecran>
  );
}

const s = StyleSheet.create({
  titre: { color: C.texte, fontFamily: P.titre, fontSize: 26, letterSpacing: -0.6 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5 },
  carte: {
    gap: E.m, padding: E.m, borderRadius: R.l,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  entete: { flexDirection: "row", alignItems: "flex-start", gap: E.s },
  nom: { color: C.texte, fontFamily: P.titreFort, fontSize: 16 },
  detail: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: "row", gap: E.s },
  bouton: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    minHeight: TOUCHE, borderRadius: R.m, borderWidth: 1,
  },
  secondaire: { backgroundColor: "rgba(255,255,255,.05)", borderColor: C.bordureForte },
  secondaireTexte: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 14 },
  accepte: { backgroundColor: "rgba(40,190,120,.12)", borderColor: "rgba(40,190,120,.38)" },
  accepteTexte: { color: C.succes, fontFamily: P.texteFort, fontSize: 14 },
  refus: { backgroundColor: "rgba(240,68,94,.12)", borderColor: "rgba(240,68,94,.38)" },
  refusTexte: { color: C.dangerTexte, fontFamily: P.texteFort, fontSize: 14 },
  motif: {
    minHeight: 72, borderRadius: R.m, padding: E.s, textAlignVertical: "top",
    backgroundColor: "rgba(255,255,255,.04)", borderWidth: 1, borderColor: C.bordure,
    color: C.texte, fontFamily: P.texte, fontSize: 14,
  },
  replie: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    minHeight: TOUCHE, paddingHorizontal: E.m, borderRadius: R.l,
    backgroundColor: "rgba(255,255,255,.04)", borderWidth: 1, borderColor: C.bordure,
  },
  replieTexte: { flex: 1, color: C.texteDoux, fontFamily: P.texteFort, fontSize: 14 },
  replieCompte: { color: C.texteFaible, fontFamily: P.texte, fontSize: 13 },
});
