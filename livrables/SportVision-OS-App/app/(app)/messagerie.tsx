// LA MESSAGERIE (30/09/2026).
//
// CE QUI RELIE L'ÉQUIPE. Cinq métiers sur six ont cet écran dans l'OS : opérateur, production,
// community manager, commercial, secrétariat. C'est le seul endroit où un opérateur au bord d'un
// terrain parle au responsable de production, et l'écran est dessiné pour ce moment-là.
//
// DEUX VUES DANS UN SEUL ÉCRAN : la liste, puis le fil. Pas un second fichier de route, parce
// qu'un retour d'écran sur un téléphone doit être instantané et ne rien recharger — la liste reste
// montée derrière. C'est le comportement de l'OS sur mobile (`msg-conv-active`), en natif.
//
// LA LISTE MONTRE LES CONVERSATIONS, PAS L'ANNUAIRE. L'OS affiche les dix-huit profils l'un sous
// l'autre, en permanence. Sur un téléphone, ce serait dix-huit lignes vides à faire défiler pour
// retrouver les quatre échanges réels (mesuré sur le compte d'Antoine : 6 messages, 4
// interlocuteurs). L'équipe complète reste à un appui, derrière « + Nouveau », comme le
// `msgNewConv()` de l'OS.
//
// PAS DE SONDAGE PERMANENT. Voir l'en-tête de `src/lib/os-messagerie.ts` : `messages` est publiée
// en temps réel, on écoute les insertions. Le glisser-pour-rafraîchir reste là pour le cas où le
// flux ne passe pas.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ecran, Probleme, Section, Vide } from "../../src/ui/Ecran";
import { Erreur } from "../../src/ui/Base";
import { Ecusson } from "../../src/ui/Ecusson";
import { Lueur } from "../../src/ui/Fond";
import { useSession } from "../../src/lib/session";
import { oublier, useDonnees } from "../../src/lib/cache";
import {
  EQUIPE, ecouterMessages, envoyer, heureDe, jourDe, lireFil, lireMessagerie, marquerLu, quandCourt,
  type CleConversation, type Conversation, type Correspondant, type Message, type Messagerie,
} from "../../src/lib/os-messagerie";
import { C, E, R, TOUCHE } from "../../src/theme/couleurs";
import { P } from "../../src/theme/polices";

export default function MessagerieEcran() {
  const { moi } = useSession();
  // Le Centre SportVision ouvre une conversation directement : « Qui contacter ? » → un message au
  // Responsable Production. C'est le seul lien entre deux écrans de ce domaine, et il est natif.
  const params = useLocalSearchParams<{ vers?: string }>();
  const [ouverte, setOuverte] = useState<CleConversation | null>(null);
  const [nouvelle, setNouvelle] = useState(false);
  const consomme = useRef<string | null>(null);

  const { donnees, chargement, rafraichissement, erreur, relire } = useDonnees<Messagerie>(
    moi ? `messagerie:${moi.id}` : null,
    () => lireMessagerie(moi!.id),
    [moi?.id],
  );

  useEffect(() => {
    const vers = typeof params.vers === "string" ? params.vers : null;
    if (vers && consomme.current !== vers) {
      consomme.current = vers;
      setOuverte(vers);
      setNouvelle(false);
    }
  }, [params.vers]);

  // Un message qui arrive pendant qu'on regarde l'écran doit s'y voir. On oublie la réponse en
  // mémoire avant de relire, sinon `useDonnees` réaffiche l'ancienne liste le temps d'un rendu.
  useEffect(() => {
    if (!moi) return;
    return ecouterMessages("liste", () => { oublier(`messagerie:${moi.id}`); relire(); });
  }, [moi, relire]);

  if (!moi) return <Ecran><Text style={s.attente}>Chargement…</Text></Ecran>;

  if (ouverte) {
    const conv = donnees?.conversations.find((c) => c.cle === ouverte);
    const contact = donnees?.equipe.find((p) => p.id === ouverte);
    return (
      <Fil
        moiId={moi.id}
        cle={ouverte}
        nom={ouverte === EQUIPE ? "Équipe SportVision" : (conv?.nom ?? contact?.nom ?? "Conversation")}
        sousTitre={
          ouverte === EQUIPE
            ? "Visible par toute l'équipe"
            : (conv?.sousTitre ?? contact?.metier ?? null)
        }
        nonLus={conv?.nonLus ?? 0}
        surRetour={() => { setOuverte(null); relire(); }}
        surChangement={() => { oublier(`messagerie:${moi.id}`); relire(); }}
      />
    );
  }

  return (
    <Ecran teinte="bleu" enCours={rafraichissement} rafraichir={relire}>
      <View style={{ gap: 4 }}>
        <Text style={s.titre}>Messagerie</Text>
        <Text style={s.sous}>
          {donnees?.nonLus
            ? `${donnees.nonLus} message${donnees.nonLus > 1 ? "s" : ""} non lu${donnees.nonLus > 1 ? "s" : ""}`
            : "Équipe & production"}
        </Text>
      </View>

      {erreur && !donnees ? <Probleme surReessayer={relire} /> : null}
      {chargement ? <Text style={s.attente}>Chargement…</Text> : null}

      {donnees && !nouvelle ? (
        <>
          <Section
            titre="Messages"
            action={
              <Pressable
                onPress={() => setNouvelle(true)}
                accessibilityRole="button"
                accessibilityLabel="Nouvelle conversation"
                hitSlop={8}
                style={({ pressed }) => [s.lien, pressed ? { opacity: 0.7 } : null]}
              >
                <Text style={s.lienTexte}>+ Nouveau</Text>
              </Pressable>
            }
          >
            <View style={s.bloc}>
              {donnees.conversations.map((c, i) => (
                <LigneConversation
                  key={c.cle}
                  conv={c}
                  derniere={i === donnees.conversations.length - 1}
                  surAppui={() => setOuverte(c.cle)}
                />
              ))}
            </View>
          </Section>

          {donnees.conversations.length <= 1 ? (
            <Vide
              titre="Aucune conversation privée"
              texte={
                "Vous n'avez encore échangé avec personne. Touchez « + Nouveau » pour choisir un " +
                "membre de l'équipe, ou écrivez à tout le monde depuis la conversation Équipe."
              }
            />
          ) : null}
        </>
      ) : null}

      {donnees && nouvelle ? (
        <Section
          titre="Nouvelle conversation"
          action={
            <Pressable
              onPress={() => setNouvelle(false)}
              accessibilityRole="button"
              accessibilityLabel="Annuler"
              hitSlop={8}
              style={({ pressed }) => [s.lien, pressed ? { opacity: 0.7 } : null]}
            >
              <Text style={s.lienTexte}>Annuler</Text>
            </Pressable>
          }
        >
          <Text style={s.consigne}>Choisir un membre de l'équipe :</Text>
          <View style={s.bloc}>
            {donnees.equipe
              .filter((p) => p.id !== moi.id)
              .map((p, i, liste) => (
                <LigneMembre
                  key={p.id}
                  membre={p}
                  derniere={i === liste.length - 1}
                  surAppui={() => { setNouvelle(false); setOuverte(p.id); }}
                />
              ))}
          </View>
          {/* CE CAS N'EST PAS THÉORIQUE. Mesuré le 30/09 : les deux community managers ne voient
              qu'un seul profil SportVision, le leur — l'annuaire interne leur est fermé par une
              policy RESTRICTIVE (détail dans `os-messagerie.ts`). Leur écran « + Nouveau » est donc
              vide, et sans ce texte il ressemble à une panne de chargement. */}
          {donnees.equipe.filter((p) => p.id !== moi.id).length === 0 ? (
            <Vide
              titre="Aucun correspondant visible"
              texte={
                "L'annuaire interne ne vous est pas ouvert depuis ce compte : vous pouvez répondre " +
                "aux personnes qui vous ont déjà écrit, mais pas démarrer une conversation. Pour " +
                "joindre quelqu'un d'autre, demandez à l'administration."
              }
            />
          ) : null}
        </Section>
      ) : null}
    </Ecran>
  );
}

// ── La liste ────────────────────────────────────────────────────────────────────────────────────

function LigneConversation({
  conv, derniere, surAppui,
}: { conv: Conversation; derniere: boolean; surAppui: () => void }) {
  const equipe = conv.cle === EQUIPE;
  return (
    <Pressable
      onPress={surAppui}
      accessibilityRole="button"
      accessibilityLabel={
        conv.nonLus
          ? `${conv.nom}, ${conv.nonLus} message${conv.nonLus > 1 ? "s" : ""} non lu${conv.nonLus > 1 ? "s" : ""}`
          : conv.nom
      }
      style={({ pressed }) => [s.ligne, derniere && { borderBottomWidth: 0 }, pressed ? { opacity: 0.7 } : null]}
    >
      {equipe ? (
        <View style={s.rondEquipe}><Ionicons name="people" size={19} color={C.cyanTexte} /></View>
      ) : (
        <Ecusson nom={conv.nom} taille={40} />
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.ligneNom, conv.nonLus > 0 && { fontFamily: P.titreFort }]} numberOfLines={1}>
          {conv.nom}
        </Text>
        <Text style={s.ligneSous} numberOfLines={1}>
          {conv.dernier ?? conv.sousTitre}
        </Text>
      </View>
      {conv.nonLus > 0 ? (
        <View style={s.badgeNonLus}><Text style={s.badgeNonLusTexte}>{conv.nonLus}</Text></View>
      ) : conv.dernierQuand ? (
        <Text style={s.ligneHeure}>{quandCourt(conv.dernierQuand)}</Text>
      ) : null}
      <Ionicons name="chevron-forward" size={16} color={C.texteFaible} />
    </Pressable>
  );
}

function LigneMembre({
  membre, derniere, surAppui,
}: { membre: Correspondant; derniere: boolean; surAppui: () => void }) {
  return (
    <Pressable
      onPress={surAppui}
      accessibilityRole="button"
      accessibilityLabel={`Écrire à ${membre.nom}, ${membre.metier}`}
      style={({ pressed }) => [s.ligne, derniere && { borderBottomWidth: 0 }, pressed ? { opacity: 0.7 } : null]}
    >
      <Ecusson nom={membre.nom} taille={40} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.ligneNom} numberOfLines={1}>{membre.nom}</Text>
        <Text style={s.ligneSous} numberOfLines={1}>{membre.metier}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={C.texteFaible} />
    </Pressable>
  );
}

// ── Le fil ──────────────────────────────────────────────────────────────────────────────────────
//
// CET ÉCRAN N'UTILISE PAS `Ecran`, ET C'EST LA SEULE EXCEPTION DE TOUT LE DOMAINE. `Ecran` est une
// page qui défile de haut en bas, avec la marge des onglets en bas. Un fil de discussion demande le
// contraire : le contenu collé en bas, le champ de saisie fixé au-dessus du clavier, et le défilé
// qui suit le dernier message. On garde donc la lueur de marque, les couleurs, les espacements et
// les polices communes — on ne recrée rien — mais la mise en page est celle d'une conversation.
function Fil({
  moiId, cle, nom, sousTitre, nonLus, surRetour, surChangement,
}: {
  moiId: string;
  cle: CleConversation;
  nom: string;
  sousTitre: string | null;
  nonLus: number;
  surRetour: () => void;
  surChangement: () => void;
}) {
  const insets = useSafeAreaInsets();
  const clavier = useClavierOuvert();
  const [brouillon, setBrouillon] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [panne, setPanne] = useState<string | null>(null);
  const defile = useRef<ScrollView | null>(null);

  const { donnees, chargement, erreur, relire } = useDonnees<Message[]>(
    `fil:${moiId}:${cle}`,
    () => lireFil(moiId, cle),
    [moiId, cle],
  );

  // MARQUER LU UNE FOIS, ET SEULEMENT S'IL Y A QUELQUE CHOSE À MARQUER. `marquerLu` lève quand
  // l'écriture ne rend aucune ligne (règle 4 du contrat) : appelée sans non-lus, elle lèverait
  // toujours. Un échec ici ne doit rien casser — on lit quand même la conversation, et l'accusé de
  // lecture se rattrapera au passage suivant.
  // Le garde-fou retient LA CONVERSATION déjà marquée, pas un simple « c'est fait ». `Fil` n'est
  // pas remonté quand on passe d'une conversation à une autre : React réutilise le composant avec
  // une autre `cle`. Un booléen resté vrai aurait fait que seule la PREMIÈRE conversation ouverte
  // se marquait lue, et les suivantes auraient gardé leur pastille bleue indéfiniment.
  const marquee = useRef<string | null>(null);
  useEffect(() => {
    if (cle === EQUIPE || nonLus <= 0 || marquee.current === cle) return;
    marquee.current = cle;
    marquerLu(moiId, cle).then(surChangement).catch(() => {});
  }, [cle, nonLus, moiId, surChangement]);

  // Un message qui arrive alors que le fil est ouvert doit s'afficher sans rien toucher.
  useEffect(() => {
    return ecouterMessages("fil", () => { oublier(`fil:${moiId}:${cle}`); relire(); });
  }, [moiId, cle, relire]);

  const messages = useMemo(() => donnees ?? [], [donnees]);

  const expedier = useCallback(async () => {
    const texte = brouillon.trim();
    if (!texte || envoi) return;
    setEnvoi(true);
    setPanne(null);
    // On vide le champ tout de suite : c'est ce que fait l'OS, et c'est ce qu'on attend d'une
    // messagerie. En cas d'échec, le texte est remis — jamais perdu.
    setBrouillon("");
    try {
      await envoyer(moiId, cle, texte);
      oublier(`fil:${moiId}:${cle}`);
      relire();
      surChangement();
    } catch (e) {
      setBrouillon(texte);
      setPanne(e instanceof Error ? e.message : "Message non envoyé.");
    } finally {
      setEnvoi(false);
    }
  }, [brouillon, envoi, moiId, cle, relire, surChangement]);

  return (
    <View style={{ flex: 1, backgroundColor: C.fond }}>
      <Lueur teinte="bleu" />

      <View style={[s.entete, { paddingTop: insets.top + E.s }]}>
        <Pressable
          onPress={surRetour}
          accessibilityRole="button"
          accessibilityLabel="Retour à la liste"
          hitSlop={10}
          style={({ pressed }) => [s.retour, pressed ? { opacity: 0.7 } : null]}
        >
          <Ionicons name="chevron-back" size={22} color={C.texte} />
        </Pressable>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={s.enteteNom} numberOfLines={1}>{nom}</Text>
          {sousTitre ? <Text style={s.enteteSous} numberOfLines={1}>{sousTitre}</Text> : null}
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        // Sur iOS le clavier recouvre la vue ; sur Android il redimensionne déjà la fenêtre, et
        // « padding » y ajouterait un vide sous le champ.
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          ref={defile}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: E.m, paddingVertical: E.m, gap: 2 }}
          // On reste collé au dernier message, y compris quand le clavier s'ouvre et réduit la
          // hauteur : sans ça, on écrit sans voir ce qu'on répond.
          onContentSizeChange={() => defile.current?.scrollToEnd({ animated: false })}
          keyboardDismissMode="interactive"
        >
          {chargement ? <Text style={s.attente}>Chargement…</Text> : null}
          {erreur && !donnees ? <Probleme surReessayer={relire} /> : null}

          {donnees && !messages.length ? (
            <View style={{ paddingTop: E.xl }}>
              <Vide
                titre={cle === EQUIPE ? "Aucun message d'équipe" : "Aucun message"}
                texte={
                  cle === EQUIPE
                    ? "Personne n'a encore écrit à l'équipe. Votre message sera visible par tout le monde."
                    : "Envoyez votre premier message privé."
                }
              />
            </View>
          ) : null}

          {messages.map((m, i) => (
            <Bulle
              key={m.id}
              m={m}
              // Le séparateur de journée : « lundi 1 septembre », comme dans l'OS. Sans lui, deux
              // messages à un mois d'écart se lisent comme une suite.
              jour={
                i === 0 || jourDe(m.quand) !== jourDe(messages[i - 1].quand)
                  ? jourDe(m.quand)
                  : null
              }
              equipe={cle === EQUIPE}
            />
          ))}
        </ScrollView>

        {/* LA BARRE D'ONGLETS FLOTTE AU-DESSUS DU CONTENU (voir `_layout.tsx` : `position:
            absolute`). Sans dégagement en bas, elle recouvrirait purement et simplement le champ
            de saisie — le même défaut que « Se déconnecter » coupé en deux, pour lequel `Ecran`
            réserve déjà 72 points. On reprend la même valeur, d'où elle vient.

            SAUF CLAVIER OUVERT SUR iOS : `KeyboardAvoidingView` remonte alors tout le bloc au-dessus
            du clavier, et la barre d'onglets reste cachée dessous. Garder les 72 points y
            laisserait un grand vide entre le champ et le clavier. Sur Android la fenêtre est
            redimensionnée et la barre remonte avec elle : le dégagement reste nécessaire. */}
        <View
          style={[
            s.saisie,
            { paddingBottom: clavier && Platform.OS === "ios" ? E.s : insets.bottom + 72 },
          ]}
        >
          <Erreur message={panne} />
          <View style={s.saisieLigne}>
            <TextInput
              value={brouillon}
              onChangeText={setBrouillon}
              placeholder="Écrire un message…"
              placeholderTextColor={C.texteFaible}
              style={s.champ}
              multiline
              // Le champ grandit jusqu'à quatre lignes (`maxHeight` dans le style) puis défile :
              // au-delà, il mangerait la conversation qu'on est en train de lire.
              maxLength={4000}
              autoCapitalize="sentences"
              accessibilityLabel="Écrire un message"
            />
            <Pressable
              onPress={expedier}
              disabled={!brouillon.trim() || envoi}
              accessibilityRole="button"
              accessibilityLabel="Envoyer"
              accessibilityState={{ disabled: !brouillon.trim() || envoi, busy: envoi }}
              style={({ pressed }) => [
                s.envoyer,
                (!brouillon.trim() || envoi) && { opacity: 0.4 },
                pressed && brouillon.trim() && !envoi ? { opacity: 0.8 } : null,
              ]}
            >
              {envoi
                ? <ActivityIndicator color="#fff" size="small" />
                : <Ionicons name="arrow-up" size={20} color="#fff" />}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/** Le clavier est-il ouvert ? Utilisé pour un seul réglage de marge, expliqué à son usage. */
function useClavierOuvert(): boolean {
  const [ouvert, setOuvert] = useState(false);
  useEffect(() => {
    // « will » sur iOS : la marge change en même temps que le clavier monte, sinon on voit le
    // champ sauter une fois le clavier arrivé. Android n'émet que les « did ».
    const montre = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const cache = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const a = Keyboard.addListener(montre, () => setOuvert(true));
    const b = Keyboard.addListener(cache, () => setOuvert(false));
    return () => { a.remove(); b.remove(); };
  }, []);
  return ouvert;
}

function Bulle({ m, jour, equipe }: { m: Message; jour: string | null; equipe: boolean }) {
  return (
    <>
      {jour ? (
        <View style={s.jour}><Text style={s.jourTexte}>{jour}</Text></View>
      ) : null}
      <View style={[s.rangee, m.demoi && { justifyContent: "flex-end" }]}>
        <View style={[s.bulle, m.demoi ? s.bulleMoi : s.bulleAutre]}>
          <Text style={[s.bulleTexte, m.demoi && { color: "#fff" }]} selectable>{m.contenu}</Text>
          <View style={[s.bullePied, m.demoi && { justifyContent: "flex-end" }]}>
            <Text style={[s.heure, m.demoi && { color: "rgba(255,255,255,.72)" }]}>{heureDe(m.quand)}</Text>
            {/* L'accusé de lecture n'a de sens qu'en privé : « lu » par qui, sur un broadcast ? */}
            {m.demoi && !equipe ? (
              <Ionicons
                name={m.lue ? "checkmark-done" : "checkmark"}
                size={13}
                color={m.lue ? "#fff" : "rgba(255,255,255,.6)"}
              />
            ) : null}
          </View>
        </View>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  titre: { color: C.texte, fontFamily: P.titre, fontSize: 27, letterSpacing: -0.6 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: 14.5, lineHeight: 21 },
  attente: { color: C.texteFaible, fontFamily: P.texte, fontSize: 13.5 },
  consigne: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13 },

  lien: { minHeight: 32, justifyContent: "center", paddingHorizontal: E.xs },
  lienTexte: { color: C.accentClair, fontFamily: P.texteFort, fontSize: 13.5 },

  bloc: { borderRadius: R.l, backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure, overflow: "hidden" },
  ligne: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    paddingHorizontal: E.m, paddingVertical: E.s, minHeight: TOUCHE + 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.bordure,
  },
  rondEquipe: {
    width: 40, height: 40, borderRadius: R.m, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,199,255,.12)", borderWidth: 1, borderColor: "rgba(0,199,255,.3)",
  },
  ligneNom: { color: C.texte, fontFamily: P.texteFort, fontSize: 14.5 },
  ligneSous: { color: C.texteDoux, fontFamily: P.texte, fontSize: 12.5 },
  ligneHeure: { color: C.texteFaible, fontFamily: P.texte, fontSize: 11.5 },
  badgeNonLus: {
    minWidth: 22, height: 22, borderRadius: R.pill, paddingHorizontal: 6,
    alignItems: "center", justifyContent: "center", backgroundColor: C.accent,
  },
  badgeNonLusTexte: { color: "#fff", fontFamily: P.texteFort, fontSize: 11.5 },

  entete: {
    flexDirection: "row", alignItems: "center", gap: E.xs,
    paddingHorizontal: E.s, paddingBottom: E.s,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.bordure,
  },
  retour: { width: TOUCHE, height: TOUCHE, alignItems: "center", justifyContent: "center" },
  enteteNom: { color: C.texte, fontFamily: P.titreFort, fontSize: 17, letterSpacing: -0.3 },
  enteteSous: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12 },

  jour: { alignItems: "center", paddingVertical: E.s },
  jourTexte: {
    color: C.texteFaible, fontFamily: P.texteMoyen, fontSize: 11.5,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
    borderRadius: R.pill, paddingHorizontal: E.s, paddingVertical: 4, overflow: "hidden",
  },
  rangee: { flexDirection: "row", paddingVertical: 2 },
  bulle: { maxWidth: "82%", borderRadius: R.l, paddingHorizontal: E.m, paddingVertical: E.s, gap: 3 },
  bulleMoi: { backgroundColor: C.accent, borderTopRightRadius: 4 },
  bulleAutre: {
    backgroundColor: C.surfaceHaute, borderWidth: 1, borderColor: C.bordure, borderTopLeftRadius: 4,
  },
  // 15 points, comme les messages de l'application des familles : on lit une conversation vite, et
  // souvent en marchant.
  bulleTexte: { color: C.texte, fontFamily: P.texte, fontSize: 15, lineHeight: 21 },
  bullePied: { flexDirection: "row", alignItems: "center", gap: 4 },
  heure: { color: C.texteFaible, fontFamily: P.texte, fontSize: 10.5 },

  saisie: {
    paddingHorizontal: E.s, paddingTop: E.s, gap: E.s,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.bordure,
    backgroundColor: "rgba(14,20,38,.92)",
  },
  saisieLigne: { flexDirection: "row", alignItems: "flex-end", gap: E.s },
  champ: {
    flex: 1, minHeight: TOUCHE, maxHeight: 120, borderRadius: R.l,
    paddingHorizontal: E.m, paddingTop: 12, paddingBottom: 12,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
    color: C.texte, fontFamily: P.texte, fontSize: 15.5,
  },
  envoyer: {
    width: TOUCHE, height: TOUCHE, borderRadius: R.pill,
    alignItems: "center", justifyContent: "center", backgroundColor: C.accent,
  },
});
