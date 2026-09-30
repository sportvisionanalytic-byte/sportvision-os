// MON PLANNING (30/09/2026). L'écran `planning` du rôle photo, que l'OS appelle « Mon planning ».
//
// LA MÊME GRAMMAIRE QUE LE CALENDRIER DES FAMILLES, et c'est délibéré : puces de mois horizontales,
// en-têtes de section, cartes. Deux palettes proches mais deux dessins différents, c'est ce qui
// donne l'impression de deux applications recollées — le reproche numéro un de Fouka.
//
// UNE LISTE, PAS UNE GRILLE. L'OS, sur poste fixe, dessine ici un calendrier mensuel à 42 cases.
// Sur un téléphone tenu debout, chaque case fait 45 points de large : le nom du client y est
// tronqué à deux lettres et l'heure de rendez-vous ne tient pas. Or c'est justement l'heure et le
// lieu qu'on vient chercher. La liste dit tout, la grille dit « RC… ».
//
// MESURÉ AVANT D'ÉCRIRE, LE 30/09, avec le jeton de chaque compte :
//
//   · 8 des 10 opérateurs n'ont AUCUNE affectation ; Antoine en a 5, Quentin 1. L'écran vide est
//     donc le cas normal, pas l'exception.
//   · Un `prod` voit les 10 lignes de `prestations_equipe`, pas seulement les siennes : c'est
//     pourquoi `lireMonPlanning` borne explicitement sur `collaborateur_id` (voir os-planning.ts).
//   · Les 10 prestations tiennent sur deux mois, septembre et octobre 2026. Les puces de mois ne
//     listent que les mois qui portent quelque chose : une puce qu'on touche pour rien a déjà été
//     retirée du calendrier des familles.
//   · `est_responsable` faux sur les 10, `fonction` rempli sur 4, `remuneration` sur 9,
//     `heure_rdv` de l'affectation sur 5. Rien n'affiche « non renseigné » : ce qui manque ne
//     prend pas de place.
//
// « TERMINÉES » NE VEUT PAS DIRE « PASSÉES », ET LES DEUX MOTS NE SONT PAS INTERCHANGEABLES ICI.
// Dans le cockpit, « Terminées » désigne un groupe de statuts (clôturée, facturée, payée). Mesuré :
// une mission du 19 septembre est encore en « arrivée_sur_place ». L'appeler « terminée » parce que
// sa date est derrière nous contredirait l'onglet Production sur le même téléphone. Les sections
// s'appellent donc « À venir » et « Passées » — une date, pas un état.
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Ecran, Probleme, Vide } from "../../src/ui/Ecran";
import { Pastille } from "../../src/ui/Base";
import { estProduction, useSession } from "../../src/lib/session";
import type { MaMission } from "../../src/lib/os-missions";
import {
  clePlanning, jours, libelleCouverture, libelleMois, lireMonPlanning, moisDisponibles,
  type JourDePlanning,
} from "../../src/lib/os-planning";
import { useDonnees } from "../../src/lib/cache";
import { dateDuJourParis, heureCourte, quand } from "../../src/lib/dates";
import { C, E, R, TOUCHE } from "../../src/theme/couleurs";
import { P, T } from "../../src/theme/polices";

export default function Planning() {
  const { moi } = useSession();
  const moiId = moi?.id ?? null;
  // LA FLÈCHE DE RETOUR N'APPARAÎT QUE POUR LA PRODUCTION, et c'est la barre du bas qui le décide :
  // cet écran est son troisième onglet pour qui va sur le terrain, et une entrée de « Mon espace »
  // pour qui pilote (voir l'en-tête de `_layout.tsx`). Une flèche de retour sur un onglet ne veut
  // rien dire ; son absence sur un écran où l'on est entré par un appui est un piège.
  const horsBarre = estProduction(moi?.role ?? null);
  const aujourdhui = dateDuJourParis();

  // MÊME CLÉ QUE L'ACCUEIL : c'est la même question. Arriver ici depuis l'accueil ne coûte donc
  // rien, et il n'y a pas deux réponses possibles à la même question dans la même session.
  const { donnees, chargement, rafraichissement, erreur, relire } = useDonnees<MaMission[]>(
    moiId ? clePlanning(moiId) : null,
    () => lireMonPlanning(moiId as string),
    [moiId],
  );
  const missions = donnees ?? [];
  const panne = !!erreur && donnees === undefined;

  const mois = useMemo(() => moisDisponibles(missions), [missions]);
  const [choisi, setChoisi] = useState<string | null>(null);

  // Le mois ouvert par défaut est celui du jour s'il porte quelque chose, sinon le premier mois à
  // venir : personne n'ouvre son planning pour regarder le mois dernier. Même règle que le
  // calendrier des familles. À défaut, le dernier mois connu, pour ne jamais rester sans sélection.
  useEffect(() => {
    if (choisi || !mois.length) return;
    const courant = aujourdhui.slice(0, 7);
    setChoisi(
      mois.includes(courant) ? courant
        : (mois.find((m) => m >= courant) ?? mois[mois.length - 1]),
    );
  }, [mois, choisi, aujourdhui]);

  const duMois = useMemo(
    () => (choisi ? jours(missions, choisi) : []),
    [missions, choisi],
  );
  const aVenir = duMois.filter((j) => j.date >= aujourdhui);
  const passees = duMois.filter((j) => j.date < aujourdhui);
  const nbDuMois = duMois.reduce((n, j) => n + j.missions.length, 0);

  return (
    <Ecran enCours={rafraichissement} teinte="cyan" rafraichir={relire} retour={horsBarre ? "/profil" : undefined}>
      <View style={{ gap: 4 }}>
        <Text style={s.titre}>Mon planning</Text>
        {/* L'OS affiche les deux : « Septembre 2026 » en titre de l'écran et « N missions ce mois »
            en compteur. Ici les deux tiennent sur une ligne, et il le faut : les puces de mois
            disparaissent quand il n'y a qu'un seul mois, et sans elles rien ne dirait lequel.
            Mesuré : les 5 missions d'Antoine tiennent toutes en septembre, il n'aura donc aucune
            puce — « 5 missions ce mois » sans nom de mois l'aurait laissé deviner. */}
        <Text style={s.sous}>
          {choisi
            ? `${libelleMois(choisi)} · ${nbDuMois} mission${nbDuMois > 1 ? "s" : ""}`
            : "Vos missions, mois par mois"}
        </Text>
      </View>

      {mois.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: E.s, paddingRight: E.l }}
        >
          {mois.map((m) => {
            const actif = m === choisi;
            return (
              <Pressable
                key={m}
                onPress={() => setChoisi(m)}
                accessibilityRole="button"
                accessibilityState={{ selected: actif }}
                accessibilityLabel={`Voir ${libelleMois(m)}`}
                style={[s.puce, actif && s.puceActive]}
              >
                <Text style={[s.puceTexte, actif && s.puceTexteActif]}>{libelleMois(m)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {chargement ? (
        <View style={s.attente}><ActivityIndicator color={C.accent} /></View>
      ) : panne ? (
        <Probleme surReessayer={relire} />
      ) : !missions.length ? (
        <Vide
          icone="calendar-outline"
          titre="Aucune mission pour l'instant"
          texte="Vos missions apparaîtront ici dès que la production vous en affecte une. Vous recevrez une invitation à accepter."
        />
      ) : !duMois.length ? (
        <Vide
          icone="calendar-clear-outline"
          titre="Rien ce mois-ci"
          texte="Changez de mois ci-dessus pour retrouver vos autres missions."
        />
      ) : (
        <View style={{ gap: E.l }}>
          {aVenir.length ? <Bloc titre="À venir" jours={aVenir} aujourdhui={aujourdhui} /> : null}
          {passees.length ? (
            // Le plus récent d'abord dans le passé : on remonte le temps depuis hier, comme dans
            // l'onglet « Mes missions ».
            <Bloc titre="Passées" jours={[...passees].reverse()} aujourdhui={aujourdhui} />
          ) : null}
        </View>
      )}
    </Ecran>
  );
}

function Bloc({ titre, jours: liste, aujourdhui }: { titre: string; jours: JourDePlanning[]; aujourdhui: string }) {
  const total = liste.reduce((n, j) => n + j.missions.length, 0);
  return (
    <View style={{ gap: E.s }}>
      <View style={s.enteteSection}>
        <Text style={s.libelleSection}>{titre}</Text>
        <Text style={s.compte}>{total}</Text>
      </View>
      {liste.map((j) => (
        <View key={j.date} style={{ gap: E.xs }}>
          {/* L'en-tête de jour dit « Aujourd'hui » ou « Demain » quand c'est le cas, sinon la date
              longue — et l'année seulement si ce n'est pas celle-ci, parce qu'une saison de
              football court sur deux années civiles. C'est `quand()` qui tient cette règle. */}
          <Text style={[s.jour, j.date === aujourdhui && s.jourAujourdhui]}>{quand(j.date)}</Text>
          {j.missions.map((m) => <CarteJour key={m.affectationId} m={m} />)}
        </View>
      ))}
    </View>
  );
}

function CarteJour({ m }: { m: MaMission }) {
  const router = useRouter();
  const rdv = heureCourte(m.heureRdv);
  const debut = heureCourte(m.heureDebut);
  const couverture = libelleCouverture(m.couverture);
  const enAttente = m.reponse === "invitation_envoyée" || m.reponse === "en_attente";

  const contenu = (
    <>
      <View style={s.ligne}>
        {/* L'heure à gauche, en colonne fixe : on balaie une journée à l'heure, pas au client.
            « Rendez-vous » n'est écrit que si la base en donne un — 5 affectations sur 10 n'en ont
            pas, et annoncer l'heure de début comme une heure de rendez-vous fait arriver en retard. */}
        <View style={s.colonneHeure}>
          {/* « Heure à venir » et pas un tiret : la colonne est étroite, mais un tiret laisse croire
              à une heure illisible plutôt qu'à une heure pas encore posée. */}
          <Text style={s.heure} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {rdv ?? debut ?? "à venir"}
          </Text>
          <Text style={s.heureLibelle}>{rdv ? "rdv" : debut ? "début" : ""}</Text>
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.nom} numberOfLines={2}>{m.client ?? "Mission SportVision"}</Text>
          {m.lieu ? <Text style={s.detail} numberOfLines={2}>{m.lieu}</Text> : null}
          {m.fonction ? <Text style={s.fonction} numberOfLines={1}>{m.fonction}</Text> : null}
        </View>
        {/* Le chevron n'apparaît que si la carte mène quelque part : une flèche qui ne s'ouvre pas
            est la promesse cassée de la règle 5, en plus petit. */}
        {enAttente ? null : <Ionicons name="chevron-forward" size={17} color={C.texteFaible} />}
      </View>

      <View style={s.bas}>
        <View style={s.pastilles}>
          {enAttente ? <Pastille ton="alerte" texte="À répondre" /> : null}
          {m.responsable ? <Pastille ton="info" texte="Responsable" /> : null}
          {couverture ? <Pastille texte={couverture} /> : null}
        </View>
        {m.remuneration !== null ? <Text style={s.remu}>{m.remuneration} €</Text> : null}
      </View>
    </>
  );

  // TOUTE LA CARTE OUVRE LE MODE JOUR J (01/10/2026), et non un bouton posé dessus : c'est la
  // grammaire du calendrier des familles, où la carte d'un événement est elle-même la cible.
  //
  // UNE MISSION ENCORE EN ATTENTE DE MA RÉPONSE RESTE INERTE, et ce n'est pas une barrière de
  // sécurité : `operateur_affecte_prestation` ne regarde que l'existence de l'affectation, pas sa
  // réponse. C'est une règle de pertinence — on répond d'abord, on part ensuite — et elle est dite
  // en clair sur la carte de l'accueil plutôt que laissée à deviner.
  if (enAttente) return <View style={s.carte}>{contenu}</View>;

  return (
    <Pressable
      onPress={() => router.push({ pathname: "/terrain", params: { prestation: m.prestationId } })}
      accessibilityRole="button"
      accessibilityLabel={`Ouvrir le Mode Jour J de la mission ${m.client ?? "SportVision"}`}
      style={({ pressed }) => [s.carte, pressed ? { opacity: 0.85 } : null]}
    >
      {contenu}
    </Pressable>
  );
}

const s = StyleSheet.create({
  titre: { color: C.texte, fontFamily: P.titre, fontSize: T.titreEcran, letterSpacing: -0.6 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: T.sousEcran, lineHeight: T.sousEcranHauteur },
  attente: { paddingVertical: E.xl * 2, alignItems: "center" },

  puce: {
    paddingHorizontal: E.m, height: TOUCHE - 6, borderRadius: R.pill, justifyContent: "center",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  puceActive: { backgroundColor: "rgba(36,84,255,.20)", borderColor: "rgba(36,84,255,.55)" },
  puceTexte: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: 13 },
  puceTexteActif: { color: C.texte, fontFamily: P.texteFort },

  enteteSection: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: E.s },
  libelleSection: { color: C.texte, fontFamily: P.titre, fontSize: 15, textTransform: "uppercase", letterSpacing: 0.9 },
  compte: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5 },
  jour: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 12.5, textTransform: "capitalize" },
  jourAujourdhui: { color: C.cyan },

  carte: {
    gap: E.s, padding: E.m, borderRadius: R.l,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  ligne: { flexDirection: "row", alignItems: "flex-start", gap: E.m },
  colonneHeure: { width: 52, gap: 1 },
  heure: { color: C.texte, fontFamily: P.titreFort, fontSize: 15 },
  heureLibelle: { color: C.texteFaible, fontFamily: P.texte, fontSize: 10.5 },
  nom: { color: C.texte, fontFamily: P.titreFort, fontSize: 16 },
  detail: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
  fonction: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5 },

  bas: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: E.s },
  pastilles: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: E.xs },
  remu: { color: C.texte, fontFamily: P.titreFort, fontSize: 15 },
});
