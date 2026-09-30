// LE CALENDRIER DU CLUB, EN NATIF (30/09/2026).
//
// CE QU'IL CHANGE PAR RAPPORT À CELUI D'UN JOUEUR. Un joueur regarde une équipe ; un club en a
// vingt-six. D'où le filtre par équipe, qui n'existe pas dans l'espace personnel : sans lui, un
// coach de U11 B fait défiler les matchs des vingt-cinq autres équipes pour trouver le sien.
//
// DOMICILE ET EXTÉRIEUR SÉPARÉS, et c'est une demande explicite de Fouka : « il faut que j'aie
// automatiquement tout de suite tous les matchs à domicile, tous les matchs à l'extérieur bien
// séparés ». On le fait par SÉPARATION et pas par filtre : un filtre cache la moitié de l'information
// et demande deux gestes pour voir l'ensemble, là où deux sections la montrent d'un coup.
//
// ON LIT ICI, ON MODIFIE DANS CLUB+. Les cartes ne sont pas cliquables : cet écran répond à « quand
// et où », et rien de plus. Créer, déplacer, annuler un match reste dans Club+, qui porte les
// règles. Un lien y mène, écrit en clair, plutôt qu'une carte qui aurait l'air modifiable.
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Ecran, Probleme, Vide } from "../Ecran";
import { CarteEvenement } from "../Cartes";
import { MoisGrille } from "../MoisGrille";
import { separer, type Evenement } from "../../lib/donnees";
import { dateDuJourParis } from "../../lib/dates";
import { type MonClub } from "../../lib/club";
import { C, E, R, TOUCHE } from "../../theme/couleurs";
import { P } from "../../theme/polices";

const MOIS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

const FILTRES = [
  { cle: "tout", libelle: "Tout" },
  { cle: "match", libelle: "Matchs" },
  { cle: "entrainement", libelle: "Entraînements" },
  { cle: "evenement", libelle: "Événements" },
] as const;
type Filtre = (typeof FILTRES)[number]["cle"];

export function CalendrierClub({
  club, evenements, chargement, panne, surRecharger, surWeb,
}: {
  club: MonClub;
  evenements: Evenement[];
  chargement: boolean;
  panne: boolean;
  surRecharger: () => void;
  surWeb: (chemin: string) => void;
}) {
  const [vue, setVue] = useState<"planning" | "mois">("planning");
  const [filtre, setFiltre] = useState<Filtre>("tout");
  const [mois, setMois] = useState<string | null>(null);
  const [equipe, setEquipe] = useState<string | null>(null);
  const [jourChoisi, setJourChoisi] = useState<string | null>(null);

  const aujourdhui = dateDuJourParis();

  /** Les mois qui contiennent vraiment quelque chose : un mois vide n'a pas à être proposé. */
  const moisDisponibles = useMemo(() => {
    const vus = new Set<string>();
    for (const e of evenements) vus.add(e.date.slice(0, 7));
    return [...vus].sort();
  }, [evenements]);

  /**
   * Les équipes qui apparaissent dans le calendrier, dans l'ordre d'un club : U6, U7… puis les
   * séniors. Un tri alphabétique donnerait U10, U11, U12, U6, U7 — ce qui a l'air d'un bug alors
   * que c'est l'ordre des lettres. Même règle que `lireEquipes`.
   */
  const equipesPresentes = useMemo(() => {
    const vues = new Set<string>();
    for (const e of evenements) if (e.equipe) vues.add(e.equipe);
    return [...vues].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b, "fr"));
  }, [evenements]);

  /**
   * LE MOIS OUVERT PAR DÉFAUT : CELUI QUI A ENCORE QUELQUE CHOSE À VENIR.
   *
   * La règle évidente — « le mois du jour s'il porte quelque chose » — se trompe un 30 du mois.
   * Constaté sur le simulateur le 30/09 : septembre portait bien des matchs, tous joués, et le
   * calendrier s'ouvrait sur une page « TERMINÉS » alors que le week-end suivant était à deux
   * jours. Un calendrier sert à préparer, pas à constater.
   *
   * On ouvre donc sur le premier mois qui contient une date à venir, et on retombe sur le dernier
   * mois connu quand la saison est finie — il vaut mieux montrer le dernier que rien.
   */
  useEffect(() => {
    if (mois || !evenements.length) return;
    const aVenirDansLeMois = new Set(
      evenements.filter((e) => e.date >= aujourdhui).map((e) => e.date.slice(0, 7)),
    );
    const premierUtile = moisDisponibles.find((m) => aVenirDansLeMois.has(m));
    setMois(premierUtile ?? moisDisponibles[moisDisponibles.length - 1] ?? null);
  }, [evenements, moisDisponibles, mois, aujourdhui]);

  // UNE ÉQUIPE FILTRÉE QUI DISPARAÎT NE DOIT PAS VIDER L'ÉCRAN. Si le club renomme une équipe ou
  // qu'on change de mois, le nom retenu peut ne plus exister : sans cette remise à zéro, le
  // calendrier afficherait « rien ce mois-ci » sans que rien à l'écran explique pourquoi.
  useEffect(() => {
    if (equipe && !equipesPresentes.includes(equipe)) setEquipe(null);
  }, [equipe, equipesPresentes]);

  const duMois = useMemo(
    () => evenements
      .filter((e) => (mois ? e.date.startsWith(mois) : true))
      .filter((e) => (filtre === "tout" ? true : e.genre === filtre))
      .filter((e) => (equipe ? e.equipe === equipe : true)),
    [evenements, mois, filtre, equipe],
  );

  const { aVenir, termines } = useMemo(() => separer(duMois), [duMois]);

  // Sur les matchs seulement : `domicile` ne veut rien dire pour un entraînement.
  const separerLieu = filtre === "match";
  const domicile = aVenir.filter((e) => e.domicile !== false);
  const exterieur = aVenir.filter((e) => e.domicile === false);

  return (
    <Ecran enCours={chargement} teinte="cyan" rafraichir={surRecharger}>
      <View style={s.entete}>
        <Text style={s.titre}>Calendrier</Text>
        <View style={s.bascule}>
          {(["planning", "mois"] as const).map((v) => (
            <Pressable
              key={v}
              onPress={() => setVue(v)}
              accessibilityRole="button"
              accessibilityState={{ selected: vue === v }}
              accessibilityLabel={v === "planning" ? "Afficher le planning" : "Afficher le calendrier du mois"}
              style={[s.basculeItem, vue === v && s.basculeActive]}
            >
              <Text style={[s.basculeTexte, vue === v && s.basculeTexteActif]}>
                {v === "planning" ? "Planning" : "Mois"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: E.s, paddingRight: E.l }}>
        {moisDisponibles.map((m) => {
          const actif = m === mois;
          return (
            <Pressable
              key={m}
              onPress={() => { setMois(m); setJourChoisi(null); }}
              accessibilityRole="button"
              accessibilityState={{ selected: actif }}
              accessibilityLabel={`Voir ${MOIS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`}
              style={[s.puce, actif && s.puceActive]}
            >
              <Text style={[s.puceTexte, actif && s.puceTexteActif]}>
                {MOIS[Number(m.slice(5, 7)) - 1]} {m.slice(0, 4)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={s.filtres}>
        {FILTRES.map((f) => {
          const actif = f.cle === filtre;
          return (
            <Pressable
              key={f.cle}
              onPress={() => setFiltre(f.cle)}
              accessibilityRole="button"
              accessibilityState={{ selected: actif }}
              accessibilityLabel={`Filtrer : ${f.libelle}`}
              style={[s.filtre, actif && s.filtreActif]}
            >
              <Text style={[s.filtreTexte, actif && s.filtreTexteActif]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                {f.libelle}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* LE FILTRE PAR ÉQUIPE, qui n'existe pas dans l'espace personnel. Il ne s'affiche qu'à partir
          de deux équipes : à une seule, il n'apprend rien et mange une ligne. */}
      {equipesPresentes.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: E.s, paddingRight: E.l }}>
          <Pressable
            onPress={() => setEquipe(null)}
            accessibilityRole="button"
            accessibilityState={{ selected: !equipe }}
            accessibilityLabel="Toutes les équipes"
            style={[s.puce, !equipe && s.puceActive]}
          >
            <Text style={[s.puceTexte, !equipe && s.puceTexteActif]}>Toutes les équipes</Text>
          </Pressable>
          {equipesPresentes.map((nom) => {
            const actif = nom === equipe;
            return (
              <Pressable
                key={nom}
                onPress={() => setEquipe(actif ? null : nom)}
                accessibilityRole="button"
                accessibilityState={{ selected: actif }}
                accessibilityLabel={`Voir le calendrier de ${nom}`}
                style={[s.puce, actif && s.puceActive]}
              >
                <Text style={[s.puceTexte, actif && s.puceTexteActif]}>{nom}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {chargement && !evenements.length ? (
        <View style={{ paddingVertical: E.xl * 2, alignItems: "center" }}>
          <ActivityIndicator color={C.accent} />
        </View>
      ) : panne ? (
        <Probleme surReessayer={surRecharger} />
      ) : vue === "mois" && mois ? (
        <MoisGrille
          mois={mois}
          evenements={duMois}
          aujourdhui={aujourdhui}
          jourChoisi={jourChoisi}
          surJour={setJourChoisi}
          ecussonClub={club.logoUrl}
        />
      ) : duMois.length ? (
        <View style={{ gap: E.l }}>
          {/* Le chiffre à droite du titre est le NOMBRE, pas le mois : le mois est déjà écrit dans
              les puces juste au-dessus, et l'y répéter deux fois de suite n'apprenait rien. */}
          {separerLieu ? (
            <>
              <Groupe titre="À domicile" liste={domicile} ecusson={club.logoUrl} aujourdhui={aujourdhui} />
              <Groupe titre="À l'extérieur" liste={exterieur} ecusson={club.logoUrl} aujourdhui={aujourdhui} />
            </>
          ) : (
            <Groupe titre="À venir" liste={aVenir} ecusson={club.logoUrl} aujourdhui={aujourdhui} />
          )}
          <Groupe titre="Terminés" liste={termines} ecusson={club.logoUrl} aujourdhui={aujourdhui} />
        </View>
      ) : (
        <Vide
          titre={evenements.length ? "Rien ici" : "Calendrier vide"}
          texte={
            evenements.length
              ? "Changez de mois, d'équipe, ou retirez le filtre pour voir tout ce que le club a publié."
              : "Aucun match ni entraînement n'a encore été publié pour ce club. Ajoutez-les dans Club+."
          }
        />
      )}

      <Pressable
        onPress={() => surWeb("/calendar")}
        accessibilityRole="button"
        accessibilityLabel="Modifier le calendrier dans Club plus"
        style={({ pressed }) => [s.lienWeb, pressed ? { opacity: 0.85 } : null]}
      >
        <Ionicons name="create-outline" size={16} color={C.texteDoux} />
        <Text style={s.lienWebTexte}>Ajouter ou modifier un match</Text>
        <Ionicons name="chevron-forward" size={15} color={C.texteFaible} />
      </Pressable>
    </Ecran>
  );
}

/** Une section de la liste. Une section vide ne s'affiche pas : un titre suivi de rien inquiète. */
function Groupe({
  titre, liste, ecusson, aujourdhui,
}: {
  titre: string; liste: Evenement[]; ecusson?: string | null; aujourdhui: string;
}) {
  if (!liste.length) return null;
  return (
    <View style={{ gap: E.s }}>
      <View style={s.enteteSection}>
        <Text style={s.libelleSection}>{titre}</Text>
        <Text style={s.compte}>{liste.length}</Text>
      </View>
      {liste.map((e) => (
        <View key={e.id} style={{ gap: 4 }}>
          {e.date === aujourdhui ? <Text style={s.marqueur}>Aujourd'hui</Text> : null}
          <CarteEvenement e={e} ecussonClub={ecusson} />
        </View>
      ))}
    </View>
  );
}

/** Le rang d'une équipe dans l'ordre d'un club : les jeunes par âge croissant, les séniors après. */
function rang(nom: string): number {
  const age = nom.match(/\bU\s?(\d{1,2})\b/i);
  return age ? Number(age[1]) : 100;
}

const s = StyleSheet.create({
  entete: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: E.s },
  titre: { color: C.texte, fontFamily: P.titre, fontSize: 26, letterSpacing: -0.6 },
  bascule: { flexDirection: "row", backgroundColor: C.surface, borderRadius: R.pill, padding: 3, borderWidth: 1, borderColor: C.bordure },
  basculeItem: { paddingHorizontal: E.m, height: 34, justifyContent: "center", borderRadius: R.pill },
  basculeActive: { backgroundColor: "rgba(36,84,255,.22)" },
  basculeTexte: { color: C.texteFaible, fontFamily: P.texteMoyen, fontSize: 13 },
  basculeTexteActif: { color: C.texte, fontFamily: P.texteFort },

  puce: {
    paddingHorizontal: E.m, height: TOUCHE - 6, borderRadius: R.pill, justifyContent: "center",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  puceActive: { backgroundColor: "rgba(36,84,255,.20)", borderColor: "rgba(36,84,255,.55)" },
  puceTexte: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: 13 },
  puceTexteActif: { color: C.texte, fontFamily: P.texteFort },

  filtres: { flexDirection: "row", gap: 4, backgroundColor: C.surface, padding: 4, borderRadius: R.pill, borderWidth: 1, borderColor: C.bordure },
  filtre: { flex: 1, height: 36, borderRadius: R.pill, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  filtreActif: { backgroundColor: "rgba(255,255,255,.10)" },
  filtreTexte: { color: C.texteFaible, fontFamily: P.texteMoyen, fontSize: 12 },
  filtreTexteActif: { color: C.texte, fontFamily: P.texteFort },

  enteteSection: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: E.s },
  libelleSection: { color: C.texte, fontFamily: P.titre, fontSize: 15, textTransform: "uppercase", letterSpacing: 0.9 },
  compte: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5 },
  marqueur: { color: C.cyan, fontFamily: P.texteFort, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.9 },

  lienWeb: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    minHeight: TOUCHE, paddingHorizontal: E.m, borderRadius: R.l,
    backgroundColor: "rgba(255,255,255,.04)", borderWidth: 1, borderColor: C.bordure,
  },
  lienWebTexte: { flex: 1, color: C.texteDoux, fontFamily: P.texteFort, fontSize: 14 },
});
