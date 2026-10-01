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
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useRouter } from "expo-router";
import { Ecran, Probleme, Section, Vide } from "../../src/ui/Ecran";
import { Bouton, Champ, Erreur, Pastille } from "../../src/ui/Base";
import { estProduction, useSession } from "../../src/lib/session";
import { libelleCouverture } from "../../src/lib/os-missions";
import {
  lireCockpit, lireMesMissions, repondre,
  type MaMission, type MissionProduction,
} from "../../src/lib/os-missions";
import { dateLongue, heureCourte } from "../../src/lib/dates";
import { C, E, R, TOUCHE } from "../../src/theme/couleurs";
import { P, T } from "../../src/theme/polices";

/** Les trois réponses d'affectation qui ferment la mission pour l'opérateur, et le mot qui le
 *  dit. Les quatre autres valeurs de `statut_affectation` sont ailleurs : `invitation_envoyée` et
 *  `en_attente` attendent une réponse, `acceptée` est une mission à faire, et `a_envoyer` n'est pas
 *  lisible par lui (la RLS l'exclut — la Production ne l'a pas encore envoyée). */
const REPONDUES_PASSEES: Record<string, string> = {
  "refusée": "Vous avez refusé",
  "remplacée": "Remplacé par la production",
  "annulée": "Annulée par la production",
};

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
                  {/* DEUX LIGNES, PARCE QUE LE LIEU EST TOUJOURS LE DERNIER (01/10/2026, vu à
                      l'écran). Sur une seule ligne, « samedi 12 septembre · 09h30 · Stade Claude
                      Ripert Villemomble » s'arrêtait à « Stade Cl… » : la date et l'heure tiennent,
                      le lieu jamais. Or c'est le lieu que la production vérifie quand elle cherche
                      où quelqu'un doit aller. Les noms de stade de la base vont jusqu'à 48
                      caractères (« Centre omnisport universitaire Carole Vergne ») : deux lignes
                      les portent, une seule ne le pourra jamais. */}
                  <Text style={s.detail} numberOfLines={2}>
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
          icone="funnel-outline"
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

  // UNE RÉPONSE NE PART PLUS AU PREMIER APPUI (01/10/2026).
  //
  // Mesuré dans `protect_sensitive_affectation_fields` puis vérifié par le chemin réel avec le
  // jeton d'un opérateur : une fois la réponse envoyée, la base REFUSE de revenir dessus, dans les
  // deux sens — `refusée → acceptée` et `acceptée → refusée` lèvent la même exception. Seule la
  // Production peut remettre l'affectation en « invitation_envoyée » (vérifié aussi).
  //
  // Or l'écran posait « Refuser » et « Accepter » côte à côte, en pleine largeur, et exécutait au
  // premier contact. Un pouce qui glisse au bord d'un terrain coûtait la mission, sans retour
  // possible et sans que la Production sache pourquoi. C'est le geste le plus irréversible de
  // l'application : il demande une seconde intention.
  const [aConfirmer, setAConfirmer] = useState<{ m: MaMission; accepte: boolean } | null>(null);

  async function repondreVraiment(m: MaMission, accepte: boolean, motif: string) {
    setEnCours(m.affectationId); setSouci(null);
    try {
      await repondre(m.affectationId, accepte, motif);
      setAConfirmer(null);
      await charger();
    }
    catch (e) { setSouci(e instanceof Error ? e.message : "La réponse n'est pas partie."); }
    finally { setEnCours(null); }
  }

  const liste = missions ?? [];
  const aRepondre = liste.filter((m) => m.reponse === "invitation_envoyée" || m.reponse === "en_attente");
  const acceptees = liste.filter((m) => m.reponse === "acceptée");
  // UN REFUS LAISSE UNE TRACE (01/10/2026).
  //
  // L'écran ne montrait QUE les invitations en attente et les missions acceptées. Un opérateur qui
  // refusait voyait la carte s'évanouir, sans un mot : rien ne lui disait que sa réponse était
  // partie, et rien ne lui permettait de la retrouver ensuite — alors que c'est la réponse sur
  // laquelle il ne peut plus revenir. Même disparition pour une affectation « remplacée » ou
  // « annulée » par la Production : la mission s'efface de son téléphone sans explication.
  //
  // L'OS WEB, LUI, LES MONTRE DEPUIS TOUJOURS (son `filterPhotoPre` a un onglet par statut
  // d'affectation, « Refusée » comprise). Ce n'est donc pas un ajout : c'est l'alignement des deux
  // produits sur la même vérité. La RLS les rend lisibles — `equipe_select` ouvre toute ligne dont
  // `collaborateur_id = auth.uid()` sauf `a_envoyer`, celle que la Production n'a pas encore
  // envoyée et qu'il n'a donc pas à voir.
  const closes = liste.filter((m) => REPONDUES_PASSEES[m.reponse]);

  return (
    <Ecran enCours={missions === null} teinte="cyan" rafraichir={charger}>
      {/* « MES MISSIONS », ET PAS UNE SECONDE FOIS « BONJOUR » (01/10/2026, vu à l'écran).
          L'Accueil et cet écran portaient le MÊME titre, au caractère près : « Bonjour Apple ».
          On passe de l'un à l'autre sans que rien ne change en haut, et on doute d'avoir changé
          d'écran. Le titre d'un écran le nomme ; le bonjour appartient à l'Accueil, qui est le
          seul à s'ouvrir sur quelqu'un. « Mes missions » est le nom de l'OS, et celui de
          l'onglet. */}
      <View style={{ gap: 4 }}>
        <Text style={s.titre}>Mes missions</Text>
        <Text style={s.sous}>{moi?.metier ?? "SportVision"}</Text>
      </View>

      {/* La brique commune, et non un bloc d'erreur maison : c'est exactement le « huitième cadre
          légèrement différent » que le contrat interdit (règle 1). */}
      <Erreur message={souci} />

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
                    surAccepter={() => { setSouci(null); setAConfirmer({ m, accepte: true }); }}
                    surRefuser={() => { setSouci(null); setAConfirmer({ m, accepte: false }); }}
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

          {/* Derrière les missions à faire, parce que c'est du passé — mais présent, parce que
              c'est la preuve de ce qu'on a répondu. Pas de Mode Jour J ici : `surAccepter` est
              absent, donc la carte le propose… et il ne doit pas. On le coupe explicitement. */}
          {closes.length ? (
            <Section titre="Sans suite">
              <View style={{ gap: E.s }}>
                {closes.map((m) => (
                  <CarteMission
                    key={m.affectationId}
                    m={m}
                    close={REPONDUES_PASSEES[m.reponse]}
                  />
                ))}
              </View>
            </Section>
          ) : null}

          {aConfirmer ? (
            <Confirmation
              m={aConfirmer.m}
              accepte={aConfirmer.accepte}
              enCours={enCours === aConfirmer.m.affectationId}
              surAnnuler={() => setAConfirmer(null)}
              surValider={(motif) => repondreVraiment(aConfirmer.m, aConfirmer.accepte, motif)}
            />
          ) : null}

          {!aRepondre.length && !acceptees.length && !closes.length ? (
            <Vide
              icone="calendar-outline"
              titre="Aucune mission pour l'instant"
              texte="Vos missions apparaîtront ici dès que la production vous en affecte une. Vous recevrez une invitation à accepter."
              action={{ libelle: "Ouvrir la messagerie", surPression: () => router.push("/messagerie") }}
            />
          ) : null}
        </>
      )}
    </Ecran>
  );
}

// ── La confirmation d'une réponse ───────────────────────────────────────────────────────────────
//
// Une feuille qui monte du bas, et qui BLOQUE : c'est la seule forme qui empêche un second appui
// réflexe d'aller au bout. Elle dit, en une phrase, ce que la base fait réellement — accepter fait
// passer la mission en « Équipe affectée », refuser la renvoie en attribution, et dans les deux cas
// on ne revient pas dessus soi-même.
//
// LE MOTIF EST DEMANDÉ SUR UN REFUS, ET IL N'EST PAS OBLIGATOIRE. Il part dans
// `prestations_equipe.notes_refus`, que l'opérateur a le droit d'écrire (vérifié par le chemin
// réel, valeur relue). Le rendre obligatoire aurait fait échouer un refus légitime au moment où la
// personne est pressée — c'est exactement la leçon du 25/09 sur le motif d'ajustement de
// rémunération, retiré par Fouka pour la même raison.
function Confirmation({
  m, accepte, enCours, surAnnuler, surValider,
}: {
  m: MaMission;
  accepte: boolean;
  enCours: boolean;
  surAnnuler: () => void;
  surValider: (motif: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [motif, setMotif] = useState("");
  const quoi = [m.client ?? "Mission SportVision", m.date ? dateLongue(m.date) : null]
    .filter(Boolean).join(" · ");

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      // Le bouton retour d'Android ferme la feuille au lieu de quitter l'écran : sans ça, il
      // traverse et l'opérateur se retrouve ailleurs avec sa réponse non envoyée.
      onRequestClose={surAnnuler}
    >
      <View style={s.voile}>
        {/* Toucher à côté annule. Un voile inerte donne l'impression d'un écran figé. */}
        <Pressable
          style={{ flex: 1 }}
          onPress={surAnnuler}
          accessibilityRole="button"
          accessibilityLabel="Annuler et revenir à mes missions"
        />
        <View style={[s.feuille, { paddingBottom: insets.bottom + E.l }]}>
          <Text style={s.feuilleTitre}>
            {accepte ? "Accepter cette mission ?" : "Refuser cette mission ?"}
          </Text>
          <Text style={s.feuilleQuoi}>{quoi}</Text>
          {/* CE QUE LA BASE FAIT VRAIMENT, ET RIEN DE PLUS (mesuré le 01/10/2026, deux fois, en
              transaction annulée, avec le jeton d'Antoine Blin sur une invitation réelle) :

                REFUS    → `prestations_equipe.statut` passe à « refusée », `notes_refus` s'écrit,
                           `cascade_prestations_equipe_reponse` ramène la mission en « planifiée »
                           s'il ne reste aucun autre opérateur accepté, et
                           `notifier_mission_refusee` écrit DEUX notifications de priorité haute
                           aux responsables de production, motif compris :
                           « Antoine Blin ne peut pas assurer RCP Fontainebleau du 03/10 — « … » ».
                           La promesse « la production sera prévenue » est donc vraie, à la lettre.

                ACCEPTATION → la mission passe bien en « équipe_affectée », et PERSONNE N'EST
                           NOTIFIÉ. Mesuré : zéro ligne dans `notifications` pour cette prestation.
                           Aucun déclencheur ne le fait, et `trg_notify_prestation_stage` ne parle
                           qu'au client. La phrase disait « la production sera prévenue » : c'était
                           un faux succès, sur le geste le plus irréversible de l'application.

              On dit donc ce qui se passe : la mission change d'état, et la Production la voit
              changer d'état dans son cockpit. Qu'une acceptation mérite une notification comme un
              refus en a une est une décision qui appartient à Fouka, pas une phrase à écrire ici. */}
          <Text style={s.feuilleTexte}>
            {accepte
              ? "La mission passera en « Équipe affectée » et la production vous y verra. "
                + "Vous ne pourrez plus la refuser vous-même : il faudra lui demander de vous renvoyer l'invitation."
              : "La mission repartira en attribution et la production sera prévenue. "
                + "Vous ne pourrez plus l'accepter vous-même : il faudra lui demander de vous renvoyer l'invitation."}
          </Text>

          {!accepte ? (
            <Champ
              label="Pourquoi (facultatif, mais ça aide la production)"
              value={motif}
              onChangeText={setMotif}
              multiline
              hauteur={84}
              placeholder="Ex : indisponible ce jour-là, trop loin, déjà sur une autre mission…"
            />
          ) : null}

          <View style={s.feuilleActions}>
            <View style={{ flex: 1 }}>
              <Bouton titre="Annuler" onPress={surAnnuler} secondaire />
            </View>
            <View style={{ flex: 1 }}>
              <Bouton
                titre={accepte ? "J'accepte" : "Je refuse"}
                onPress={() => surValider(motif)}
                enCours={enCours}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function CarteMission({
  m, enCours, surAccepter, surRefuser, close,
}: {
  m: MaMission;
  enCours?: boolean;
  surAccepter?: () => void;
  surRefuser?: () => void;
  /** Le mot qui dit pourquoi cette mission n'est plus la sienne. Présent = aucune action. */
  close?: string;
}) {
  const router = useRouter();
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
        {close ? <Pastille ton="neutre" texte={close} />
          : m.responsable ? <Pastille ton="info" texte="Responsable" /> : null}
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
        {libelleCouverture(m.couverture) ? <Pastille texte={libelleCouverture(m.couverture)!} /> : null}
        {m.remuneration !== null ? (
          <Text style={s.remu}>{m.remuneration} €</Text>
        ) : null}
      </View>

      {/* LE MODE JOUR J EST SUR LA CARTE D'UNE MISSION ACCEPTÉE, et c'est le seul endroit où il a
          un sens : l'OS l'ouvre lui aussi depuis la carte d'une prestation, jamais depuis un menu.
          Sur une invitation en attente il n'y est pas — on répond d'abord, on part ensuite. */}
      {!surAccepter && !close ? (
        <Pressable
          onPress={() => router.push({ pathname: "/terrain", params: { prestation: m.prestationId } })}
          accessibilityRole="button"
          accessibilityLabel={`Ouvrir le Mode Jour J de la mission ${m.client ?? "SportVision"}`}
          style={({ pressed }) => [s.jourj, pressed ? { opacity: 0.85 } : null]}
        >
          <Ionicons name="radio-button-on" size={17} color={C.dangerTexte} />
          <Text style={s.jourjTexte}>Mode Jour J</Text>
        </Pressable>
      ) : null}

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
  titre: { color: C.texte, fontFamily: P.titre, fontSize: T.titreEcran, letterSpacing: -0.6 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: T.sousEcran, lineHeight: T.sousEcranHauteur },
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

  // Le rouge du Mode Jour J, celui de l'OS (`var(--er)`) : le seul rouge de l'application qui ne
  // signale pas une erreur. Il dit « en direct », et il est identique sur l'accueil.
  jourj: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: E.xs,
    minHeight: TOUCHE, borderRadius: R.m,
    backgroundColor: "rgba(240,68,94,.12)", borderWidth: 1, borderColor: "rgba(240,68,94,.34)",
  },
  jourjTexte: { color: C.dangerTexte, fontFamily: P.texteFort, fontSize: 14.5 },

  actions: { flexDirection: "row", gap: E.s },
  bouton: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    minHeight: TOUCHE, borderRadius: R.m, borderWidth: 1,
  },
  accepter: { backgroundColor: "rgba(40,190,120,.12)", borderColor: "rgba(40,190,120,.38)" },
  accepterTexte: { color: C.succes, fontFamily: P.texteFort, fontSize: 14 },
  refuser: { backgroundColor: "rgba(255,255,255,.05)", borderColor: C.bordureForte },
  refuserTexte: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 14 },

  voile: { flex: 1, backgroundColor: "rgba(3,5,12,.72)", justifyContent: "flex-end" },
  feuille: {
    gap: E.m, padding: E.l, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl,
    backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.bordureForte,
  },
  feuilleTitre: { color: C.texte, fontFamily: P.titre, fontSize: 21, letterSpacing: -0.4 },
  feuilleQuoi: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 13.5, marginTop: -E.s },
  feuilleTexte: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
  feuilleActions: { flexDirection: "row", gap: E.s },

  erreur: {
    padding: E.m, borderRadius: R.l,
    backgroundColor: "rgba(240,68,94,.12)", borderWidth: 1, borderColor: "rgba(240,68,94,.35)",
  },
  erreurTexte: { color: C.dangerTexte, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
});
