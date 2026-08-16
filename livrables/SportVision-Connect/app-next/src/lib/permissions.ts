import type { ActiveContext, FeatureKey, MembershipRole, ModuleKey, OrgType, QuotaKey, ResourceKey } from "./types";
import { PLANS } from "./plans";
import { MODULE_TO_CONNECT_MODULE, READY_MODULES } from "./supabase/entitlements";

// Permissions centralisées — voir README.md § Logique d'abonnement et DATA_MODEL.md
// § Fonctions de permission.
//
// Interdiction formelle de tester `plan.code` ou `organization.type` directement dans un
// écran. Tout passe par ces quatre fonctions. Résolution dans l'ordre : type d'organisation →
// tier de l'offre → entitlements → rôle → périmètre d'équipes → capacités explicites.
// Le premier refus l'emporte.

const READ_ONLY_ROLES = new Set(["viewer"]);

/**
 * Types d'organisation pour qui le module "sponsors" a un sens métier — voir navigation.ts :
 * seules ces navigations proposent une entrée "Sponsors"/"Partenaires"/"Mes sponsors"/"Ma
 * visibilité" (club, académie et événement en Full Communication, l'espace propre d'un
 * partenaire, un joueur indépendant). Ni coach, ni parent, ni agence CM, ni espace Projet
 * (generic/one_off) n'ont cette entrée nulle part — leur ouvrir le module par défaut affichait
 * une jauge "Full Communication" qui n'a aucun sens pour eux (audit nuit 09-10/08).
 */
const SPONSORS_ORG_TYPES: ReadonlySet<OrgType> = new Set(["club", "academy", "event", "sponsor", "player"]);

/**
 * Un module absent de READY_MODULES est verrouillé, jamais ouvert par défaut — sinon un compte
 * réel (club, joueur, parent ou projet) verrait du contenu mock sur un module pas encore branché.
 * Pour un module prêt, l'accès réel est piloté par organization_entitlements (via
 * MODULE_TO_CONNECT_MODULE) — mais organization_entitlements n'existe que pour un espace CLUB
 * (c'est un plan/quota vendu). Un espace joueur, parent ou projet n'a pas d'entitlements réels
 * (ctx.entitlements toujours undefined pour eux, voir session.ts) : un module READY_MODULES leur
 * est donc en général toujours ouvert, jamais bloqué par une clé qui ne les concerne pas.
 * Correction (Phase 3) : la version précédente appliquait le gate d'entitlement à tout le monde,
 * ce qui verrouillait silencieusement /content pour un espace joueur/parent (Phase 2) faute
 * d'entitlement "bibliotheque_contenus" — jamais détecté faute de compte réel pour tester.
 *
 * Exceptions (audit nuit 09-10/08) : "presences" et "sponsors" ne suivent PAS la règle
 * générique ci-dessus — un module gated par entitlement pour le club ne doit jamais devenir
 * "ouvert par défaut" pour un type d'organisation qui n'a jamais souscrit ce module. La règle
 * générique est correcte pour /content ou /messages (aucun entitlement club-only n'a de sens
 * pour un joueur/parent/projet), mais "presences" et "sponsors" désignent une vraie offre
 * commerciale que seuls certains types d'organisation ont pu signer.
 */
export function canAccess(ctx: ActiveContext, module: ModuleKey): boolean {
  if (!READY_MODULES.has(module)) return false;

  // "presences" (Présences terrain, Full Communication) : vendu uniquement au club — jamais
  // ouvert par défaut pour un coach, une académie, un événement ou un espace Projet, même si
  // aucun d'eux n'a d'entitlements réels. Voir entitlements.ts § "presences" et
  // FullCommunicationDashboard.tsx (canSeePresences) qui appliquait déjà ce garde-fou en aval.
  if (module === "presences") {
    if (ctx.organization.type !== "club") return false;
    const connectModuleKey = MODULE_TO_CONNECT_MODULE.presences;
    return connectModuleKey ? (ctx.entitlements?.[connectModuleKey]?.actif ?? false) : false;
  }

  // "sponsors" : CRM sponsors du club (gated par entitlement), inclus au contrat Full
  // Communication pour académie/événement, espace propre d'un partenaire (sponsors/page.tsx
  // bypass déjà canAccess pour lui via isPartner/PartnerView — inclus ici pour que le cadenas
  // de la Sidebar reste cohérent), et "Mes sponsors" pour un joueur. Jamais ouvert pour un
  // coach, un parent, une agence CM ou un espace Projet — voir SPONSORS_ORG_TYPES ci-dessus.
  if (module === "sponsors") {
    if (!SPONSORS_ORG_TYPES.has(ctx.organization.type)) return false;
    if (ctx.organization.type !== "club") return true;
    const connectModuleKey = MODULE_TO_CONNECT_MODULE.sponsors;
    return connectModuleKey ? (ctx.entitlements?.[connectModuleKey]?.actif ?? false) : false;
  }

  if (ctx.organization.type !== "club") return true;
  const connectModuleKey = MODULE_TO_CONNECT_MODULE[module];
  if (!connectModuleKey) return true;
  return ctx.entitlements?.[connectModuleKey]?.actif ?? false;
}

export function canCreate(ctx: ActiveContext, _resource: ResourceKey): boolean {
  if (ctx.membership.status !== "active") return false;
  if (READ_ONLY_ROLES.has(ctx.membership.role)) return false;
  return true;
}

export function hasEntitlement(ctx: ActiveContext, feature: FeatureKey): boolean {
  return ctx.membership.capabilities.includes(feature);
}

export function hasQuota(ctx: ActiveContext, quota: QuotaKey): boolean {
  const plan = PLANS[ctx.subscription.planCode];
  switch (quota) {
    case "monthly_visuals":
      return plan.monthlyCredits === null || ctx.subscription.creditsRemaining > 0;
    case "season_presences":
      return ctx.subscription.presencesUsed < plan.seasonPresences;
    case "storage":
      return ctx.subscription.storageUsedBytes < ctx.subscription.storageQuotaBytes;
    case "seats":
      return plan.maxUsers === null; // le décompte réel des sièges vit côté serveur
    default:
      return false;
  }
}

/** Raison lisible à afficher sur l'écran « module verrouillé » — voir ACTIONS.md § 26. */
export function lockedModuleMessage(ctx: ActiveContext): string {
  return `Ce module n'est pas activé sur votre contrat actuel (${PLANS[ctx.subscription.planCode].name}). Votre interlocuteur SportVision peut l'ajouter à tout moment.`;
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Audit Communication/Éducateur (§13/§14 du master doc, 12/08/2026) — un club_members.role n'a
// jamais filtré ni la navigation ni ces écrans (canAccess ci-dessus ne teste que type
// d'organisation + entitlements, jamais `ctx.membership.role`) : un communication_manager ou un
// coach voyait exactement le même menu qu'un admin, avec Contrats/Factures/Utilisateurs/Documents
// grand ouverts. Les 3 vues financières (client_devis/client_factures/client_contrats) sont déjà
// correctement restreintes au bureau côté RLS (club_member_has_financial_access, migration-
// connect-v41, 11/08) — ces deux helpers reproduisent la MÊME liste de rôles côté frontend, pour
// remplacer un "Aucun document pour le moment" trompeur (la requête renvoie [] silencieusement)
// par un message explicite, et pour piloter la navigation/les pages Utilisateurs et Paramètres
// (qui elles n'ont aucune protection RLS par rôle : club_members reste lisible par tout membre
// actif du club, cm_same_club_select, migration-clubplus-v1.sql).
// ───────────────────────────────────────────────────────────────────────────────────────────

/** Mêmes 4 rôles que club_member_has_financial_access() (migration-connect-v41-decisions-
 * produit-11-08.sql : admin/president/tresorier/membre_bureau), traduits via mapClubRole. */
const CLUB_BUREAU_ROLES: ReadonlySet<MembershipRole> = new Set(["admin", "president", "treasurer", "board_member"]);

/** Un membre de club voit-il les devis/factures/contrats du club ? Toujours vrai hors club (les
 * autres types d'organisation n'ont pas cette distinction de rôle). Conservée telle quelle
 * (nom et comportement inchangés) : c'est encore la fonction "write-capable" de référence pour
 * tout appelant existant qui doit rester bureau-only (contracts/page.tsx, les actions
 * approve_quote/sign_contract/pay_invoice ci-dessous, le filtre Finance de notifications/page.tsx).
 * Voir canViewClubFinancialDocuments ci-dessous pour la variante lecture élargie
 * (Bible §10, fondations "Autres rôles Club+" du 17/08/2026). */
export function hasClubFinancialAccess(ctx: ActiveContext): boolean {
  if (ctx.organization.type !== "club") return true;
  return CLUB_BUREAU_ROLES.has(ctx.membership.role);
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Distinction Voir / Agir sur les documents financiers (Bible §10/§19, 17/08/2026) : "approve_quote
// distinct de view_quote" (Trésorier), "Voir distinct de Signer" (Contrats), "Documents :
// Voir/télécharger selon permission ; signer uniquement si autorisé" (Secrétaire), "Factures selon
// délégation" (Administratif). hasClubFinancialAccess() ci-dessus reste le seul gate AVANT ce
// chantier : un booléen unique tout-ou-rien, jamais scindé voir/agir nulle part dans le code (grep
// vérifié sur billing/page.tsx, documents/page.tsx, contracts/page.tsx, notifications/page.tsx —
// seuls 4 appelants, tous des gates de PAGE, aucune action fine-grained existante).
//
// Bug corrigé au passage (priorité n°1 du brief) : NAV_CLUB_SECRETAIRE et NAV_CLUB_ADMINISTRATIF
// (navigation.ts) pointent toutes deux vers /documents, mais documents/page.tsx et billing/page.tsx
// gataient tout leur contenu derrière hasClubFinancialAccess — Secrétaire/Administratif tombaient
// sur "Accès refusé" en cliquant sur leur propre menu. canViewClubFinancialDocuments() corrige ça
// en élargissant la LECTURE à ces 2 rôles (+ Trésorier, déjà couvert par hasClubFinancialAccess).
// ───────────────────────────────────────────────────────────────────────────────────────────

/** Bureau historique + Secrétaire/Administratif (Bible §10) en LECTURE seule des devis, factures
 * et contrats du club — Trésorier est déjà dans CLUB_BUREAU_ROLES, pas besoin de le rajouter.
 * Toujours vrai hors club (même règle que hasClubFinancialAccess). N'élargit QUE la lecture :
 * aucune des actions ci-dessous (canApproveQuote/canSignContract/canPayInvoice) n'utilise cet
 * ensemble de rôles. */
const CLUB_FINANCIAL_VIEWER_ROLES: ReadonlySet<MembershipRole> = new Set([...CLUB_BUREAU_ROLES, "secretary", "admin_staff"]);

export function canViewClubFinancialDocuments(ctx: ActiveContext): boolean {
  if (ctx.organization.type !== "club") return true;
  return CLUB_FINANCIAL_VIEWER_ROLES.has(ctx.membership.role);
}

/** Accepter un devis (Bible §19 : "Voir / télécharger / accepter si approve_quote"). Fermé par
 * défaut au bureau historique — Secrétaire et Administratif voient (canViewClubFinancialDocuments)
 * mais n'agissent pas tant qu'aucun mécanisme de délégation fine par utilisateur n'existe (Bible
 * §10 : "signer uniquement si autorisé", pas de liste de délégation nominative aujourd'hui),
 * cohérent avec le "fermé par défaut" déjà retenu par le chantier précédent (fondations rôles).
 * Alias intentionnel de hasClubFinancialAccess aujourd'hui (même ensemble de rôles) : fonction
 * distincte pour que chaque call site exprime l'intention réelle (voir vs. agir), pas parce que
 * l'ensemble de rôles diffère pour l'instant. */
export function canApproveQuote(ctx: ActiveContext): boolean {
  return hasClubFinancialAccess(ctx);
}

/** Signer un contrat (Bible §19 : "Voir / télécharger / signer si sign_contract"). Même règle que
 * canApproveQuote ci-dessus — voir son commentaire. */
export function canSignContract(ctx: ActiveContext): boolean {
  return hasClubFinancialAccess(ctx);
}

/** Régler une facture (Bible §19 : "Régler uniquement si pay_invoice=true + facture payable +
 * paiement en ligne disponible"). Même règle que canApproveQuote ci-dessus — voir son commentaire. */
export function canPayInvoice(ctx: ActiveContext): boolean {
  return hasClubFinancialAccess(ctx);
}

/** Communication et Éducateur (§11 du master doc) : jamais Utilisateurs, jamais l'onglet
 * Paramètres > Organisation, jamais les documents financiers par défaut. */
const CLUB_COMM_EDUCATEUR_ROLES: ReadonlySet<MembershipRole> = new Set(["communication_manager", "coach"]);

export function isClubCommunicationOrEducateur(ctx: ActiveContext): boolean {
  return ctx.organization.type === "club" && CLUB_COMM_EDUCATEUR_ROLES.has(ctx.membership.role);
}

/** Les 6 rôles club "opérationnels" (Bible §7-§10) : Coach, Directeur sportif, Communication,
 * Secrétaire, Trésorier, Administratif — ni bureau (admin/president/board_member, "vision large"),
 * ni admin. Aucun n'a "Organisation" complète ni "Intégrations" dans son propre menu
 * (navigation.ts § CLUB_ROLE_NAV, fondations "Autres rôles Club+" du 17/08/2026) : même principe
 * "Mon profil" que Communication/Éducateur (isClubCommunicationOrEducateur, qui ne couvrait que 2
 * des 6 rôles réellement concernés), étendu aux 4 rôles ajoutés par ce chantier. Utilisée par
 * settings/layout.tsx, settings/organization/page.tsx, settings/integrations/page.tsx et le filtre
 * de catégorie "users" de notifications/page.tsx — PAS par users/page.tsx (hors périmètre de ce
 * chantier), qui continue d'utiliser isClubCommunicationOrEducateur telle quelle. */
const CLUB_NON_BUREAU_ROLES: ReadonlySet<MembershipRole> = new Set([
  ...CLUB_COMM_EDUCATEUR_ROLES,
  "secretary",
  "treasurer",
  "admin_staff",
  "sports_director",
]);

export function isClubNonBureauRole(ctx: ActiveContext): boolean {
  return ctx.organization.type === "club" && CLUB_NON_BUREAU_ROLES.has(ctx.membership.role);
}
