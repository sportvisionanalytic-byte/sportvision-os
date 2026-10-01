// GALERIES PHOTO (30/09/2026). L'écran `media` de l'OS, celui que l'opérateur y trouve rangé avec
// ses missions : « verser les photos d'un match en fait partie », dit le commentaire de son menu.
//
// == DEUX ÉCRANS DANS UN ONGLET, ET LA BASE CHOISIT LEQUEL ======================================
//
// La liste, puis la galerie. Pas deux routes : la galerie est l'ouverture d'une ligne, et sur un
// téléphone on y entre et on en sort par le même geste. Aucun `estOperateur` ni `estProduction`
// nulle part dans ce fichier — la même requête sert tout le monde, et c'est la RLS qui décide de
// ce qu'elle rend. Mesuré : 57 galeries pour un responsable de production, 0 pour un opérateur.
//
// == LE VIDE DIT POURQUOI, ET CE N'EST PAS UNE FORMULE DE POLITESSE =============================
//
// Un opérateur voit zéro galerie aujourd'hui, et « Aucune galerie » tout court le ferait
// téléphoner. La raison est précise et vérifiée : une galerie ne lui appartient que s'il l'a
// créée ou si elle est rattachée à une de ses missions, et `media_albums.mission_id` est NULL sur
// 57 galeries sur 57. C'est ce que l'écran écrit, et il dit à qui s'adresser.
//
// == PAS DE VERSEMENT DEPUIS LE TÉLÉPHONE, ET C'EST MESURÉ ======================================
//
// LES DROITS NE SONT PAS LE PROBLÈME, ET IL FAUT LE DIRE PRÉCISÉMENT. Vérifié par le chemin réel,
// en transaction annulée : un opérateur affecté à une mission dont les galeries existent PEUT
// insérer une ligne dans `media_assets`, et les policies de stockage l'autorisent à écrire dans
// `galerie-previews/<galerie>/`, dans `media/<galerie>/` et dans `apercus-clairs/`. Si on ne
// construit pas, ce n'est pas parce que la base refuse.
//
// C'EST LA CHAÎNE DES DÉRIVÉS QUI L'INTERDIT. L'OS fabrique TROIS fichiers par photo avant d'écrire
// quoi que ce soit : vignette 480 px filigranée, aperçu 1600 px filigrané, aperçu 1600 px CLAIR.
// Les trois sortent d'un canvas de navigateur, le filigrane est dessiné par `_galFiligrane` avec la
// police `system-ui`. React Native n'a ni `createImageBitmap`, ni canvas, ni `toBlob`. Et le script
// qui a dû régénérer ces dérivés a déjà payé la leçon : « le réécrire côté serveur produirait un
// marquage DIFFÉRENT de tous les autres, et deux filigranes dans la même galerie se verraient ».
//
// SANS L'APERÇU CLAIR, PERSONNE NE RETROUVE L'ENFANT. Le moteur de reconnaissance lit
// `preview_clair_path`, et rien d'autre. Le chiffre qui tranche, croisé sur les 7 784 photos : les
// 4 921 qui ont un aperçu clair portent 2 247 lectures de dossard par Vision de macOS, soit 45,7 % ;
// les 2 863 qui n'en ont pas en portent ZÉRO. Pas « peu » : zéro.
//
// LE POIDS ACHÈVE LE DOSSIER : 12,94 Mo de moyenne par original, 36 Mo au maximum, 98,39 Go pour
// 7 784 photos. Un match, c'est 100 à 431 photos, soit 1,3 à 5,6 Go à pousser en 4G au bord d'un
// terrain. Et les photos sont sur la carte du reflex, pas dans le téléphone.
//
// LE TÉLÉPHONE S'ARRÊTE DONC À LA GALERIE — il la crée, la nomme, la rattache — et l'écran le DIT,
// à l'endroit où l'on chercherait le bouton. Ce n'est pas un écran qui manque, c'est un outil de
// bureau.
//
// == CE QUE LE TÉLÉPHONE FAIT MAINTENANT (01/10/2026) ===========================================
//
// La production crée les galeries d'une mission depuis l'onglet « Missions » de cet écran, par la
// RPC de l'OS. C'est le geste qui ferme le trou des 57 galeries : mesuré deux fois en transaction
// annulée, Antoine passe de 0 galerie visible à 6 dès que les galeries de sa mission existent, et un
// opérateur non affecté reste à 0.
// == CE QUE LE 01/10/2026 (APRÈS-MIDI) A AJOUTÉ, ET CE QUE FOUKA A DIT EXACTEMENT ==============
//
// « Dans galerie photo, c'est encore trop brouillon. C'est pas trié par équipe, par club. Je peux
// pas voir les statistiques, les galeries vendues sur l'app. Je peux même pas télécharger les
// photos. »
//
// TROIS MANQUES, TROIS RÉPONSES, ET AUCUNE N'INVENTE DE RÈGLE.
//
// 1. LE TRI. Une recherche, un filtre par CLUB, et des sections par ÉQUIPE qui se replient. C'est
//    le rangement de l'OS, repris avec ses mots : son écran « Médias & Ventes » porte déjà un
//    sélecteur « Tous les clubs / … / Sans club » et un champ « Rechercher un titre, un club, une
//    équipe… », posés le 29/09 pour la même raison (« beaucoup de galeries »). On ne réinvente
//    donc pas un rangement : on porte celui-là sur un téléphone, où un menu déroulant devient une
//    rangée de puces et où le classement par équipe devient une liste qu'on ouvre.
//
//    LE TAUX DE REMPLISSAGE A DÉCIDÉ DU DESSIN (règle 6). Mesuré sur les 57 galeries : 21 ont un
//    club (15 RCP Fontainebleau, 6 SF Villemomble), 36 n'en ont pas ; 16 ont une équipe, 27 une
//    structure externe, 24 n'ont NI l'une NI l'autre. « Sans club » est donc le plus gros groupe,
//    pas un cas limite : le masquer aurait caché les deux tiers de la liste.
//
// 2. LES VENTES. Un onglet, et il N'EXISTE QUE SI LA BASE DIT OUI. On ne recopie aucune liste de
//    rôles : `media_revenus_visibles()` porte la décision de Fouka du 29/09, on la lui demande.
//    Mesuré : false pour Antoine (photo), true pour Mikael (prod) et Fouka (admin). Et ce que la
//    base rend vraiment : `media_orders` = 15 lignes pour la production, 17 pour l'administration,
//    ZÉRO pour un opérateur. Un opérateur ne voit donc pas un cadre à 0 €, il ne voit pas l'onglet.
//
// 3. LE TÉLÉCHARGEMENT DES ORIGINAUX. Décision de Fouka ce matin : un opérateur récupère les
//    originaux des galeries de SES missions. Et le droit ne se reteste pas ici, parce qu'il est
//    DÉJÀ répondu par le fait de voir la galerie :
//
//      · `malbums_staff_select` = `media_upload_staff()` → seuls admin, sec, prod et photo voient
//        une galerie ; la policy RESTRICTIVE `malbums_photographe_perimetre` réduit le photo à ses
//        propres missions ;
//      · la policy de stockage `sv_media_prive_media_select` demande `can_access_media(galerie)`,
//        qui commence par `if is_staff() then return not est_operateur_terrain()
//        or photographe_voit_album(...)`.
//
//    Les deux ensembles coïncident exactement : SI UNE GALERIE EST DANS CETTE LISTE, SES ORIGINAUX
//    SONT ACCESSIBLES. Le bouton ne peut donc pas mener à un refus (règle 5), et il n'y a aucun
//    second filtre à écrire (règle 3). Vérifié par le chemin réel, en transaction annulée :
//    Antoine affecté à la mission → 431 + 314 photos et 314 originaux lisibles dans le seau privé ;
//    Erwan non affecté → zéro partout.
//
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { Ecran, Probleme, Section, Vide } from "../../src/ui/Ecran";
import { Bouton, Champ, Erreur, Pastille } from "../../src/ui/Base";
import { Barre } from "../../src/ui/Barre";
import { Jauge } from "../../src/ui/Jauge";
import {
  creerGaleriesMission, definirTypeEvenement, libelleTypeEvenement, lireEquipesDeMission,
  lireEquipesDuClub, lireGaleriesDeMission,
  lireGaleriesParMission, lireOriginauxGalerie,
  lireMesGaleries, lirePhotosGalerie, numeroUtileDeLaGalerie, rattacherEquipe, renommerGalerie,
  TYPES_EVENEMENT,
  type EquipeDeMission, type EquipeDuClub, type Galerie, type PhotoGalerie,
} from "../../src/lib/os-galeries";
import {
  bornes, euros, lireVentes, lireVentesDeLaGalerie, PERIODES, pourcent, puisVoirLesVentes,
  quandVente, type LienVendeur, type Periode, type Ventes,
} from "../../src/lib/os-ventes";
import {
  autoriserPhototheque, enregistrerLot, enregistrerOriginal, placeLibre, poids, poidsDuLot,
  type AvancementLot,
} from "../../src/lib/os-telechargement";
import { lireMissions, type MissionProd } from "../../src/lib/os-production";
import { oublier, useDonnees } from "../../src/lib/cache";
import { dateLongue, quand } from "../../src/lib/dates";
import { estProduction, useSession } from "../../src/lib/session";
import { C, E, R, TOUCHE } from "../../src/theme/couleurs";
import { P, T } from "../../src/theme/polices";

/**
 * LES MOTS DE L'OS, MOT POUR MOT (`GM_STATUT` de la fiche mission).
 *
 * Une personne qui passe de l'ordinateur au téléphone doit retrouver « Brouillon », pas
 * « Non publiée » : deux vocabulaires pour le même état, c'est deux applications (règle 9).
 */
const LIBELLE_STATUT: Record<string, string> = {
  draft: "Brouillon",
  published: "Publiée",
  archived: "Archivée",
};

/** Le ton de chaque état. Toujours accompagné du mot : jamais une couleur seule. */
const TON_STATUT: Record<string, "neutre" | "succes" | "alerte"> = {
  draft: "alerte",
  published: "succes",
  archived: "neutre",
};

export default function Galeries() {
  const [ouverte, setOuverte] = useState<Galerie | null>(null);
  return ouverte
    ? <UneGalerie galerie={ouverte} surRetour={() => setOuverte(null)} />
    : <ListeGaleries surOuvrir={setOuverte} />;
}

// ── La liste, et l'onglet des missions ──────────────────────────────────────────────────────

interface DonneesMissions {
  missions: MissionProd[];
  /** Combien de galeries chaque mission porte déjà. Une seule requête pour toute la liste. */
  parMission: Map<string, number>;
}

/** Les trois onglets possibles. Celui des ventes et celui des missions n'existent pas pour tous. */
type Onglet = "galeries" | "ventes" | "missions";

/** Le mot de l'OS pour les galeries qui ne sont rattachées à aucun club : 36 sur 57. */
const SANS_CLUB = "sans-club";
/** Idem pour les galeries sans équipe ni structure : 24 sur 57. */
const SANS_EQUIPE = "sans-equipe";

interface GroupeEquipe {
  cle: string;
  libelle: string;
  galeries: Galerie[];
}

/**
 * LES GROUPES, CALCULÉS À PARTIR DE CE QUE LA BASE A RENDU, JAMAIS D'UNE SECONDE REQUÊTE.
 *
 * Le club vient de `clubs.nom` ou, pour un opérateur qui n'a pas le droit de lire `clubs`, du
 * client de la mission. L'équipe vient de `club_teams.name` ou, à défaut, de `structure_externe` —
 * c'est exactement ce que porte déjà le champ `categorie`, et c'est le même repli que l'OS affiche
 * dans sa colonne de contexte.
 */
function grouperParEquipe(liste: Galerie[]): GroupeEquipe[] {
  const par = new Map<string, GroupeEquipe>();
  for (const g of liste) {
    const libelle = g.categorie ?? "Sans équipe";
    // La CLÉ est l'identifiant d'équipe quand il y en a un, pas son nom : deux clubs peuvent avoir
    // une équipe « U11 », et les fondre dans un seul groupe mélangerait deux clubs sous un mot.
    const cle = g.equipeId ?? (g.categorie ? `s:${g.categorie}` : SANS_EQUIPE);
    const deja = par.get(cle);
    if (deja) deja.galeries.push(g);
    else par.set(cle, { cle, libelle, galeries: [g] });
  }
  return [...par.values()].sort((a, b) => {
    // « Sans équipe » EN DERNIER, toujours : c'est le fourre-tout, pas une catégorie. Alphabétique
    // pour le reste, avec `numeric` pour que U6 passe avant U10 — sans lui, U10 arrive avant U6.
    if (a.cle === SANS_EQUIPE) return 1;
    if (b.cle === SANS_EQUIPE) return -1;
    return a.libelle.localeCompare(b.libelle, "fr", { numeric: true });
  });
}

function ListeGaleries({ surOuvrir }: { surOuvrir: (g: Galerie) => void }) {
  const { moi } = useSession();
  // LE SEUL TEST DE MÉTIER DE CET ÉCRAN, ET IL NE BORNE AUCUNE LECTURE. Il décide de l'existence
  // d'un onglet dont TOUTES les actions seraient refusées à un opérateur : `creer_galeries_mission`
  // lève 42501 pour un profil `photo`, mesuré. Règle 5 : on n'affiche pas un bouton qui refuse.
  // Le périmètre de pôle, lui, n'est pas retesté : `v_production_missions` se termine par
  // `WHERE is_staff() AND pole_scope_ok(p.pole_id)`, une mission lue est déjà dans le pôle.
  const production = estProduction(moi?.role ?? null);
  const [onglet, setOnglet] = useState<Onglet>("galeries");

  // `useDonnees` et pas un `useState` : au retour d'une galerie, la liste est déjà là. Un écran
  // qu'on quitte et qu'on retrouve ne doit jamais remontrer sa roue.
  const { donnees, chargement, rafraichissement, erreur, relire } =
    useDonnees<Galerie[]>("os:galeries", lireMesGaleries);

  // LE DROIT DE VOIR L'ARGENT SE DEMANDE À LA BASE, ET IL EST MIS EN CACHE COMME UNE DONNÉE. C'est
  // `media_revenus_visibles()` qui répond, pas une liste de rôles recopiée ici : un responsable de
  // pôle n'est ni `admin` ni `prod` et a pourtant le droit (décision de Fouka du 29/09).
  const droit = useDonnees<boolean>("os:galeries:droit-ventes", puisVoirLesVentes);
  const ventesVisibles = droit.donnees === true;

  // La clé vaut `null` pour qui n'est pas de la production : `useDonnees` ne charge alors rien du
  // tout. Un opérateur ne paye pas une lecture de missions qu'il ne verra jamais.
  const mission = useDonnees<DonneesMissions>(
    production ? "os:galeries:missions" : null,
    async () => {
      const [missions, parMission] = await Promise.all([lireMissions(), lireGaleriesParMission()]);
      return { missions, parMission };
    },
  );

  const liste = donnees ?? [];
  const total = useMemo(() => liste.reduce((s, g) => s + g.nbPhotos, 0), [liste]);
  // Compté sur la liste qu'on a vraiment reçue, jamais sur un chiffre écrit en dur : un opérateur
  // en voit zéro, la production en voit 57, et la phrase doit être vraie pour les deux.
  const sansType = useMemo(() => liste.filter((g) => !g.typeEvenement).length, [liste]);
  const missions = mission.donnees?.missions ?? [];
  const parMission = mission.donnees?.parMission ?? new Map<string, number>();
  const sansGalerie = useMemo(
    () => missions.filter((m) => !parMission.get(m.id)).length,
    [missions, parMission],
  );

  // ── Le tri : un club, puis une recherche ────────────────────────────────────────────────────
  const [club, setClub] = useState("tous");
  const [recherche, setRecherche] = useState("");

  /** Les clubs PRÉSENTS dans la liste, et eux seuls. Proposer un club sans galerie serait un
   *  filtre qui ne rend jamais rien. « Sans club » n'apparaît que s'il y en a. */
  const clubs = useMemo(() => {
    const vus = new Map<string, { libelle: string; n: number }>();
    let sans = 0;
    for (const g of liste) {
      if (!g.clubId) { sans += 1; continue; }
      const ancien = vus.get(g.clubId);
      // Un club rattaché dont la base ne nous donne pas le nom : on le DIT au lieu de le ranger
      // dans « Sans club », ce qui serait faux. Le cas est réservé au lecteur dont la RLS ferme
      // `clubs` et dont la galerie n'a pas de mission pour nommer son client.
      const libelle = g.clubNom ?? "Club non nommé";
      vus.set(g.clubId, { libelle, n: (ancien?.n ?? 0) + 1 });
    }
    const tries = [...vus.entries()]
      .map(([cle, v]) => ({ cle, libelle: v.libelle, n: v.n }))
      .sort((a, b) => a.libelle.localeCompare(b.libelle, "fr"));
    const rangee = [{ cle: "tous", libelle: "Tous les clubs", n: liste.length }, ...tries];
    if (sans) rangee.push({ cle: SANS_CLUB, libelle: "Sans club", n: sans });
    return rangee;
  }, [liste]);

  // Un club choisi puis disparu de la liste (galerie rattachée ailleurs, rafraîchissement) laisserait
  // un écran vide sans qu'on comprenne pourquoi : on retombe sur « Tous les clubs ».
  const clubActif = clubs.some((c) => c.cle === club) ? club : "tous";

  const filtrees = useMemo(() => {
    let l = liste;
    if (clubActif === SANS_CLUB) l = l.filter((g) => !g.clubId);
    else if (clubActif !== "tous") l = l.filter((g) => g.clubId === clubActif);
    const q = recherche.trim().toLowerCase();
    if (q) {
      // Les MÊMES champs que la recherche de l'OS, plus la référence de mission : sur un téléphone
      // on cherche aussi « 3843 » parce qu'on l'a sous les yeux dans ses missions.
      l = l.filter((g) => [g.titre, g.clubNom, g.equipeNom, g.categorie, g.reference]
        .filter(Boolean).join(" ").toLowerCase().includes(q));
    }
    return l;
  }, [liste, clubActif, recherche]);

  const groupes = useMemo(() => grouperParEquipe(filtrees), [filtrees]);

  // ── Les sections qu'on ouvre ────────────────────────────────────────────────────────────────
  const [ouverts, setOuverts] = useState<Record<string, boolean>>({});
  const basculer = useCallback((cle: string) => {
    setOuverts((a) => ({ ...a, [cle]: !a[cle] }));
  }, []);
  /**
   * OUVERT OU FERMÉ PAR DÉFAUT : ÇA SE DÉCIDE SUR LES CHIFFRES, PAS SUR UN GOÛT.
   *
   * Avec quatre groupes ou moins, tout replier fait faire quatre gestes pour voir ce qui tenait à
   * l'écran. Au-delà, la liste des noms d'équipes EST l'index qu'on vient chercher : c'est elle qui
   * évite le défilement dont Fouka se plaint. Et une recherche ouvre tout, sinon on chercherait un
   * titre pour trouver un accordéon fermé.
   */
  const toutOuvert = groupes.length <= 4 || recherche.trim().length > 0;

  /** Après une création, la liste des galeries ET le compte par mission sont faux d'un coup. */
  const toutRelire = useCallback(() => {
    oublier("os:galeries");
    relire();
    mission.relire();
    // `mission.relire` est stable (useCallback) ; `mission`, non : le mettre en dépendance
    // referait ce rappel à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relire, mission.relire]);

  // La rangée d'onglets se construit d'après les droits : une puce absente se lit « ça n'existe
  // pas », une puce qui refuse est une promesse cassée.
  const onglets = [
    { cle: "galeries", libelle: "Galeries", n: liste.length },
    ...(ventesVisibles ? [{ cle: "ventes", libelle: "Ventes" }] : []),
    ...(production ? [{ cle: "missions", libelle: "Missions", n: sansGalerie }] : []),
  ];
  const ongletActif = onglets.some((o) => o.cle === onglet) ? onglet : "galeries";

  return (
    <Ecran
      enCours={!!donnees && rafraichissement}
      teinte="violet"
      rafraichir={ongletActif === "missions" ? toutRelire : relire}
      retour="/profil"
    >
      <View style={{ gap: 4 }}>
        <Text style={s.titre}>Galeries photo</Text>
        <Text style={s.sous}>
          {liste.length
            ? `${liste.length} galerie${liste.length > 1 ? "s" : ""} · ${total.toLocaleString("fr-FR")} photo${total > 1 ? "s" : ""}`
            : "Les albums de vos missions"}
        </Text>
      </View>

      {/* La rangée n'existe QUE s'il y a deux choses à choisir. Une puce unique est un titre
          déguisé, et elle ferait croire à l'opérateur qu'un second onglet lui manque. */}
      {onglets.length > 1 ? (
        <Barre
          choix={onglets}
          actif={ongletActif}
          surChoix={(c) => setOnglet(c as Onglet)}
        />
      ) : null}

      {ongletActif === "missions" ? (
        <OngletMissions
          missions={missions}
          parMission={parMission}
          chargement={mission.chargement}
          erreur={mission.erreur}
          relire={toutRelire}
        />
      ) : ongletActif === "ventes" ? (
        <OngletVentes />
      ) : chargement ? (
        <View style={s.attente}><ActivityIndicator color={C.accent} /></View>
      ) : erreur && !donnees ? (
        <Probleme surReessayer={relire} />
      ) : liste.length ? (
        <View style={{ gap: E.m }}>
          {/* LE TRI N'APPARAÎT QU'AU-DELÀ DE DIX GALERIES. En dessous, la liste tient sous le
              pouce : un champ de recherche et une rangée de puces coûteraient alors plus de place
              qu'ils n'en font gagner. Le seuil est bas exprès — la base en compte déjà 57. */}
          {liste.length > 10 ? (
            <View style={{ gap: E.s }}>
              <Champ
                label="Rechercher une galerie"
                value={recherche}
                onChangeText={setRecherche}
                placeholder="Rechercher un titre, un club, une équipe…"
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
              {clubs.length > 2 ? (
                <Barre choix={clubs} actif={clubActif} surChoix={setClub} />
              ) : null}
            </View>
          ) : null}

          {/* LES GALERIES SANS TYPE, DITES UNE FOIS ET AU BON ENDROIT.
              Mesuré ce soir : 57 sur 57. Écrire « type non renseigné » sur chaque carte aurait
              répété la même ligne cinquante-sept fois sans rien apprendre ; ne rien dire aurait
              laissé un champ de la base vide pour toujours. Un seul compte, en tête, et il
              disparaît tout seul à mesure que la production renseigne les galeries. */}
          {sansType > 0 && production ? (
            <View style={s.rappel}>
              <Text style={s.rappelTexte}>
                {sansType === liste.length
                  ? `Aucune des ${liste.length} galeries ne porte de type d'événement.`
                  : `${sansType} galerie${sansType > 1 ? "s" : ""} sans type d'événement.`}
                {" "}Ouvrez une galerie, « Modifier la galerie », pour le choisir. Sans type, la base
                la traite comme un événement à dossards.
              </Text>
            </View>
          ) : null}

          {!filtrees.length ? (
            <Vide
              icone="search-outline"
              titre="Aucune galerie ne correspond"
              texte={
                "Aucune galerie ne porte ce texte dans son nom, son club ou son équipe. Effacez la "
                + "recherche pour revoir les "
                + `${liste.length} galerie${liste.length > 1 ? "s" : ""} de la liste.`
              }
              action={{ libelle: "Effacer la recherche", surPression: () => { setRecherche(""); setClub("tous"); } }}
            />
          ) : groupes.length === 1 ? (
            // UN SEUL GROUPE N'EST PAS UN GROUPE. Un accordéon unique demande un geste pour ouvrir
            // ce qu'on venait lire, et son titre répète ce que la puce du club dit déjà.
            <View style={{ gap: E.s }}>
              {groupes[0].galeries.map((g) => (
                <CarteGalerie key={g.id} g={g} surOuvrir={() => surOuvrir(g)} />
              ))}
            </View>
          ) : (
            <View style={{ gap: E.s }}>
              {groupes.map((gr) => {
                const ouvert = toutOuvert || ouverts[gr.cle] === true;
                const n = gr.galeries.length;
                const photos = gr.galeries.reduce((t, g) => t + g.nbPhotos, 0);
                return (
                  <View key={gr.cle} style={{ gap: E.s }}>
                    <Pressable
                      onPress={() => basculer(gr.cle)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: ouvert }}
                      accessibilityLabel={`${gr.libelle}, ${n} galerie${n > 1 ? "s" : ""}`}
                      style={({ pressed }) => [s.groupe, pressed ? { opacity: 0.85 } : null]}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={s.groupeNom} numberOfLines={1}>{gr.libelle}</Text>
                        <Text style={s.groupeDetail}>
                          {n} galerie{n > 1 ? "s" : ""} · {photos.toLocaleString("fr-FR")} photo{photos > 1 ? "s" : ""}
                        </Text>
                      </View>
                      <Ionicons
                        name={ouvert ? "chevron-up" : "chevron-down"}
                        size={18}
                        color={C.texteFaible}
                      />
                    </Pressable>
                    {ouvert ? (
                      <View style={{ gap: E.s, paddingLeft: E.s }}>
                        {gr.galeries.map((g) => (
                          <CarteGalerie key={g.id} g={g} surOuvrir={() => surOuvrir(g)} />
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      ) : (
        <Vide
          icone="images-outline"
          titre="Aucune galerie à votre nom"
          texte={
            "Une galerie vous revient quand vous l'avez créée, ou quand elle est rattachée à une de "
            + "vos missions. Aucune galerie n'est aujourd'hui rattachée à une mission : demandez à la "
            + "production de créer celles de vos matchs depuis la fiche mission, elles apparaîtront ici."
          }
        />
      )}
    </Ecran>
  );
}

/**
 * L'ONGLET DES MISSIONS : LE SEUL ENDROIT OÙ UNE GALERIE SE CRÉE (01/10/2026).
 *
 * POURQUOI PAS UN BOUTON « NOUVELLE GALERIE » LIBRE, comme dans l'OS. Parce que c'est exactement
 * ainsi que les 57 galeries actuelles se sont retrouvées avec `mission_id` NULL — et donc invisibles
 * aux opérateurs qui avaient pris les photos. Vérifié par le chemin réel : un `insert` direct dans
 * `media_albums` par un profil `prod` réussit et laisse `mission_id` à NULL. Un formulaire libre sur
 * un téléphone rejouerait le même défaut, en plus vite.
 *
 * `creer_galeries_mission` fait l'inverse : elle rattache la galerie au club, à l'équipe, à la
 * saison, au pôle ET à la mission, et c'est ce dernier champ qui ouvre la galerie au photographe.
 */
function OngletMissions({
  missions, parMission, chargement, erreur, relire,
}: {
  missions: MissionProd[];
  parMission: Map<string, number>;
  chargement: boolean;
  erreur: unknown;
  relire: () => void;
}) {
  if (chargement) return <View style={s.attente}><ActivityIndicator color={C.accent} /></View>;
  if (erreur && !missions.length) return <Probleme surReessayer={relire} />;
  if (!missions.length) {
    return (
      <Vide
        titre="Aucune mission dans votre pôle"
        texte={
          "Les galeries se créent depuis une mission : c'est ce rattachement qui les ouvre au "
          + "photographe qui a pris les photos. Sans mission, il n'y a rien à créer ici."
        }
      />
    );
  }

  // LES PLUS RÉCENTES D'ABORD. On vient créer la galerie du match de samedi, pas celle de février.
  // `lireMissions` trie dans l'autre sens pour le cockpit, qui regarde ce qui arrive : on ne change
  // pas sa fonction pour un écran, on trie ici, sur une copie.
  const ordonnees = [...missions].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  return (
    <Section titre="Galeries des missions">
      <Text style={s.explication}>
        Une galerie par équipe de la mission, jamais deux pour la même. Versez ensuite les photos
        depuis l'ordinateur, puis publiez : la galerie apparaît dans Club+ pour l'équipe et dans
        Connect pour ses familles, selon la formule du club.
      </Text>
      <View style={{ gap: E.s }}>
        {ordonnees.map((m) => (
          <CarteMission key={m.id} m={m} deja={parMission.get(m.id) ?? 0} surCreation={relire} />
        ))}
      </View>
    </Section>
  );
}

function CarteMission({
  m, deja, surCreation,
}: { m: MissionProd; deja: number; surCreation: () => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [equipes, setEquipes] = useState<EquipeDeMission[] | null>(null);
  const [deesEquipes, setDeesEquipes] = useState<(string | null)[]>([]);
  const [lecture, setLecture] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [souci, setSouci] = useState<string | null>(null);
  const [fait, setFait] = useState<string | null>(null);

  // LES ÉQUIPES NE SE LISENT QU'À L'OUVERTURE, et c'est une décision de 4G : dix missions à
  // l'écran, ce serait dix appels de RPC pour un chiffre que personne ne regarde encore.
  const ouvrir = useCallback(async () => {
    setOuvert(true);
    setSouci(null);
    if (equipes !== null) return;
    setLecture(true);
    try {
      // Les deux ensemble : les équipes de la mission, et les galeries qui y sont déjà, avec leur
      // équipe. C'est leur COMPARAISON qui décide du bouton, exactement comme dans l'OS.
      const [e, g] = await Promise.all([lireEquipesDeMission(m.id), lireGaleriesDeMission(m.id)]);
      setEquipes(e);
      setDeesEquipes(g.map((x) => x.equipeId));
    } catch (e) {
      setSouci((e as Error)?.message ?? "Les équipes n'ont pas pu être lues.");
    } finally { setLecture(false); }
  }, [equipes, m.id]);

  const creer = useCallback(async () => {
    setEnCours(true);
    setSouci(null);
    try {
      const r = await creerGaleriesMission(m.id);
      const creees = r.filter((x) => x.creee);
      // LE MÊME MESSAGE QUE L'OS, et surtout la même distinction : « créées » et « existaient
      // déjà » ne sont pas la même nouvelle. Zéro création annoncée comme un succès, c'est le faux
      // succès de la règle 4 sous une autre forme.
      setFait(
        creees.length === 0 ? "Les galeries existaient déjà."
          : creees.length === 1 ? `Galerie créée : ${creees[0].titre}`
          : `${creees.length} galeries créées, une par équipe.`,
      );
      setOuvert(false);
      // Ce qu'on vient de lire sur cette mission est devenu faux : on l'oublie, la prochaine
      // ouverture relira. Garder l'ancienne liste, c'est reproposer de créer ce qui existe.
      setEquipes(null);
      setDeesEquipes([]);
      surCreation();
    } catch (e) {
      setSouci((e as Error)?.message ?? "Création impossible.");
    } finally {
      setEnCours(false);
    }
  }, [m.id, surCreation]);

  const detail = [
    m.date ? quand(m.date) : "Sans date",
    m.lieu,
  ].filter(Boolean).join(" · ");

  // LE LIBELLÉ EST CELUI DE L'OS, y compris son cas « manquantes ». Il annonce un nombre que la
  // base a compté (`equipes_de_mission`), jamais un nombre deviné depuis le champ texte `equipes` —
  // qui dit sept entrées là où la base en reconnaît six, doublons compris.
  const manquantes = equipes
    ? equipes.filter((e) => !deesEquipes.includes(e.equipeId)).length
    : 0;
  const libelle = !equipes
    ? "Créer les galeries"
    : equipes.length
      ? (deja
          ? `Créer les galeries manquantes (${manquantes})`
          : `Créer les galeries (${equipes.length} équipe${equipes.length > 1 ? "s" : ""})`)
      : "Créer la galerie de la prestation";
  const peutCreer = equipes ? (equipes.length ? manquantes > 0 : deja === 0) : false;

  return (
    <View style={s.carte}>
      <View style={s.ligne}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.nom} numberOfLines={2}>{m.client ?? "Sans client"}</Text>
          <Text style={s.detail} numberOfLines={2}>{detail}</Text>
          <Text style={s.compte}>{m.reference}</Text>
        </View>
        {/* UN ZÉRO S'AFFICHE, et c'est la leçon de `Barre` : un zéro se lit « il n'y a rien là »,
            une absence se lit « ça n'existe pas ». Une mission sans galerie doit se voir. */}
        <Pastille
          ton={deja ? "info" : "neutre"}
          texte={deja ? `${deja} galerie${deja > 1 ? "s" : ""}` : "Aucune galerie"}
        />
      </View>

      {fait ? <View style={s.ok}><Text style={s.okTexte}>{fait}</Text></View> : null}

      {!ouvert ? (
        <Bouton
          titre={deja ? "Voir les équipes de la mission" : "Créer les galeries"}
          onPress={ouvrir}
          secondaire={deja > 0}
          icone={deja ? undefined : <Ionicons name="images" size={16} color="#fff" />}
        />
      ) : lecture ? (
        <View style={s.attentePetite}><ActivityIndicator color={C.accent} /></View>
      ) : (
        <View style={{ gap: E.s }}>
          {equipes && equipes.length ? (
            <>
              <Text style={s.sousTitreBloc}>
                {equipes.length} équipe{equipes.length > 1 ? "s" : ""} sur cette mission
              </Text>
              <View style={{ gap: E.xs }}>
                {equipes.map((e) => (
                  <View key={e.equipeId} style={s.equipeLigne}>
                    <Text style={s.equipeNom} numberOfLines={1}>{e.nom}</Text>
                    {e.adversaires
                      ? <Text style={s.equipeAdv} numberOfLines={1}>vs {e.adversaires}</Text>
                      : null}
                  </View>
                ))}
              </View>
            </>
          ) : equipes ? (
            <Vide
              titre="Aucune équipe reconnue sur cette mission"
              texte={
                "La base ne retrouve aucune équipe : ni présence planifiée, ni match, ni nom d'équipe "
                + "qui existe au club. Elle créera donc une seule galerie, celle de la prestation, que "
                + "vous rattacherez à une équipe ensuite si besoin."
              }
            />
          ) : null}

          <Erreur message={souci} />

          {peutCreer ? (
            <Bouton titre={libelle} onPress={creer} enCours={enCours} />
          ) : equipes ? (
            <Text style={s.explication}>
              Chaque équipe de cette mission a déjà sa galerie. Versez les photos depuis
              l'ordinateur, puis publiez-la.
            </Text>
          ) : null}
          <Bouton titre="Fermer" onPress={() => setOuvert(false)} secondaire />
        </View>
      )}
    </View>
  );
}

function CarteGalerie({ g, surOuvrir }: { g: Galerie; surOuvrir: () => void }) {
  // LE CLUB EN PREMIER, DEVANT LA DATE (01/10/2026). Depuis que la liste est rangée par équipe, le
  // titre d'une carte ne dit plus à quel club elle appartient : dans « Tous les clubs », deux
  // groupes « U11 » de deux clubs différents se suivent. Le nom du club le tranche d'un coup d'œil.
  // Il ne se répète PAS quand il est déjà le nom de l'équipe ou de la structure — c'est la même
  // règle que l'OS s'est donnée le 12/09 après avoir affiché « RCPF · U9 · U9 RCPF ».
  const clubUtile = g.clubNom && g.clubNom !== g.categorie ? g.clubNom : null;
  const detail = [clubUtile, g.date ? dateLongue(g.date) : null, g.reference]
    .filter(Boolean).join(" · ");
  return (
    <Pressable
      onPress={surOuvrir}
      accessibilityRole="button"
      accessibilityLabel={`${g.titre}, ${g.nbPhotos} photos`}
      style={({ pressed }) => [s.carte, pressed ? { opacity: 0.85 } : null]}
    >
      <View style={s.ligne}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.nom} numberOfLines={2}>{g.titre}</Text>
          {/* Ni « date non renseignée » ni « catégorie non renseignée » : la catégorie manque sur
              41 galeries sur 57, et une ligne vide répétée quarante fois n'apprend rien. */}
          {detail ? <Text style={s.detail} numberOfLines={1}>{detail}</Text> : null}
          <Text style={s.compte}>
            {g.nbPhotos.toLocaleString("fr-FR")} photo{g.nbPhotos > 1 ? "s" : ""}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={C.texteFaible} />
      </View>
      <View style={s.pastilles}>
        {/* L'ÉTAT S'AFFICHE TOUJOURS, DÉSORMAIS. Avant, seul « Archivée » se voyait, et une galerie
            en brouillon se lisait comme une galerie publiée. Depuis que le téléphone crée des
            galeries, le brouillon est le premier état de toutes : ne pas le dire, c'est laisser
            croire que les familles la voient déjà. */}
        {LIBELLE_STATUT[g.statut] ? (
          <Pastille ton={TON_STATUT[g.statut] ?? "neutre"} texte={LIBELLE_STATUT[g.statut]} />
        ) : g.statut ? <Pastille texte={g.statut} /> : null}
        {g.categorie ? <Pastille texte={g.categorie} /> : null}
        {/* LE TYPE D'ÉVÉNEMENT, QUAND IL EST RENSEIGNÉ. Mesuré ce soir : il l'est sur 0 galerie
            sur 57. On n'écrit donc PAS « type non renseigné » cinquante-sept fois de suite — le
            compte manquant est dit une seule fois, en tête de liste, là où il se corrige. */}
        {libelleTypeEvenement(g.typeEvenement)
          ? <Pastille ton="info" texte={libelleTypeEvenement(g.typeEvenement)!} />
          : null}
      </View>
    </Pressable>
  );
}


// ── L'ONGLET DES VENTES ─────────────────────────────────────────────────────────────────────

/**
 * LES VENTES, POUR QUI LA BASE LES OUVRE (01/10/2026).
 *
 * Fouka : « Je peux pas voir les statistiques, les galeries vendues sur l'app. »
 *
 * TROIS BLOCS, ET CE SONT CEUX DE L'OS, dans le même ordre : le résumé de la période, le classement
 * des galeries, puis la liste des ventes une par une. Le troisième existe pour une raison que Fouka
 * a dite mot pour mot devant l'écran de l'ordinateur le 21/09 : « je ne sais même pas quelle
 * prestation a été payée, quelle galerie a été payée ». Un total de 144,90 € ne dit ni qui, ni quoi.
 *
 * ON N'INVENTE AUCUN CHIFFRE. Les trois viennent des mêmes fonctions que l'écran « Statistiques »
 * de l'OS, avec les mêmes bornes, comptées à Paris. Un chiffre du téléphone qui différerait d'un
 * centime de celui de l'ordinateur ferait perdre confiance aux deux.
 *
 * L'ÉCART ENTRE LE RÉSUMÉ ET LA LISTE EST RÉEL ET ASSUMÉ : mesuré, 10 commandes et 144,90 € au
 * résumé contre 12 ventes dans la liste. Deux commandes n'ont AUCUNE galerie (`album_id` NULL : deux
 * Pass Photo achetés dans l'application, source `apple`), et le résumé passe par le périmètre des
 * galeries. L'OS affiche déjà les deux côte à côte ainsi. Corriger l'un pour qu'il colle à l'autre
 * aurait fabriqué un chiffre.
 */
function OngletVentes() {
  const [periode, setPeriode] = useState<Periode>("30j");
  const { donnees, chargement, erreur, relire } = useDonnees<Ventes>(
    `os:galeries:ventes:${periode}`,
    () => lireVentes(periode),
    [periode],
  );

  const plage = bornes(periode);
  const r = donnees?.resume ?? null;

  return (
    <View style={{ gap: E.m }}>
      <Barre choix={PERIODES.map((p) => ({ cle: p.cle, libelle: p.libelle }))} actif={periode} surChoix={(c) => setPeriode(c as Periode)} />
      <Text style={s.explication}>
        Du {dateLongue(plage.debut)} au {dateLongue(plage.fin)}. Les galeries d'essai sont écartées
        de ces chiffres, comme sur l'ordinateur.
      </Text>

      {chargement ? (
        <View style={s.attente}><ActivityIndicator color={C.accent} /></View>
      ) : erreur && !donnees ? (
        <Probleme surReessayer={relire} />
      ) : !r ? (
        <Vide
          titre="Statistiques indisponibles"
          texte={
            "La base n'a rien renvoyé pour cette période. Réessayez dans un instant : si cela se "
            + "reproduit, les ventes restent consultables sur l'ordinateur, écran Statistiques."
          }
        />
      ) : (
        <>
          {/* QUATRE CHIFFRES, LES MÊMES QUE L'OS ET AVEC SES MOTS. Deux par ligne : sur 402 points
              de large, quatre cases côte à côte tronquent « Chiffre d'affaires ». */}
          <View style={s.tuiles}>
            <Tuile
              titre="Chiffre d'affaires"
              valeur={euros(r.caCents)}
              sous={r.rembourseCents > 0 ? `${euros(r.rembourseCents)} remboursés` : null}
            />
            <Tuile
              titre="Commandes"
              valeur={r.commandes.toLocaleString("fr-FR")}
              sous={r.commandesGratuites > 0 ? `${r.commandesGratuites} offertes` : null}
            />
            <Tuile
              titre="Panier moyen"
              valeur={euros(r.panierMoyenCents)}
              sous="commandes payantes"
            />
            <Tuile
              titre="Conversion"
              valeur={pourcent(r.conversion)}
              sous="pour 100 visites"
            />
          </View>

          {/* Les visites ne sont pas une tuile : c'est le dénominateur de la conversion, et le
              mettre à côté d'elle évite de faire croire à deux mesures indépendantes. */}
          <Text style={s.explication}>
            {r.visites.toLocaleString("fr-FR")} visite{r.visites > 1 ? "s" : ""} de galerie sur la
            période, {r.galeriesVendeuses} galerie{r.galeriesVendeuses > 1 ? "s" : ""} ayant vendu.
          </Text>

          {donnees?.galeries.length ? (
            <Section titre="Les galeries qui ont bougé">
              <View style={{ gap: E.xs }}>
                {donnees.galeries.map((g) => (
                  <View key={g.albumId} style={s.ligneVente}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.venteNom} numberOfLines={1}>{g.titre}</Text>
                      <Text style={s.venteDetail} numberOfLines={1}>
                        {[g.club, `${g.visites} visite${g.visites > 1 ? "s" : ""}`,
                          g.commandes ? `${g.commandes} commande${g.commandes > 1 ? "s" : ""}` : null]
                          .filter(Boolean).join(" · ")}
                      </Text>
                    </View>
                    {/* UNE GALERIE À 0 € N'EST PAS UNE ERREUR : elle peut être incluse dans un Pass
                        Photo, ou vue et jugée trop chère. On affiche le zéro sans le peindre en
                        vert, et la conversion dit le reste. */}
                    <Text style={[s.venteMontant, g.caCents > 0 ? { color: C.succesTexte } : null]}>
                      {euros(g.caCents)}
                    </Text>
                  </View>
                ))}
              </View>
            </Section>
          ) : (
            <Vide
              titre="Aucune galerie consultée ni vendue"
              texte={
                "Sur cette période, aucune galerie n'a reçu de visite ni de commande. Choisissez une "
                + "période plus large, ou vérifiez qu'un lien de partage a bien été envoyé au club."
              }
            />
          )}

          {donnees?.ventes.length ? (
            <Section titre="Ventes, qui a payé quoi">
              <View style={{ gap: E.xs }}>
                {donnees.ventes.map((v) => (
                  <View key={v.id} style={s.ligneVente}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.venteNom} numberOfLines={1}>{v.galerie}</Text>
                      <Text style={s.venteDetail} numberOfLines={1}>
                        {[quandVente(v.payeLe), v.club, v.formule].filter(Boolean).join(" · ")}
                      </Text>
                      {v.acheteur ? (
                        <Text style={s.venteDetail} numberOfLines={1}>{v.acheteur}</Text>
                      ) : null}
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 3 }}>
                      <Text
                        style={[
                          s.venteMontant,
                          v.rembourse
                            ? { color: C.texteFaible, textDecorationLine: "line-through" }
                            : { color: C.succesTexte },
                        ]}
                      >
                        {euros(v.montantCents)}
                      </Text>
                      {v.rembourse ? <Pastille texte="Remboursé" /> : null}
                    </View>
                  </View>
                ))}
              </View>
            </Section>
          ) : null}
        </>
      )}
    </View>
  );
}

/** Un chiffre et son intitulé. Le dessin d'une carte, sans son bord : quatre cadres empilés font
 *  un formulaire, quatre chiffres posés font un tableau de bord. */
function Tuile({ titre, valeur, sous }: { titre: string; valeur: string; sous?: string | null }) {
  return (
    <View style={s.tuile}>
      <Text style={s.tuileTitre} numberOfLines={1}>{titre}</Text>
      <Text style={s.tuileValeur} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {valeur}
      </Text>
      {sous ? <Text style={s.tuileSous} numberOfLines={1}>{sous}</Text> : null}
    </View>
  );
}

/**
 * CE QUE CETTE GALERIE A VENDU, LIEN PAR LIEN.
 *
 * `media_album_links_stats` est la fonction de la famille qui fait le garde-fou CORRECTEMENT : elle
 * se termine par `where media_pricing_staff()` et n'écrit l'argent que
 * `case when media_revenus_visibles() then … end`. Deux droits distincts, tenus par la base.
 *
 * ZÉRO LIGNE = AUCUN BLOC. Mesuré : Mikael (prod) reçoit 1 lien, 1 commande et 40,00 € sur la
 * galerie la plus vendeuse ; Antoine (photo) reçoit ZÉRO LIGNE — pas une ligne à zéro euro. Un
 * cadre « 0 € » serait une affirmation là où il n'y a qu'une absence de droit.
 */
function VentesDeLaGalerie({ albumId }: { albumId: string }) {
  const { donnees } = useDonnees<LienVendeur[]>(
    `os:galeries:liens:${albumId}`,
    () => lireVentesDeLaGalerie(albumId),
    [albumId],
  );
  const liens = donnees ?? [];
  if (!liens.length) return null;

  const commandes = liens.reduce((t, l) => t + (l.commandes ?? 0), 0);
  // L'ARGENT NE S'ADDITIONNE QUE S'IL EST DONNÉ. `caCents` vaut `null` quand la base le masque (le
  // Secrétariat fixe les prix sans voir les recettes) : sommer des null donnerait 0 €, c'est-à-dire
  // « rien vendu » au lieu de « pas votre affaire ».
  const argentVisible = liens.some((l) => l.caCents !== null);
  const ca = liens.reduce((t, l) => t + (l.caCents ?? 0), 0);

  return (
    <Section titre="Ce que cette galerie a vendu">
      <View style={{ gap: E.xs }}>
        {liens.map((l) => (
          <View key={l.id} style={s.ligneVente}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.venteNom} numberOfLines={1}>
                {l.libelle ?? l.formule ?? "Lien de partage"}
              </Text>
              <Text style={s.venteDetail} numberOfLines={2}>
                {[
                  l.audience,
                  l.formule && l.formule !== l.libelle ? l.formule : null,
                  l.prixCents !== null ? euros(l.prixCents) : null,
                  `${l.visiteurs} visiteur${l.visiteurs > 1 ? "s" : ""}`,
                  l.commandes !== null
                    ? `${l.commandes} commande${l.commandes > 1 ? "s" : ""}`
                    : null,
                ].filter(Boolean).join(" · ")}
              </Text>
            </View>
            {l.caCents !== null ? (
              <Text style={[s.venteMontant, l.caCents > 0 ? { color: C.succesTexte } : null]}>
                {euros(l.caCents)}
              </Text>
            ) : null}
            {!l.actif ? <Pastille texte="Désactivé" /> : null}
          </View>
        ))}
      </View>
      {argentVisible ? (
        <Text style={s.explication}>
          {commandes} commande{commandes > 1 ? "s" : ""} au total, {euros(ca)}. Les liens et leurs
          tarifs se règlent depuis l'OS.
        </Text>
      ) : (
        <Text style={s.explication}>
          Les recettes de cette galerie ne vous sont pas ouvertes : seules la direction, la
          production, la comptabilité et le responsable du pôle les voient.
        </Text>
      )}
    </Section>
  );
}

// ── Une galerie ─────────────────────────────────────────────────────────────────────────────

/** Soixante par page : la plus grosse galerie réelle compte 431 photos. */
const PAR_PAGE = 60;

function UneGalerie({ galerie, surRetour }: { galerie: Galerie; surRetour: () => void }) {
  const { moi } = useSession();
  // « Type non renseigné » ne s'affiche qu'à qui peut le renseigner. Mesuré : un opérateur ne peut
  // RIEN écrire sur une galerie (`malbums_photographe_perimetre` porte
  // `with_check (NOT est_operateur_terrain())`), et son UPDATE rend zéro ligne sans erreur. Lui
  // montrer un manque qu'il ne peut pas combler, c'est un reproche sans bouton.
  const production = estProduction(moi?.role ?? null);
  const [photos, setPhotos] = useState<PhotoGalerie[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [enCours, setEnCours] = useState(true);
  const [panne, setPanne] = useState(false);
  const [agrandie, setAgrandie] = useState<PhotoGalerie | null>(null);
  // LE LOT VIT DANS L'ÉCRAN DE LA GALERIE, PAS DANS UN `useDonnees`. Ce n'est pas une lecture qu'on
  // met en cache : c'est un travail en cours, qui doit survivre au défilement et s'arrêter au geste.
  const [lot, setLot] = useState<AvancementLot | null>(null);
  const [bilan, setBilan] = useState<string | null>(null);
  const [soucisLot, setSoucisLot] = useState<string | null>(null);
  // UNE RÉFÉRENCE, PAS UN ÉTAT. La boucle du lot lit ce drapeau entre chaque photo : un `useState`
  // lui aurait donné la valeur figée du rendu où elle a démarré, et « Arrêter » n'aurait rien fait.
  const arret = useRef(false);
  // LE TITRE ET LA CATÉGORIE VIVENT ICI PENDANT LA VISITE. La liste derrière est en cache, et
  // revenir dessus la relira ; mais rester sur une galerie qu'on vient de renommer en lisant
  // l'ancien nom, c'est croire que l'enregistrement a échoué.
  const [titre, setTitre] = useState(galerie.titre);
  const [categorie, setCategorie] = useState(galerie.categorie);
  // Le type suit la même règle que le titre : il se change dans le panneau, et la pastille au-dessus
  // doit bouger tout de suite, sinon on croit que ça n'a pas pris.
  const [type, setType] = useState(galerie.typeEvenement);

  const { width } = useWindowDimensions();
  // Trois colonnes, gouttières comprises. `Ecran` pose E.l de marge de chaque côté.
  const cote = Math.floor((width - E.l * 2 - E.xs * 2) / 3);

  const charger = useCallback(async (p: number) => {
    setEnCours(true);
    setPanne(false);
    try {
      const r = await lirePhotosGalerie(galerie.id, p, PAR_PAGE);
      setTotal(r.total);
      // On AJOUTE à partir de la deuxième page, et on remplace sur la première : un rafraîchissement
      // qui empilerait les mêmes photos doublerait la grille.
      setPhotos((avant) => (p === 0 ? r.photos : [...avant, ...r.photos]));
      setPage(p);
    } catch { setPanne(true); }
    finally { setEnCours(false); }
  }, [galerie.id]);

  useEffect(() => { charger(0); }, [charger]);

  const nets = photos.filter((p) => p.net).length;
  const reste = total !== null ? total - photos.length : 0;

  /**
   * ENREGISTRER TOUTE LA GALERIE DANS LA PHOTOTHÈQUE.
   *
   * ON LIT LA LISTE COMPLÈTE AVANT DE COMMENCER, et pas les 60 photos affichées : « les originaux
   * de cette galerie » veut dire les 431, pas la première page. `lireOriginauxGalerie` ne demande
   * aucun aperçu et ne signe rien : une requête, et le poids réel du lot.
   *
   * TROIS CONTRÔLES AVANT LE PREMIER OCTET, et chacun évite une promesse cassée :
   *   · la permission d'écrire dans la photothèque — refusée, on le DIT et on ne télécharge rien ;
   *   · la place libre — 431 photos pèsent jusqu'à 5,6 Go, et un lot qui s'arrête à mi-chemin après
   *     un quart d'heure d'attente est pire que le lot qu'on n'a pas lancé. On garde 500 Mo de
   *     marge : un téléphone à zéro octet libre cesse de fonctionner, pas seulement de télécharger ;
   *   · une galerie sans aucun original — on ne lance pas une boucle vide en annonçant un travail.
   */
  const lancerLot = useCallback(async () => {
    setBilan(null);
    setSoucisLot(null);
    arret.current = false;
    setLot({ enregistrees: 0, echecs: 0, total: 0, octets: 0, enCours: null });
    try {
      const tous = await lireOriginauxGalerie(galerie.id);
      if (!tous.length) {
        setLot(null);
        setSoucisLot("Cette galerie n'a aucun fichier original enregistré.");
        return;
      }
      if (!(await autoriserPhototheque())) {
        setLot(null);
        setSoucisLot(
          "La photothèque n'a pas été autorisée. Ouvrez Réglages, SV OS bêta, Photos, et "
          + "autorisez l'ajout de photos.",
        );
        return;
      }
      const attendu = poidsDuLot(tous);
      const libre = placeLibre();
      if (libre !== null && attendu > 0 && attendu + 500 * 1048576 > libre) {
        setLot(null);
        setSoucisLot(
          `Ces ${tous.length} photos pèsent ${poids(attendu)} et il reste ${poids(libre)} sur ce `
          + "téléphone. Libérez de la place, ou enregistrez les photos une par une.",
        );
        return;
      }
      setLot({ enregistrees: 0, echecs: 0, total: tous.length, octets: 0, enCours: null });
      const r = await enregistrerLot(tous, setLot, () => arret.current);
      setLot(null);
      // LE BILAN DIT LA VÉRITÉ, MÊME QUAND ELLE EST MOYENNE (règle 4). « Terminé » sur un lot qui a
      // perdu trois photos, c'est un faux succès : on annonce ce qui est dans la photothèque, ce qui
      // a échoué, et le fait que l'arrêt vient de la personne quand c'est le cas.
      const debut = `${r.enregistrees} photo${r.enregistrees > 1 ? "s" : ""} enregistrée${r.enregistrees > 1 ? "s" : ""}`;
      setBilan(
        r.arrete
          ? `${debut} sur ${r.total}, arrêté.`
          : r.echecs
            ? `${debut} sur ${r.total}. ${r.echecs} n'${r.echecs > 1 ? "ont" : "a"} pas pu être enregistrée${r.echecs > 1 ? "s" : ""} : relancez pour reprendre.`
            : `${debut} dans votre photothèque.`,
      );
      if (r.premierSouci) setSoucisLot(r.premierSouci);
    } catch (e) {
      setLot(null);
      setSoucisLot((e as Error)?.message ?? "Le téléchargement n'a pas pu démarrer.");
    }
  }, [galerie.id]);

  return (
    <Ecran teinte="violet" enCours={enCours && page === 0} rafraichir={() => charger(0)}>
      <Pressable
        onPress={surRetour}
        accessibilityRole="button"
        accessibilityLabel="Revenir à la liste des galeries"
        hitSlop={8}
        style={({ pressed }) => [s.retour, pressed ? { opacity: 0.7 } : null]}
      >
        <Ionicons name="chevron-back" size={18} color={C.texteDoux} />
        <Text style={s.retourTexte}>Galeries</Text>
      </Pressable>

      <View style={{ gap: 4 }}>
        <Text style={s.titre}>{titre}</Text>
        <Text style={s.sous}>
          {[
            galerie.date ? dateLongue(galerie.date) : null,
            // Le total VRAI, compté par la base. `photo_count` dérive : mesuré faux sur 1 galerie
            // sur 57. Tant qu'on ne l'a pas, on n'annonce rien plutôt qu'un chiffre approximatif.
            total !== null ? `${total.toLocaleString("fr-FR")} photo${total > 1 ? "s" : ""}` : null,
          ].filter(Boolean).join(" · ")}
        </Text>
      </View>

      {/* CE QU'ON REGARDE SE DIT. L'aperçu net vit dans un bucket privé et demande une signature ;
          quand elle manque, on affiche l'aperçu filigrané, et le dire évite de croire qu'une photo
          a été livrée avec son filigrane. Mesuré : 4 921 photos sur 7 784 ont un aperçu net, le cas
          mélangé est donc le cas courant, pas une bizarrerie. */}
      {photos.length ? (
        <View style={s.pastilles}>
          {nets === photos.length ? <Pastille ton="info" texte="Aperçus sans filigrane" />
            : nets === 0 ? <Pastille texte="Aperçus filigranés" />
            : <Pastille texte={`${nets} aperçu${nets > 1 ? "s" : ""} sur ${photos.length} sans filigrane`} />}
        </View>
      ) : null}

      <View style={s.pastilles}>
        {LIBELLE_STATUT[galerie.statut] ? (
          <Pastille ton={TON_STATUT[galerie.statut] ?? "neutre"} texte={LIBELLE_STATUT[galerie.statut]} />
        ) : null}
        {categorie ? <Pastille texte={categorie} /> : null}
        {libelleTypeEvenement(type)
          ? <Pastille ton="info" texte={libelleTypeEvenement(type)!} />
          : production ? <Pastille ton="alerte" texte="Type non renseigné" /> : null}
      </View>

      <LeNumeroDeDossard albumId={galerie.id} type={type} />

      {/* LES ORIGINAUX, AU-DESSUS DE LA GRILLE ET PAS EN BAS DE PAGE. C'est ce qu'un opérateur vient
          chercher : sur 431 photos, un bouton posé sous la grille demande huit « voir plus » avant
          d'exister. Le bloc n'apparaît que quand la galerie a des photos — proposer d'enregistrer
          zéro photo est un bouton qui ne mène nulle part (règle 5). */}
      {total ? (
        <View style={s.carte}>
          <Text style={s.sousTitreBloc}>Enregistrer les originaux</Text>
          {lot ? (
            <View style={{ gap: E.s }}>
              <Text style={s.detail}>
                {lot.total
                  ? `${lot.enregistrees} sur ${lot.total} enregistrée${lot.enregistrees > 1 ? "s" : ""}`
                  : "Préparation de la liste"}
                {lot.octets > 0 ? ` · ${poids(lot.octets)}` : ""}
                {lot.echecs ? ` · ${lot.echecs} échec${lot.echecs > 1 ? "s" : ""}` : ""}
              </Text>
              {lot.enCours ? (
                <Text style={s.explication} numberOfLines={1}>{lot.enCours}</Text>
              ) : null}
              {/* `Jauge` ET PAS UNE BARRE À MOI : la brique existe dans `src/ui/`, écrite le même
                  jour pour le centre de formation. Deux barres de progression légèrement
                  différentes dans la même application, c'est le reproche numéro un de Fouka
                  (règle 1). Elle n'avance que sur ce que la photothèque a confirmé. */}
              <Jauge
                avancement={lot.total ? Math.round((lot.enregistrees / lot.total) * 100) : 0}
                couleur={C.accentClair}
              />
              {/* « Arrêter » ET PAS « Annuler » : ce qui est enregistré le reste, rien ne se défait.
                  Annuler laisserait croire que la photothèque va être nettoyée. */}
              <Bouton titre="Arrêter" onPress={() => { arret.current = true; }} secondaire />
            </View>
          ) : (
            <>
              <Text style={s.explication}>
                Les fichiers du reflex, en pleine définition et sans filigrane, dans la photothèque
                de ce téléphone. Un original pèse 13 Mo en moyenne : en 4G, une galerie entière prend
                plusieurs minutes, et l'enregistrement s'arrête au geste.
              </Text>
              <Text style={s.explication}>
                La photothèque d'iOS recompresse ce qu'elle reçoit : l'image garde sa définition
                entière, le fichier est plus léger que celui du reflex. Pour livrer un fichier
                d'origine à un client, passez par l'ordinateur.
              </Text>
              <Bouton
                titre={`Enregistrer les ${total.toLocaleString("fr-FR")} originaux`}
                onPress={lancerLot}
                icone={<Ionicons name="download-outline" size={16} color="#fff" />}
              />
              <Text style={s.explication}>
                Une seule photo : ouvrez-la d'une pression, puis « Enregistrer l'original ».
              </Text>
            </>
          )}
          {bilan ? <View style={s.ok}><Text style={s.okTexte}>{bilan}</Text></View> : null}
          <Erreur message={soucisLot} />
        </View>
      ) : null}

      <VentesDeLaGalerie albumId={galerie.id} />

      <PanneauGalerie
        galerie={galerie}
        surRenommee={setTitre}
        surEquipe={setCategorie}
        surType={setType}
      />

      {panne && !photos.length ? (
        <Probleme surReessayer={() => charger(0)} />
      ) : enCours && !photos.length ? (
        <View style={s.attente}><ActivityIndicator color={C.accent} /></View>
      ) : photos.length ? (
        <>
          <View style={s.grille}>
            {photos.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => setAgrandie(p)}
                accessibilityRole="imagebutton"
                accessibilityLabel="Agrandir la photo"
                style={({ pressed }) => [{ width: cote, height: cote }, pressed ? { opacity: 0.8 } : null]}
              >
                <Image
                  source={{ uri: p.url }}
                  style={s.vignette}
                  contentFit="cover"
                  // La case porte déjà un fond : sur une grille de soixante vignettes, une case
                  // colorée qui se remplit vaut mieux que soixante cadres vides qui clignotent.
                  transition={120}
                />
              </Pressable>
            ))}
          </View>

          {reste > 0 ? (
            <Pressable
              onPress={() => charger(page + 1)}
              accessibilityRole="button"
              accessibilityLabel={`Charger ${Math.min(reste, PAR_PAGE)} photos de plus`}
              style={({ pressed }) => [s.suite, pressed ? { opacity: 0.8 } : null]}
            >
              {enCours
                ? <ActivityIndicator color={C.texte} />
                : <Text style={s.suiteTexte}>Voir {Math.min(reste, PAR_PAGE)} photos de plus</Text>}
            </Pressable>
          ) : null}

          {/* Une panne survenue APRÈS la première page ne doit pas effacer ce qui est déjà affiché :
              on la signale sous la grille, et le bouton reste. */}
          {panne ? (
            <Text style={s.souci}>La suite n'a pas pu être chargée. Réessayez dans un instant.</Text>
          ) : null}
        </>
      ) : (
        <Vide
          titre="Aucune photo dans cette galerie"
          texte="Les photos apparaissent ici une fois versées et traitées. Si vous en attendez, prévenez la production."
        />
      )}

      <Modal
        visible={!!agrandie}
        transparent
        animationType="fade"
        onRequestClose={() => setAgrandie(null)}
      >
        <View style={s.plein}>
          {/* LE FOND FERME, ET C'EST UNE VUE À PART. Avant, TOUTE la surface fermait la photo : y
              poser un bouton « Enregistrer » aurait fait fermer le modal au moindre raté du doigt,
              juste avant de lancer un téléchargement. */}
          <Pressable
            onPress={() => setAgrandie(null)}
            accessibilityRole="button"
            accessibilityLabel="Fermer la photo"
            style={s.pleinFond}
          />
          {agrandie ? (
            <>
              <Image
                source={{ uri: agrandie.url }}
                style={{ width: "100%", aspectRatio: agrandie.ratio }}
                contentFit="contain"
                transition={120}
              />
              <UnOriginal photo={agrandie} surFermer={() => setAgrandie(null)} />
            </>
          ) : null}
        </View>
      </Modal>
    </Ecran>
  );
}


/**
 * ENREGISTRER UNE SEULE PHOTO, DEPUIS LA PHOTO AGRANDIE (01/10/2026).
 *
 * C'est le geste du bord de terrain : le coach demande LA photo du but, on l'ouvre, on l'enregistre,
 * on l'envoie. Treize mégaoctets, quelques secondes. Le lot, lui, se lance quand on rentre.
 *
 * ON ENREGISTRE L'ORIGINAL, PAS CE QUI EST À L'ÉCRAN, et la nuance vaut d'être dite : la grille
 * montre un aperçu de 1 600 points, filigrané ou non ; le fichier enregistré est celui du reflex,
 * 4 000 × 6 000, sans filigrane. Un écran qui enregistrerait l'aperçu affiché aurait l'air de
 * marcher et livrerait une photo inutilisable.
 */
function UnOriginal({ photo, surFermer }: { photo: PhotoGalerie; surFermer: () => void }) {
  const [enCours, setEnCours] = useState(false);
  const [fait, setFait] = useState(false);
  const [souci, setSouci] = useState<string | null>(null);

  // La photo change quand on ouvre la suivante : sans ça, « Enregistrée » resterait affiché sur une
  // autre photo, qui ne l'est pas.
  useEffect(() => { setFait(false); setSouci(null); }, [photo.id]);

  const enregistrer = useCallback(async () => {
    setEnCours(true);
    setSouci(null);
    try {
      if (!(await autoriserPhototheque())) {
        setSouci(
          "La photothèque n'a pas été autorisée. Ouvrez Réglages, SV OS bêta, Photos, et autorisez "
          + "l'ajout de photos.",
        );
        return;
      }
      await enregistrerOriginal(photo);
      // PAS DE FAUX SUCCÈS : `enregistrerOriginal` lève si la signature est refusée, si le fichier
      // arrive vide, ou si la photothèque refuse. On n'arrive ici qu'une fois le fichier dedans.
      setFait(true);
    } catch (e) {
      setSouci((e as Error)?.message ?? "Enregistrement impossible.");
    } finally {
      setEnCours(false);
    }
  }, [photo]);

  return (
    <View style={s.pleinBarre}>
      {photo.chemin ? (
        fait ? (
          <View style={s.ok}>
            <Text style={s.okTexte}>
              Enregistrée dans votre photothèque{photo.nomFichier ? ` : ${photo.nomFichier}` : ""}.
            </Text>
          </View>
        ) : (
          <Bouton
            titre={photo.octets ? `Enregistrer l'original (${poids(photo.octets)})` : "Enregistrer l'original"}
            onPress={enregistrer}
            enCours={enCours}
            icone={<Ionicons name="download-outline" size={16} color="#fff" />}
          />
        )
      ) : (
        // Une photo sans fichier original : ça existe, et un bouton qui échouerait à coup sûr serait
        // la promesse cassée de la règle 5.
        <Text style={s.explication}>
          Cette photo n'a pas de fichier original enregistré. Signalez-le à la production.
        </Text>
      )}
      <Erreur message={souci} />
      <Bouton titre="Fermer" onPress={surFermer} secondaire />
    </View>
  );
}

/**
 * LE DOSSARD SERT-IL ICI ? C'EST LA BASE QUI RÉPOND (01/10/2026, soir).
 *
 * `galerie_numero_utile(id)` est une fonction de la base, et c'est elle qui décide : un
 * entraînement et un stage se jouent sans numéro, tout le reste avec. La règle est écrite UNE
 * fois, là-bas ; la recopier ici donnerait deux versions de la même décision, et le jour où Fouka
 * ajoute un type, c'est la copie qui aurait tort (la leçon du filtre recopié, 30/09).
 *
 * CE N'EST PAS UNE DÉCORATION. Ce booléen commande la recherche par dossard que les familles
 * utilisent dans Connect : sur une galerie marquée « entraînement », le champ disparaît. La
 * production doit donc voir, au moment où elle choisit le type, ce que ce choix fait dehors.
 *
 * UN APPEL, ET SEULEMENT SUR LA GALERIE OUVERTE. La poser sur les 57 lignes de la liste, ce serait
 * 57 allers-retours pour une phrase. Un échec ne casse rien : on n'écrit pas la ligne, plutôt que
 * d'affirmer une réponse qu'on n'a pas.
 */
function LeNumeroDeDossard({ albumId, type }: { albumId: string; type: string | null }) {
  const [utile, setUtile] = useState<boolean | null>(null);

  useEffect(() => {
    let vivant = true;
    // `type` est dans les dépendances exprès : le choix du type change la réponse, et la phrase
    // doit suivre le même geste que la pastille.
    numeroUtileDeLaGalerie(albumId)
      .then((r) => { if (vivant) setUtile(r); })
      .catch(() => { if (vivant) setUtile(null); });
    return () => { vivant = false; };
  }, [albumId, type]);

  if (utile === null) return null;
  return (
    <Text style={s.explication}>
      {utile
        ? "Les familles peuvent chercher par numéro de dossard dans cette galerie."
        : "La recherche par numéro de dossard est fermée sur cette galerie : on ne porte pas de "
          + "numéro à ce genre d'événement."}
    </Text>
  );
}

// ── Ce qu'on peut changer sur une galerie, et ce qui ne se fera jamais d'ici ────────────────

/**
 * LE PANNEAU D'UNE GALERIE : RENOMMER, RATTACHER, ET DIRE OÙ LE TÉLÉPHONE S'ARRÊTE.
 *
 * DEUX LECTEURS, DEUX CONTENUS, ET C'EST LA BASE QUI A TRANCHÉ. `malbums_prod_update` demande
 * `role in ('admin','prod')`, et la policy RESTRICTIVE `malbums_photographe_perimetre` porte
 * `with_check (NOT est_operateur_terrain())` : un opérateur ne peut RIEN écrire sur une galerie,
 * même celle de sa propre mission. Mesuré par le chemin réel : son UPDATE rend zéro ligne et
 * AUCUNE erreur. Lui montrer un champ « Nom de la galerie » serait la promesse cassée de la
 * règle 5, doublée du faux succès de la règle 4.
 *
 * ON NE LUI MONTRE DONC PAS UN ÉCRAN AMPUTÉ SANS EXPLICATION : on dit qui modifie, et surtout on
 * dit la seule chose qu'il vient vraiment chercher — pourquoi il n'y a pas de bouton « verser mes
 * photos ». Un manque expliqué ne fait pas téléphoner (règle 7).
 */
function PanneauGalerie({
  galerie, surRenommee, surEquipe, surType,
}: {
  galerie: Galerie;
  surRenommee: (titre: string) => void;
  surEquipe: (nom: string | null) => void;
  surType: (type: string | null) => void;
}) {
  const { moi } = useSession();
  const production = estProduction(moi?.role ?? null);
  const [ouvert, setOuvert] = useState(false);
  const [nom, setNom] = useState(galerie.titre);
  const [equipes, setEquipes] = useState<EquipeDuClub[] | null>(null);
  const [equipeId, setEquipeId] = useState(galerie.equipeId);
  const [typeChoisi, setTypeChoisi] = useState(galerie.typeEvenement);
  const [lecture, setLecture] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [souci, setSouci] = useState<string | null>(null);
  const [fait, setFait] = useState<string | null>(null);

  const ouvrir = useCallback(async () => {
    setOuvert(true);
    setSouci(null);
    setFait(null);
    // Sans club, il n'y a pas d'équipe à proposer : une équipe appartient à un club, et les 74
    // équipes de la base se répartissent sur deux clubs. Mesuré : 36 galeries sur 57 n'ont pas de
    // club. On ne lit rien et on le dira.
    if (!galerie.clubId || equipes !== null) return;
    setLecture(true);
    try { setEquipes(await lireEquipesDuClub(galerie.clubId)); }
    catch (e) { setSouci((e as Error)?.message ?? "Les équipes du club n'ont pas pu être lues."); }
    finally { setLecture(false); }
  }, [equipes, galerie.clubId]);

  const renommer = useCallback(async () => {
    setEnCours(true); setSouci(null); setFait(null);
    try {
      await renommerGalerie(galerie.id, nom);
      // Le cache de la liste devient faux à la seconde où la base a dit oui.
      oublier("os:galeries");
      surRenommee(nom.trim());
      setFait("Nom enregistré.");
    } catch (e) { setSouci((e as Error)?.message ?? "Enregistrement impossible."); }
    finally { setEnCours(false); }
  }, [galerie.id, nom, surRenommee]);

  const rattacher = useCallback(async (e: EquipeDuClub | null) => {
    setEnCours(true); setSouci(null); setFait(null);
    try {
      await rattacherEquipe(galerie.id, e?.id ?? null);
      oublier("os:galeries");
      setEquipeId(e?.id ?? null);
      surEquipe(e?.nom ?? null);
      setFait(e ? `Galerie rattachée à ${e.nom}.` : "Équipe retirée.");
    } catch (err) { setSouci((err as Error)?.message ?? "Rattachement impossible."); }
    finally { setEnCours(false); }
  }, [galerie.id, surEquipe]);

  /**
   * CHOISIR LE TYPE, OU LE RETIRER.
   *
   * On n'écrit RIEN avant d'avoir la réponse de la base, et `definirTypeEvenement` relit la valeur
   * écrite : l'état de l'écran ne bouge donc qu'après une écriture confirmée. L'ordre inverse —
   * colorer la pastille puis écrire — est exactement le « Chapitre accepté (local) » qu'on vient
   * de retirer du Centre : un vert qui ne prouve rien.
   */
  const choisirType = useCallback(async (cle: string | null) => {
    setEnCours(true); setSouci(null); setFait(null);
    try {
      await definirTypeEvenement(galerie.id, cle);
      oublier("os:galeries");
      setTypeChoisi(cle);
      surType(cle);
      setFait(cle ? `Type enregistré : ${libelleTypeEvenement(cle)}.` : "Type retiré.");
    } catch (err) { setSouci((err as Error)?.message ?? "Enregistrement impossible."); }
    finally { setEnCours(false); }
  }, [galerie.id, surType]);

  if (!production) {
    return (
      <Vide
        titre="Les photos montent depuis l'ordinateur"
        texte={
          "Le téléphone ne verse pas de photos, et ce n'est pas une limite d'affichage : chaque photo "
          + "part avec trois versions préparées à l'écran de l'ordinateur : la vignette et l'aperçu "
          + "filigranés, et l'aperçu clair sans lequel la reconnaissance ne retrouve aucun enfant. "
          + "Déposez le lien de vos fichiers depuis « Sauvegarde & livraison », la production les verse "
          + "et publie la galerie. Le nom et l'équipe d'une galerie se modifient aussi depuis l'OS."
        }
      />
    );
  }

  // Les catégories supplémentaires sont exclues du choix : y remettre une équipe déjà cochée dans
  // `team_ids` créerait un doublon que l'OS n'attend pas. On dit qu'elles existent, on n'y touche pas.
  const proposables = (equipes ?? []).filter((e) => !galerie.equipesEnPlus.includes(e.id));

  return (
    <View style={s.carte}>
      {fait ? <View style={s.ok}><Text style={s.okTexte}>{fait}</Text></View> : null}

      {!ouvert ? (
        <Bouton
          titre="Modifier la galerie"
          onPress={ouvrir}
          secondaire
          icone={<Ionicons name="create-outline" size={16} color={C.texte} />}
        />
      ) : (
        <View style={{ gap: E.m }}>
          {/* « Nom de la galerie », le libellé de l'OS. Pas « Titre » : la table s'appelle
              `media_albums`, l'utilisateur n'a pas à le savoir — c'est écrit tel quel dans l'OS. */}
          <Champ
            label="Nom de la galerie"
            value={nom}
            onChangeText={setNom}
            placeholder="Tournoi U12, Sens"
          />
          <Bouton
            titre="Enregistrer le nom"
            onPress={renommer}
            enCours={enCours}
            // Un bouton qui n'a rien à enregistrer ne doit pas donner l'impression d'avoir agi.
            desactive={!nom.trim() || nom.trim() === galerie.titre}
          />

          {/* LE TYPE D'ÉVÉNEMENT, ET POURQUOI IL EST ICI PLUTÔT QUE DANS UN SCRIPT.
              Mesuré : `type_evenement` est NULL sur 57 galeries sur 57. Un script de rattrapage
              existe et n'a jamais tourné — et c'est heureux : il aurait écrit « match » partout, y
              compris sur les plateaux d'école de foot, qui ne sont pas des matchs. Le type n'est
              pas une étiquette, il ferme ou ouvre la recherche par dossard des familles. Il se
              choisit donc là où quelqu'un sait, sur la galerie qu'il a sous les yeux. */}
          <Text style={s.sousTitreBloc}>Type d'événement</Text>
          <Text style={s.explication}>
            Il commande la recherche par numéro de dossard dans Connect : elle reste ouverte partout,
            sauf sur un entraînement et un stage, où personne ne porte de numéro.
          </Text>
          <View style={s.typesRangee}>
            {TYPES_EVENEMENT.map((t) => (
              <Pressable
                key={t.cle}
                disabled={enCours}
                onPress={() => choisirType(t.cle === typeChoisi ? null : t.cle)}
                accessibilityRole="button"
                accessibilityState={{ selected: t.cle === typeChoisi, disabled: enCours }}
                accessibilityLabel={
                  t.cle === typeChoisi ? `Retirer le type ${t.libelle}` : `Type ${t.libelle}`
                }
                style={({ pressed }) => [
                  s.typePuce,
                  t.cle === typeChoisi ? s.typePuceChoisie : null,
                  pressed ? { opacity: 0.8 } : null,
                ]}
              >
                <Text style={[s.typeTexte, t.cle === typeChoisi ? s.typeTexteChoisi : null]}>
                  {t.libelle}
                </Text>
              </Pressable>
            ))}
          </View>
          {!typeChoisi ? (
            <Text style={s.explication}>
              Aucun type n'est encore choisi sur cette galerie. Tant qu'il manque, la base traite la
              galerie comme un événement à dossards.
            </Text>
          ) : null}

          <Text style={s.sousTitreBloc}>Catégorie couverte</Text>
          {!galerie.clubId ? (
            <Vide
              titre="Cette galerie n'est rattachée à aucun club"
              texte={
                "Une équipe appartient à un club, et sans club il n'y a pas d'équipe à proposer : "
                + "36 galeries sur 57 sont dans ce cas : un tournoi, un club adverse, une académie. "
                + "Le rattachement à un club se fait dans l'OS."
              }
            />
          ) : lecture ? (
            <View style={s.attentePetite}><ActivityIndicator color={C.accent} /></View>
          ) : proposables.length ? (
            <View style={{ gap: E.xs }}>
              {proposables.map((e) => (
                <Pressable
                  key={e.id}
                  onPress={() => rattacher(e.id === equipeId ? null : e)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: e.id === equipeId }}
                  accessibilityLabel={
                    e.id === equipeId ? `Retirer ${e.nom}` : `Rattacher la galerie à ${e.nom}`
                  }
                  style={({ pressed }) => [
                    s.equipeChoix,
                    e.id === equipeId ? s.equipeChoisie : null,
                    pressed ? { opacity: 0.8 } : null,
                  ]}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.equipeNom} numberOfLines={1}>{e.nom}</Text>
                    {e.categorie ? <Text style={s.equipeAdv}>{e.categorie}</Text> : null}
                  </View>
                  {e.id === equipeId ? (
                    <Ionicons name="checkmark-circle" size={20} color={C.accentClair} />
                  ) : null}
                </Pressable>
              ))}
              {galerie.equipesEnPlus.length ? (
                <Text style={s.explication}>
                  {galerie.equipesEnPlus.length} catégorie
                  {galerie.equipesEnPlus.length > 1 ? "s" : ""} supplémentaire
                  {galerie.equipesEnPlus.length > 1 ? "s" : ""} sont cochée
                  {galerie.equipesEnPlus.length > 1 ? "s" : ""} sur cette galerie. Elles ne sont pas
                  listées ici et ne sont pas modifiées : elles se règlent dans l'OS.
                </Text>
              ) : null}
            </View>
          ) : (
            <Vide
              titre="Aucune équipe active dans ce club"
              texte={
                "Les équipes archivées ne sont pas proposées : rattacher une galerie de samedi à une "
                + "équipe qui n'existe plus n'aiderait personne. Créez l'équipe dans Club+ d'abord."
              }
            />
          )}

          <Erreur message={souci} />

          {/* CE QUI NE SE FERA PAS D'ICI, DIT À L'ENDROIT OÙ ON LE CHERCHERAIT. Publier une galerie
              écrit aux familles (`notifier_publication_galerie`), fixe le barème
              (`bareme_a_la_publication`) et met la galerie en file de reconnaissance : trois
              déclencheurs et une facture. Verser les photos demande les trois dérivés filigranés que
              seul le navigateur sait dessiner. Ni l'un ni l'autre n'est un écran qui manque. */}
          <Text style={s.explication}>
            Verser les photos et publier la galerie restent sur l'ordinateur : chaque photo part avec
            ses trois versions préparées à l'écran, et publier prévient les familles et fixe le tarif.
          </Text>

          <Bouton titre="Fermer" onPress={() => setOuvert(false)} secondaire />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  titre: { color: C.texte, fontFamily: P.titre, fontSize: T.titreEcran, letterSpacing: -0.6 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: T.sousEcran, lineHeight: T.sousEcranHauteur },
  attente: { paddingVertical: E.xl * 2, alignItems: "center" },

  carte: {
    gap: E.s, padding: E.m, borderRadius: R.l,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
    // La carte entière est la cible : au bord d'un terrain, on ne vise pas un chevron.
    minHeight: TOUCHE + E.m * 2,
  },
  ligne: { flexDirection: "row", alignItems: "center", gap: E.s },
  nom: { color: C.texte, fontFamily: P.titreFort, fontSize: 16 },
  detail: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
  compte: { color: C.texteFaible, fontFamily: P.texteMoyen, fontSize: 12 },
  pastilles: { flexDirection: "row", flexWrap: "wrap", gap: E.xs, alignItems: "center" },

  retour: {
    flexDirection: "row", alignItems: "center", gap: 2,
    alignSelf: "flex-start", minHeight: TOUCHE, paddingRight: E.s,
  },
  retourTexte: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 14.5 },

  // Les valeurs de l'écran d'affectation, sans une variation : c'est le même geste (une carte qui
  // s'ouvre sur une action) et il ne doit pas se dessiner de deux façons.
  attentePetite: { paddingVertical: E.l, alignItems: "center" },
  sousTitreBloc: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 13 },
  explication: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5, lineHeight: 18 },
  ok: {
    borderRadius: R.m, paddingVertical: E.s, paddingHorizontal: E.m,
    backgroundColor: "rgba(18,183,106,.12)", borderWidth: 1, borderColor: "rgba(18,183,106,.32)",
  },
  okTexte: { color: C.succesTexte, fontFamily: P.texteFort, fontSize: 13 },

  // Un rappel, pas une alarme : il dit un travail à faire, pas une panne. D'où le ton d'alerte
  // discret plutôt que le rouge de `Erreur`, qui annoncerait que quelque chose est cassé.
  rappel: {
    borderRadius: R.m, paddingVertical: E.s, paddingHorizontal: E.m,
    backgroundColor: "rgba(247,144,9,.10)", borderWidth: 1, borderColor: "rgba(247,144,9,.30)",
  },
  rappelTexte: { color: C.alerte, fontFamily: P.texte, fontSize: 12.5, lineHeight: 18 },

  equipeLigne: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    paddingVertical: E.xs, paddingHorizontal: E.s,
    borderRadius: R.s, backgroundColor: C.surfaceHaute,
  },
  equipeNom: { color: C.texte, fontFamily: P.texteFort, fontSize: 13.5, flexShrink: 1 },
  equipeAdv: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12, flexShrink: 1 },
  equipeChoix: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    // La cible fait TOUCHE : on choisit une équipe au bord d'un terrain, avec des gants parfois.
    minHeight: TOUCHE, paddingHorizontal: E.m, borderRadius: R.m,
    backgroundColor: C.surfaceHaute, borderWidth: 1, borderColor: C.bordure,
  },
  equipeChoisie: { backgroundColor: "rgba(36,84,255,.20)", borderColor: "rgba(36,84,255,.55)" },

  // Six types tiennent sur deux rangées d'un téléphone : on les pose tous, plutôt qu'un menu
  // déroulant qui cacherait le choix derrière un geste de plus.
  typesRangee: { flexDirection: "row", flexWrap: "wrap", gap: E.xs },
  typePuce: {
    // La même cible que les équipes : TOUCHE de haut, parce que c'est le même doigt.
    minHeight: TOUCHE, justifyContent: "center", paddingHorizontal: E.m, borderRadius: R.m,
    backgroundColor: C.surfaceHaute, borderWidth: 1, borderColor: C.bordure,
  },
  typePuceChoisie: { backgroundColor: "rgba(36,84,255,.20)", borderColor: "rgba(36,84,255,.55)" },
  typeTexte: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 13.5 },
  typeTexteChoisi: { color: C.texte },

  grille: { flexDirection: "row", flexWrap: "wrap", gap: E.xs },
  vignette: { width: "100%", height: "100%", borderRadius: R.s, backgroundColor: C.surfaceHaute },

  suite: {
    minHeight: TOUCHE, alignItems: "center", justifyContent: "center",
    borderRadius: R.l, borderWidth: 1, borderColor: C.bordureForte,
    backgroundColor: "rgba(255,255,255,.05)",
  },
  suiteTexte: { color: C.texte, fontFamily: P.texteFort, fontSize: 14 },
  souci: { color: C.dangerTexte, fontFamily: P.texte, fontSize: 13, lineHeight: 19 },

  plein: {
    flex: 1, alignItems: "center", justifyContent: "center",
    // Le fond de la marque, opaque a 95 % : la photo se lit sans que l'ecran change de couleur.
    backgroundColor: C.fond + "F2", padding: E.m,
  },
  // Le fond qui ferme, sous la photo et sous les boutons.
  pleinFond: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  pleinBarre: { alignSelf: "stretch", gap: E.s, marginTop: E.m },

  // ── Le tri par club et par equipe (01/10/2026) ──
  groupe: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    // La rangee entiere est la cible : on ouvre un groupe avec le pouce, pas avec le chevron.
    minHeight: TOUCHE, paddingHorizontal: E.m, paddingVertical: E.xs,
    borderRadius: R.m, backgroundColor: C.surfaceHaute, borderWidth: 1, borderColor: C.bordure,
  },
  groupeNom: { color: C.texte, fontFamily: P.titreFort, fontSize: 14.5 },
  groupeDetail: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12 },

  // ── Les ventes ──
  tuiles: { flexDirection: "row", flexWrap: "wrap", gap: E.s },
  tuile: {
    // Deux par ligne sur 402 points : quatre cases cote a cote tronquent « Chiffre d'affaires ».
    flexGrow: 1, flexBasis: "46%", gap: 3,
    padding: E.m, borderRadius: R.m,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  tuileTitre: {
    color: C.texteFaible, fontFamily: P.texteFort, fontSize: T.etiquette,
    textTransform: "uppercase", letterSpacing: 0.6,
  },
  tuileValeur: { color: C.texte, fontFamily: P.titre, fontSize: 21, letterSpacing: -0.4 },
  tuileSous: { color: C.texteFaible, fontFamily: P.texte, fontSize: 11.5 },
  ligneVente: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    minHeight: TOUCHE, paddingVertical: E.xs, paddingHorizontal: E.m,
    borderRadius: R.m, backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  venteNom: { color: C.texte, fontFamily: P.texteFort, fontSize: 13.5 },
  venteDetail: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12, lineHeight: 17 },
  venteMontant: { color: C.texteDoux, fontFamily: P.titreFort, fontSize: 14 },

});
