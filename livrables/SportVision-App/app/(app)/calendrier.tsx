// Le calendrier (22/09/2026, refonte).
//
// Deux façons de regarder, parce que les deux questions existent : « qu'est-ce qui arrive » et
// « qu'est-ce qu'il y a le week-end du 26 ». La liste répond à la première, la grille du mois à la
// seconde. Sur un téléphone, la grille seule affiche des pastilles illisibles : elle ne remplace
// pas la liste, elle la complète.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSession } from "../../src/lib/session";
import { lireCalendrierFamille, useFamille } from "../../src/lib/famille";
import { lireEvenements, separer, type Evenement } from "../../src/lib/donnees";
import { dateDuJourParis } from "../../src/lib/dates";
import { useDonnees, cleEvenements } from "../../src/lib/cache";
import { Ecran, Probleme, Vide } from "../../src/ui/Ecran";
import { CarteEvenement } from "../../src/ui/Cartes";
import { MoisGrille } from "../../src/ui/MoisGrille";
import { BandeauEnfant, SelecteurEnfant } from "../../src/ui/Enfants";
import { C, E, R, TOUCHE } from "../../src/theme/couleurs";
import { P } from "../../src/theme/polices";

const MOIS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

const FILTRES = [
  { cle: "tout", libelle: "Tout" },
  { cle: "match", libelle: "Matchs" },
  { cle: "entrainement", libelle: "Entraînements" },
  { cle: "evenement", libelle: "Événements" },
] as const;
type Filtre = (typeof FILTRES)[number]["cle"];

export default function Calendrier() {
  const { profil } = useSession();
  const famille = useFamille();
  const router = useRouter();
  const { filtre: filtreDemande } = useLocalSearchParams<{ filtre?: string }>();
  const parent = profil?.espace === "parent";
  // L'ecusson du club, pour les cartes de match. Cote parent il vient du club de l'enfant
  // regarde, comme partout ailleurs dans l'application.
  const ecussonClub = parent ? famille.detail?.clubLogoUrl : profil?.clubLogoUrl;
  // Affilie ou non : la phrase a dire n'est pas la meme, et se tromper envoie la personne
  // appeler son club pour un probleme qui n'existe pas.
  const affilie = parent ? famille.choisi?.enAttente === false : !!profil?.affilie;

  // 29/09/2026 — MEME CLE QUE L'ACCUEIL, donc le calendrier s'ouvre deja rempli quand on y arrive
  // depuis l'accueil : c'est la meme question, elle n'est posee qu'une fois.
  const { donnees, chargement, erreur: souci, relire: charger } = useDonnees<Evenement[]>(
    profil ? cleEvenements(parent, profil.clubId, famille.choisi?.refId) : null,
    async () => {
      if (parent) {
        const tout = await lireCalendrierFamille();
        const ref = famille.choisi?.refId;
        return ref ? tout.filter((e) => e.sportifRef === ref) : tout;
      }
      if (profil?.clubId) return lireEvenements(profil.clubId);
      return [];
    },
    [parent, profil?.clubId, famille.choisi?.refId],
  );
  const evenements = donnees ?? [];
  const panne = !!souci && donnees === undefined;
  const [vue, setVue] = useState<"planning" | "mois">("planning");
  // La lecture au montage reste : elle evite que la liste s'affiche une image sans filtre avant de
  // se filtrer, quand l'ecran est monte pour la premiere fois par le raccourci de l'accueil.
  const [filtre, setFiltre] = useState<Filtre>(
    FILTRES.some((f) => f.cle === filtreDemande) ? (filtreDemande as Filtre) : "tout",
  );
  const [mois, setMois] = useState<string | null>(null);
  const [jourChoisi, setJourChoisi] = useState<string | null>(null);

  // == LE RACCOURCI « RESULTATS » DE L'ACCUEIL, A LA DEUXIEME VISITE (30/09/2026) ==============
  //
  // CE QUI NE MARCHAIT PAS. `useState` ne lit son argument qu'au montage, et les onglets restent
  // montes : le premier passage par « Resultats » filtrait bien sur les matchs, le deuxieme
  // n'appliquait plus rien. L'ecran etait deja la, son etat initial etait deja calcule.
  //
  // POURQUOI LES DEUX CORRECTIONS EVIDENTES ECHOUENT, et c'est la raison de la troisieme :
  //
  //   `useEffect(..., [filtreDemande])` : un effet ne se redeclenche que si la valeur CHANGE. On
  //     appuie sur « Resultats » (filtre = match), on remet « Tout » a la main dans l'ecran, on
  //     rappuie sur « Resultats » : le parametre de route vaut toujours « match », il n'a pas
  //     bouge, l'effet ne rejoue pas, et rien ne se filtre. Le defaut revient a l'identique au
  //     deuxieme appui apres un reglage manuel.
  //
  //   `useFocusEffect` qui relit le parametre a chaque prise de focus : cette fois ca s'applique,
  //     mais le parametre RESTE dans la route. Une semaine plus tard, ouvrir l'onglet Calendrier
  //     rebascule sur « Matchs » et cache ses entrainements, sans que rien a l'ecran explique
  //     pourquoi. C'est le filtre collant que Fouka a refuse : il doit etre ponctuel.
  //
  // CE QU'ON FAIT. On applique a la prise de focus, PUIS ON CONSOMME L'INTENTION : le parametre est
  // vide juste apres. Un appui sur « Resultats » le repose, donc le geste marche autant de fois
  // qu'on le refait ; revenir sur l'onglet par la barre du bas ne trouve plus rien a appliquer,
  // donc le reglage manuel tient. C'est plus simple qu'un compteur passe par l'accueil : il n'y a
  // pas de valeur a comparer, l'intention existe ou elle n'existe plus.
  useFocusEffect(
    useCallback(() => {
      if (!FILTRES.some((f) => f.cle === filtreDemande)) return;
      setFiltre(filtreDemande as Filtre);
      // Chaine vide plutot que `undefined` : on veut un parametre qui ne corresponde a aucun
      // filtre, de facon sure. Selon les versions, `undefined` peut etre ignore a la fusion des
      // parametres et laisser l'ancienne valeur en place, ce qui rendrait le filtre collant.
      router.setParams({ filtre: "" });
    }, [filtreDemande, router]),
  );


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
        <MoisGrille
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
              : !affilie
                ? (parent
                    ? "Le calendrier apparaîtra dès que le club aura validé le rattachement de votre enfant."
                    : "Votre calendrier apparaîtra dès que votre club aura validé votre affiliation.")
                : (parent
                    ? "Le club n'a encore publié aucun match ni entraînement pour son équipe."
                    : "Votre club n'a encore publié aucun match ni entraînement.")
          }
        />
      )}
    </Ecran>
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

});
