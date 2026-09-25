// Le calendrier (22/09/2026, refonte).
//
// Deux façons de regarder, parce que les deux questions existent : « qu'est-ce qui arrive » et
// « qu'est-ce qu'il y a le week-end du 26 ». La liste répond à la première, la grille du mois à la
// seconde. Sur un téléphone, la grille seule affiche des pastilles illisibles : elle ne remplace
// pas la liste, elle la complète.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSession } from "../../src/lib/session";
import { lireCalendrierFamille, useFamille } from "../../src/lib/famille";
import { lireEvenements, separer, type Evenement } from "../../src/lib/donnees";
import { dateDuJourParis, versDate } from "../../src/lib/dates";
import { Ecran, Probleme, Vide } from "../../src/ui/Ecran";
import { CarteEvenement } from "../../src/ui/Cartes";
import { BandeauEnfant, SelecteurEnfant } from "../../src/ui/Enfants";
import { C, E, R, TOUCHE } from "../../src/theme/couleurs";
import { P } from "../../src/theme/polices";

const MOIS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const JOURS_COURTS = ["L", "M", "M", "J", "V", "S", "D"];

const FILTRES = [
  { cle: "tout", libelle: "Tout" },
  { cle: "match", libelle: "Matchs" },
  { cle: "entrainement", libelle: "Entraînements" },
  { cle: "evenement", libelle: "Événements" },
] as const;
type Filtre = (typeof FILTRES)[number]["cle"];

const COULEUR_GENRE: Record<string, string> = {
  match: C.accentClair, entrainement: C.cyan, evenement: C.violet, rendez_vous: C.alerte,
};

export default function Calendrier() {
  const { profil } = useSession();
  const famille = useFamille();
  const router = useRouter();
  const { filtre: filtreDemande } = useLocalSearchParams<{ filtre?: string }>();
  const parent = profil?.espace === "parent";
  // L'ecusson du club, pour les cartes de match. Cote parent il vient du club de l'enfant
  // regarde, comme partout ailleurs dans l'application.
  const ecussonClub = parent ? famille.detail?.clubLogoUrl : profil?.clubLogoUrl;

  const [evenements, setEvenements] = useState<Evenement[]>([]);
  const [chargement, setChargement] = useState(true);
  const [panne, setPanne] = useState(false);
  const [vue, setVue] = useState<"planning" | "mois">("planning");
  const [filtre, setFiltre] = useState<Filtre>(
    FILTRES.some((f) => f.cle === filtreDemande) ? (filtreDemande as Filtre) : "tout",
  );
  const [mois, setMois] = useState<string | null>(null);
  const [jourChoisi, setJourChoisi] = useState<string | null>(null);

  const charger = useCallback(async () => {
    setChargement(true);
    setPanne(false);
    try {
      if (parent) {
        const tout = await lireCalendrierFamille();
        const ref = famille.choisi?.refId;
        setEvenements(ref ? tout.filter((e) => e.sportifRef === ref) : tout);
      } else if (profil?.clubId) {
        setEvenements(await lireEvenements(profil.clubId));
      } else {
        setEvenements([]);
      }
    } catch {
      setPanne(true);
      setEvenements([]);
    } finally { setChargement(false); }
  }, [parent, profil?.clubId, famille.choisi?.refId]);

  useEffect(() => { charger(); }, [charger]);

  /** Les mois qui contiennent vraiment quelque chose : un mois vide n'a pas à être proposé. */
  const moisDisponibles = useMemo(() => {
    const vus = new Set<string>();
    for (const e of evenements) vus.add(e.date.slice(0, 7));
    return [...vus].sort();
  }, [evenements]);

  const aujourdhui = dateDuJourParis();

  // Le mois ouvert par défaut est celui du jour s'il porte quelque chose, sinon le premier mois à
  // venir : personne n'ouvre son calendrier pour regarder le mois dernier.
  useEffect(() => {
    if (mois || !moisDisponibles.length) return;
    const courant = aujourdhui.slice(0, 7);
    setMois(moisDisponibles.includes(courant)
      ? courant
      : (moisDisponibles.find((m) => m >= courant) ?? moisDisponibles[moisDisponibles.length - 1]));
  }, [moisDisponibles, mois, aujourdhui]);

  const duMois = useMemo(
    () => evenements
      .filter((e) => (mois ? e.date.startsWith(mois) : true))
      .filter((e) => (filtre === "tout" ? true : e.genre === filtre)),
    [evenements, mois, filtre],
  );

  const { aVenir, termines } = useMemo(() => separer(duMois), [duMois]);
  const titreMois = mois ? `${MOIS[Number(mois.slice(5, 7)) - 1]} ${mois.slice(0, 4)}` : "";

  function ouvrir(e: Evenement) {
    if (e.genre === "match") router.push({ pathname: "/match/[id]", params: { id: e.id } });
  }

  return (
    <Ecran enCours={chargement} rafraichir={charger} teinte="cyan">
      <View style={s.entete}>
        <Text style={s.titre}>Calendrier</Text>
        <View style={s.bascule}>
          {(["planning", "mois"] as const).map((v) => (
            <Pressable key={v} onPress={() => setVue(v)} style={[s.basculeItem, vue === v && s.basculeActive]}>
              <Text style={[s.basculeTexte, vue === v && s.basculeTexteActif]}>
                {v === "planning" ? "Planning" : "Mois"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {parent ? (
        <View style={{ gap: E.s }}>
          <SelecteurEnfant />
          <BandeauEnfant />
        </View>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: E.s, paddingRight: E.l }}>
        {moisDisponibles.map((m) => {
          const actif = m === mois;
          return (
            <Pressable key={m} onPress={() => { setMois(m); setJourChoisi(null); }} style={[s.puce, actif && s.puceActive]}>
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
            <Pressable key={f.cle} onPress={() => setFiltre(f.cle)} style={[s.filtre, actif && s.filtreActif]}>
              <Text
                style={[s.filtreTexte, actif && s.filtreTexteActif]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {f.libelle}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {chargement && !evenements.length ? (
        <View style={{ paddingVertical: E.xl * 2, alignItems: "center" }}>
          <ActivityIndicator color={C.accent} />
        </View>
      ) : panne ? (
        <Probleme surReessayer={charger} />
      ) : vue === "mois" && mois ? (
        <VueMois
          mois={mois}
          evenements={duMois}
          aujourdhui={aujourdhui}
          jourChoisi={jourChoisi}
          surJour={setJourChoisi}
          surEvenement={ouvrir}
          ecussonClub={ecussonClub}
        />
      ) : duMois.length ? (
        <View style={{ gap: E.l }}>
          {aVenir.length ? (
            <View style={{ gap: E.s }}>
              <View style={s.enteteSection}>
                <Text style={s.libelleSection}>À venir</Text>
                <Text style={s.compte}>{titreMois}</Text>
              </View>
              {aVenir.map((e) => (
                <View key={e.id} style={{ gap: 4 }}>
                  {e.date === aujourdhui ? <Text style={s.marqueur}>Aujourd'hui</Text> : null}
                  <CarteEvenement e={e} ecussonClub={ecussonClub} onPress={() => ouvrir(e)} />
                </View>
              ))}
            </View>
          ) : null}

          {termines.length ? (
            <View style={{ gap: E.s }}>
              <View style={s.enteteSection}>
                <Text style={s.libelleSection}>Terminés</Text>
                <Text style={s.compte}>{termines.length}</Text>
              </View>
              {termines.map((e) => <CarteEvenement key={e.id} e={e} ecussonClub={ecussonClub} onPress={() => ouvrir(e)} />)}
            </View>
          ) : null}
        </View>
      ) : (
        <Vide
          titre={evenements.length ? "Rien ce mois-ci" : "Calendrier vide"}
          texte={
            evenements.length
              ? "Changez de mois ci-dessus, ou retirez le filtre pour voir tout ce que le club a publié."
              : parent
                ? "Le calendrier se remplira dès que le club aura publié les matchs et les entraînements de son équipe."
                : "Votre calendrier se remplira dès que votre club aura validé votre affiliation."
          }
        />
      )}
    </Ecran>
  );
}

/** La grille du mois : une pastille par genre d'événement, et le détail du jour touché en dessous. */
function VueMois({
  mois, evenements, aujourdhui, jourChoisi, surJour, surEvenement, ecussonClub,
}: {
  mois: string;
  evenements: Evenement[];
  aujourdhui: string;
  jourChoisi: string | null;
  surJour: (jour: string | null) => void;
  surEvenement: (e: Evenement) => void;
  /** L'ecusson du club, pour les cartes de match de la journee ouverte. */
  ecussonClub?: string | null;
}) {
  const annee = Number(mois.slice(0, 4));
  const numeroMois = Number(mois.slice(5, 7));
  const premier = new Date(annee, numeroMois - 1, 1);
  const nbJours = new Date(annee, numeroMois, 0).getDate();
  // getDay() rend 0 pour dimanche : la semaine française commence le lundi.
  const decalage = (premier.getDay() + 6) % 7;

  const parJour = useMemo(() => {
    const carte = new Map<string, Evenement[]>();
    for (const e of evenements) {
      const liste = carte.get(e.date) ?? [];
      liste.push(e);
      carte.set(e.date, liste);
    }
    return carte;
  }, [evenements]);

  const cases: (string | null)[] = [
    ...Array.from({ length: decalage }, () => null),
    ...Array.from({ length: nbJours }, (_, i) =>
      `${annee}-${String(numeroMois).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`),
  ];

  const jour = jourChoisi && parJour.has(jourChoisi) ? jourChoisi : null;
  const duJour = jour ? parJour.get(jour) ?? [] : [];

  return (
    <View style={{ gap: E.m }}>
      <View style={s.grille}>
        {JOURS_COURTS.map((j, i) => (
          <Text key={`${j}-${i}`} style={s.enteteJour}>{j}</Text>
        ))}
        {cases.map((date, i) => {
          if (!date) return <View key={`vide-${i}`} style={s.caseJour} />;
          const dedans = parJour.get(date) ?? [];
          const actif = date === jour;
          return (
            <Pressable
              key={date}
              onPress={() => surJour(dedans.length ? (actif ? null : date) : null)}
              style={[s.caseJour, actif && s.caseActive, date === aujourdhui && !actif && s.caseAujourdhui]}
            >
              <Text style={[s.numeroJour, actif && { color: C.texte }, !dedans.length && { color: C.texteFaible }]}>
                {Number(date.slice(8, 10))}
              </Text>
              <View style={s.points}>
                {dedans.slice(0, 3).map((e, k) => (
                  <View key={k} style={[s.point, { backgroundColor: COULEUR_GENRE[e.genre] ?? C.texteFaible }]} />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>

      {jour ? (
        <View style={{ gap: E.s }}>
          <Text style={s.libelleSection}>
            {versDate(jour).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
          </Text>
          {duJour.map((e) => <CarteEvenement key={e.id} e={e} ecussonClub={ecussonClub} onPress={() => surEvenement(e)} />)}
        </View>
      ) : (
        <Text style={s.aide}>Touchez un jour marqué pour voir ce qu'il contient.</Text>
      )}
    </View>
  );
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

  grille: { flexDirection: "row", flexWrap: "wrap", backgroundColor: C.surface, borderRadius: R.xl, borderWidth: 1, borderColor: C.bordure, padding: E.s },
  enteteJour: { width: `${100 / 7}%`, textAlign: "center", color: C.texteFaible, fontFamily: P.texteFort, fontSize: 11, paddingBottom: E.xs },
  caseJour: { width: `${100 / 7}%`, height: 48, alignItems: "center", justifyContent: "center", gap: 3, borderRadius: R.m },
  caseActive: { backgroundColor: "rgba(36,84,255,.22)" },
  caseAujourdhui: { borderWidth: 1, borderColor: "rgba(0,199,255,.45)" },
  numeroJour: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: 14 },
  points: { flexDirection: "row", gap: 3, height: 5 },
  point: { width: 5, height: 5, borderRadius: 3 },
  aide: { color: C.texteFaible, fontFamily: P.texte, fontSize: 13, textAlign: "center" },
});
