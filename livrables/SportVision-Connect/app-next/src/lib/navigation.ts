import type { MembershipRole, ModuleKey, OrgType, PlanCode } from "./types";

// Navigation par profil — voir README.md § Les treize expériences et § Navigation groupée.
// L'offre décide de la navigation avant le type d'organisation (voir la logique dans
// resolveNavigation ci-dessous, qui reproduit exactement le pseudo-code du README).
//
// Chaque navigation est un mélange de titres de section (non cliquables) et d'entrées de
// module. Une entrée reste toujours visible : c'est `canAccess()` (permissions.ts), pas cette
// liste, qui décide si elle porte un cadenas.

export type NavEntry =
  | { kind: "section"; label: string }
  | { kind: "item"; module: ModuleKey; label: string; href: string };

const section = (label: string): NavEntry => ({ kind: "section", label });
const item = (module: ModuleKey, label: string, href: string): NavEntry => ({
  kind: "item",
  module,
  label,
  href: `/${href}`,
});

// Club+ Start / Club+ Performance — 19 entrées (README).
const NAV_CLUB_PLUS: NavEntry[] = [
  item("dashboard", "Accueil", "dashboard"),
  section("Club+"),
  item("studio", "Studio", "studio"),
  item("newsroom", "Newsroom", "newsroom"),
  item("matchcenter", "Match Center", "matchcenter"),
  section("Communication"),
  item("communication", "Communication", "communication"),
  item("visual_requests" as ModuleKey, "Demandes", "requests"),
  item("content", "Contenus", "content"),
  section("Club"),
  item("calendar", "Calendrier", "calendar"),
  item("teams", "Équipes", "teams"),
  item("teams", "Adhésions", "team-requests"),
  item("sponsors", "Sponsors", "sponsors"),
  section("SportVision"),
  item("services", "Prestations", "services"),
  item("accompagnement", "Accompagnement", "accompagnement"),
  section("Gestion"),
  item("contracts", "Contrats", "contracts"),
  item("billing", "Factures", "billing"),
  item("users", "Utilisateurs", "users"),
  item("documents", "Documents", "documents"),
  item("messages", "Messages", "messages"),
  item("support", "Aide", "support"),
  item("settings", "Paramètres", "settings"),
];

// Club Full Communication.
const NAV_CLUB_FULLCOM: NavEntry[] = [
  item("dashboard", "Accueil", "dashboard"),
  section("Communication"),
  item("communication", "Planning éditorial", "communication"),
  item("validations", "À valider", "validations"),
  item("publications", "Publications", "publications"),
  section("Production"),
  item("services", "Prestations", "services"),
  item("presences", "Présences", "presences"),
  item("content", "Médiathèque", "content"),
  section("Performance"),
  item("analytics", "Statistiques", "analytics"),
  item("reports", "Rapports", "reports"),
  section("Club"),
  item("teams", "Équipes", "teams"),
  item("teams", "Adhésions", "team-requests"),
  item("sponsors", "Sponsors", "sponsors"),
  section("SportVision"),
  item("mycm", "Mon Community Manager", "mycm"),
  item("messages", "Messages", "messages"),
  item("documents", "Documents", "documents"),
  item("billing", "Factures", "billing"),
  item("settings", "Paramètres", "settings"),
];

// Coach Full Communication.
const NAV_COACH_FULLCOM: NavEntry[] = [
  item("dashboard", "Accueil", "dashboard"),
  section("Communication"),
  item("communication", "Planning", "communication"),
  item("content", "Contenus", "content"),
  item("validations", "À valider", "validations"),
  section("Production"),
  item("services", "Tournages", "services"),
  item("sessions", "Séances", "sessions"),
  section("Performance"),
  item("analytics", "Statistiques", "analytics"),
  item("reports", "Rapports", "reports"),
  section("SportVision"),
  item("mycm", "Mon CM", "mycm"),
  item("messages", "Messages", "messages"),
  item("documents", "Documents", "documents"),
  item("settings", "Paramètres", "settings"),
];

// Académie Full Communication.
const NAV_ACADEMY_FULLCOM: NavEntry[] = [
  item("dashboard", "Accueil", "dashboard"),
  section("Communication"),
  item("communication", "Planning éditorial", "communication"),
  item("content", "Contenus", "content"),
  item("validations", "À valider", "validations"),
  section("Académie"),
  item("teams", "Groupes", "teams"),
  item("camps", "Stages", "camps"),
  item("eventtimeline", "Événements", "eventtimeline"),
  section("Production"),
  item("services", "Prestations", "services"),
  section("Partenaires"),
  item("sponsors", "Sponsors", "sponsors"),
  section("Performance"),
  item("analytics", "Statistiques", "analytics"),
  item("reports", "Rapports", "reports"),
  section("SportVision"),
  item("mycm", "Mon CM", "mycm"),
  item("messages", "Messages", "messages"),
  item("documents", "Documents", "documents"),
  item("users", "Utilisateurs", "users"),
  item("settings", "Paramètres", "settings"),
];

// Tournoi (événement) Full Communication.
const NAV_EVENT_FULLCOM: NavEntry[] = [
  item("dashboard", "Accueil", "dashboard"),
  section("Événement"),
  item("eventtimeline", "Timeline", "eventtimeline"),
  item("teams", "Équipes participantes", "teams"),
  section("Communication"),
  item("communication", "Planning éditorial", "communication"),
  item("content", "Contenus", "content"),
  item("validations", "À valider", "validations"),
  item("live", "Live", "live"),
  section("Production"),
  item("services", "Prestations", "services"),
  section("Partenaires"),
  item("sponsors", "Sponsors", "sponsors"),
  section("Performance"),
  item("analytics", "Statistiques", "analytics"),
  item("reports", "Rapport événement", "reports"),
  section("SportVision"),
  item("mycm", "Mon CM", "mycm"),
  item("messages", "Messages", "messages"),
  item("documents", "Documents", "documents"),
  item("settings", "Paramètres", "settings"),
];

const NAV_SPONSOR: NavEntry[] = [
  item("dashboard", "Accueil", "dashboard"),
  section("Mon partenariat"),
  item("sponsors", "Ma visibilité", "sponsors"),
  item("content", "Contenus sponsorisés", "content"),
  item("calendar", "Opérations", "calendar"),
  section("Documents"),
  item("documents", "Contrat et documents", "documents"),
  item("messages", "Messages", "messages"),
  item("settings", "Paramètres", "settings"),
];

const NAV_GENERIC: NavEntry[] = [
  item("dashboard", "Accueil", "dashboard"),
  section("SportVision"),
  item("services", "Prestations", "services"),
  item("visual_requests" as ModuleKey, "Demandes", "requests"),
  item("content", "Contenus", "content"),
  item("calendar", "Calendrier", "calendar"),
  item("appointments", "Rendez-vous", "appointments"),
  section("Gestion"),
  item("documents", "Documents", "documents"),
  item("billing", "Factures", "billing"),
  item("users", "Utilisateurs", "users"),
  item("messages", "Messages", "messages"),
  item("settings", "Paramètres", "settings"),
];

const NAV_PARENT: NavEntry[] = [
  item("dashboard", "Accueil", "dashboard"),
  section("Mes enfants"),
  item("children", "Profils associés", "children"),
  item("content", "Leurs contenus", "content"),
  item("authorizations", "Autorisations", "authorizations"),
  item("teams", "Adhésions à une équipe", "team-requests"),
  section("SportVision"),
  item("services", "Prestations", "services"),
  item("calendar", "Calendrier", "calendar"),
  item("billing", "Paiements", "billing"),
  item("messages", "Messages", "messages"),
  item("settings", "Paramètres", "settings"),
];

const NAV_CM_AGENCY: NavEntry[] = [
  item("dashboard", "Tableau de bord", "dashboard"),
  item("communication", "Planning éditorial", "communication"),
  item("visual_requests" as ModuleKey, "Demandes", "requests"),
  item("content", "Contenus", "content"),
  item("calendar", "Calendrier", "calendar"),
  item("teams", "Clubs suivis", "teams"),
  item("services", "Prestations", "services"),
  item("accompagnement", "Mes accès", "accompagnement"),
  item("documents", "Documents", "documents"),
  item("messages", "Messages", "messages"),
  item("support", "Aide", "support"),
  item("settings", "Paramètres", "settings"),
];

// Académie / Coach sur une offre Club+ (pas encore Full Communication).
const NAV_ACADEMY_CLUBPLUS: NavEntry[] = [
  item("dashboard", "Tableau de bord", "dashboard"),
  item("teams", "Groupes", "teams"),
  item("services", "Stages et événements", "services"),
  item("users", "Inscriptions", "users"),
  item("content", "Contenus", "content"),
  item("communication", "Communication", "communication"),
  item("visual_requests" as ModuleKey, "Demandes", "requests"),
  item("calendar", "Calendrier", "calendar"),
  item("documents", "Documents", "documents"),
  item("billing", "Factures", "billing"),
  item("messages", "Messages", "messages"),
  item("support", "Aide", "support"),
  item("settings", "Paramètres", "settings"),
];

const NAV_COACH_CLUBPLUS: NavEntry[] = [
  item("dashboard", "Tableau de bord", "dashboard"),
  item("teams", "Joueurs suivis", "teams"),
  item("calendar", "Séances", "calendar"),
  item("content", "Contenus", "content"),
  item("communication", "Communication", "communication"),
  item("visual_requests" as ModuleKey, "Demandes", "requests"),
  item("services", "Prestations", "services"),
  item("contracts", "Contrats", "contracts"),
  item("billing", "Factures", "billing"),
  item("documents", "Documents", "documents"),
  item("messages", "Messages", "messages"),
  item("support", "Aide", "support"),
  item("settings", "Paramètres", "settings"),
];

// Refonte 11/08/2026 (brief Fouka, test réel de l'espace Joueur) — voir ACTIONS.md/rapport de
// l'agent pour le détail des 22 points. Principe directeur : une navigation pensée POUR un
// joueur, pas une version bridée du menu club/admin. Tout ce qui relève de la gestion de la
// structure (Prestations club, Demandes de visuels, Factures, Documents, Utilisateurs, Gérer
// l'offre, Crédits, Contrats, Sponsors) est retiré du menu — pas verrouillé avec un cadenas, un
// joueur n'a pas besoin de savoir que ces pages existent. "Mes prestations"/"Commander une
// prestation" est volontairement ABSENT en V1 : le catalogue restreint joueur (Match Photo/Vidéo
// + options Drone/Highlight, prix TTC — voir services.ts § formatServicePriceTTC) est prêt, mais
// aucun `client_id` n'existe pour une commande personnelle de joueur sans backend supplémentaire
// (voir le rapport de l'agent) — plutôt qu'un bouton qui mène à un module verrouillé, il est
// retiré, conformément à la consigne explicite de Fouka ("sinon retire complètement ce bouton").
const NAV_PLAYER: NavEntry[] = [
  item("dashboard", "Accueil", "dashboard"),
  item("content", "Mes contenus", "content"),
  item("calendar", "Calendrier", "calendar"),
  item("teams", "Mon équipe", "team-requests"),
  item("messages", "Messages", "messages"),
  item("settings", "Mon profil", "settings/profile"),
  item("support", "Aide", "support"),
];

const NAV_ONE_OFF: NavEntry[] = [
  item("dashboard", "Aperçu", "dashboard"),
  item("services", "Ma prestation", "services"),
  item("calendar", "Planning", "calendar"),
  item("documents", "Documents", "documents"),
  item("billing", "Paiement", "billing"),
  item("content", "Livrables", "content"),
  item("messages", "Messages", "messages"),
  item("support", "Aide", "support"),
];

/**
 * Reproduit exactement la logique du README : l'offre décide avant le type.
 *   if (plan === 'Full Communication') {
 *     if (type === 'coach')    return coachFc
 *     if (type === 'academy')  return academieFc
 *     if (type === 'event')    return tournoiFc
 *     return fullcom
 *   }
 *   return NAVS[type]
 *
 * Un joueur rattaché à un club abonné perd Factures et Sponsors (voir README) : à filtrer par
 * l'appelant avec `isAffiliatedPlayer`, pas ici, pour garder cette fonction pure sur (type, plan).
 */
export function resolveNavigation(orgType: OrgType, planCode: PlanCode): NavEntry[] {
  if (planCode === "full_communication") {
    if (orgType === "coach") return NAV_COACH_FULLCOM;
    if (orgType === "academy") return NAV_ACADEMY_FULLCOM;
    if (orgType === "event") return NAV_EVENT_FULLCOM;
    return NAV_CLUB_FULLCOM;
  }
  if (orgType === "club") return NAV_CLUB_PLUS;
  if (orgType === "academy") return NAV_ACADEMY_CLUBPLUS;
  if (orgType === "coach") return NAV_COACH_CLUBPLUS;
  if (orgType === "player") return NAV_PLAYER;
  if (orgType === "parent") return NAV_PARENT;
  if (orgType === "cm_agency") return NAV_CM_AGENCY;
  if (orgType === "sponsor") return NAV_SPONSOR;
  if (orgType === "event") return NAV_ONE_OFF;
  return NAV_GENERIC;
}

/** Un joueur rattaché à un club abonné n'a ni Factures ni Sponsors : le club les porte. */
export function filterAffiliatedPlayerNav(entries: NavEntry[]): NavEntry[] {
  return entries.filter((e) => e.kind !== "item" || (e.module !== "billing" && e.module !== "sponsors"));
}

// Audit Communication/Éducateur (12/08/2026, brief Fouka §13/§14 du master doc) — même principe
// que filterAffiliatedPlayerNav ci-dessus et que le rebuild NAV_PLAYER : resolveNavigation()
// n'a jamais eu de dimension "rôle", seulement (type d'organisation, offre). Un communication_
// manager ou un coach de club voyait donc EXACTEMENT le même menu qu'un admin/président —
// Contrats, Factures, Utilisateurs et Documents compris — alors que ces 4 modules sont réservés
// au bureau du club (§11 : "Documents du club"/"Factures du club" = Non ou "permission
// spéciale" ; "Utilisateurs" = Non pour les deux). Les 3 vues financières sont déjà bien
// restreintes côté RLS (club_member_has_financial_access, migration-connect-v41) : cette
// fonction aligne le MENU sur cette même frontière plutôt que de laisser une entrée qui mène à
// un "Aucun document pour le moment" trompeur — retirée, pas verrouillée avec un cadenas, même
// principe que le brief joueur du 11/08 ("sinon retire complètement ce bouton").
//
// Un coach, en plus, ne fait pas de communication (§14 : pas de "Demandes de visuels", pas de
// planning éditorial/validations/publications, pas de Studio/Newsroom/Match Center — outils de
// création/diffusion de contenu, pas de suivi "périmètre équipe") — ces modules restent réservés
// au rôle Communication.
//
// "Sponsors" (CRM partenariats/business du club) n'apparaît dans AUCUNE des deux navs Annexe A —
// retiré pour les deux rôles, contrairement au reste de cette liste qui distingue Communication
// de Coach.
const CLUB_FINANCIAL_ADMIN_MODULES: ReadonlySet<ModuleKey> = new Set(["contracts", "billing", "users", "documents"]);
const CLUB_NOT_RELEVANT_EITHER_ROLE: ReadonlySet<ModuleKey> = new Set(["sponsors"]);
const CLUB_COMMUNICATION_ONLY_MODULES: ReadonlySet<ModuleKey> = new Set([
  "communication",
  "visual_requests",
  "validations",
  "publications",
  "studio",
  "newsroom",
  "matchcenter",
]);

/** Applique le menu Communication/Éducateur (§11/§13/§14/Annexe A) par-dessus la navigation club
 * de base (Club+ ou Full Communication). Retourne `entries` telle quelle pour tout autre rôle
 * (admin/président/trésorier/membre du bureau/...) — cette fonction ne fait QUE retirer des
 * entrées non pertinentes pour ces deux rôles précis, jamais en ajouter ni en réordonner.
 *
 * Reste volontairement conservateur au-delà des 6 lignes de la matrice explicitement en jeu
 * (Prestations/Demandes de visuels/Documents/Factures/Utilisateurs/Paramètres) : "Équipes",
 * "Adhésions" et "Accompagnement" restent visibles pour les deux rôles (pertinents en pratique —
 * un éducateur suit le roster de son équipe — et non nommément exclus par le master doc), à
 * réévaluer si Fouka veut coller à l'Annexe A à la lettre. */
export function filterClubRoleNav(entries: NavEntry[], role: MembershipRole): NavEntry[] {
  if (role !== "communication_manager" && role !== "coach") return entries;

  const filtered = entries
    .filter((e) => e.kind !== "item" || !CLUB_FINANCIAL_ADMIN_MODULES.has(e.module))
    .filter((e) => e.kind !== "item" || !CLUB_NOT_RELEVANT_EITHER_ROLE.has(e.module))
    .filter((e) => e.kind !== "item" || role !== "coach" || !CLUB_COMMUNICATION_ONLY_MODULES.has(e.module))
    // "Paramètres" (onglet Organisation/Intégrations inclus, voir settings/layout.tsx) devient
    // "Mon profil" pointant directement sur l'onglet personnel — §31 : ces deux rôles n'ont "pas
    // d'onglet organisation complet par défaut".
    .map((e): NavEntry =>
      e.kind === "item" && e.module === "settings" && e.href === "/settings"
        ? { ...e, label: "Mon profil", href: "/settings/profile" }
        : e,
    );

  // Retire les titres de section devenus vides (ex. "Communication" pour un coach une fois
  // communication/visual_requests/validations/publications retirés) — une navigation "pensée
  // pour" le rôle, pas une version bridée qui laisse des en-têtes sans rien dessous.
  return filtered.filter((e, i) => {
    if (e.kind !== "section") return true;
    const next = filtered[i + 1];
    return !!next && next.kind === "item";
  });
}
