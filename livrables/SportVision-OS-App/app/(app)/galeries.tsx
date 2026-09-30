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
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { Ecran, Probleme, Section, Vide } from "../../src/ui/Ecran";
import { Bouton, Champ, Erreur, Pastille } from "../../src/ui/Base";
import { Barre } from "../../src/ui/Barre";
import {
  creerGaleriesMission, lireEquipesDeMission, lireEquipesDuClub, lireGaleriesDeMission,
  lireGaleriesParMission,
  lireMesGaleries, lirePhotosGalerie, rattacherEquipe, renommerGalerie,
  type EquipeDeMission, type EquipeDuClub, type Galerie, type PhotoGalerie,
} from "../../src/lib/os-galeries";
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

function ListeGaleries({ surOuvrir }: { surOuvrir: (g: Galerie) => void }) {
  const { moi } = useSession();
  // LE SEUL TEST DE MÉTIER DE CET ÉCRAN, ET IL NE BORNE AUCUNE LECTURE. Il décide de l'existence
  // d'un onglet dont TOUTES les actions seraient refusées à un opérateur : `creer_galeries_mission`
  // lève 42501 pour un profil `photo`, mesuré. Règle 5 : on n'affiche pas un bouton qui refuse.
  // Le périmètre de pôle, lui, n'est pas retesté : `v_production_missions` se termine par
  // `WHERE is_staff() AND pole_scope_ok(p.pole_id)`, une mission lue est déjà dans le pôle.
  const production = estProduction(moi?.role ?? null);
  const [onglet, setOnglet] = useState<"galeries" | "missions">("galeries");

  // `useDonnees` et pas un `useState` : au retour d'une galerie, la liste est déjà là. Un écran
  // qu'on quitte et qu'on retrouve ne doit jamais remontrer sa roue.
  const { donnees, chargement, rafraichissement, erreur, relire } =
    useDonnees<Galerie[]>("os:galeries", lireMesGaleries);

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
  const missions = mission.donnees?.missions ?? [];
  const parMission = mission.donnees?.parMission ?? new Map<string, number>();
  const sansGalerie = useMemo(
    () => missions.filter((m) => !parMission.get(m.id)).length,
    [missions, parMission],
  );

  /** Après une création, la liste des galeries ET le compte par mission sont faux d'un coup. */
  const toutRelire = useCallback(() => {
    oublier("os:galeries");
    relire();
    mission.relire();
    // `mission.relire` est stable (useCallback) ; `mission`, non : le mettre en dépendance
    // referait ce rappel à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relire, mission.relire]);

  return (
    <Ecran
      enCours={!!donnees && rafraichissement}
      teinte="violet"
      rafraichir={onglet === "missions" ? toutRelire : relire}
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
      {production ? (
        <Barre
          choix={[
            { cle: "galeries", libelle: "Galeries", n: liste.length },
            { cle: "missions", libelle: "Missions", n: sansGalerie },
          ]}
          actif={onglet}
          surChoix={(c) => setOnglet(c as "galeries" | "missions")}
        />
      ) : null}

      {onglet === "missions" ? (
        <OngletMissions
          missions={missions}
          parMission={parMission}
          chargement={mission.chargement}
          erreur={mission.erreur}
          relire={toutRelire}
        />
      ) : chargement ? (
        <View style={s.attente}><ActivityIndicator color={C.accent} /></View>
      ) : erreur && !donnees ? (
        <Probleme surReessayer={relire} />
      ) : liste.length ? (
        <View style={{ gap: E.s }}>
          {liste.map((g) => <CarteGalerie key={g.id} g={g} surOuvrir={() => surOuvrir(g)} />)}
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
  const detail = [g.date ? dateLongue(g.date) : null, g.reference].filter(Boolean).join(" · ");
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
      </View>
    </Pressable>
  );
}

// ── Une galerie ─────────────────────────────────────────────────────────────────────────────

/** Soixante par page : la plus grosse galerie réelle compte 431 photos. */
const PAR_PAGE = 60;

function UneGalerie({ galerie, surRetour }: { galerie: Galerie; surRetour: () => void }) {
  const [photos, setPhotos] = useState<PhotoGalerie[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [enCours, setEnCours] = useState(true);
  const [panne, setPanne] = useState(false);
  const [agrandie, setAgrandie] = useState<PhotoGalerie | null>(null);
  // LE TITRE ET LA CATÉGORIE VIVENT ICI PENDANT LA VISITE. La liste derrière est en cache, et
  // revenir dessus la relira ; mais rester sur une galerie qu'on vient de renommer en lisant
  // l'ancien nom, c'est croire que l'enregistrement a échoué.
  const [titre, setTitre] = useState(galerie.titre);
  const [categorie, setCategorie] = useState(galerie.categorie);

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
      </View>

      <PanneauGalerie
        galerie={galerie}
        surRenommee={setTitre}
        surEquipe={setCategorie}
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
        <Pressable
          onPress={() => setAgrandie(null)}
          accessibilityRole="button"
          accessibilityLabel="Fermer la photo"
          style={s.plein}
        >
          {agrandie ? (
            <Image
              source={{ uri: agrandie.url }}
              style={{ width: "100%", aspectRatio: agrandie.ratio }}
              contentFit="contain"
              transition={120}
            />
          ) : null}
        </Pressable>
      </Modal>
    </Ecran>
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
  galerie, surRenommee, surEquipe,
}: {
  galerie: Galerie;
  surRenommee: (titre: string) => void;
  surEquipe: (nom: string | null) => void;
}) {
  const { moi } = useSession();
  const production = estProduction(moi?.role ?? null);
  const [ouvert, setOuvert] = useState(false);
  const [nom, setNom] = useState(galerie.titre);
  const [equipes, setEquipes] = useState<EquipeDuClub[] | null>(null);
  const [equipeId, setEquipeId] = useState(galerie.equipeId);
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
});
