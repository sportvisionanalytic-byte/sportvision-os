// L'ESPACE CLUB : TROIS ÉCRANS NATIFS, ET LE WEB POUR LE RESTE (30/09/2026).
//
// == CE QUI A CHANGÉ, ET POURQUOI =============================================================
//
// Fouka, trois fois, la dernière en insistant : « on dirait trop encore le site web collé sur
// l'app, alors que par rapport à Connect, je veux la même fluidité, la même DA. Il faut que ce soit
// beau visuellement, bien propre, bien construit, bien calé. » Puis, quand je lui ai demandé ce qui
// comptait : « les couleurs, la typo, l'espacement ».
//
// LE 29/09, J'AI TRAITÉ ÇA COMME UN PROBLÈME DE COQUE : une barre d'onglets native, un menu natif,
// un profil natif autour d'une vue web. C'était mieux, et ça n'a pas suffi — normal : ce qu'on
// REGARDE restait une page web. La cause est structurelle, pas cosmétique. Tous les écrans de
// Connect sont natifs et lisent la base directement ; Club+ arrivait dans une fenêtre. Aucune
// retouche du cadre ne rattrape ça.
//
// DONC : les trois destinations quotidiennes — Accueil, Calendrier, Équipes, celles que Fouka a
// choisies lui-même — sont maintenant des écrans natifs, écrits avec les MÊMES briques et les MÊMES
// jetons que l'espace personnel (`Ecran`, `Section`, `Prochain`, `CarteEvenement`, `MoisGrille`,
// `C` / `E` / `R` / `P`). Le reste — Communication, Galeries, Contrats, Factures, Paramètres — reste
// servi par Club+ dans la vue web.
//
// == CE QU'ON NE REFAIT PAS ICI ===============================================================
//
// Les DROITS. Qui peut voir quoi, selon le plan, le type d'organisation et le rôle : ça reste dans
// Club+ et dans les policies de la base. Les écrans natifs lisent les mêmes tables que le site avec
// la session de la personne : c'est la RLS qui tranche, ici comme là-bas. Rien n'est réinterprété,
// et une section web ouverte sans droit affiche son propre cadenas, décidé par le site.
//
// L'ÉCRITURE. On lit en natif, on modifie dans Club+. Chaque écran porte un lien explicite vers la
// page qui permet de créer et de corriger. Refaire les formulaires ici, ce serait entretenir deux
// versions de chaque règle métier, et le jour où elles divergent personne ne sait laquelle fait foi.
//
// == LE REPLI, ET IL COMPTE ===================================================================
//
// Un CM SportVision affilié n'a PAS forcément de ligne dans `club_members` : son périmètre passe par
// `cm_clubs_autorises()`. `lireMesClubs()` lui rend donc une liste vide, et les écrans natifs
// n'auraient rien à montrer. Dans ce cas on sert Club+ dans la vue web, exactement comme avant :
// c'est le comportement connu, qui marche. Un écran natif vide serait une régression déguisée en
// modernisation.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { VueConnect, type PoigneeVueConnect } from "../src/ui/VueConnect";
import {
  cookiesClubPlusDisponibles, marquerCookiesClubPlusPoses, oublierCookiesClubPlus,
  sourceClubPlus, sourceClubPlusDirecte, type SourceConnect,
} from "../src/lib/connect";
import { ADRESSES, oublierPorte, type Porte } from "../src/lib/espaces";
import { useSession } from "../src/lib/session";
import { CHEMINS_NATIFS, libelleDuChemin, navigationDuClub } from "../src/lib/navigation-club";
import {
  libelleRole, lireEquipes, lireMembres, lireMesClubs,
  type EquipeDuClub, type MembreDuClub, type MonClub,
} from "../src/lib/club";
import { lireEvenements, type Evenement } from "../src/lib/donnees";
import { cleEvenements, oublier, useDonnees } from "../src/lib/cache";
import { AccueilClub } from "../src/ui/club/AccueilClub";
import { CalendrierClub } from "../src/ui/club/CalendrierClub";
import { EquipesClub } from "../src/ui/club/EquipesClub";
import { ResultatMatch } from "../src/ui/club/ResultatMatch";
import { MonProfil } from "../src/ui/club/MonProfil";
import { GaleriesClub } from "../src/ui/club/GaleriesClub";
import { lireMonProfil, type MonProfil as Profil } from "../src/lib/club-profil";
import { C, E, R, TOUCHE } from "../src/theme/couleurs";
import { P } from "../src/theme/polices";

const TITRES: Record<Exclude<Porte, "personnel">, string> = {
  club: "Espace club",
  sportvision: "Équipe de production",
};

export default function EspaceWeb() {
  const { porte } = useLocalSearchParams<{ porte?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const vue = useRef<PoigneeVueConnect>(null);
  const { session, profil, deconnexion, chargement: sessionEnCours } = useSession();

  const cle: Exclude<Porte, "personnel"> = porte === "sportvision" ? "sportvision" : "club";
  // La coque à onglets est celle de Club+. L'espace de production garde la vue simple : ses écrans
  // n'ont pas la même charpente, et lui inventer une navigation qui ne colle pas serait pire.
  const avecOnglets = cle === "club";
  const racine = `${ADRESSES[cle]}/clubplus`;

  const [source, setSource] = useState<SourceConnect | null>(null);
  const [panne, setPanne] = useState(false);
  const [charge, setCharge] = useState(false);
  const [peutReculer, setPeutReculer] = useState(false);
  const [menuOuvert, setMenuOuvert] = useState(false);
  const [profilOuvert, setProfilOuvert] = useState(false);
  /** Le match dont on regarde ou saisit le résultat. `null` : la feuille est fermée. */
  const [matchOuvert, setMatchOuvert] = useState<string | null>(null);
  /** L'édition de son profil, en natif. */
  const [profilEdition, setProfilEdition] = useState(false);
  /**
   * Une SECTION du menu que l'application sait dessiner elle-même, hors des trois onglets.
   *
   * « Galeries » en est une : elle est dans le menu de cinq rôles, jamais dans les onglets, et
   * c'est l'écran le plus visuel de l'espace club. Une page web encadrée y perd le plus.
   */
  const [sectionNative, setSectionNative] = useState<string | null>(null);

  /**
   * La section web affichée, ou `null` quand on est sur un écran natif.
   *
   * En ref AUSSI, parce que `surAdresse` est appelée par la vue web : elle doit savoir si le web est
   * visible sans se recréer à chaque changement, sinon on repose un écouteur à chaque navigation.
   */
  const [cheminWeb, setCheminWeb] = useState<string | null>(null);
  const cheminWebRef = useRef<string | null>(null);
  useEffect(() => { cheminWebRef.current = cheminWeb; }, [cheminWeb]);

  /** L'écran natif ouvert, par son chemin Club+ : « /dashboard », « /calendar » ou « /teams ». */
  const [ongletNatif, setOngletNatif] = useState("/dashboard");

  // == LES DONNÉES DU CLUB ====================================================================
  const mesClubs = useDonnees<MonClub[]>(
    session && avecOnglets ? "club:mes-clubs" : null,
    lireMesClubs,
    [session?.user?.id, avecOnglets],
  );
  const clubs = mesClubs.donnees ?? [];
  const [clubChoisi, setClubChoisi] = useState<string | null>(null);
  const club = clubs.find((c) => c.id === clubChoisi) ?? clubs[0] ?? null;

  const evs = useDonnees<Evenement[]>(
    club ? cleEvenements(false, club.id) : null,
    () => lireEvenements(club!.id),
    [club?.id],
  );
  const eqs = useDonnees<EquipeDuClub[]>(
    club ? `club:equipes:${club.id}` : null,
    () => lireEquipes(club!.id),
    [club?.id],
  );
  const mbs = useDonnees<MembreDuClub[]>(
    club ? `club:membres:${club.id}` : null,
    () => lireMembres(club!.id),
    [club?.id],
  );

  /**
   * Le profil du compte, pour le « Bonjour ». Il prime sur ce que le club a saisi : quelqu'un qui
   * corrige son prénom doit le voir changer, sinon il croit que rien n'a marché.
   */
  const moi = useDonnees<Profil | null>(
    session ? `club:profil:${session.user?.id}` : null,
    () => lireMonProfil({ prenom: club?.monPrenom, nom: null }),
    [session?.user?.id, club?.monPrenom],
  );
  const monPrenom = (moi.donnees?.prenom || club?.monPrenom || "").trim();

  const rechargerClub = useCallback(() => {
    mesClubs.relire(); evs.relire(); eqs.relire(); mbs.relire(); moi.relire();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesClubs.relire, evs.relire, eqs.relire, mbs.relire, moi.relire]);

  /**
   * On sert du natif quand on a un club à montrer, et seulement là.
   *
   * Tant que la liste des clubs n'a pas répondu, on ne décide rien : ouvrir la vue web pour la
   * refermer 150 ms plus tard ferait clignoter l'écran au lancement, et poserait la session de
   * Club+ pour rien.
   */
  const clubsConnus = mesClubs.donnees !== undefined || !!mesClubs.erreur;
  const natifPossible = avecOnglets && !!club;
  const afficheNatif = natifPossible && cheminWeb === null && sectionNative === null;
  /**
   * ON NE SAIT PAS ENCORE, ET ON NE FAIT PAS SEMBLANT (30/09/2026).
   *
   * Vu sur le simulateur avec une vraie session de coach : pendant la seconde où la liste des clubs
   * arrive, l'écran affichait la barre du haut de la vue web — chevron, « Espace club », roue —
   * puis elle disparaissait d'un coup quand l'accueil natif prenait la main. C'est-à-dire qu'on
   * montrait exactement le site encadré que toute cette refonte enlève, à chaque ouverture.
   *
   * Tant qu'on ne sait pas, on ne montre ni l'un ni l'autre : une roue sur le fond, et rien de plus.
   */
  const enAttenteDeClub = avecOnglets && !!session && !sessionEnCours && !clubsConnus;

  /**
   * LA NAVIGATION DE CETTE PERSONNE, ET PAS CELLE DE L'ADMINISTRATEUR (30/09/2026).
   *
   * Avant, tout le monde recevait les dix-neuf entrées du menu admin. Un coach y voyait Factures,
   * Contrats, Paramètres, Sponsors, Invitations — que Club+ ne lui montre jamais — et il lui
   * manquait Matchs & résultats, Notifications et Mon profil, qui sont dans le sien.
   *
   * Tant que le club n'a pas répondu, `club` est nul et la fonction rend le menu complet. Ce n'est
   * jamais visible : l'écran affiche une roue tant que `clubsConnus` est faux.
   */
  const nav = useMemo(
    () => navigationDuClub(club?.role ?? null, club?.equipes ?? []),
    [club?.role, club?.equipes],
  );

  const changerEspace = useCallback(async () => {
    await oublierPorte();
    router.replace("/bienvenue");
  }, [router]);

  // LE CHEMIN COURT, ET SON REPLI. Une fois les cookies posés, la page s'ouvre directement : un
  // aller-retour au lieu de trois. On ne devine pas s'ils tiennent encore — si Club+ renvoie vers
  // sa page de connexion, on refait le pont (voir surAdresse). Le pire cas est l'ancien
  // comportement, jamais une impasse.
  const preparer = useCallback(async (cheminVoulu: string, forcerLePont = false) => {
    setPanne(false); setCharge(false); setSource(null);
    if (!forcerLePont && cookiesClubPlusDisponibles()) {
      setSource(sourceClubPlusDirecte(cheminVoulu));
      return;
    }
    const s = await sourceClubPlus(cheminVoulu);
    if (s) setSource(s);
    // Pas de source : c'est que la session n'est pas lisible. L'écran de reconnexion est piloté par
    // `session`, plus par un état local — voir plus bas.
  }, []);

  /**
   * ON N'OUVRE PLUS LA VUE WEB AU LANCEMENT (30/09/2026).
   *
   * Avant, `preparer()` partait au montage : la vue web était donc toujours créée, même pour
   * quelqu'un qui n'allait consulter que son calendrier. On la crée maintenant au premier besoin
   * réel. Le seul cas qui l'exige d'emblée : quand le natif n'a rien à montrer (espace de
   * production, ou compte sans ligne `club_members`).
   */
  useEffect(() => {
    if (sessionEnCours || !session) return;
    if (avecOnglets && !clubsConnus) return;      // on attend de savoir
    if (natifPossible) return;                     // le natif prend la main
    if (source || cheminWeb !== null) return;      // déjà fait
    setCheminWeb("/dashboard");
    preparer("/dashboard");
  }, [sessionEnCours, session, avecOnglets, clubsConnus, natifPossible, source, cheminWeb, preparer]);

  // CLUB+ RENVOIE VERS SA PAGE DE CONNEXION QUAND IL NE RECONNAÎT PLUS LA SESSION. Premier renvoi :
  // les cookies ont expiré, on refait le pont. Second : c'est une déconnexion voulue — on oublie
  // l'espace mémorisé et on ramène au choix, sinon l'application rouvrirait Club+ au lancement
  // suivant et le pont l'y reconnecterait, ce qui rendrait la déconnexion impossible.
  const dejaRefait = useRef(false);
  const surAdresse = useCallback((url: string) => {
    const apresRacine = url.startsWith(racine) ? url.slice(racine.length) : "";
    // On suit la navigation interne au site pour le titre de la barre — mais JAMAIS au point de
    // ramener quelqu'un sur le web alors qu'il regarde un écran natif.
    if (apresRacine) {
      const propre = apresRacine.split("?")[0] || "/dashboard";
      setCheminWeb((avant) => (avant === null ? null : propre));
    }
    if (!url.includes("/auth/login") && !url.includes("/clubplus/login")) {
      // Une page de Club+ atteinte hors de /auth/ : les cookies sont posés, le raccourci vaut.
      if (url.startsWith(ADRESSES[cle]) && !url.includes("/auth/")) marquerCookiesClubPlusPoses();
      return;
    }
    oublierCookiesClubPlus();
    if (dejaRefait.current) {
      // Deux renvois d'affilée : la session ne vaut plus rien côté site. On ne jette dehors que si
      // la personne REGARDE le web. Sinon la vue est cachée derrière un écran natif parfaitement
      // valide, et la sortir de là serait incompréhensible.
      if (cheminWebRef.current !== null) changerEspace();
      return;
    }
    dejaRefait.current = true;
    preparer(cheminWebRef.current ?? "/dashboard", true);
  }, [preparer, changerEspace, racine, cle]);

  /**
   * Ouvrir une page DANS CLUB+, sans discuter.
   *
   * Elle existe séparément d'`allerWeb` à cause d'un piège que je me suis tendu : l'écran natif des
   * galeries porte un lien « identifier les joueurs sur les photos », qui vise `/galeries`. Passé
   * par `allerWeb`, ce chemin est intercepté et rouvre… l'écran natif. Le bouton n'aurait rien
   * fait, sans erreur, sans trace. Une fonction qui intercepte et une fonction qui obéit, ce ne
   * sont pas les mêmes, et les confondre se paie toujours.
   */
  const ouvrirDansClubPlus = useCallback((c: string) => {
    setMenuOuvert(false);
    setSectionNative(null);
    setCheminWeb(c);
    if (source) vue.current?.allerA(`${racine}${c}`);
    else preparer(c);
  }, [racine, source, preparer]);

  /**
   * Ouvrir une destination du menu — en natif quand l'application sait la dessiner, sinon dans
   * Club+. C'est ici, et nulle part ailleurs, qu'un écran devient natif : les tables de navigation
   * restent la copie exacte de celles du site.
   */
  const allerWeb = useCallback((c: string) => {
    setMenuOuvert(false);
    if (c === "/settings/profile") { setProfilEdition(true); return; }
    if (natifPossible && c === "/galeries") { setCheminWeb(null); setSectionNative("/galeries"); return; }
    ouvrirDansClubPlus(c);
  }, [natifPossible, ouvrirDansClubPlus]);

  /**
   * Ouvrir une destination : en natif quand l'application sait la dessiner, sinon dans Club+.
   *
   * Un onglet de trésorier — « Factures », « Contrats » — passe donc par la vue web, et c'est
   * exactement ce que Fouka a choisi le 30/09 : la barre du bas suit le rôle, même quand deux de
   * ses trois entrées sont servies par le site.
   */
  const allerOnglet = useCallback((chemin: string) => {
    if (natifPossible && CHEMINS_NATIFS.has(chemin)) {
      setMenuOuvert(false);
      setSectionNative(null);
      setOngletNatif(chemin);
      setCheminWeb(null);
      return;
    }
    allerWeb(chemin);
  }, [natifPossible, allerWeb]);

  // L'onglet allumé. Sur le web, on prend le chemin le PLUS LONG qui corresponde : « /teams/12 »
  // allume « Mon équipe », et pas « Accueil » au prétexte que les deux commencent par « / ».
  const ongletActif = afficheNatif
    ? ongletNatif
    : nav.onglets
        .filter((o) => (cheminWeb ?? "").startsWith(o.chemin))
        .sort((a, b) => b.chemin.length - a.chemin.length)[0]?.chemin;

  // == PAS DE SESSION ========================================================================
  if (sessionEnCours) {
    return (
      <View style={[s.centre, { backgroundColor: C.fond }]}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }
  if (!session) {
    return (
      <View style={{ flex: 1, backgroundColor: C.fond }}>
        <View style={[s.centre, { paddingTop: insets.top }]}>
          <Text style={s.grosTexte}>Vous n'êtes plus connecté</Text>
          <Text style={s.petitTexte}>Reconnectez-vous et cet espace s'ouvrira sans rien redemander.</Text>
          {/* SE CONNECTER, ET C'EST LA SORTIE QUI MANQUAIT LE 29/09. Le seul bouton proposé ramenait
              au choix d'espace, d'où « Espace club » renvoyait ici : une boucle fermée, sans aucun
              endroit pour saisir son mot de passe. Un écran qui dit « reconnectez-vous » doit porter
              le moyen de le faire. */}
          <Pressable
            accessibilityRole="button" accessibilityLabel="Se connecter"
            onPress={() => router.replace("/connexion")}
            style={({ pressed }) => [s.action, pressed ? { opacity: 0.85 } : null]}
          >
            <Text style={s.actionTexte}>Se connecter</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button" accessibilityLabel="Choisir mon espace"
            onPress={changerEspace}
            style={({ pressed }) => [s.lien, pressed ? { opacity: 0.85 } : null]}
          >
            <Text style={s.lienTexte}>Choisir mon espace</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.fond }}>
      {/* LA BARRE DU HAUT N'EXISTE QUE POUR LE WEB. Les écrans natifs portent leur propre titre,
          comme dans l'espace personnel : un bandeau au-dessus d'un écran natif, c'est exactement
          l'empilement qui donnait l'impression d'un site encadré. */}
      {!afficheNatif && !enAttenteDeClub ? (
        <View style={[s.barre, { paddingTop: insets.top + 6 }]}>
          {/* Le retour suit la page ; quand elle n'a plus d'historique, il ramène là d'où l'on vient
              — l'écran natif si on en a un, l'accueil du club sinon. Un bouton grisé n'est pas une
              sortie. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={peutReculer ? "Retour" : natifPossible ? "Revenir à mon club" : "Revenir à l'accueil du club"}
            onPress={() => {
              if (sectionNative) { setSectionNative(null); return; }
              if (peutReculer) { vue.current?.reculer(); return; }
              if (natifPossible) { setCheminWeb(null); return; }
              allerWeb("/dashboard");
            }}
            hitSlop={10}
            style={s.boutonBarre}
          >
            <Ionicons name="chevron-back" size={20} color={C.texte} />
          </Pressable>

          {/* PAS DE TITRE EN DOUBLE (30/09/2026). Un écran natif porte son grand titre lui-même,
              comme tous ceux de l'espace personnel ; la barre n'a alors qu'à porter la sortie. Vu
              sur le simulateur : « Galeries » était écrit deux fois, à dix pixels l'un de l'autre.
              Pour une page web, la barre reste le seul endroit qui peut nommer ce qu'on regarde. */}
          <Text style={s.titre} numberOfLines={1}>
            {sectionNative ? "" : avecOnglets ? libelleDuChemin(nav, cheminWeb ?? "/dashboard") : TITRES[cle]}
          </Text>

          {/* La sortie de l'espace, présente DANS TOUS LES CAS (leçon du 30/09 : elle ne
              s'affichait qu'avec la barre d'onglets, et l'espace de production n'avait donc aucune
              issue). Aucun écran de cette application ne se garde sans sortie. */}
          <Pressable
            accessibilityRole="button" accessibilityLabel="Mon compte"
            onPress={() => setProfilOuvert(true)} hitSlop={10} style={s.boutonBarre}
          >
            <Ionicons name="person-circle-outline" size={23} color={C.texteDoux} />
          </Pressable>
        </View>
      ) : null}

      {/* == LES SECTIONS NATIVES, hors onglets ============================================ */}
      {sectionNative === "/galeries" && club ? (
        <View style={{ flex: 1 }}>
          <GaleriesClub clubId={club.id} clubNom={club.nom} surWeb={ouvrirDansClubPlus} />
        </View>
      ) : null}

      {/* == LES ÉCRANS NATIFS ============================================================== */}
      {afficheNatif && club ? (
        <View style={{ flex: 1 }}>
          {ongletNatif === "/calendar" ? (
            <CalendrierClub
              club={club}
              evenements={evs.donnees ?? []}
              chargement={evs.chargement}
              panne={!!evs.erreur && evs.donnees === undefined}
              surRecharger={rechargerClub}
              surWeb={allerWeb}
              surMatch={(e) => setMatchOuvert(e.id)}
            />
          ) : ongletNatif === "/teams" ? (
            <EquipesClub
              club={club}
              titre={nav.onglets.find((o) => o.chemin === "/teams")?.libelle ?? "Équipes"}
              equipes={eqs.donnees ?? []}
              chargement={eqs.chargement}
              panne={!!eqs.erreur && eqs.donnees === undefined}
              surRecharger={rechargerClub}
              surWeb={allerWeb}
            />
          ) : (
            <AccueilClub
              club={club}
              clubs={clubs}
              nav={nav}
              prenom={monPrenom}
              evenements={evs.donnees ?? []}
              equipes={eqs.donnees ?? []}
              membres={mbs.donnees ?? []}
              chargement={evs.chargement || eqs.chargement}
              panne={!!evs.erreur && evs.donnees === undefined}
              surRecharger={rechargerClub}
              surChangerDeClub={setClubChoisi}
              surOnglet={allerOnglet}
              surWeb={allerWeb}
              surProfil={() => setProfilOuvert(true)}
            />
          )}
        </View>
      ) : null}

      {/* == LA VUE WEB ====================================================================
          Elle n'est créée qu'au premier besoin, puis on la GARDE : la masquer coûte zéro et évite
          de recharger la page à chaque aller-retour avec un écran natif. `pointerEvents` bloque les
          touches d'une vue cachée, qui sinon captent les gestes par-dessus l'écran natif. */}
      {source ? (
        <View
          style={{ flex: afficheNatif ? 0 : 1, display: afficheNatif ? "none" : "flex" }}
          pointerEvents={afficheNatif ? "none" : "auto"}
        >
          {panne ? (
            <View style={s.centre}>
              <Text style={s.grosTexte}>La page n'a pas répondu</Text>
              <Text style={s.petitTexte}>
                Vérifiez votre connexion. Rien n'est perdu, vos données sont sur nos serveurs.
              </Text>
              <Pressable
                accessibilityRole="button" accessibilityLabel="Réessayer"
                onPress={() => { dejaRefait.current = false; preparer(cheminWeb ?? "/dashboard"); }}
                style={({ pressed }) => [s.action, pressed ? { opacity: 0.85 } : null]}
              >
                <Text style={s.actionTexte}>Réessayer</Text>
              </Pressable>
            </View>
          ) : (
            <VueConnect
              ref={vue}
              source={source}
              surHistorique={setPeutReculer}
              surAdresse={surAdresse}
              surChargement={() => setCharge(true)}
              surPanne={() => { setCharge(true); setPanne(true); }}
            />
          )}
        </View>
      ) : null}

      {enAttenteDeClub ? (
        <View style={[s.attente, { top: 0 }]} pointerEvents="none"><ActivityIndicator color={C.accent} /></View>
      ) : !afficheNatif && !sectionNative && !charge && !panne ? (
        /* LE VOILE D'ATTENTE EST CELUI DE LA VUE WEB, ET DE RIEN D'AUTRE (30/09/2026). Sans
           `!sectionNative`, il se posait par-dessus l'écran natif des galeries : la barre disait
           « Galeries », et dessous une roue tournait indéfiniment sur un écran qui, lui, était
           déjà chargé. Vu sur le simulateur, invisible en relisant le code. */
        <View style={s.attente} pointerEvents="none"><ActivityIndicator color={C.accent} /></View>
      ) : null}

      {/* LA BARRE D'ONGLETS. Trois destinations quotidiennes et un menu : au-delà, les libellés se
          coupent et l'onglet actif devient difficile à lire — même règle que l'espace personnel. */}
      {avecOnglets ? (
        <View style={[s.onglets, { paddingBottom: insets.bottom || E.s }]}>
          {nav.onglets.map((o) => {
            const actif = ongletActif === o.chemin;
            return (
              <Pressable
                key={o.chemin}
                accessibilityRole="tab"
                accessibilityState={{ selected: actif }}
                accessibilityLabel={o.libelle}
                onPress={() => allerOnglet(o.chemin)}
                style={s.onglet}
              >
                <Ionicons name={o.icone as never} size={21} color={actif ? C.accentClair : C.texteDoux} />
                <Text
                  style={[s.ongletTexte, actif ? { color: C.accentClair } : null]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                >
                  {o.court ?? o.libelle}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="button" accessibilityLabel="Ouvrir le menu"
            onPress={() => setMenuOuvert(true)} style={s.onglet}
          >
            <Ionicons name="grid-outline" size={21} color={menuOuvert ? C.accentClair : C.texteDoux} />
            <Text style={[s.ongletTexte, menuOuvert ? { color: C.accentClair } : null]}>Menu</Text>
          </Pressable>
        </View>
      ) : null}

      {/* LA SAISIE DU RÉSULTAT. Elle vit ici et pas dans une route à part : l'espace club est un
          seul écran, avec une seule session et une seule vue web. Une route de plus repartirait de
          zéro sur les deux. */}
      {club ? (
        <ResultatMatch
          matchId={matchOuvert}
          clubNom={club.nom}
          clubLogoUrl={club.logoUrl}
          surFermer={() => setMatchOuvert(null)}
          surEnregistre={() => { oublier("evenements:"); rechargerClub(); }}
          surWeb={allerWeb}
        />
      ) : null}

      <MonProfil
        visible={profilEdition}
        secours={{ prenom: club?.monPrenom, nom: null }}
        roleLibelle={club ? libelleRole(club.role, club.fonction) : null}
        clubNom={club?.nom ?? null}
        surFermer={() => setProfilEdition(false)}
        surEnregistre={() => moi.relire()}
      />

      {/* LE MENU, rangé comme dans Club+ : mêmes titres, même ordre. Une famille de coachs qui
          passe de l'ordinateur au téléphone doit retrouver les mêmes mots au même endroit. */}
      <Modal visible={menuOuvert} animationType="slide" transparent onRequestClose={() => setMenuOuvert(false)}>
        <Pressable style={s.voile} onPress={() => setMenuOuvert(false)} accessibilityLabel="Fermer le menu" />
        <View style={[s.feuille, { paddingBottom: insets.bottom + E.m }]}>
          <View style={s.poignee} />
          <ScrollView contentContainerStyle={{ paddingBottom: E.l }} showsVerticalScrollIndicator={false}>
            {nav.menu.map((groupe) => (
              <View key={groupe.titre} style={{ marginTop: E.m }}>
                <Text style={s.groupeTitre}>{groupe.titre}</Text>
                {groupe.entrees.map((e) => (
                  <Pressable
                    key={e.cle}
                    accessibilityRole="button" accessibilityLabel={e.libelle}
                    onPress={() => allerWeb(e.chemin)}
                    style={({ pressed }) => [s.ligne, pressed ? { backgroundColor: "rgba(255,255,255,.05)" } : null]}
                  >
                    <View style={s.rond}><Ionicons name={e.icone as never} size={17} color={C.texteDoux} /></View>
                    <Text style={s.ligneTexte}>{e.libelle}</Text>
                    <Ionicons name="chevron-forward" size={16} color={C.texteFaible} />
                  </Pressable>
                ))}
              </View>
            ))}
            {/* LA SORTIE DE L'ESPACE, ACCESSIBLE DE N'IMPORTE QUEL ONGLET (30/09/2026).
                Une seule ligne, et pas un groupe « Mon compte » avec le prénom : vu sur le
                simulateur avec la session d'un coach, le menu affichait « Mon profil » (le
                formulaire de Club+) puis, juste en dessous, « Marc » — deux lignes qui ont l'air
                de mener au même endroit alors qu'elles ne font pas la même chose.

                Changer d'espace et se déconnecter restent DANS le profil, jamais ailleurs :
                décision de Fouka le 29/09, « pour changer, il faut que tu ailles dans profil, se
                déconnecter ». Cette ligne ouvre donc le profil, elle n'agit pas elle-même. */}
            <Pressable
              accessibilityRole="button" accessibilityLabel="Compte et déconnexion"
              onPress={() => { setMenuOuvert(false); setProfilOuvert(true); }}
              style={({ pressed }) => [s.ligne, { marginTop: E.l }, pressed ? { backgroundColor: "rgba(255,255,255,.05)" } : null]}
            >
              <View style={s.rond}><Ionicons name="log-out-outline" size={17} color={C.texteDoux} /></View>
              <Text style={s.ligneTexte}>Compte et déconnexion</Text>
              <Ionicons name="chevron-forward" size={16} color={C.texteFaible} />
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      {/* LE PROFIL. C'est ici qu'on change d'espace et qu'on se déconnecte — et nulle part
          ailleurs, pour que le geste soit délibéré. */}
      <Modal visible={profilOuvert} animationType="slide" transparent onRequestClose={() => setProfilOuvert(false)}>
        <Pressable style={s.voile} onPress={() => setProfilOuvert(false)} accessibilityLabel="Fermer" />
        <View style={[s.feuille, { paddingBottom: insets.bottom + E.m }]}>
          <View style={s.poignee} />
          {/* QUI JE SUIS, EN TROIS LIGNES. Fouka : « il faut que le coach voie son rôle ». Le rôle
              était écrit nulle part, et le périmètre d'équipes non plus : un coach ne pouvait pas
              vérifier sous quelle casquette le club l'a enregistré. */}
          <View style={{ gap: 3, paddingTop: E.s, paddingBottom: E.m }}>
            <Text style={s.grosTexte}>{monPrenom || profil?.prenom || "Mon compte"}</Text>
            <Text style={s.petitTexte}>
              {club
                ? [club.nom, libelleRole(club.role, club.fonction)].filter(Boolean).join(" · ")
                : (profil?.clubNom || TITRES[cle])}
            </Text>
            {club?.equipes.length ? (
              <Text style={s.petitTexte}>{club.equipes.join(" · ")}</Text>
            ) : null}
          </View>
          {/* Modifier son profil : photo, nom, téléphone, e-mail. La page existe dans Club+
              (/settings/profile) et n'est fermée à personne ; la refaire ici, ce serait deux
              formulaires pour un seul enregistrement. */}
          <Pressable
            accessibilityRole="button" accessibilityLabel="Modifier mon profil"
            onPress={() => { setProfilOuvert(false); setProfilEdition(true); }}
            style={({ pressed }) => [s.ligne, pressed ? { backgroundColor: "rgba(255,255,255,.05)" } : null]}
          >
            <View style={s.rond}><Ionicons name="person-outline" size={17} color={C.texteDoux} /></View>
            <Text style={s.ligneTexte}>Modifier mon profil</Text>
            <Ionicons name="chevron-forward" size={16} color={C.texteFaible} />
          </Pressable>
          <Pressable
            accessibilityRole="button" accessibilityLabel="Changer d'espace"
            onPress={() => { setProfilOuvert(false); changerEspace(); }}
            style={({ pressed }) => [s.ligne, pressed ? { backgroundColor: "rgba(255,255,255,.05)" } : null]}
          >
            <View style={s.rond}><Ionicons name="swap-horizontal" size={17} color={C.texteDoux} /></View>
            <Text style={s.ligneTexte}>Changer d'espace</Text>
            <Ionicons name="chevron-forward" size={16} color={C.texteFaible} />
          </Pressable>
          <Pressable
            accessibilityRole="button" accessibilityLabel="Se déconnecter"
            onPress={async () => { setProfilOuvert(false); await oublierPorte(); await deconnexion(); }}
            style={({ pressed }) => [s.ligne, pressed ? { backgroundColor: "rgba(255,255,255,.05)" } : null]}
          >
            <View style={s.rond}><Ionicons name="log-out-outline" size={17} color={C.alerteTexte} /></View>
            <Text style={[s.ligneTexte, { color: C.alerteTexte }]}>Se déconnecter</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  barre: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    paddingHorizontal: E.s, paddingBottom: E.s,
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.bordure,
  },
  boutonBarre: { width: TOUCHE, height: TOUCHE, alignItems: "center", justifyContent: "center" },
  titre: { flex: 1, color: C.texte, fontFamily: P.titreFort, fontSize: 16.5, textAlign: "center" },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: E.xl, gap: E.s },
  grosTexte: { color: C.texte, fontFamily: P.titreFort, fontSize: 18, textAlign: "center" },
  petitTexte: { color: C.texteDoux, fontFamily: P.texte, fontSize: 14.5, lineHeight: 21, textAlign: "center", maxWidth: 320 },
  lien: { paddingVertical: E.s, paddingHorizontal: E.m, marginTop: E.xs },
  lienTexte: { color: C.texteDoux, fontFamily: P.texte, fontSize: 14, textAlign: "center" },
  action: {
    marginTop: E.m, paddingHorizontal: E.xl, minHeight: TOUCHE, borderRadius: R.m,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.06)", borderWidth: 1, borderColor: C.bordure,
  },
  actionTexte: { color: C.texte, fontFamily: P.texteFort, fontSize: 15 },
  attente: {
    position: "absolute", left: 0, right: 0, bottom: 0, top: 96,
    alignItems: "center", justifyContent: "center", backgroundColor: C.fond,
  },
  onglets: {
    flexDirection: "row", paddingTop: E.xs,
    backgroundColor: C.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.bordure,
  },
  onglet: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, paddingVertical: 4, minHeight: TOUCHE },
  ongletTexte: { alignSelf: "stretch", textAlign: "center", color: C.texteDoux, fontFamily: P.texteFort, fontSize: 11 },
  voile: { ...(StyleSheet.absoluteFill as object), backgroundColor: "rgba(0,0,0,.55)" },
  feuille: {
    position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "82%",
    backgroundColor: C.surface, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl,
    paddingHorizontal: E.l, paddingTop: E.s,
    borderTopWidth: 1, borderTopColor: C.bordure,
  },
  poignee: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: C.bordure, marginBottom: E.s },
  groupeTitre: {
    color: C.texteFaible, fontFamily: P.texteFort, fontSize: 11.5,
    textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4, marginTop: E.xs,
  },
  ligne: {
    flexDirection: "row", alignItems: "center", gap: E.m,
    minHeight: TOUCHE, borderRadius: R.m, paddingHorizontal: E.s,
  },
  rond: {
    width: 32, height: 32, borderRadius: R.m, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.05)", borderWidth: 1, borderColor: C.bordure,
  },
  ligneTexte: { flex: 1, color: C.texte, fontFamily: P.texte, fontSize: 15 },
});
