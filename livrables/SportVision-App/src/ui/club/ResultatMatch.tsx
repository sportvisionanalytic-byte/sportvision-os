// SAISIR LE RÉSULTAT D'UN MATCH, AU BORD DU TERRAIN (30/09/2026).
//
// POURQUOI CET ÉCRAN EXISTE, ET POURQUOI IL EST DESSINÉ COMME ÇA. Fouka l'a choisi en premier
// parmi les écrans à passer en natif : c'est le seul de Club+ qu'on utilise DEBOUT, une main sur
// le téléphone, souvent en 4G, juste après le coup de sifflet final. Tout le dessin découle de là :
//
//   · DEUX GROS COMPTEURS plutôt qu'un champ de saisie. Pas de clavier qui mange l'écran, pas de
//     virgule ni de texte à valider, et des cibles de 52 points qu'on touche sans regarder.
//   · LE STATUT D'ABORD. « Reporté » et « annulé » sont les deux cas où l'on ouvre cet écran sans
//     score à saisir ; les mettre après les compteurs obligerait à remplir un score pour dire
//     qu'il n'y en a pas.
//   · AUCUN FAUX SUCCÈS. L'enregistrement ne dit « enregistré » que si la base a bien rendu une
//     ligne (voir `enregistrerResultat`). Règle posée le 10/09 après le « ça n'enregistre pas »
//     de Villemomble.
//
// CE QU'ON NE FAIT PAS ICI : les buteurs, l'homme du match, les cartons, l'affluence. Club+ les
// porte, ils demandent la liste des joueurs, et ce n'est pas ce qu'on saisit debout. Un lien mène
// à la fiche complète pour qui veut aller plus loin.
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Bouton, Erreur } from "../Base";
import { Ecusson } from "../Cartes";
import {
  enregistrerResultat, lireMatchClub, peutSaisirResultat,
  type MatchClub, type StatutMatch,
} from "../../lib/club-match";
import { dateLongue, heureCourte } from "../../lib/dates";
import { C, E, R, TOUCHE } from "../../theme/couleurs";
import { P } from "../../theme/polices";

const STATUTS: { cle: StatutMatch; libelle: string }[] = [
  { cle: "joue", libelle: "Joué" },
  { cle: "reporte", libelle: "Reporté" },
  { cle: "annule", libelle: "Annulé" },
];

export function ResultatMatch({
  matchId, clubNom, clubLogoUrl, surFermer, surEnregistre, surWeb,
}: {
  /** L'identifiant d'affichage (« match-<uuid> ») ou l'uuid nu. `null` ferme la feuille. */
  matchId: string | null;
  clubNom?: string | null;
  clubLogoUrl?: string | null;
  surFermer: () => void;
  /** Appelé après un enregistrement réussi, pour que le calendrier se relise. */
  surEnregistre: () => void;
  surWeb: (chemin: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [match, setMatch] = useState<MatchClub | null>(null);
  const [peutEcrire, setPeutEcrire] = useState(false);
  const [chargement, setChargement] = useState(false);
  const [souci, setSouci] = useState<string | null>(null);

  const [statut, setStatut] = useState<StatutMatch>("joue");
  const [pour, setPour] = useState(0);
  const [contre, setContre] = useState(0);
  const [envoi, setEnvoi] = useState(false);

  const charger = useCallback(async (id: string) => {
    setChargement(true); setSouci(null); setMatch(null);
    try {
      const m = await lireMatchClub(id);
      if (!m) { setSouci("Ce match n'existe plus."); return; }
      setMatch(m);
      setStatut(m.statut ?? "joue");
      const chiffres = (m.score ?? "").match(/(\d+)\s*[-–]\s*(\d+)/);
      setPour(chiffres ? Number(chiffres[1]) : 0);
      setContre(chiffres ? Number(chiffres[2]) : 0);
      setPeutEcrire(await peutSaisirResultat(m));
    } catch {
      setSouci("Le match n'a pas pu être chargé. Vérifiez votre connexion.");
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { if (matchId) charger(matchId); }, [matchId, charger]);

  async function enregistrer() {
    if (!match) return;
    setEnvoi(true); setSouci(null);
    try {
      await enregistrerResultat(match, statut, statut === "joue" ? { pour, contre } : null);
      surEnregistre();
      surFermer();
    } catch (e) {
      setSouci(e instanceof Error && e.message ? e.message : "L'enregistrement n'a pas abouti.");
    } finally {
      setEnvoi(false);
    }
  }

  const adversaire = match?.adversaire ?? "Adversaire";

  return (
    <Modal visible={!!matchId} animationType="slide" transparent onRequestClose={surFermer}>
      <Pressable style={s.voile} onPress={surFermer} accessibilityLabel="Fermer" />
      <View style={[s.feuille, { paddingBottom: insets.bottom + E.m }]}>
        <View style={s.poignee} />
        <ScrollView contentContainerStyle={{ gap: E.l, paddingBottom: E.l }} showsVerticalScrollIndicator={false}>
          {chargement ? (
            <View style={{ paddingVertical: E.xl * 2, alignItems: "center" }}>
              <ActivityIndicator color={C.accent} />
            </View>
          ) : !match ? (
            <View style={{ gap: E.s, paddingVertical: E.l }}>
              <Text style={s.titre}>Match indisponible</Text>
              <Erreur message={souci} />
            </View>
          ) : (
            <>
              <View style={{ gap: E.xs }}>
                <Text style={s.surtitre}>
                  {[match.competition, match.domicile ? "à domicile" : "à l'extérieur"].filter(Boolean).join(" · ")}
                </Text>
                <View style={s.affiche}>
                  <View style={s.camp}>
                    <Ecusson url={clubLogoUrl} nom={clubNom} taille={44} />
                    <Text style={s.campNom} numberOfLines={2}>{match.equipe || clubNom || "Notre équipe"}</Text>
                  </View>
                  <Text style={s.contre}>{match.domicile ? "vs" : "@"}</Text>
                  <View style={s.camp}>
                    <Ecusson nom={adversaire} taille={44} neutre />
                    <Text style={s.campNom} numberOfLines={2}>{adversaire}</Text>
                  </View>
                </View>
                <Text style={s.quand}>
                  {[match.date ? dateLongue(match.date) : null, heureCourte(match.heure), match.lieu]
                    .filter(Boolean).join(" · ")}
                </Text>
              </View>

              {!peutEcrire ? (
                /* PAS DE FORMULAIRE QU'ON NE PEUT PAS ENVOYER. La base a répondu qu'il n'est pas
                   éducateur de cette équipe : afficher des compteurs pour finir sur « refusé »
                   serait une promesse cassée. On montre ce qu'il y a, et où aller. */
                <View style={{ gap: E.s }}>
                  <Text style={s.label}>Résultat</Text>
                  <Text style={s.scoreLecture}>
                    {match.statut === "reporte" ? "Match reporté"
                      : match.statut === "annule" ? "Match annulé"
                      : match.score ?? "Pas encore saisi"}
                  </Text>
                  <Text style={s.aide}>
                    Seul l'encadrement de cette équipe peut saisir son résultat.
                  </Text>
                </View>
              ) : (
                <>
                  <View style={{ gap: E.s }}>
                    <Text style={s.label}>Ce match a été</Text>
                    <View style={s.segments}>
                      {STATUTS.map((st) => {
                        const actif = st.cle === statut;
                        return (
                          <Pressable
                            key={st.cle}
                            onPress={() => setStatut(st.cle)}
                            accessibilityRole="button"
                            accessibilityState={{ selected: actif }}
                            accessibilityLabel={st.libelle}
                            style={[s.segment, actif && s.segmentActif]}
                          >
                            <Text style={[s.segmentTexte, actif && s.segmentTexteActif]}>{st.libelle}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  {statut === "joue" ? (
                    <View style={{ gap: E.s }}>
                      <Text style={s.label}>Score</Text>
                      <View style={s.compteurs}>
                        <Compteur
                          titre={match.equipe || "Nous"}
                          valeur={pour}
                          surChange={setPour}
                          teinte={C.accentClair}
                        />
                        <Compteur
                          titre={adversaire}
                          valeur={contre}
                          surChange={setContre}
                          teinte={C.texteDoux}
                        />
                      </View>
                    </View>
                  ) : (
                    <Text style={s.aide}>
                      {statut === "reporte"
                        ? "Le match sera annoncé comme reporté, sans score, dans l'application des familles."
                        : "Le match sera annoncé comme annulé, sans score, dans l'application des familles."}
                    </Text>
                  )}

                  <Erreur message={souci} />
                  <Bouton
                    titre={statut === "joue" ? "Enregistrer le résultat" : "Enregistrer"}
                    onPress={enregistrer}
                    enCours={envoi}
                  />
                </>
              )}

              <Pressable
                onPress={() => { surFermer(); surWeb("/matchcenter"); }}
                accessibilityRole="button"
                accessibilityLabel="Ouvrir le Match Center dans Club plus"
                style={({ pressed }) => [s.lienWeb, pressed ? { opacity: 0.85 } : null]}
              >
                <Ionicons name="open-outline" size={16} color={C.texteDoux} />
                <Text style={s.lienWebTexte}>Buteurs, cartons, homme du match</Text>
                <Ionicons name="chevron-forward" size={15} color={C.texteFaible} />
              </Pressable>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Un compteur de buts : deux cibles larges et un chiffre qu'on lit de loin. */
function Compteur({
  titre, valeur, surChange, teinte,
}: { titre: string; valeur: number; surChange: (n: number) => void; teinte: string }) {
  return (
    <View style={s.compteur}>
      <Text style={s.compteurTitre} numberOfLines={2}>{titre}</Text>
      <Text style={[s.compteurValeur, { color: teinte }]}>{valeur}</Text>
      <View style={s.compteurBoutons}>
        <Pressable
          onPress={() => surChange(Math.max(0, valeur - 1))}
          accessibilityRole="button"
          accessibilityLabel={`Retirer un but à ${titre}`}
          // Un score ne descend pas sous zéro, et le bouton le dit au lieu de ne rien faire.
          disabled={valeur === 0}
          style={({ pressed }) => [s.pas, pressed ? { opacity: 0.7 } : null, valeur === 0 ? { opacity: 0.35 } : null]}
        >
          <Ionicons name="remove" size={22} color={C.texte} />
        </Pressable>
        <Pressable
          onPress={() => surChange(Math.min(99, valeur + 1))}
          accessibilityRole="button"
          accessibilityLabel={`Ajouter un but à ${titre}`}
          style={({ pressed }) => [s.pas, pressed ? { opacity: 0.7 } : null]}
        >
          <Ionicons name="add" size={22} color={C.texte} />
        </Pressable>
      </View>
    </View>
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
  titre: { color: C.texte, fontFamily: P.titre, fontSize: 21, letterSpacing: -0.4 },
  surtitre: {
    color: C.cyan, fontFamily: P.texteFort, fontSize: 11,
    textTransform: "uppercase", letterSpacing: 0.9, textAlign: "center",
  },
  affiche: { flexDirection: "row", alignItems: "flex-start", gap: E.s, paddingTop: E.xs },
  camp: { flex: 1, alignItems: "center", gap: E.xs },
  campNom: { alignSelf: "stretch", textAlign: "center", color: C.texte, fontFamily: P.titreFort, fontSize: 14, lineHeight: 18 },
  contre: { color: C.texteFaible, fontFamily: P.titre, fontSize: 15, paddingTop: 14 },
  quand: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13, textAlign: "center", lineHeight: 19 },

  label: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 12.5 },
  aide: { color: C.texteFaible, fontFamily: P.texte, fontSize: 13, lineHeight: 19 },
  scoreLecture: { color: C.texte, fontFamily: P.titre, fontSize: 30, letterSpacing: -0.8 },

  segments: { flexDirection: "row", gap: 4, backgroundColor: "rgba(255,255,255,.04)", padding: 4, borderRadius: R.pill, borderWidth: 1, borderColor: C.bordure },
  segment: { flex: 1, minHeight: 40, borderRadius: R.pill, alignItems: "center", justifyContent: "center" },
  segmentActif: { backgroundColor: "rgba(36,84,255,.24)" },
  segmentTexte: { color: C.texteFaible, fontFamily: P.texteMoyen, fontSize: 13.5 },
  segmentTexteActif: { color: C.texte, fontFamily: P.texteFort },

  compteurs: { flexDirection: "row", gap: E.s },
  compteur: {
    flex: 1, alignItems: "center", gap: E.xs, paddingVertical: E.m, paddingHorizontal: E.s,
    borderRadius: R.l, backgroundColor: "rgba(255,255,255,.04)", borderWidth: 1, borderColor: C.bordure,
  },
  compteurTitre: { alignSelf: "stretch", textAlign: "center", color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: 12.5, lineHeight: 16 },
  compteurValeur: { fontFamily: P.titre, fontSize: 46, lineHeight: 52, fontVariant: ["tabular-nums"] },
  compteurBoutons: { flexDirection: "row", gap: E.s },
  pas: {
    width: 52, height: TOUCHE, borderRadius: R.m, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.07)", borderWidth: 1, borderColor: C.bordureForte,
  },

  lienWeb: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    minHeight: TOUCHE, paddingHorizontal: E.m, borderRadius: R.l,
    backgroundColor: "rgba(255,255,255,.04)", borderWidth: 1, borderColor: C.bordure,
  },
  lienWebTexte: { flex: 1, color: C.texteDoux, fontFamily: P.texteFort, fontSize: 14 },
});
