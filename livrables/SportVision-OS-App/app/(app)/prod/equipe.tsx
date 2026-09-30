// L'EQUIPE TERRAIN (30/09/2026).
//
// « QUI EST DISPONIBLE » NE SE LIT PAS DANS `disponibilites`. Mesure : cette table contient UNE
// ligne, une seule, datee du 28 juillet, au statut « sous_conditions ». Bâtir l'ecran dessus aurait
// affiche « disponibilite non renseignee » douze fois de suite — exactement la faute du 30/09 sur
// `club_teams.members`. On lit donc la disponibilite comme l'OS la lit dans son propre picker
// d'affectation : par la CHARGE, c'est-a-dire le nombre de missions acceptees a venir. Zero se dit
// « Libre », et c'est le mot de l'OS.
//
// CE QUE LES CHIFFRES DISENT AUJOURD'HUI, ET QUE L'ECRAN NE DOIT PAS MAQUILLER :
//
//   · 12 personnes de terrain (10 operateurs, 2 community managers), toutes actives, toutes du pole
//     Football. Les DOUZE sont a zero mission a venir.
//   · Les 10 affectations acceptees portent toutes sur des missions du 12 au 27 septembre, donc
//     passees. Les deux seules missions a venir (3 octobre) n'ont personne. « Sur une mission » est
//     donc vide, et la raison est a dire : ce n'est pas que l'equipe se repose, c'est que les
//     missions de la semaine prochaine ne sont pas pourvues.
//   · `incidents` est VIDE, zero ligne depuis l'origine. On ne presente pas une liste qu'on
//     consulte, on dit qu'aucun incident n'a jamais ete declare.
//   · `mission_suivi_operateur.arrive_at` n'est rempli que 3 fois sur 9 suivis : l'arrivee sur place
//     n'est pas confirmee systematiquement. Une arrivee absente ne veut donc PAS dire en retard,
//     seulement qu'elle n'a pas ete confirmee. La formulation le dit, comme la fonction de rappel de
//     la base le fait deja pour ses notifications.
import React, { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Probleme, Vide } from "../../../src/ui/Ecran";
import { Pastille } from "../../../src/ui/Base";
import { Barre } from "../../../src/ui/Barre";
import { Ecusson } from "../../../src/ui/Ecusson";
import { EcranProd } from "./_layout";
import { useDonnees } from "../../../src/lib/cache";
import { dateDuJourParis, heureCourte, quand } from "../../../src/lib/dates";
import {
  chargeAVenir, lireAffectations, lireCandidats, lireIncidentsOuverts, lireMissions,
  lireSuiviTerrain,
  type Affectation, type Candidat, type Incident, type MissionProd, type SuiviTerrain,
} from "../../../src/lib/os-production";
import { C, E, R } from "../../../src/theme/couleurs";
import { P } from "../../../src/theme/polices";

interface Donnees {
  candidats: Candidat[];
  affectations: Affectation[];
  missions: MissionProd[];
  incidents: Incident[];
  suivis: SuiviTerrain[];
}

export default function EcranEquipe() {
  const [liste, setListe] = useState("sur_mission");

  const { donnees, chargement, rafraichissement, erreur, relire } = useDonnees<Donnees>(
    "prod:equipe",
    async () => {
      const [candidats, affectations, missions, incidents, suivis] = await Promise.all([
        lireCandidats(), lireAffectations(), lireMissions(), lireIncidentsOuverts(),
        lireSuiviTerrain(),
      ]);
      return { candidats, affectations, missions, incidents, suivis };
    },
  );

  const candidats = donnees?.candidats ?? [];
  const affectations = donnees?.affectations ?? [];
  const missions = donnees?.missions ?? [];
  const incidents = donnees?.incidents ?? [];
  const suivis = donnees?.suivis ?? [];

  const charge = useMemo(() => chargeAVenir(affectations), [affectations]);
  const aujourdhui = dateDuJourParis();

  const surMission = useMemo(
    () => candidats.filter((c) => (charge.get(c.id) ?? 0) > 0),
    [candidats, charge],
  );
  const libres = useMemo(
    () => candidats.filter((c) => (charge.get(c.id) ?? 0) === 0),
    [candidats, charge],
  );
  const missionsDuJour = useMemo(
    () => missions.filter((m) => m.date === aujourdhui),
    [missions, aujourdhui],
  );

  const sous = chargement
    ? "Chargement"
    : `${candidats.length} personne${candidats.length > 1 ? "s" : ""} de terrain · ` +
      `${libres.length} libre${libres.length > 1 ? "s" : ""}`;

  return (
    <EcranProd titre="Équipe terrain" sous={sous} rafraichir={relire} enCours={rafraichissement}>
      <Barre
        choix={[
          { cle: "sur_mission", libelle: "Sur une mission", n: surMission.length },
          { cle: "libres", libelle: "Libres", n: libres.length },
          { cle: "incidents", libelle: "Incidents", n: incidents.length },
        ]}
        actif={liste}
        surChoix={setListe}
      />

      {/* CE QUI SE PASSE AUJOURD'HUI PASSE DEVANT LES LISTES : c'est la question du matin. */}
      {!chargement && !erreur ? (
        <View style={s.jour}>
          <Text style={s.jourTitre}>Aujourd'hui</Text>
          {missionsDuJour.length ? (
            <View style={{ gap: E.xs }}>
              {missionsDuJour.map((m) => {
                const arrivee = suivis.find((v) => v.prestationId === m.id && v.arriveA);
                return (
                  <Text key={m.id} style={s.jourTexte}>
                    {[m.client ?? "Sans client", heureCourte(m.heureRdv ?? m.heureDebut), m.lieu]
                      .filter(Boolean).join(" · ")}
                    {"\n"}
                    {m.operateurs
                      ? arrivee
                        ? `${m.operateurs} · arrivée confirmée`
                        : `${m.operateurs} · arrivée non confirmée`
                      : "Personne sur cette mission"}
                  </Text>
                );
              })}
            </View>
          ) : (
            <Text style={s.jourTexte}>Aucune mission aujourd'hui.</Text>
          )}
        </View>
      ) : null}

      {chargement ? (
        <View style={s.attente}><ActivityIndicator color={C.accent} /></View>
      ) : erreur ? (
        <Probleme surReessayer={relire} />
      ) : liste === "incidents" ? (
        incidents.length ? (
          <View style={{ gap: E.s }}>
            {incidents.map((i) => (
              <View key={i.id} style={s.carte}>
                <View style={s.ligne}>
                  <Text style={s.nom} numberOfLines={2}>{i.type ?? "Incident"}</Text>
                  <Pastille
                    ton={i.niveau === "critique" ? "danger" : i.niveau === "important" ? "alerte" : "neutre"}
                    texte={i.niveau}
                  />
                </View>
                {i.description ? <Text style={s.detail}>{i.description}</Text> : null}
                <Text style={s.reference}>
                  {[i.declarePar ? `déclaré par ${i.declarePar}` : null,
                    i.quand ? quand(i.quand.slice(0, 10)) : null].filter(Boolean).join(" · ")}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Vide
            titre="Aucun incident ouvert"
            texte={
              "Aucun incident n'a jamais été déclaré sur une mission. Un incident se déclare depuis " +
              "la fiche de la mission, par l'opérateur sur place ou par la production, et il bloque " +
              "la mention « mission prête » jusqu'à sa clôture."
            }
          />
        )
      ) : liste === "libres" ? (
        libres.length ? (
          <View style={{ gap: E.s }}>
            {libres.map((c) => (
              <CartePersonne key={c.id} c={c} missionsDeLaPersonne={[]} />
            ))}
          </View>
        ) : (
          <Vide titre="Personne n'est libre" texte="Toute l'équipe a au moins une mission à venir." />
        )
      ) : surMission.length ? (
        <View style={{ gap: E.s }}>
          {surMission.map((c) => (
            <CartePersonne
              key={c.id}
              c={c}
              missionsDeLaPersonne={affectations.filter(
                (a) => a.collaborateurId === c.id && a.statut === "acceptée"
                  && a.missionDate && a.missionDate >= aujourdhui,
              )}
            />
          ))}
        </View>
      ) : (
        <Vide
          titre="Personne n'est engagé sur une mission à venir"
          texte={
            "Les affectations acceptées portent toutes sur des missions passées. Ce n'est pas que " +
            "l'équipe est au repos : ce sont les missions à venir qui n'ont pas encore d'opérateur. " +
            "L'écran Affectation les liste."
          }
        />
      )}
    </EcranProd>
  );
}

function CartePersonne({
  c, missionsDeLaPersonne,
}: { c: Candidat; missionsDeLaPersonne: Affectation[] }) {
  return (
    <View style={s.carte}>
      <View style={s.ligne}>
        <Ecusson nom={c.nom} taille={42} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.nom} numberOfLines={1}>{c.nom || "Sans nom"}</Text>
          <Text style={s.detail} numberOfLines={2}>
            {[
              c.role === "photo" ? "Opérateur terrain" : c.role === "cm" ? "Community manager" : c.role,
              c.niveau ? `niveau ${c.niveau}` : null,
              // Le telephone est ce qu'on cherche quand une mission commence dans vingt minutes.
              c.telephone,
            ].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <Pastille
            ton={missionsDeLaPersonne.length === 0 ? "succes" : "info"}
            texte={
              missionsDeLaPersonne.length === 0
                ? "Libre"
                : `${missionsDeLaPersonne.length} mission${missionsDeLaPersonne.length > 1 ? "s" : ""}`
            }
          />
          {!c.actif ? <Pastille ton="danger" texte="Compte inactif" /> : null}
        </View>
      </View>

      {c.materielPersonnel ? (
        <Text style={s.materiel} numberOfLines={3}>Matériel personnel : {c.materielPersonnel}</Text>
      ) : null}

      {missionsDeLaPersonne.length ? (
        <View style={{ gap: 2 }}>
          {missionsDeLaPersonne.map((a) => (
            <Text key={a.id} style={s.detail} numberOfLines={1}>
              {[a.missionDate ? quand(a.missionDate) : null, a.missionClient, a.fonction]
                .filter(Boolean).join(" · ")}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  attente: { paddingVertical: E.xl * 2, alignItems: "center" },
  carte: {
    gap: E.s, padding: E.m, borderRadius: R.l,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  ligne: { flexDirection: "row", alignItems: "flex-start", gap: E.s },
  nom: { flex: 1, color: C.texte, fontFamily: P.titreFort, fontSize: 16 },
  detail: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
  reference: { color: C.texteFaible, fontFamily: P.texte, fontSize: 11.5 },
  materiel: { color: C.cyanTexte, fontFamily: P.texte, fontSize: 12.5, lineHeight: 17 },

  jour: {
    gap: E.xs, padding: E.m, borderRadius: R.l,
    backgroundColor: "rgba(36,84,255,.10)", borderWidth: 1, borderColor: "rgba(36,84,255,.30)",
  },
  jourTitre: { color: C.texte, fontFamily: P.titreFort, fontSize: 14 },
  jourTexte: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13, lineHeight: 18 },
});
