// Le calendrier (22/09/2026).
//
// Sur un telephone, une grille mensuelle affiche des pastilles illisibles. On garde donc la liste,
// mais on rend le mois choisissable : c'est le meme service que les vues du site, dans la forme
// que le pouce sait manipuler.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSession } from "../../src/lib/session";
import { lireCalendrierFamille, useFamille } from "../../src/lib/famille";
import { lireEvenements, type Evenement } from "../../src/lib/donnees";
import { dateDuJourParis } from "../../src/lib/dates";
import { Ecran, Vide } from "../../src/ui/Ecran";
import { CarteEvenement } from "../../src/ui/Cartes";
import { BandeauEnfant, SelecteurEnfant } from "../../src/ui/Enfants";
import { C, E, R } from "../../src/theme/couleurs";

const MOIS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const FILTRES = [
  { cle: "tout", libelle: "Tout" },
  { cle: "match", libelle: "Matchs" },
  { cle: "entrainement", libelle: "Entraînements" },
] as const;
type Filtre = (typeof FILTRES)[number]["cle"];

export default function Calendrier() {
  const { profil } = useSession();
  const famille = useFamille();
  const parent = profil?.espace === "parent";
  const [evenements, setEvenements] = useState<Evenement[]>([]);
  const [chargement, setChargement] = useState(true);
  const [filtre, setFiltre] = useState<Filtre>("tout");
  const [mois, setMois] = useState<string | null>(null);
  const barre = useRef<ScrollView>(null);

  const charger = useCallback(async () => {
    setChargement(true);
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
    } finally { setChargement(false); }
  }, [parent, profil?.clubId, famille.choisi?.refId]);

  useEffect(() => { charger(); }, [charger]);

  /** Les mois qui contiennent vraiment quelque chose : un mois vide n'a pas a etre propose. */
  const moisDisponibles = useMemo(() => {
    const vus = new Set<string>();
    for (const e of evenements) vus.add(e.date.slice(0, 7));
    return [...vus].sort();
  }, [evenements]);

  // Le mois ouvert par defaut est celui du jour s'il porte quelque chose, sinon le premier mois a
  // venir : personne n'ouvre son calendrier pour regarder le mois dernier.
  useEffect(() => {
    if (mois || !moisDisponibles.length) return;
    const jour = dateDuJourParis().slice(0, 7);
    setMois(moisDisponibles.includes(jour) ? jour : (moisDisponibles.find((m) => m >= jour) ?? moisDisponibles[moisDisponibles.length - 1]));
  }, [moisDisponibles, mois]);

  const liste = useMemo(() => {
    return evenements
      .filter((e) => (mois ? e.date.startsWith(mois) : true))
      .filter((e) => (filtre === "tout" ? true : e.genre === filtre));
  }, [evenements, mois, filtre]);

  const aujourdhui = dateDuJourParis();
  const titreMois = mois ? `${MOIS[Number(mois.slice(5, 7)) - 1]} ${mois.slice(0, 4)}` : "";

  return (
    <Ecran enCours={chargement} rafraichir={charger} teinte="cyan">
      <Text style={s.titre}>Calendrier</Text>

      {parent ? (
        <View style={{ gap: E.s }}>
          <SelecteurEnfant />
          <BandeauEnfant />
        </View>
      ) : null}

      <ScrollView
        ref={barre}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: E.s, paddingRight: E.l }}
      >
        {moisDisponibles.map((m) => {
          const actif = m === mois;
          return (
            <Pressable key={m} onPress={() => setMois(m)} style={[s.puce, actif && s.puceActive]}>
              <Text style={[s.puceTexte, actif && s.puceTexteActif]}>
                {MOIS[Number(m.slice(5, 7)) - 1].slice(0, 4)}. {m.slice(2, 4)}
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
              <Text style={[s.filtreTexte, actif && s.filtreTexteActif]}>{f.libelle}</Text>
            </Pressable>
          );
        })}
      </View>

      {chargement && !evenements.length ? (
        <View style={{ paddingVertical: E.xl * 2, alignItems: "center" }}>
          <ActivityIndicator color={C.accent} />
        </View>
      ) : liste.length ? (
        <View style={{ gap: E.s }}>
          <View style={s.enteteMois}>
            <Text style={s.moisCourant}>{titreMois}</Text>
            <Text style={s.compte}>
              {liste.length} {liste.length > 1 ? "rendez-vous" : "rendez-vous"}
            </Text>
          </View>
          {liste.map((e) => (
            <View key={e.id} style={{ gap: 4 }}>
              {e.date === aujourdhui ? <Text style={s.marqueur}>Aujourd'hui</Text> : null}
              <CarteEvenement e={e} />
            </View>
          ))}
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

const s = StyleSheet.create({
  titre: { color: C.texte, fontSize: 25, fontWeight: "800", letterSpacing: -0.5 },
  puce: {
    paddingHorizontal: E.m, height: 36, borderRadius: R.pill, justifyContent: "center",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  puceActive: { backgroundColor: "rgba(79,125,255,.18)", borderColor: "rgba(79,125,255,.5)" },
  puceTexte: { color: C.texteDoux, fontSize: 13, fontWeight: "600" },
  puceTexteActif: { color: C.texte },
  filtres: { flexDirection: "row", gap: E.xs, backgroundColor: C.surface, padding: 4, borderRadius: R.pill, borderWidth: 1, borderColor: C.bordure },
  filtre: { flex: 1, height: 34, borderRadius: R.pill, alignItems: "center", justifyContent: "center" },
  filtreActif: { backgroundColor: "rgba(255,255,255,.09)" },
  filtreTexte: { color: C.texteFaible, fontSize: 12.5, fontWeight: "600" },
  filtreTexteActif: { color: C.texte },
  enteteMois: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: E.s },
  moisCourant: { color: C.texteFaible, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  compte: { color: C.texteFaible, fontSize: 12 },
  marqueur: { color: C.cyan, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.9 },
});
