/**
 * LA NAVIGATION DE L'ESPACE CLUB, PAR RÔLE (30/09/2026).
 *
 * == LE DÉFAUT QUE CE FICHIER CORRIGE ========================================================
 *
 * `sections-club.ts` servait à TOUT LE MONDE une copie figée du menu de l'administrateur : dix-neuf
 * entrées, les mêmes pour un président et pour un coach. Or Club+ a une navigation PAR RÔLE depuis
 * le 10/09/2026 (décisions Club+ n° 1, « chaque rôle ne voit que les entrées qu'il a le droit
 * d'utiliser »). Un coach voyait donc dans l'application Factures, Contrats, Paramètres, Sponsors,
 * Invitations, Coachs & dirigeants, Studio, Newsroom et Accompagnement — neuf entrées que le site
 * ne lui montre jamais — et il lui manquait Matchs & résultats, Notifications et Mon profil, qui
 * sont dans SON menu. Les libellés non plus n'étaient pas les siens : « Demandes » au lieu de
 * « Mes demandes », « Équipes » au lieu de « Mon équipe U16A ».
 *
 * Fouka, le 30/09 : « rends tout cohérent ». La cohérence, ici, c'est un seul vocabulaire et un
 * seul découpage entre les deux écrans qu'une même personne ouvre dans la même journée.
 *
 * == LA SOURCE, ET CE QU'ON EN A REPRIS ======================================================
 *
 * Copie fidèle de `livrables/SportVision-Connect/app-next/src/lib/navigation.ts`, tables
 * `NAV_CLUB_FULLCOM` et `CLUB_ROLE_NAV`, plus `filterClubRoleNav`. L'application ne peut pas
 * importer le code du site : ce sont deux projets. Cette duplication est donc assumée, et c'est
 * `tests/app-navigation-club.test.mjs` qui garantit qu'elle ne dérive pas — il relit les deux
 * fichiers et compare entrée par entrée.
 *
 * DEUX SIMPLIFICATIONS, ET ELLES SONT VRAIES :
 *
 *   1. LE PLAN NE DÉCIDE PLUS RIEN. `session.ts` du site pose `isFullCommunication = true` en dur
 *      depuis la décision de Fouka du 21/09 (« uniquement les clubs qui sont sur Club+ seront des
 *      clubs en Full Communication »). Tout club part donc de `NAV_CLUB_FULLCOM`, et il n'y a pas
 *      d'autre branche à reproduire.
 *
 *   2. LE TYPE D'ORGANISATION NON PLUS. `lireMesClubs` lit `club_members` joint à `clubs` : elle
 *      ne rend que de vrais CLUBS. Une académie, un tournoi, une agence CM n'ont pas de ligne là,
 *      et l'espace club retombe alors sur la vue web de Club+ — le repli existant.
 *
 * AUCUN CADENAS À PRÉVOIR : tous les modules cités ici sont dans `READY_MODULES` du site, et
 * `canAccess` n'en ferme aucun pour un club. Une entrée de ce fichier mène donc à un écran qui
 * répond. Les droits FINS restent au site et à la RLS : ce fichier range, il n'autorise rien.
 */

/** Une destination. `chemin` est relatif à la racine `/clubplus` de Club+. */
export interface EntreeClub {
  cle: string;
  libelle: string;
  chemin: string;
  icone: string;
  /**
   * Le libellé pour la BARRE DU BAS, quand le libellé complet n'y tient pas.
   *
   * Onze pixels, quatre onglets, un téléphone : « Mon équipe U16A », « Résultats & informations »
   * ou « Factures & devis » s'y coupent au milieu d'un mot. Un mot tronqué n'est pas une étiquette,
   * c'est une énigme — même leçon que les raccourcis de l'accueil ce matin. Le libellé complet
   * reste dans le menu et dans le titre de la page, là où il y a la place.
   */
  court?: string;
}

export interface GroupeClub {
  titre: string;
  entrees: EntreeClub[];
}

/**
 * L'icône d'une destination, choisie par le chemin.
 *
 * Une seule table, plutôt qu'une icône répétée à chaque table de navigation : « Calendrier »
 * apparaît dans neuf menus, et neuf occasions de se tromper d'icône n'en valent aucune.
 */
const ICONES: Record<string, string> = {
  "/dashboard": "home",
  "/calendar": "calendar",
  "/teams": "people",
  "/team-requests": "person-add-outline",
  "/matchcenter": "football-outline",
  "/communication": "megaphone-outline",
  "/validations": "checkmark-done-outline",
  "/publications": "send-outline",
  "/newsroom": "newspaper-outline",
  "/requests": "create-outline",
  "/content": "images-outline",
  "/galeries": "albums-outline",
  "/studio": "color-wand-outline",
  "/services": "camera-outline",
  "/presences": "clipboard-outline",
  "/accompagnement": "compass-outline",
  "/analytics": "bar-chart-outline",
  "/reports": "reader-outline",
  "/sponsors": "ribbon-outline",
  "/users": "id-card-outline",
  "/invitations": "mail-outline",
  "/mycm": "headset-outline",
  "/messages": "chatbubbles-outline",
  "/documents": "folder-outline",
  "/billing": "card-outline",
  "/contracts": "document-text-outline",
  "/settings": "settings-outline",
  "/settings/profile": "person-outline",
  "/settings/organization": "business-outline",
  "/onboarding": "rocket-outline",
  "/notifications": "notifications-outline",
  "/support": "help-circle-outline",
};

type Ligne = { titre: string } | EntreeClub;

const t = (titre: string): Ligne => ({ titre });
const i = (cle: string, libelle: string, chemin: string): Ligne => ({
  cle, libelle, chemin, icone: ICONES[chemin] ?? "ellipse-outline",
});

/**
 * Club Full Communication : le menu de l'administrateur, du président et des dirigeants.
 *
 * SEPT ENTRÉES Y SONT REVENUES LE 30/09/2026, et c'est ce portage qui les a fait trouver. Fouka :
 * « il faut que l'administrateur, lui, il voie tout, tout, tout, toutes les galeries, tous les
 * trucs, mais bien classés. » Galeries, Matchs & résultats, Contrats, Aide, Studio,
 * Accompagnement, Notifications et Mon profil existaient dans le menu d'AUTRES rôles — un coach
 * pouvait ouvrir les galeries de son club, son président non. Le correctif est posé des deux
 * côtés en même temps, ici et dans `navigation.ts` du site, et le test de dérive le vérifie.
 */
const CLUB: Ligne[] = [
  i("dashboard", "Accueil", "/dashboard"),
  t("Communication"),
  i("communication", "Planning éditorial", "/communication"),
  i("validations", "À valider", "/validations"),
  i("publications", "Publications", "/publications"),
  i("newsroom", "Actualités", "/newsroom"),
  i("requests", "Demandes", "/requests"),
  i("studio", "Studio", "/studio"),
  t("Production"),
  i("services", "Prestations", "/services"),
  i("presences", "Présences", "/presences"),
  i("content", "Contenus", "/content"),
  i("galeries", "Galeries", "/galeries"),
  t("Performance"),
  i("analytics", "Statistiques", "/analytics"),
  i("reports", "Rapports", "/reports"),
  t("Club"),
  i("calendar", "Calendrier", "/calendar"),
  i("teams", "Équipes", "/teams"),
  i("team-requests", "Affiliations", "/team-requests"),
  i("matchcenter", "Matchs & résultats", "/matchcenter"),
  i("sponsors", "Sponsors", "/sponsors"),
  i("users", "Coachs & dirigeants", "/users"),
  i("invitations", "Invitations", "/invitations"),
  t("SportVision"),
  i("mycm", "Mon CM", "/mycm"),
  i("accompagnement", "Accompagnement", "/accompagnement"),
  i("messages", "Messages", "/messages"),
  i("documents", "Documents", "/documents"),
  i("support", "Aide", "/support"),
  t("Gestion"),
  i("billing", "Factures", "/billing"),
  i("contracts", "Contrats", "/contracts"),
  i("settings-club", "Paramètres", "/settings"),
  t("Compte"),
  i("notifications", "Notifications", "/notifications"),
  i("settings", "Mon profil", "/settings/profile"),
];


/** Coach : périmètre strict sur son ou ses équipes, saisie du résultat, zéro finance. */
const COACH: Ligne[] = [
  i("dashboard", "Accueil", "/dashboard"),
  t("SportVision"),
  i("services", "Prestations", "/services"),
  i("requests", "Mes demandes", "/requests"),
  i("content", "Mes contenus", "/content"),
  i("galeries", "Galeries", "/galeries"),
  i("calendar", "Calendrier", "/calendar"),
  i("messages", "Messages", "/messages"),
  t("Mon équipe"),
  i("teams", "Mon équipe", "/teams"),
  i("team-requests", "Affiliations", "/team-requests"),
  i("matchcenter", "Matchs & résultats", "/matchcenter"),
  t("Compte"),
  i("notifications", "Notifications", "/notifications"),
  i("settings", "Mon profil", "/settings/profile"),
];

/** Community manager du club : tout le travail éditorial, ni argent ni accès. */
const COMMUNICATION: Ligne[] = [
  i("dashboard", "Accueil", "/dashboard"),
  t("Le club"),
  i("calendar", "Calendrier", "/calendar"),
  i("teams", "Équipes", "/teams"),
  i("matchcenter", "Résultats & informations", "/matchcenter"),
  t("Communication"),
  i("communication", "Centre communication", "/communication"),
  i("requests", "Demandes de visuels", "/requests"),
  i("content", "Mes contenus", "/content"),
  i("galeries", "Galeries", "/galeries"),
  i("newsroom", "Actualités", "/newsroom"),
  t("SportVision"),
  i("services", "Prestations", "/services"),
  i("presences", "Présences", "/presences"),
  i("messages", "Messages", "/messages"),
  t("Compte"),
  i("settings", "Mon profil", "/settings/profile"),
];

/** Community manager SportVision affilié : il met le club en place, il ne le dirige pas. */
const CM_SPORTVISION: Ligne[] = [
  i("dashboard", "Tableau de bord", "/dashboard"),
  t("Le club"),
  i("calendar", "Calendrier", "/calendar"),
  i("teams", "Équipes", "/teams"),
  i("matchcenter", "Résultats", "/matchcenter"),
  i("users", "Membres", "/users"),
  i("invitations", "Invitations", "/invitations"),
  t("Communication"),
  i("communication", "Centre communication", "/communication"),
  i("requests", "Demandes", "/requests"),
  i("content", "Contenus", "/content"),
  i("galeries", "Galeries", "/galeries"),
  i("newsroom", "Actualités", "/newsroom"),
  i("sponsors", "Sponsors", "/sponsors"),
  t("SportVision"),
  i("presences", "Présences", "/presences"),
  i("messages", "Messagerie", "/messages"),
  t("Administration"),
  i("onboarding", "Onboarding", "/onboarding"),
];

/** Trésorier : factures, devis, contrats, et aucun contenu sportif parasite. */
const TRESORIER: Ligne[] = [
  i("dashboard", "Accueil", "/dashboard"),
  t("Finance"),
  i("billing", "Factures & devis", "/billing"),
  i("contracts", "Contrats", "/contracts"),
  i("settings-org", "Informations du club", "/settings/organization"),
  t("Compte"),
  i("settings", "Mon profil", "/settings/profile"),
];

/** Administratif : jamais un mini-administrateur par défaut. */
const ADMINISTRATIF: Ligne[] = [
  i("dashboard", "Accueil", "/dashboard"),
  t("SportVision"),
  i("requests", "Demandes", "/requests"),
  i("calendar", "Calendrier", "/calendar"),
  t("Structure"),
  i("documents", "Documents", "/documents"),
  t("Compte"),
  i("settings", "Mon profil", "/settings/profile"),
];

/** Responsable sponsors : les sponsors, et le calendrier pour situer les opérations. */
const SPONSORS: Ligne[] = [
  i("dashboard", "Accueil", "/dashboard"),
  t("Partenaires"),
  i("sponsors", "Sponsors", "/sponsors"),
  t("Club"),
  i("calendar", "Calendrier", "/calendar"),
  t("Compte"),
  i("settings", "Mon profil", "/settings/profile"),
];

/** Lecture seule : consulter la vie du club, rien de plus. */
const LECTURE_SEULE: Ligne[] = [
  i("dashboard", "Accueil", "/dashboard"),
  t("Club"),
  i("calendar", "Calendrier", "/calendar"),
  i("teams", "Équipes", "/teams"),
  t("Compte"),
  i("settings", "Mon profil", "/settings/profile"),
];

/**
 * Les rôles qui ont leur propre navigation, par la valeur RÉELLE de `club_members.role`.
 *
 * ON NOMME LES RÔLES COMME LA BASE LES NOMME. Le site traduit d'abord en un vocabulaire de design
 * (`comm` → `communication_manager`) parce qu'il en a besoin ailleurs ; ici cette traduction
 * n'apporterait qu'un tableau de plus à tenir à jour, et une occasion de plus de se tromper.
 *
 * ABSENTS ET C'EST VOULU : `admin`, `president`, `secretaire`, `membre_bureau`,
 * `directeur_sportif` retombent sur le menu complet. Décision du 14/09 de Fouka — « sur Club+ il
 * faut aussi dirigeant accès complet, pas que président » — que le site applique en les retirant
 * de sa propre table.
 */
const PAR_ROLE: Record<string, Ligne[]> = {
  coach: COACH,
  // Responsable d'équipe : la base le traite exactement comme un coach (is_team_educateur
  // l'inclut, même périmètre `club_members.teams`). Même menu, donc.
  resp_equipe: COACH,
  comm: COMMUNICATION,
  cm_externe: CM_SPORTVISION,
  tresorier: TRESORIER,
  administratif: ADMINISTRATIF,
  sponsor_mgr: SPONSORS,
  lecture_seule: LECTURE_SEULE,
};

/**
 * LES TROIS ONGLETS DU BAS, PAR RÔLE.
 *
 * Fouka a tranché le 30/09 : « adaptés au rôle », avec son exemple — « un trésorier aurait Accueil,
 * Factures, Contrats ». Un onglet est ce qu'on ouvre tous les jours ; le reste vit dans le menu.
 *
 * TROIS, PAS QUATRE : au-delà, avec l'entrée Menu, les libellés se coupent sur un téléphone. Même
 * règle que l'espace personnel.
 *
 * Les chemins nommés ici doivent exister dans la navigation du rôle — c'est ce que vérifie
 * `tests/app-navigation-club.test.mjs`. Un onglet vers une entrée que le rôle n'a pas serait
 * exactement le défaut qu'on est en train de corriger.
 */
const ONGLETS_PAR_ROLE: Record<string, string[]> = {
  coach: ["/dashboard", "/calendar", "/teams"],
  resp_equipe: ["/dashboard", "/calendar", "/teams"],
  comm: ["/dashboard", "/calendar", "/communication"],
  cm_externe: ["/dashboard", "/calendar", "/teams"],
  tresorier: ["/dashboard", "/billing", "/contracts"],
  administratif: ["/dashboard", "/calendar", "/documents"],
  sponsor_mgr: ["/dashboard", "/sponsors", "/calendar"],
  lecture_seule: ["/dashboard", "/calendar", "/teams"],
};

const ONGLETS_PAR_DEFAUT = ["/dashboard", "/calendar", "/teams"];

/** Ce que l'application sait afficher elle-même. Le reste passe par la vue web de Club+. */
export const CHEMINS_NATIFS = new Set(["/dashboard", "/calendar", "/teams"]);

export interface NavigationClub {
  /** Les trois destinations de la barre du bas, dans l'ordre. */
  onglets: EntreeClub[];
  /** Tout le reste, groupé et titré comme dans Club+. */
  menu: GroupeClub[];
  /** Les entrées du menu qui méritent un raccourci sur l'accueil : les trois premières. */
  raccourcis: EntreeClub[];
}

/**
 * La navigation d'une personne dans son club.
 *
 * `equipes` est son périmètre (`club_members.teams`). Un seul nom : l'entrée « Mon équipe » devient
 * « Mon équipe U16A », exactement comme sur le site. Zéro, deux ou plus : « Mes équipes ».
 */
export function navigationDuClub(role: string | null, equipes: string[] = []): NavigationClub {
  const cle = (role ?? "").toLowerCase();
  const lignes = PAR_ROLE[cle] ?? CLUB;
  const cheminsOnglets = ONGLETS_PAR_ROLE[cle] ?? ONGLETS_PAR_DEFAUT;

  const nommees = lignes.map((l) => (estEntree(l) ? raccourcir(nommerMonEquipe(l, equipes)) : l));

  const onglets: EntreeClub[] = [];
  for (const chemin of cheminsOnglets) {
    const trouvee = nommees.find((l) => estEntree(l) && l.chemin === chemin) as EntreeClub | undefined;
    // Un onglet dont l'entrée n'existe pas dans la navigation du rôle est ignoré plutôt que
    // fabriqué : mieux vaut deux onglets justes que trois dont un ment.
    if (trouvee) onglets.push(trouvee);
  }

  const dansLesOnglets = new Set(onglets.map((o) => o.chemin));
  const menu: GroupeClub[] = [];
  let courant: GroupeClub | null = null;
  for (const l of nommees) {
    if (!estEntree(l)) { courant = { titre: l.titre, entrees: [] }; menu.push(courant); continue; }
    if (dansLesOnglets.has(l.chemin)) continue;
    // Une entrée avant le premier titre — « Accueil » — n'a pas de groupe : elle est déjà un
    // onglet, et si elle ne l'est pas, elle ouvre le premier groupe.
    if (!courant) { courant = { titre: "Le club", entrees: [] }; menu.push(courant); }
    courant.entrees.push(l);
  }

  const groupes = menu.filter((g) => g.entrees.length);
  return { onglets, menu: groupes, raccourcis: groupes.flatMap((g) => g.entrees).slice(0, 3) };
}

/**
 * Le libellé court d'une entrée, pour la barre du bas.
 *
 * Deux règles, et pas une de plus : on coupe avant « & », qui sépare toujours un complément du
 * mot principal (« Factures & devis », « Résultats & informations », « Matchs & résultats ») ; et
 * on retire le nom de l'équipe de « Mon équipe U16A », que la barre n'a pas la place de porter.
 * Au-delà, on laisserait l'écran décider, et c'est comme ça qu'on coupe un mot au hasard.
 */
function raccourcir(e: EntreeClub): EntreeClub {
  const avantEsperluette = e.libelle.split(" & ")[0].trim();
  const court = e.libelle.startsWith("Mon équipe ") ? "Mon équipe"
    : e.libelle === "Centre communication" ? "Communication"
    : e.libelle === "Demandes de visuels" ? "Demandes"
    : e.libelle === "Informations du club" ? "Le club"
    : e.libelle === "Planning éditorial" ? "Planning"
    : e.libelle === "Tableau de bord" ? "Accueil"
    : avantEsperluette;
  return court === e.libelle ? e : { ...e, court };
}

function estEntree(l: Ligne): l is EntreeClub {
  return (l as EntreeClub).chemin !== undefined;
}

/** « Mon équipe » porte le nom de l'équipe quand il n'y en a qu'une, comme sur le site. */
function nommerMonEquipe(e: EntreeClub, equipes: string[]): EntreeClub {
  if (e.libelle !== "Mon équipe") return e;
  return { ...e, libelle: equipes.length === 1 ? `Mon équipe ${equipes[0]}` : "Mes équipes" };
}

/** Le libellé d'un chemin, pour le titre de la barre. On cherche le plus long qui corresponde :
 *  « /teams/12 » doit dire « Mon équipe U16A », pas retomber sur « Accueil ». */
export function libelleDuChemin(nav: NavigationClub, chemin: string): string {
  const tout = [...nav.onglets, ...nav.menu.flatMap((g) => g.entrees)];
  let meilleur: EntreeClub | null = null;
  for (const s of tout) {
    if (!chemin.startsWith(s.chemin)) continue;
    if (!meilleur || s.chemin.length > meilleur.chemin.length) meilleur = s;
  }
  return meilleur?.libelle ?? "Espace club";
}
