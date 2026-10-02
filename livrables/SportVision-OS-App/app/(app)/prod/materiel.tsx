// LE MATERIEL (30/09/2026).
//
// LA QUESTION EST « QUEL KIT EST DEHORS, CHEZ QUI, ET QUAND RENTRE-T-IL ». L'ecran repond aux deux
// premieres, et explique pourquoi il ne peut pas repondre a la troisieme.
//
// MESURE AVANT D'ECRIRE (jeton de Mikael) :
//
//   · 2 kits, 2 reservations actives, toutes deux au statut `réservé`, sur des missions du
//     12 septembre deja cloturees. Elles sont donc dehors depuis dix-huit jours.
//   · `date_retour_prevue` EST NULLE SUR LES DEUX. Aucun retour ne peut etre declare echu : ce n'est
//     pas une liste vide, c'est une echeance que personne ne saisit. Et
//     `mission_suivi_operateur.kit_restitue_at` est nul sur les 9 suivis : la seconde source est
//     muette aussi. On dit les deux.
//   · `kits.statut` vaut `disponible` sur les deux, alors qu'une reservation active les tient. Les
//     deux verites ne s'accordent pas. On affiche la RESERVATION, qui nomme la personne et la
//     mission, et on signale le desaccord — on ne corrige pas une donnee depuis un ecran (lecon du
//     27/09 : une correction de donnees ne se defend pas, celle-la etait redegradee le lendemain
//     matin).
//   · 6 materiels, 5 ranges dans un kit, 1 hors kit. `kits.contenu` (jsonb) vaut `[]` sur les deux :
//     la composition se lit dans `materiels.kit_id`, pas dans ce champ.
//   · 0 controle de kit, 0 incident materiel, 0 maintenance : ces trois modules de l'OS n'ont jamais
//     servi, l'application ne les dessine pas.
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Probleme, Vide } from "../../../src/ui/Ecran";
import { Bouton, Erreur, Pastille } from "../../../src/ui/Base";
import { enregistrerRetourKit } from "../../../src/lib/os-pilotage";
import { Barre } from "../../../src/ui/Barre";
import { EcranProd } from "./_layout";
import { useDonnees } from "../../../src/lib/cache";
import { quand } from "../../../src/lib/dates";
import {
  kitSeDitLibreMaisEstPris, LIBELLE_CATEGORIE, LIBELLE_STATUT_KIT, lireMateriel, retourEchu,
  sansEcheanceDeRetour,
  type EtatMateriel, type Kit, type Reservation,
} from "../../../src/lib/os-materiel";
import { C, E, R } from "../../../src/theme/couleurs";
import { P } from "../../../src/theme/polices";
import { KITS_ACTIFS } from "../../../src/lib/modules";

// LE MODULE EST ETEINT (02/10/2026, decision de Fouka : « pour le moment on retire les trucs de
// kit »). La puce « Materiel » a disparu de la rangee du haut ; cet ecran reste joignable par une
// URL ou un lien deja envoye, et il doit alors DIRE qu'il est retire. Afficher les deux kits comme
// si on les tenait serait pire que de ne rien afficher : quelqu'un enregistrerait un retour dans un
// module que personne ne suit. Le code d'origine est intact en dessous, derriere `KITS_ACTIFS`.
function MaterielRetire() {
  return (
    <EcranProd titre="Matériel">
      <Vide
        titre="Le suivi du matériel est mis de côté"
        texte={
          "Les kits et leurs sorties ne sont pas suivis pour l'instant : le module sera repris plus " +
          "tard. Rien n'est perdu, les kits et le matériel sont toujours en base. En attendant, une " +
          "sortie de kit se convient directement avec l'opérateur, et aucune mission n'en dépend."
        }
      />
    </EcranProd>
  );
}

export default function EcranMateriel() {
  if (!KITS_ACTIFS) return <MaterielRetire />;
  return <EcranMaterielKits />;
}

function EcranMaterielKits() {
  const [liste, setListe] = useState("dehors");

  const { donnees, chargement, rafraichissement, erreur, relire } = useDonnees<EtatMateriel>(
    "prod:materiel",
    lireMateriel,
  );

  const kits = donnees?.kits ?? [];
  const reservations = donnees?.reservations ?? [];
  const materiels = donnees?.materiels ?? [];

  // « Dehors » = une reservation active sans retour enregistre. C'est la definition de la vue du
  // cockpit, qui ecarte `retourné` et `en_contrôle` pour nommer le kit d'une mission.
  const dehors = useMemo(() => reservations.filter((r) => !r.retourEffectifLe), [reservations]);
  const echus = useMemo(() => dehors.filter((r) => retourEchu(r)), [dehors]);
  const sansEcheance = useMemo(() => sansEcheanceDeRetour(reservations), [reservations]);
  const kitsPrisSansLeDire = useMemo(
    () => kits.filter((k) => kitSeDitLibreMaisEstPris(k, reservations)),
    [kits, reservations],
  );

  const sous = chargement
    ? "Chargement"
    : `${kits.length} kit${kits.length > 1 ? "s" : ""} · ` +
      `${dehors.length} sorti${dehors.length > 1 ? "s" : ""}`;

  return (
    <EcranProd titre="Matériel" sous={sous} rafraichir={relire} enCours={rafraichissement}>
      <Barre
        choix={[
          { cle: "dehors", libelle: "Sortis", n: dehors.length },
          { cle: "echus", libelle: "Retour échu", n: echus.length },
          { cle: "kits", libelle: "Tous les kits", n: kits.length },
        ]}
        actif={liste}
        surChoix={setListe}
      />

      {/* LE DESACCORD SE DIT EN HAUT, PAS EN PETIT. Un kit qui se declare disponible alors qu'il est
          chez quelqu'un, c'est le kit qu'on promet a un deuxieme operateur le meme samedi. */}
      {!chargement && !erreur && kitsPrisSansLeDire.length ? (
        <View style={s.desaccord}>
          <Text style={s.desaccordTitre}>
            {kitsPrisSansLeDire.length > 1
              ? `${kitsPrisSansLeDire.length} kits se disent disponibles alors qu'ils sont sortis`
              : "Un kit se dit disponible alors qu'il est sorti"}
          </Text>
          <Text style={s.desaccordTexte}>
            {kitsPrisSansLeDire.map((k) => k.nom).join(", ")}
            {" : la fiche du kit annonce « Disponible », mais une réservation en cours le tient. " +
              "L'état à corriger est celui du kit, sur sa fiche dans l'OS."}
          </Text>
        </View>
      ) : null}

      {chargement ? (
        <View style={s.attente}><ActivityIndicator color={C.accent} /></View>
      ) : erreur ? (
        <Probleme surReessayer={relire} />
      ) : liste === "dehors" ? (
        dehors.length ? (
          <View style={{ gap: E.s }}>
            {dehors.map((r) => <CarteReservation key={r.id} r={r} surChangement={relire} />)}
          </View>
        ) : (
          <Vide
            titre="Aucun kit sorti"
            texte="Tous les kits sont rentrés. Un kit apparaît ici dès qu'il est réservé pour une mission."
          />
        )
      ) : liste === "echus" ? (
        echus.length ? (
          <View style={{ gap: E.s }}>
            {echus.map((r) => <CarteReservation key={r.id} r={r} echu surChangement={relire} />)}
          </View>
        ) : (
          <Vide
            titre="Le retour échu ne peut pas être calculé"
            texte={
              `Un retour n'est en retard que par rapport à une date de retour prévue, et ` +
              `${sansEcheance} réservation${sansEcheance > 1 ? "s" : ""} sur ${reservations.length} ` +
              `n'en ${sansEcheance > 1 ? "ont" : "a"} aucune. Cette liste est donc vide parce que la ` +
              "donnée manque, pas parce que tout est rentré. La date de retour se saisit sur la " +
              "réservation, dans l'OS ; et l'opérateur n'a jamais coché « kit restitué » sur aucune " +
              "mission."
            }
          />
        )
      ) : kits.length ? (
        <View style={{ gap: E.s }}>
          {kits.map((k) => (
            <CarteKit
              key={k.id}
              k={k}
              reservation={dehors.find((r) => r.kitId === k.id) ?? null}
              contenu={materiels.filter((m) => m.kitId === k.id)}
            />
          ))}
        </View>
      ) : (
        <Vide
          titre="Aucun kit"
          texte={
            "Les kits se créent dans l'OS, module Matériel. Un kit commun sert les deux pôles ; un " +
            "kit dédié n'est visible que par son pôle."
          }
        />
      )}

      {!chargement && !erreur && materiels.some((m) => !m.kitId) ? (
        <Text style={s.note}>
          {/* « materiel(s) » : la parenthese est une facon d'eviter de compter. Tout le reste de
              l'application accorde (« 2 kits · 2 sorties »), et une seule ligne qui ne le fait pas
              se voit. */}
          {`${materiels.filter((m) => !m.kitId).length} matériel${materiels.filter((m) => !m.kitId).length > 1 ? "s" : ""} hors kit : ` +
            materiels.filter((m) => !m.kitId).map((m) => m.nom).join(", ") + "."}
        </Text>
      ) : null}
    </EcranProd>
  );
}

/**
 * UNE SORTIE DE KIT, ET LE GESTE QUI LA FERME (01/10/2026).
 *
 * ENREGISTRER LE RETOUR DEBLOQUE LES RESERVATIONS, et c'est nouveau depuis la v369 : une
 * reservation dont le retour n'est ni prevu ni enregistre occupe le kit SANS FIN. Les deux kits de
 * SportVision sont sortis depuis le 12 septembre ; tant que personne n'enregistre leur retour,
 * plus aucune reservation n'est possible, et le refus de la base nomme cette carte.
 *
 * Cet ecran etait une liste a regarder — zero element appuyable, mesure a l'audit. Il annoncait le
 * blocage sans donner la sortie.
 */
function CarteReservation({
  r, echu, surChangement,
}: { r: Reservation; echu?: boolean; surChangement: () => void }) {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const rendre = async () => {
    setErreur(null);
    setEnCours(true);
    try {
      await enregistrerRetourKit(r.id, r.kitId);
      surChangement();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <View style={s.carte}>
      <View style={s.ligne}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.nom} numberOfLines={2}>{r.kitNom ?? "Kit"}</Text>
          {/* CHEZ QUI : c'est la premiere chose qu'on cherche. Un kit sans titulaire est le vrai
              probleme, pas une case vide : la base le laisse a null quand celui qui l'avait quitte
              la mission. */}
          <Text style={s.detail} numberOfLines={2}>
            {r.collaborateurNom ? `Chez ${r.collaborateurNom}` : "Sans titulaire"}
          </Text>
          <Text style={s.reference} numberOfLines={2}>
            {[r.missionReference, r.missionDate ? quand(r.missionDate) : null]
              .filter(Boolean).join(" · ")}
          </Text>
        </View>
        <Pastille
          ton={echu ? "danger" : "alerte"}
          texte={LIBELLE_STATUT_KIT[r.statut] ?? r.statut}
        />
      </View>

      <Text style={s.detail}>
        {r.sortieLe ? `Sorti le ${quand(r.sortieLe.slice(0, 10))}` : "Date de sortie non renseignée"}
        {" · "}
        {r.retourPrevuLe
          ? `retour prévu le ${quand(r.retourPrevuLe.slice(0, 10))}`
          : "aucune date de retour prévue"}
      </Text>

      {r.lieuRecuperation || r.lieuRetour ? (
        <Text style={s.detail} numberOfLines={2}>
          {[r.lieuRecuperation ? `Récupération : ${r.lieuRecuperation}` : null,
            r.lieuRetour ? `Retour : ${r.lieuRetour}` : null].filter(Boolean).join(" · ")}
        </Text>
      ) : null}

      {r.consignes ? <Text style={s.consignes}>{r.consignes}</Text> : null}

      <Erreur message={erreur} />
      <Bouton titre="Enregistrer le retour" onPress={rendre} enCours={enCours} />
      <Text style={s.note}>
        Tant que le retour n'est pas enregistré, ce kit ne peut être réservé pour personne d'autre.
      </Text>
    </View>
  );
}

function CarteKit({
  k, reservation, contenu,
}: {
  k: Kit;
  reservation: Reservation | null;
  contenu: { id: string; nom: string; categorie: string | null }[];
}) {
  return (
    <View style={s.carte}>
      <View style={s.ligne}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.nom} numberOfLines={2}>{k.nom}</Text>
          <Text style={s.detail} numberOfLines={2}>
            {[
              k.typeKit,
              k.numInterne,
              // Ou il se trouve quand il ne sort pas. Mesure : les deux kits le renseignent.
              k.localisation ? `rangé : ${k.localisation}` : null,
              // Pole nul = commun aux deux poles. C'est la lecture de `kit_pole_scope_ok`.
              k.poleId ? (k.poleExclusif ? "kit dédié à un pôle" : "kit prioritaire d'un pôle") : "kit commun",
            ].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <Pastille
          ton={k.statut === "disponible" ? "succes" : "alerte"}
          texte={LIBELLE_STATUT_KIT[k.statut] ?? k.statut}
        />
      </View>

      {reservation ? (
        <Text style={s.detail} numberOfLines={2}>
          {`Sorti · ${reservation.collaborateurNom ?? "sans titulaire"}`}
          {reservation.missionReference ? ` · ${reservation.missionReference}` : ""}
        </Text>
      ) : null}

      {contenu.length ? (
        <View style={{ gap: 2 }}>
          {contenu.map((m) => (
            <Text key={m.id} style={s.contenu} numberOfLines={1}>
              {[LIBELLE_CATEGORIE[m.categorie ?? ""] ?? m.categorie, m.nom]
                .filter(Boolean).join(" · ")}
            </Text>
          ))}
        </View>
      ) : (
        <Text style={s.contenuVide}>
          Composition non renseignée : aucun matériel n'est rattaché à ce kit.
        </Text>
      )}
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
  nom: { color: C.texte, fontFamily: P.titreFort, fontSize: 16 },
  detail: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
  reference: { color: C.texteFaible, fontFamily: P.texte, fontSize: 11.5 },
  consignes: { color: C.cyanTexte, fontFamily: P.texte, fontSize: 12.5, lineHeight: 17 },
  contenu: { color: C.texteDoux, fontFamily: P.texte, fontSize: 12.5 },
  contenuVide: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5, lineHeight: 17 },
  note: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12, lineHeight: 17 },

  desaccord: {
    gap: E.xs, padding: E.m, borderRadius: R.l,
    backgroundColor: "rgba(232,163,61,.10)", borderWidth: 1, borderColor: "rgba(232,163,61,.34)",
  },
  desaccordTitre: { color: C.alerteTexte, fontFamily: P.titreFort, fontSize: 14.5 },
  desaccordTexte: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13, lineHeight: 18 },
});
