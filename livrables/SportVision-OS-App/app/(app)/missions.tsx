// LES MISSIONS — DEUX MÉTIERS, DEUX ÉCRANS (30/09/2026).
//
// L'OPÉRATEUR vient voir LES SIENNES : quand, où, à quelle heure il est attendu, et ce qu'on lui
// demande. Il est dehors, souvent en 4G, parfois debout. Tout le dessin part de là — les cartes
// se lisent d'un coup d'œil, l'action tient sous le pouce, et rien ne dépend d'un survol.
//
// LA PRODUCTION vient voir CELLES DE TOUS, rangées par ce qu'il reste à faire. Le classement vient
// de `v_production_missions`, et de nulle part ailleurs : le 30/09, un groupe absent de l'écran de
// l'OS a rendu invisibles toutes les prestations vendues et pas encore planifiées. La leçon n'est
// pas d'ajouter un second classement ici, c'est qu'il ne doit y en avoir qu'un.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Ecran, Probleme, Section, Vide } from "../../src/ui/Ecran";
import { Pastille } from "../../src/ui/Base";
import { estProduction, useSession } from "../../src/lib/session";
import {
  lireCockpit, lireMesMissions, repondre,
  type MaMission, type MissionProduction,
} from "../../src/lib/os-missions";
import { dateLongue, heureCourte } from "../../src/lib/dates";
import { C, E, R, TOUCHE } from "../../src/theme/couleurs";
import { P } from "../../src/theme/polices";

/** Les groupes du cockpit, dans l'ordre du travail réel. Mêmes libellés que l'OS. */
const GROUPES: { cle: string; libelle: string }[] = [
  { cle: "a_planifier", libelle: "À planifier" },
  { cle: "attente_acceptation", libelle: "En attente" },
  { cle: "a_venir", libelle: "À venir" },
  { cle: "terrain", libelle: "Sur le terrain" },
  { cle: "post_production", libelle: "Post-production" },
  { cle: "a_verifier", libelle: "À vérifier" },
  { cle: "corrections", libelle: "Corrections" },
  { cle: "terminees", libelle: "Terminées" },
];

export default function Missions() {
  const { moi } = useSession();
  return estProduction(moi?.role ?? null) ? <Cockpit /> : <MesMissions />;
}

// ── L'écran de la production ────────────────────────────────────────────────────────────────
function Cockpit() {
  const [missions, setMissions] = useState<MissionProduction[] | null>(null);
  const [panne, setPanne] = useState(false);
  const [groupe, setGroupe] = useState("a_planifier");

  const charger = useCallback(async () => {
    setPanne(false);
    try { setMissions(await lireCockpit()); } catch { setPanne(true); }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const liste = missions ?? [];
  const compte = useMemo(() => {
    const c = new Map<string, number>();
    for (const m of liste) c.set(m.groupe, (c.get(m.groupe) ?? 0) + 1);
    return c;
  }, [liste]);
  const visibles = liste.filter((m) => m.groupe === groupe);

  return (
    <Ecran enCours={missions === null} teinte="bleu" rafraichir={charger}>
      <View style={{ gap: 4 }}>
        <Text style={s.titre}>Production</Text>
        <Text style={s.sous}>
          {liste.length ? `${liste.length} mission${liste.length > 1 ? "s" : ""} en cours` : "Le cockpit des missions"}
        </Text>
      </View>

      {/* Les groupes VIDES restent affichés : leur absence ferait croire qu'ils n'existent pas, et
          c'est précisément ce qui a caché « À planifier » pendant des mois. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: E.s, paddingRight: E.l }}>
        {GROUPES.map((g) => {
          const actif = g.cle === groupe;
          const n = compte.get(g.cle) ?? 0;
          return (
            <Pressable
              key={g.cle}
              onPress={() => setGroupe(g.cle)}
              accessibilityRole="button"
              accessibilityState={{ selected: actif }}
              accessibilityLabel={`${g.libelle}, ${n}`}
              style={[s.puce, actif && s.puceActive]}
            >
              <Text style={[s.puceTexte, actif && s.puceTexteActif]}>{g.libelle}</Text>
              <View style={[s.badge, actif && s.badgeActif]}>
                <Text style={[s.badgeTexte, actif && s.badgeTexteActif]}>{n}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {missions === null ? (
        <View style={s.attente}><ActivityIndicator color={C.accent} /></View>
      ) : panne ? (
        <Probleme surReessayer={charger} />
      ) : visibles.length ? (
        <View style={{ gap: E.s }}>
          {visibles.map((m) => (
            <View key={m.id} style={s.carte}>
              <View style={s.ligne}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={s.nom} numberOfLines={1}>{m.client ?? "Sans client"}</Text>
                  <Text style={s.detail} numberOfLines={1}>
                    {[m.date ? dateLongue(m.date) : null, heureCourte(m.heureDebut), m.lieu]
                      .filter(Boolean).join(" · ")}
                  </Text>
                  <Text style={s.reference}>{m.reference}</Text>
                </View>
                {m.prete ? <Pastille ton="succes" texte="Prête" /> : null}
              </View>
              <Text style={s.operateurs} numberOfLines={1}>
                {m.operateurs || "Aucun opérateur affecté"}
              </Text>
              {/* Ce qui cloche est dit en clair, pas signalé par une couleur seule. */}
              {m.enRetard || m.echeanceManquante ? (
                <View style={s.alertes}>
                  {m.enRetard ? <Pastille ton="danger" texte="Livraison en retard" /> : null}
                  {m.echeanceManquante ? <Pastille ton="alerte" texte="Échéance manquante" /> : null}
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <Vide
          titre="Rien dans ce groupe"
          texte="Les missions arrivent ici au fur et à mesure qu'elles changent d'état. Touchez un autre groupe ci-dessus."
        />
      )}
    </Ecran>
  );
}

// ── L'écran de l'opérateur ──────────────────────────────────────────────────────────────────
function MesMissions() {
  const { moi } = useSession();
  const [missions, setMissions] = useState<MaMission[] | null>(null);
  const [panne, setPanne] = useState(false);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [souci, setSouci] = useState<string | null>(null);

  const charger = useCallback(async () => {
    setPanne(false); setSouci(null);
    try { setMissions(await lireMesMissions()); } catch { setPanne(true); }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  async function agir(m: MaMission, accepte: boolean) {
    setEnCours(m.affectationId); setSouci(null);
    try { await repondre(m.affectationId, accepte); await charger(); }
    catch (e) { setSouci(e instanceof Error ? e.message : "La réponse n'est pas partie."); }
    finally { setEnCours(null); }
  }

  const liste = missions ?? [];
  const aRepondre = liste.filter((m) => m.reponse === "invitation_envoyée" || m.reponse === "en_attente");
  const acceptees = liste.filter((m) => m.reponse === "acceptée");

  return (
    <Ecran enCours={missions === null} teinte="cyan" rafraichir={charger}>
      <View style={{ gap: 4 }}>
        <Text style={s.titre}>Bonjour {moi?.prenom || ""}</Text>
        <Text style={s.sous}>{moi?.metier ?? "SportVision"}</Text>
      </View>

      {souci ? (
        <View style={s.erreur}><Text style={s.erreurTexte}>{souci}</Text></View>
      ) : null}

      {missions === null ? (
        <View style={s.attente}><ActivityIndicator color={C.accent} /></View>
      ) : panne ? (
        <Probleme surReessayer={charger} />
      ) : (
        <>
          {/* CE QUI ATTEND UNE RÉPONSE PASSE DEVANT. Une invitation qui dort, c'est une mission
              qui n'a personne : c'est le seul endroit de l'écran où le geste est urgent. */}
          {aRepondre.length ? (
            <Section titre="À répondre">
              <View style={{ gap: E.s }}>
                {aRepondre.map((m) => (
                  <CarteMission
                    key={m.affectationId}
                    m={m}
                    enCours={enCours === m.affectationId}
                    surAccepter={() => agir(m, true)}
                    surRefuser={() => agir(m, false)}
                  />
                ))}
              </View>
            </Section>
          ) : null}

          {acceptees.length ? (
            <Section titre="Mes missions">
              <View style={{ gap: E.s }}>
                {acceptees.map((m) => <CarteMission key={m.affectationId} m={m} />)}
              </View>
            </Section>
          ) : null}

          {!aRepondre.length && !acceptees.length ? (
            <Vide
              titre="Aucune mission pour l'instant"
              texte="Vos missions apparaîtront ici dès que la production vous en affecte une. Vous recevrez une invitation à accepter."
            />
          ) : null}
        </>
      )}
    </Ecran>
  );
}

function CarteMission({
  m, enCours, surAccepter, surRefuser,
}: {
  m: MaMission;
  enCours?: boolean;
  surAccepter?: () => void;
  surRefuser?: () => void;
}) {
  return (
    <View style={s.carte}>
      <View style={s.ligne}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.nom} numberOfLines={2}>{m.client ?? "Mission SportVision"}</Text>
          <Text style={s.detail} numberOfLines={2}>
            {[m.date ? dateLongue(m.date) : null, heureCourte(m.heureRdv ?? m.heureDebut)]
              .filter(Boolean).join(" · ")}
          </Text>
          {m.lieu ? <Text style={s.detail} numberOfLines={2}>{m.lieu}</Text> : null}
        </View>
        {m.responsable ? <Pastille ton="info" texte="Responsable" /> : null}
      </View>

      {/* LE BRIEF EST CE QU'ON VIENT LIRE AU BORD DU TERRAIN. Il passe avant la rémunération, qui
          ne change rien à ce qu'on fait une fois sur place. */}
      {m.brief || m.besoin ? (
        <View style={s.brief}>
          <Text style={s.briefTitre}>Brief</Text>
          <Text style={s.briefTexte}>{m.brief || m.besoin}</Text>
        </View>
      ) : null}

      <View style={s.bas}>
        {m.couverture ? <Pastille texte={m.couverture} /> : null}
        {m.remuneration !== null ? (
          <Text style={s.remu}>{m.remuneration} €</Text>
        ) : null}
      </View>

      {surAccepter && surRefuser ? (
        <View style={s.actions}>
          <Pressable
            onPress={surRefuser}
            accessibilityRole="button"
            accessibilityLabel="Refuser cette mission"
            style={({ pressed }) => [s.bouton, s.refuser, pressed ? { opacity: 0.85 } : null]}
          >
            <Text style={s.refuserTexte}>Refuser</Text>
          </Pressable>
          <Pressable
            onPress={surAccepter}
            accessibilityRole="button"
            accessibilityLabel="Accepter cette mission"
            style={({ pressed }) => [s.bouton, s.accepter, pressed ? { opacity: 0.85 } : null]}
          >
            {enCours ? (
              <ActivityIndicator color={C.succes} />
            ) : (
              <>
                <Ionicons name="checkmark" size={16} color={C.succes} />
                <Text style={s.accepterTexte}>Accepter</Text>
              </>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  titre: { color: C.texte, fontFamily: P.titre, fontSize: 26, letterSpacing: -0.6 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5 },
  attente: { paddingVertical: E.xl * 2, alignItems: "center" },

  puce: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: E.m, height: TOUCHE - 6, borderRadius: R.pill,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  puceActive: { backgroundColor: "rgba(36,84,255,.20)", borderColor: "rgba(36,84,255,.55)" },
  puceTexte: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: 13 },
  puceTexteActif: { color: C.texte, fontFamily: P.texteFort },
  badge: { minWidth: 20, paddingHorizontal: 5, borderRadius: R.pill, backgroundColor: "rgba(255,255,255,.07)" },
  badgeActif: { backgroundColor: "rgba(255,255,255,.16)" },
  badgeTexte: { color: C.texteFaible, fontFamily: P.texteFort, fontSize: 11, textAlign: "center" },
  badgeTexteActif: { color: C.texte },

  carte: {
    gap: E.s, padding: E.m, borderRadius: R.l,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  ligne: { flexDirection: "row", alignItems: "flex-start", gap: E.s },
  nom: { color: C.texte, fontFamily: P.titreFort, fontSize: 16 },
  detail: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
  reference: { color: C.texteFaible, fontFamily: P.texte, fontSize: 11.5 },
  operateurs: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: 13 },
  alertes: { flexDirection: "row", flexWrap: "wrap", gap: E.xs },

  brief: {
    gap: 3, padding: E.s, borderRadius: R.m,
    backgroundColor: "rgba(0,199,255,.08)", borderWidth: 1, borderColor: "rgba(0,199,255,.26)",
  },
  briefTitre: { color: C.cyan, fontFamily: P.texteFort, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 },
  briefTexte: { color: C.texte, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },

  bas: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: E.s },
  remu: { color: C.texte, fontFamily: P.titreFort, fontSize: 15 },

  actions: { flexDirection: "row", gap: E.s },
  bouton: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    minHeight: TOUCHE, borderRadius: R.m, borderWidth: 1,
  },
  accepter: { backgroundColor: "rgba(40,190,120,.12)", borderColor: "rgba(40,190,120,.38)" },
  accepterTexte: { color: C.succes, fontFamily: P.texteFort, fontSize: 14 },
  refuser: { backgroundColor: "rgba(255,255,255,.05)", borderColor: C.bordureForte },
  refuserTexte: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 14 },

  erreur: {
    padding: E.m, borderRadius: R.l,
    backgroundColor: "rgba(240,68,94,.12)", borderWidth: 1, borderColor: "rgba(240,68,94,.35)",
  },
  erreurTexte: { color: C.dangerTexte, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
});
