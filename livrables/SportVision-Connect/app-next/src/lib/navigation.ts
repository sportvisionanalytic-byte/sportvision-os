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
  item("users", "Membres & accès", "users"),
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
  item("users", "Membres & accès", "users"),
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
  item("users", "Membres & accès", "users"),
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

// ───────────────────────────────────────────────────────────────────────────────────────────
// Navigation par rôle club — fondations "Autres rôles Club+" (brief Fouka 17/08/2026,
// CLUB-PLUS-PRODUCT-BIBLE.md §5-§10). AUCUN persona Joueur/Parent ici : ceux-ci sont servis par
// app-connect (Connect), jamais par Club+ (voir NAV_PLAYER/NAV_PARENT plus haut, hors périmètre).
//
// Remplace l'ancienne rustine soustractive (filterClubRoleNav retirait des entrées de
// NAV_CLUB_PLUS pour communication_manager/coach uniquement, historique : audit Communication/
// Éducateur du 12/08/2026, §13/§14 du master doc de l'époque) par une construction POSITIVE :
// chaque rôle a sa propre navigation pensée pour lui (Bible §7-§10), pas une version amputée du
// menu Admin. admin/president/board_member (Bible §6 : "vision large") et sponsor_manager/
// viewer (rôles réels hors périmètre Bible §5) continuent de recevoir `entries` telle quelle
// (NAV_CLUB_PLUS ou la variante Full Communication résolue par resolveNavigation) : cette
// fonction ne les touche pas.
//
// Simplification assumée : ces 6 navs sont IDENTIQUES que le club soit Club+ Start/Performance
// ou Full Communication — la Bible ne différencie la navigation par rôle que par (type
// d'organisation, rôle), jamais par palier d'offre (seul le menu Admin change de variante selon
// l'offre). `canAccess()` (permissions.ts) continue de verrouiller une page dont le module n'est
// pas dans l'offre active, indépendamment de sa présence ici — même principe que NAV_CLUB_PLUS.
//
// Gaps connus vs la Bible, laissés pour l'agent qui construira l'interface détaillée de chaque
// rôle (pas de nouvelle page créée dans ce chantier, périmètre = navigation.ts/types.ts/
// permissions.ts/mappers.ts/settings.ts/matches.ts/ClubPlusDashboard.tsx/users/page.tsx) :
//   - "Crédits" (Bible §9, Communication) n'a aucune page dédiée dans ce dépôt aujourd'hui (le
//     solde existe déjà : Subscription.creditsRemaining/creditsReserved, affiché en gauge sur
//     ClubPlusDashboard) — omis plutôt qu'un lien mort.
//   - "Résultats & informations" (Bible §9) est mappé sur le module "matchcenter" existant (même
//     écran de saisie/consultation des résultats que Coach/Directeur sportif) — la Bible envisage
//     peut-être un écran de consultation distinct pour la Communication, pas construit ici.
//   - "Mes demandes" (SportVision, générique à presque toutes les interfaces Bible) et "Demandes
//     de visuels" (Communication) pointent tous deux vers /requests (module "visual_requests") :
//     ce dépôt n'a qu'UNE liste de demandes aujourd'hui (VisualRequest), pas de liste ServiceRequest
//     séparée — pour la Communication (seul rôle où la Bible liste les deux dans des groupes
//     différents), l'entrée n'apparaît qu'une fois, dans "Communication", pour éviter un lien
//     dupliqué vers la même page.
//   - "informations structure" (Administratif, Bible §10) n'a pas d'écran de consultation
//     dédié (lecture seule du profil organisation) distinct de Paramètres > Organisation (réservé
//     au bureau) — mappé sur "Mon profil" comme les autres rôles non-bureau, par défaut fermé.
//   - "Mon équipe [Nom]" (Coach, Bible §7) : le nom réel de l'équipe (ou "Mes équipes" au pluriel
//     si plusieurs) vient de `ctx.membership.teamScope`, non disponible dans cette fonction pure
//     (entries, role) — Sidebar.tsx/Header.tsx (hors périmètre de ce chantier) devront passer
//     teamScope pour personnaliser ; en attendant, libellé générique "Mon équipe" (fallback
//     explicitement toléré par le brief).
//
// Correctif au passage : l'ancienne rustine rangeait "matchcenter" (Match Center = saisie/suivi
// des résultats de match, voir data/club/matches.ts et matchcenter/page.tsx) dans les modules
// "communication uniquement" et le retirait donc du menu Coach — alors que la Bible §7 liste
// explicitement "Matchs & résultats" dans LE PROPRE menu du Coach (c'est lui qui saisit le
// score). Corrigé ici : matchcenter fait partie du bloc "équipe" de Coach et Directeur sportif,
// pas du bloc Communication.

/** Coach (Bible §7) : scope strict sur son (ses) équipe(s), saisie résultat, zéro Finance/
 * Membres/Communication. */
const NAV_CLUB_COACH: NavEntry[] = [
  item("dashboard", "Accueil", "dashboard"),
  section("SportVision"),
  item("services", "Prestations", "services"),
  item("visual_requests" as ModuleKey, "Mes demandes", "requests"),
  item("content", "Mes contenus", "content"),
  item("calendar", "Calendrier", "calendar"),
  item("messages", "Messages", "messages"),
  section("Mon équipe"),
  item("teams", "Mon équipe", "teams"),
  item("teams", "Joueurs & affiliations", "team-requests"),
  item("matchcenter", "Matchs & résultats", "matchcenter"),
  section("Compte"),
  item("settings", "Mon profil", "settings/profile"),
];

/** Directeur / Responsable sportif (Bible §8, rôle `sports_director`) : couche intermédiaire
 * Admin <-> coachs, supervise plusieurs équipes/groupes (club_members.teams, tableau JSONB, déjà
 * multi-valeurs) sans finance ni membres par défaut. */
const NAV_CLUB_DIRECTEUR_SPORTIF: NavEntry[] = [
  item("dashboard", "Accueil", "dashboard"),
  section("Sportif"),
  item("teams", "Mes équipes", "teams"),
  item("teams", "Joueurs & affiliations", "team-requests"),
  item("matchcenter", "Matchs & résultats", "matchcenter"),
  section("SportVision"),
  item("services", "Prestations", "services"),
  item("visual_requests" as ModuleKey, "Mes demandes", "requests"),
  item("content", "Mes contenus", "content"),
  item("calendar", "Calendrier", "calendar"),
  item("messages", "Messages", "messages"),
  section("Compte"),
  item("settings", "Mon profil", "settings/profile"),
];

/** Communication / CM interne (Bible §9, `communication_manager`) : exploite résultats, contenus,
 * visuels ; lecture seule sur les équipes (scope), aucune Finance, aucun Membres. */
const NAV_CLUB_COMMUNICATION: NavEntry[] = [
  item("dashboard", "Accueil", "dashboard"),
  section("Communication"),
  item("communication", "Centre communication", "communication"),
  item("matchcenter", "Résultats & informations", "matchcenter"),
  item("visual_requests" as ModuleKey, "Demandes de visuels", "requests"),
  item("content", "Mes contenus", "content"),
  section("SportVision"),
  item("services", "Prestations", "services"),
  item("calendar", "Calendrier", "calendar"),
  item("messages", "Messages", "messages"),
  section("Structure"),
  item("teams", "Équipes", "teams"),
  section("Compte"),
  item("settings", "Mon profil", "settings/profile"),
];

/** Secrétaire (Bible §10) : démarches opérationnelles, documents, affiliations en lecture,
 * calendrier — jamais Finance, jamais Membres. */
const NAV_CLUB_SECRETAIRE: NavEntry[] = [
  item("dashboard", "Accueil", "dashboard"),
  section("SportVision"),
  item("visual_requests" as ModuleKey, "Demandes", "requests"),
  item("calendar", "Calendrier", "calendar"),
  section("Structure"),
  item("documents", "Documents", "documents"),
  item("teams", "Affiliations", "team-requests"),
  section("Compte"),
  item("settings", "Mon profil", "settings/profile"),
];

/** Trésorier / Finance (Bible §10) : factures, devis, contrats — "aucun contenu sportif
 * parasite" (Bible), donc ni Communication, ni Équipes, ni Studio/Newsroom/Match Center. Devis
 * et factures partagent aujourd'hui le même écran (/billing, voir "Devis, contrats et factures
 * de {club}") ; Messages volontairement omis, la Bible §10 ne le liste pas pour ce rôle
 * (contrairement à tous les autres) et le décrit comme délibérément minimal. */
const NAV_CLUB_TRESORIER: NavEntry[] = [
  item("dashboard", "Accueil", "dashboard"),
  section("Finance"),
  item("billing", "Factures & devis", "billing"),
  item("contracts", "Contrats", "contracts"),
  section("Compte"),
  item("settings", "Mon profil", "settings/profile"),
];

/** Administratif (Bible §10, rôle `admin_staff`) : "jamais un mini-Admin par défaut" — Demandes,
 * Calendrier, Documents, Compte. Pas d'Affiliations/Équipes (pas de permission fine-grained
 * aujourd'hui : fermé par défaut, comportement sûr) ; jamais Membres & accès. */
const NAV_CLUB_ADMINISTRATIF: NavEntry[] = [
  item("dashboard", "Accueil", "dashboard"),
  section("SportVision"),
  item("visual_requests" as ModuleKey, "Demandes", "requests"),
  item("calendar", "Calendrier", "calendar"),
  section("Structure"),
  item("documents", "Documents", "documents"),
  section("Compte"),
  item("settings", "Mon profil", "settings/profile"),
];

/** Un rôle absent de cette table (admin/president/board_member/sponsor_manager/viewer, ou tout
 * rôle non-club) garde `entries` telle quelle — c'est le comportement historique et voulu :
 * admin/president/board_member voient NAV_CLUB_PLUS (ou la variante Full Communication) au
 * complet (Bible §6 : "vision large"), inchangée par ce chantier. */
const CLUB_ROLE_NAV: Partial<Record<MembershipRole, NavEntry[]>> = {
  coach: NAV_CLUB_COACH,
  sports_director: NAV_CLUB_DIRECTEUR_SPORTIF,
  communication_manager: NAV_CLUB_COMMUNICATION,
  secretary: NAV_CLUB_SECRETAIRE,
  treasurer: NAV_CLUB_TRESORIER,
  admin_staff: NAV_CLUB_ADMINISTRATIF,
};

/** Remplace `entries` (résolue par resolveNavigation) par la navigation dédiée du rôle si ce
 * rôle en a une (voir CLUB_ROLE_NAV ci-dessus) ; sinon la retourne inchangée. Le nom et la
 * signature de cette fonction sont conservés à l'identique (Sidebar.tsx/Header.tsx l'appellent
 * déjà avec `(entries, ctx.membership.role)` pour tout org type club — pas de nouveau site
 * d'appel à câbler). */
export function filterClubRoleNav(entries: NavEntry[], role: MembershipRole): NavEntry[] {
  return CLUB_ROLE_NAV[role] ?? entries;
}
