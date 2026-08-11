import type { ModuleKey, OrgType, PlanCode } from "./types";

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

// Club standard — sans Club+ (offre Essentiel).
const NAV_CLUB_STANDARD: NavEntry[] = [
  item("dashboard", "Accueil", "dashboard"),
  section("SportVision"),
  item("services", "Prestations", "services"),
  item("visual_requests" as ModuleKey, "Demandes", "requests"),
  item("content", "Contenus", "content"),
  section("Gestion"),
  item("documents", "Documents", "documents"),
  item("billing", "Factures", "billing"),
  item("messages", "Messages", "messages"),
  item("users", "Utilisateurs", "users"),
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
 *   if (type === 'club' && plan === 'Essentiel') return standard
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
  if (orgType === "club" && planCode === "essentiel") return NAV_CLUB_STANDARD;
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
