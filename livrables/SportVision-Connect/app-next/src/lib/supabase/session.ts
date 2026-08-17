import type { SupabaseClient, User as SupabaseUser } from "@supabase/supabase-js";
import type { ActiveContext, User } from "@/lib/types";
import { mapClubPlan, mapClubRole, mapOrgRole, mapOrgType, mapProjetRole, SPACE_TYPE_LABELS } from "./mappers";

function buildUserFromAuth(authUser: SupabaseUser): User {
  const meta = (authUser.user_metadata ?? {}) as { prenom?: string; nom?: string; telephone?: string; locale?: "fr" | "en" };
  return {
    id: authUser.id,
    firstName: meta.prenom ?? "",
    lastName: meta.nom ?? "",
    email: authUser.email ?? "",
    phone: meta.telephone,
    locale: meta.locale ?? "fr",
    theme: "dark",
    mfaEnabled: false,
    onboardingStep: 10,
    onboardingCompletedAt: authUser.created_at,
  };
}

// Reproduit bootAfterLogin() de l'app vanilla (app/index.html ~820-869) : un "espace" n'est pas
// forcément une organisation — un espace Joueur/Famille n'a pas de ligne `memberships`, juste une
// ligne `player_profiles`/`parent_profiles` propre (voir le commentaire original, index.html
// ~802-806). Voir le plan Phase 1 § Décisions d'architecture n°2 et n°3.

export const ACTIVE_SPACE_COOKIE = "sv_active_space";

export interface Space {
  // "delegated_club" (17/08/2026, chantier "vraie bascule d'espace" cm_agency, brief Fouka) : un
  // club auquel une agence CM a un accès délégué (cm_agency_club_access), PAS une organisation
  // dont l'utilisateur est membre — id = clubs.id, comme "organization"/club, mais volontairement
  // un kind distinct pour que layout.tsx route vers buildDelegatedClubActiveContext (qui
  // revérifie la délégation en direct) plutôt que buildClubActiveContext (qui exige une vraie
  // ligne club_members, inexistante ici par construction).
  kind: "organization" | "player" | "parent" | "delegated_club";
  /** organization_id pour kind="organization"/"delegated_club" ; player_profiles.id / parent_profiles.id sinon. */
  id: string;
  name: string;
  subtitle: string;
  /** false uniquement pour une organisation non-club (coach/académie/sponsor/projet réels) —
   * bascule espace par espace, voir le plan Phase 1 § Décisions d'architecture n°3. Club, joueur
   * et parent sont cliquables depuis la Phase 2. */
  clickable: boolean;
  organizationType?: string;
  membershipId?: string;
  role?: string;
  status?: string;
}

export function spaceKey(space: Pick<Space, "kind" | "id">): string {
  return `${space.kind}:${space.id}`;
}

interface MembershipRow {
  id: string;
  organization_id: string;
  role: string;
  status: string;
  organizations: { id: string; nom: string; organization_type: string; statut: string } | null;
}

export async function getSpaces(supabase: SupabaseClient, userId: string): Promise<Space[]> {
  const [orgRes, playerRes, parentRes] = await Promise.all([
    // 17/08/2026 — le filtre `.eq("status", "actif")` excluait totalement un membre invité ou
    // suspendu de cette liste : il n'apparaissait dans AUCUN écran, pas même une invitation à
    // accepter. Retiré : les 3 statuts réels (actif/invitation/suspendu) sont maintenant tous
    // remontés, `status` (déjà mappé sur chaque Space, voir plus bas) permet à l'appelant de
    // décider quoi en faire — pickActiveSpace (ci-dessous) ne sélectionne toujours automatiquement
    // qu'un espace `status === "active"`, jamais un espace invité/suspendu.
    supabase
      .from("memberships")
      .select("id, organization_id, role, status, organizations(id, nom, organization_type, statut)")
      .eq("user_id", userId),
    supabase.from("player_profiles").select("id, prenom, nom, account_status").eq("user_id", userId),
    supabase.from("parent_profiles").select("id, prenom, nom").eq("user_id", userId),
  ]);

  const spaces: Space[] = [];

  for (const row of (orgRes.data ?? []) as unknown as MembershipRow[]) {
    if (!row.organizations) continue;
    const orgType = row.organizations.organization_type;
    spaces.push({
      kind: "organization",
      id: row.organizations.id,
      name: row.organizations.nom,
      subtitle: SPACE_TYPE_LABELS[orgType] ?? orgType,
      // tournoi/stage/cm_agency (migration-connect-v20 puis migration-clubplus-v44) :
      // buildOrgSpaceActiveContext (plus bas dans ce fichier) les gère déjà pleinement, mais
      // restaient absents de cette liste — un espace tournoi/stage/cm_agency réel n'était donc
      // jamais cliquable, malgré un backend complet. Trouvé le 12/08/2026 en creusant pourquoi
      // un compte se retrouvait sur l'écran "aucun espace" et redirigé vers l'ancienne app.
      clickable:
        orgType === "club" ||
        orgType === "projet" ||
        orgType === "coach" ||
        orgType === "academie" ||
        // structure_coaching (17/08/2026, migration-connect-v78-signup-unifie-clubplus.sql) :
        // même socle réel que coach/académie/sponsor (memberships + organization_role_catalog,
        // pas d'entitlements) — voir GENERIC_ORG_TYPES/buildOrgSpaceActiveContext plus bas dans
        // ce fichier. Ajouté ici pour ne pas reproduire le bug trouvé le 12/08 (espace réel non
        // cliquable faute d'entrée dans cette liste, malgré un backend complet).
        orgType === "structure_coaching" ||
        orgType === "sponsor" ||
        orgType === "tournoi" ||
        orgType === "stage" ||
        orgType === "cm_agency",
      organizationType: orgType,
      membershipId: row.id,
      role: row.role,
      status: row.status,
    });
  }

  for (const row of (playerRes.data ?? []) as { id: string; prenom: string; nom: string }[]) {
    spaces.push({
      kind: "player",
      id: row.id,
      name: `${row.prenom} ${row.nom}`,
      subtitle: SPACE_TYPE_LABELS.player ?? "Joueur",
      clickable: true,
    });
  }

  for (const row of (parentRes.data ?? []) as { id: string; prenom: string; nom: string }[]) {
    spaces.push({
      kind: "parent",
      id: row.id,
      name: `${row.prenom} ${row.nom}`,
      subtitle: SPACE_TYPE_LABELS.parent ?? "Parent / Famille",
      clickable: true,
    });
  }

  // Clubs délégués à une agence CM dont l'utilisateur est membre actif (17/08/2026, "vraie
  // bascule d'espace" cm_agency, brief Fouka) — voir buildDelegatedClubActiveContext ci-dessous,
  // qui revérifie tout en direct au moment d'entrer (jamais confiance dans cette liste seule).
  // RLS de cm_agency_club_access (is_org_member(cm_agency_org_id) or is_org_member(club_id) or
  // is_staff()) fait déjà tout le travail de filtrage ici : cette requête ne peut renvoyer que les
  // délégations des agences dont l'utilisateur est réellement membre actif.
  const cmAgencyOrgIds = ((orgRes.data ?? []) as unknown as MembershipRow[])
    .filter((row) => row.organizations?.organization_type === "cm_agency" && row.status === "actif")
    .map((row) => row.organization_id);

  if (cmAgencyOrgIds.length > 0) {
    const { data: delegatedRows } = await supabase
      .from("cm_agency_club_access")
      .select("id, club_id, expires_at, clubs(nom)")
      .in("cm_agency_org_id", cmAgencyOrgIds);

    const today = new Date().toISOString().slice(0, 10);
    for (const row of (delegatedRows ?? []) as unknown as { id: string; club_id: string; expires_at: string | null; clubs: { nom: string } | null }[]) {
      // Une délégation expirée n'apparaît même pas comme espace cliquable — pas de distinction
      // "visible mais grisé" ici, contrairement à un statut invitation/suspendu (getSpaces ne
      // filtre normalement rien, mais une délégation expirée n'a stricto sensu jamais existé du
      // point de vue de l'utilisateur, ce n'est pas un état intermédiaire à afficher).
      if (row.expires_at && row.expires_at < today) continue;
      spaces.push({
        kind: "delegated_club",
        id: row.club_id,
        name: row.clubs?.nom ?? "Club",
        subtitle: "Accès délégué (agence CM)",
        clickable: true,
        organizationType: "club",
      });
    }
  }

  return spaces;
}

/** Précédence identique à openSpace()/bootAfterLogin() : dernier espace cliquable mémorisé,
 * sinon auto-sélection si un seul espace cliquable, sinon aucun (écran sélecteur).
 *
 * 17/08/2026 — `s.status` (valeur brute française, voir getSpaces ci-dessus : "actif"/
 * "invitation"/"suspendu" pour un espace organisation, `undefined` pour joueur/parent, aucun
 * concept de statut côté Connect) doit valoir "actif" ou être absent pour être auto-sélectionnable
 * — sans cette garde, un membre invité mais pas encore accepté, ou suspendu, se serait retrouvé
 * placé DANS l'espace comme s'il en était déjà membre actif (getSpaces ne filtre plus par statut
 * depuis ce même correctif, précisément pour qu'un statut non-actif reste visible côté écran
 * "aucun espace actif" plutôt que d'être invisible — mais jamais auto-entré). */
export function pickActiveSpace(spaces: Space[], rememberedKey: string | undefined): Space | null {
  const eligible = spaces.filter((s) => s.clickable && (s.status === undefined || s.status === "actif"));
  if (rememberedKey) {
    const remembered = eligible.find((s) => spaceKey(s) === rememberedKey);
    if (remembered) return remembered;
  }
  if (eligible.length === 1) return eligible[0]!;
  return null;
}

interface ClubRow {
  id: string;
  ville: string | null;
  discipline: string | null;
  plan: string;
  engagement: string;
  credits_balance: number;
  credits_monthly: number;
  credits_reserved: number;
  portail_client_id: string | null;
}

interface EntitlementRow {
  module_key: string;
  actif: boolean;
  quota_credits: number | null;
  priorite: string;
}

/** Construit l'ActiveContext complet pour un espace organisation de type club. */
export async function buildClubActiveContext(
  supabase: SupabaseClient,
  authUser: SupabaseUser,
  space: Space,
): Promise<ActiveContext | null> {
  if (space.kind !== "organization" || !space.clickable) return null;

  const [orgRes, clubRes, entitlementsRes, memberRes] = await Promise.all([
    supabase.from("organizations").select("id, nom, organization_type, created_at").eq("id", space.id).maybeSingle(),
    supabase
      .from("clubs")
      .select("id, ville, discipline, plan, engagement, credits_balance, credits_monthly, credits_reserved, portail_client_id")
      .eq("id", space.id)
      .maybeSingle(),
    supabase
      .from("organization_entitlements")
      .select("module_key, actif, quota_credits, priorite")
      .eq("organization_id", space.id),
    // `teams` (§7.1 du master doc, "équipe/catégorie facultative" à l'invitation) — pas porté par
    // `memberships` (qui ne reprend que role/status, voir sync_club_member_to_membership,
    // migration-connect-v10), une requête dédiée sur club_members est nécessaire pour la "lecture
    // ciblée" d'un éducateur (§14) — voir ClubServicesBoard.tsx. cm_self_select (auth.uid() =
    // user_id, migration-clubplus-v1.sql) l'autorise sans condition de statut.
    supabase.from("club_members").select("teams").eq("club_id", space.id).eq("user_id", authUser.id).maybeSingle(),
  ]);

  const org = orgRes.data as { id: string; nom: string; organization_type: string; created_at: string } | null;
  const club = clubRes.data as ClubRow | null;
  if (!org || !club || !space.role) return null;

  // Un club réel n'a jamais organization_entitlements/clubs.plan pour distinguer "Full
  // Communication" de Club+ : ce plan est vendu par contrat, pas par abonnement logiciel. Dérivé
  // d'un contrat réel actif (contrats.type_contrat='full_communication', migration-contrats-v2)
  // lié au client Portail relié au club — jamais d'un nouveau champ sur `clubs`. Un club sans
  // portail_client_id (jamais relié) ou sans contrat actif de ce type retombe sur club/performance
  // via mapClubPlan, comportement inchangé.
  //
  // Lit `client_contrats` (vue, migration-clubplus-v33), PAS `contrats` directement : `contrats`
  // n'a de policy RLS que pour le staff (admin/sec/com/compta), fail-closed pour un membre de
  // club — un accès direct renvoyait donc toujours 0 ligne, peu importe l'existence réelle du
  // contrat. Confirmé indépendamment par 5 agents lors de l'audit UI/UX du 11/08/2026 : aucun
  // vrai club Full Communication n'a jamais pu obtenir isFullCommunication=true (mauvais
  // dashboard, mauvaise nav, jamais mis en avant Validations/Publications/Statistiques/Rapports).
  let isFullCommunication = false;
  if (club.portail_client_id) {
    const { data: contract } = await supabase
      .from("client_contrats")
      .select("id")
      .eq("client_id", club.portail_client_id)
      .eq("type_contrat", "full_communication")
      .eq("statut", "actif")
      .limit(1)
      .maybeSingle();
    isFullCommunication = Boolean(contract);
  }

  const entitlements: NonNullable<ActiveContext["entitlements"]> = {};
  for (const row of (entitlementsRes.data ?? []) as EntitlementRow[]) {
    entitlements[row.module_key] = {
      actif: row.actif,
      quotaCredits: row.quota_credits,
      priorite: row.priorite === "prioritaire" ? "prioritaire" : "standard",
    };
  }

  return {
    user: buildUserFromAuth(authUser),
    organization: {
      id: org.id,
      type: mapOrgType(org.organization_type),
      name: org.nom,
      createdAt: org.created_at,
    },
    membership: {
      id: space.membershipId!,
      userId: authUser.id,
      organizationId: org.id,
      role: mapClubRole(space.role),
      teamScope: Array.isArray(memberRes.data?.teams) ? (memberRes.data!.teams as string[]) : [],
      capabilities: [],
      status: space.status === "actif" ? "active" : space.status === "invitation" ? "invited" : "disabled",
    },
    subscription: {
      id: `sub-${club.id}`,
      organizationId: org.id,
      planCode: isFullCommunication ? "full_communication" : mapClubPlan(club.plan),
      status: "active",
      startsAt: org.created_at,
      renewsAt: org.created_at,
      commitmentMonths: club.engagement === "12mois" ? 12 : 0,
      noticeMonths: 0,
      creditsRemaining: Math.max(0, club.credits_balance - club.credits_reserved),
      creditsReserved: club.credits_reserved,
      // Non trackés côté réel pour l'instant — voir le plan Phase 1 § permissions.ts.
      presencesUsed: 0,
      storageUsedBytes: 0,
      storageQuotaBytes: 1,
    },
    entitlements,
  };
}

/**
 * Construit l'ActiveContext pour un club auquel l'utilisateur accède via une délégation d'agence
 * CM (`cm_agency_club_access`), PAS via une ligne `club_members` — voir Space.kind="delegated_club"
 * ci-dessus. 17/08/2026, "vraie bascule d'espace" cm_agency (brief Fouka) : jusqu'ici, "Ouvrir" sur
 * un accès délégué (/accompagnement) n'ouvrait rien de réel — le club était seulement listé en
 * lecture, aucune interaction technique possible.
 *
 * Sécurité : la délégation est REVÉRIFIÉE en direct ici (jamais confiance dans le Space déjà
 * résolu par getSpaces(), même principe que buildClubActiveContext/clubplus-activate) — vivante
 * (ligne encore présente en base, cm_agency_club_access n'a pas de statut "révoqué", révoquer =
 * supprimer la ligne) ET non expirée. Retourne null si l'une des deux conditions n'est plus vraie,
 * ce qui fait immédiatement disparaître l'espace côté utilisateur, sans purge différée à gérer :
 * aucun état technique persistant (pas de ligne club_members créée) ne survit à une révocation.
 *
 * Rôle : "external_cm" (MembershipRole), IDENTIQUE au rôle qu'un club donnerait lui-même à un CM
 * externe invité directement (club_members.role='cm_externe', voir mappers.ts) — même navigation
 * (NAV_CLUB_COMMUNICATION), mêmes pages, "il ne devient jamais administrateur" (Bible §9). C'est
 * aussi le rôle qui porte techniquement l'accès en base : is_club_member() (migration-clubplus-v1,
 * étendue par migration-connect-v80-cm-agency-delegated-club-access.sql) reconnaît désormais CE
 * chemin d'accès en plus d'une vraie ligne club_members active, donc TOUTES les policies RLS déjà
 * bâties sur is_club_member() (contenus, club_requests, club_sponsors, calendrier...) fonctionnent
 * ici sans modification supplémentaire — pas de nouvelle surface RLS par table, un seul point
 * d'extension déjà réutilisé partout. Les documents financiers restent hors de portée (fonction
 * séparée, club_member_has_financial_access/view_access, non touchée par cette extension) : une
 * agence CM déléguée ne voit jamais les factures du club, cohérent avec le périmètre "négocié"
 * (allowed/denied) qui n'a jamais inclus "Facturation" dans aucune délégation existante.
 */
export async function buildDelegatedClubActiveContext(
  supabase: SupabaseClient,
  authUser: SupabaseUser,
  space: Space,
): Promise<ActiveContext | null> {
  if (space.kind !== "delegated_club") return null;

  const [clubRes, myMembershipsRes] = await Promise.all([
    supabase
      .from("clubs")
      .select("id, ville, discipline, plan, engagement, credits_balance, credits_monthly, credits_reserved, portail_client_id")
      .eq("id", space.id)
      .maybeSingle(),
    supabase.from("memberships").select("organization_id").eq("user_id", authUser.id).eq("status", "actif"),
  ]);

  const club = clubRes.data as ClubRow | null;
  if (!club) return null;

  const myOrgIds = ((myMembershipsRes.data ?? []) as { organization_id: string }[]).map((m) => m.organization_id);
  if (myOrgIds.length === 0) return null;

  const { data: delegation } = await supabase
    .from("cm_agency_club_access")
    .select("id, expires_at")
    .eq("club_id", space.id)
    .in("cm_agency_org_id", myOrgIds)
    .maybeSingle();
  if (!delegation) return null;
  if (delegation.expires_at && delegation.expires_at < new Date().toISOString().slice(0, 10)) return null;

  const { data: org } = await supabase.from("organizations").select("id, nom, created_at").eq("id", space.id).maybeSingle();
  if (!org) return null;

  let isFullCommunication = false;
  if (club.portail_client_id) {
    const { data: contract } = await supabase
      .from("client_contrats")
      .select("id")
      .eq("client_id", club.portail_client_id)
      .eq("type_contrat", "full_communication")
      .eq("statut", "actif")
      .limit(1)
      .maybeSingle();
    isFullCommunication = Boolean(contract);
  }

  return {
    user: buildUserFromAuth(authUser),
    organization: {
      id: org.id,
      type: "club",
      name: org.nom,
      createdAt: org.created_at,
    },
    membership: {
      id: `delegated-${delegation.id}`,
      userId: authUser.id,
      organizationId: org.id,
      role: "external_cm",
      teamScope: [],
      capabilities: [],
      status: "active",
    },
    subscription: {
      id: `sub-${club.id}`,
      organizationId: org.id,
      planCode: isFullCommunication ? "full_communication" : mapClubPlan(club.plan),
      status: "active",
      startsAt: org.created_at,
      renewsAt: org.created_at,
      commitmentMonths: club.engagement === "12mois" ? 12 : 0,
      noticeMonths: 0,
      creditsRemaining: Math.max(0, club.credits_balance - club.credits_reserved),
      creditsReserved: club.credits_reserved,
      presencesUsed: 0,
      storageUsedBytes: 0,
      storageQuotaBytes: 1,
    },
  };
}

interface PlayerProfileRow {
  id: string;
  club_id: string;
  prenom: string;
  nom: string;
  account_status: string;
  created_at: string;
}

/**
 * Construit l'ActiveContext pour un espace Joueur — voir le plan Phase 2 § Décisions
 * d'architecture n°1. `membership`/`subscription` sont synthétiques (un joueur n'a ni ligne
 * `memberships` ni `clubs` propre) : role "player", plan "club_access" (déjà la convention posée
 * par le mock pour "inclus dans l'offre du club"), quotas à 0 (non trackés côté réel).
 * `entitlements` reste undefined — canAccess() verrouille alors tout module gated par une clé
 * (teams, matchcenter, sponsors...), ce qui est le comportement voulu pour un espace personnel.
 */
export async function buildPlayerActiveContext(
  supabase: SupabaseClient,
  authUser: SupabaseUser,
  space: Space,
): Promise<ActiveContext | null> {
  if (space.kind !== "player") return null;

  const { data } = await supabase
    .from("player_profiles")
    .select("id, club_id, prenom, nom, account_status, created_at")
    .eq("id", space.id)
    .maybeSingle();
  const player = data as PlayerProfileRow | null;
  if (!player) return null;

  return {
    user: buildUserFromAuth(authUser),
    organization: {
      id: player.id,
      type: "player",
      name: `${player.prenom} ${player.nom}`,
      // Toujours résolvable : player_profiles.club_id est NOT NULL en base (un joueur appartient
      // toujours à un seul club) — voir le plan Phase 2 § Décisions d'architecture n°1.
      parentOrganizationId: player.club_id,
      createdAt: player.created_at,
    },
    membership: {
      id: `player-membership-${player.id}`,
      userId: authUser.id,
      organizationId: player.id,
      role: "player",
      teamScope: [],
      capabilities: [],
      status: player.account_status === "actif" ? "active" : "disabled",
    },
    subscription: {
      id: `sub-${player.id}`,
      organizationId: player.id,
      planCode: "club_access",
      status: "active",
      startsAt: player.created_at,
      renewsAt: player.created_at,
      commitmentMonths: 0,
      noticeMonths: 0,
      creditsRemaining: 0,
      creditsReserved: 0,
      presencesUsed: 0,
      storageUsedBytes: 0,
      storageQuotaBytes: 1,
    },
  };
}

interface ParentProfileRow {
  id: string;
  prenom: string | null;
  nom: string | null;
  created_at: string;
}

/**
 * Construit l'ActiveContext pour un espace Famille. `organization.parentOrganizationId` reste
 * undefined (contrairement au joueur) : un parent peut avoir des enfants dans plusieurs clubs,
 * pas de club unique à résoudre sans ambiguïté — voir le plan Phase 2 § Décisions
 * d'architecture n°1. `membership.status` = "active" si au moins un enfant confirmé
 * (`parent_player_relationships.statut='confirme'`), sinon "invited" (en attente).
 */
export async function buildParentActiveContext(
  supabase: SupabaseClient,
  authUser: SupabaseUser,
  space: Space,
): Promise<ActiveContext | null> {
  if (space.kind !== "parent") return null;

  const [parentRes, confirmedRes] = await Promise.all([
    supabase.from("parent_profiles").select("id, prenom, nom, created_at").eq("id", space.id).maybeSingle(),
    supabase
      .from("parent_player_relationships")
      .select("id", { count: "exact", head: true })
      .eq("parent_id", space.id)
      .eq("statut", "confirme"),
  ]);
  const parent = parentRes.data as ParentProfileRow | null;
  if (!parent) return null;

  return {
    user: buildUserFromAuth(authUser),
    organization: {
      id: parent.id,
      type: "parent",
      name: `${parent.prenom ?? ""} ${parent.nom ?? ""}`.trim() || (authUser.email ?? "Parent"),
      createdAt: parent.created_at,
    },
    membership: {
      id: `parent-membership-${parent.id}`,
      userId: authUser.id,
      organizationId: parent.id,
      role: "parent",
      teamScope: [],
      capabilities: [],
      status: (confirmedRes.count ?? 0) > 0 ? "active" : "invited",
    },
    subscription: {
      id: `sub-${parent.id}`,
      organizationId: parent.id,
      planCode: "club_access",
      status: "active",
      startsAt: parent.created_at,
      renewsAt: parent.created_at,
      commitmentMonths: 0,
      noticeMonths: 0,
      creditsRemaining: 0,
      creditsReserved: 0,
      presencesUsed: 0,
      storageUsedBytes: 0,
      storageQuotaBytes: 1,
    },
  };
}

interface ProjetOrgRow {
  id: string;
  nom: string;
  organization_type: string;
  created_at: string;
  credits_balance: number;
  credits_reserved: number;
}

/**
 * Construit l'ActiveContext pour un espace Projet (organizations.organization_type='projet',
 * client ponctuel indépendant — ex-Portail). Contrairement à joueur/parent, une vraie ligne
 * `memberships` existe (role réel toujours 'client', posé par sync_client_user_to_membership) —
 * voir le plan Phase 3 § Décisions d'architecture n°1. Pas de `clubs`/`organization_entitlements` :
 * planCode "one_off" ("Facturé à la commande"), entitlements undefined (aucun module Projet n'est
 * gated par une clé connect_modules de toute façon).
 *
 * `creditsRemaining` lit désormais organizations.credits_balance/credits_reserved (migration-
 * connect-v24-projet-credits.sql), même formule que buildClubActiveContext ci-dessus
 * (Math.max(0, balance - reserved)) — plus de 0 en dur. Un espace Projet n'a pas de rechargement
 * automatique (pas d'abonnement Stripe récurrent, "facturé à la commande") : le crédit est
 * accordé manuellement par le staff SportVision via credit_organization() (fiche client Projet,
 * SportVision OS). Un client jamais crédité affiche donc honnêtement 0, jamais une valeur inventée.
 */
export async function buildProjetActiveContext(
  supabase: SupabaseClient,
  authUser: SupabaseUser,
  space: Space,
): Promise<ActiveContext | null> {
  if (space.kind !== "organization" || space.organizationType !== "projet" || !space.clickable) return null;

  const { data } = await supabase
    .from("organizations")
    .select("id, nom, organization_type, created_at, credits_balance, credits_reserved")
    .eq("id", space.id)
    .maybeSingle();
  const org = data as ProjetOrgRow | null;
  if (!org || !space.role) return null;

  return {
    user: buildUserFromAuth(authUser),
    organization: {
      id: org.id,
      type: mapOrgType(org.organization_type),
      name: org.nom,
      createdAt: org.created_at,
    },
    membership: {
      id: space.membershipId!,
      userId: authUser.id,
      organizationId: org.id,
      role: mapProjetRole(space.role),
      teamScope: [],
      capabilities: [],
      status: space.status === "actif" ? "active" : space.status === "invitation" ? "invited" : "disabled",
    },
    subscription: {
      id: `sub-${org.id}`,
      organizationId: org.id,
      planCode: "one_off",
      status: "active",
      startsAt: org.created_at,
      renewsAt: org.created_at,
      commitmentMonths: 0,
      noticeMonths: 0,
      creditsRemaining: Math.max(0, org.credits_balance - org.credits_reserved),
      creditsReserved: org.credits_reserved,
      presencesUsed: 0,
      storageUsedBytes: 0,
      storageQuotaBytes: 1,
    },
  };
}

// tournoi/stage/cm_agency (migration-connect-v20 puis migration-clubplus-v44, bascule 2 org
// types séparés) ajoutés le 10/08 puis 17/08 : même socle réel exact que coach/académie/sponsor
// (memberships + organization_role_catalog, pas d'entitlements) — seule différence, leur
// création passe par connect-staff-create-org/connect-org-activate (staff) plutôt que
// connect-org-signup (self-service), ce qui ne change rien ici : cette fonction lit uniquement
// l'état déjà en base, peu importe comment il y est arrivé.
// Exporté (17/08/2026) : app/(app)/layout.tsx maintenait sa propre copie locale
// (GENERIC_SPACE_TYPES) pour aiguiller Space -> builder d'ActiveContext, jamais mise à jour au fil
// des ajouts successifs de types à cette liste (structure_coaching le 17/08, tournoi/stage/
// cm_agency avant) — trouvé en creusant le chantier "vraie bascule d'espace" cm_agency : ces 4
// types tombaient tous dans buildClubActiveContext (aucune ligne `clubs` pour eux, `club` toujours
// null), donc systématiquement sur l'écran "Aucun espace disponible", malgré un backend complet et
// un dashboard/nav entièrement fonctionnels une fois dans l'app. Une seule source de vérité
// désormais : layout.tsx importe cette liste plutôt que d'en garder une copie.
export const GENERIC_ORG_TYPES = ["coach", "academie", "structure_coaching", "sponsor", "tournoi", "stage", "cm_agency"] as const;
type GenericOrgType = (typeof GENERIC_ORG_TYPES)[number];

/**
 * Construit l'ActiveContext pour un espace Coach, Académie, Sponsor, Tournoi/Événement, Stage/
 * Camp ou Agence CM. Les 6 partagent le même socle réel (migration-connect-v3/v4/v6/v20,
 * migration-clubplus-v44) : une vraie ligne `memberships`, un rôle réel via
 * `organization_role_catalog` (pas de check constraint en dur comme pour club_members), et
 * aucune `organization_entitlements` (pas de plan/quota vendu — planCode "one_off", comme pour
 * un espace projet). Une seule fonction paramétrée plutôt que 6 quasi-identiques : les 6
 * backends sont structurellement identiques, seul le rôle diffère.
 */
export async function buildOrgSpaceActiveContext(
  supabase: SupabaseClient,
  authUser: SupabaseUser,
  space: Space,
): Promise<ActiveContext | null> {
  if (space.kind !== "organization" || !space.clickable) return null;
  if (!GENERIC_ORG_TYPES.includes(space.organizationType as GenericOrgType)) return null;
  const orgType = space.organizationType as GenericOrgType;

  const { data } = await supabase
    .from("organizations")
    .select("id, nom, organization_type, created_at")
    .eq("id", space.id)
    .maybeSingle();
  const org = data as { id: string; nom: string; organization_type: string; created_at: string } | null;
  if (!org || !space.role) return null;

  return {
    user: buildUserFromAuth(authUser),
    organization: {
      id: org.id,
      type: mapOrgType(org.organization_type),
      name: org.nom,
      createdAt: org.created_at,
    },
    membership: {
      id: space.membershipId!,
      userId: authUser.id,
      organizationId: org.id,
      role: mapOrgRole(orgType, space.role),
      teamScope: [],
      capabilities: [],
      status: space.status === "actif" ? "active" : space.status === "invitation" ? "invited" : "disabled",
    },
    subscription: {
      id: `sub-${org.id}`,
      organizationId: org.id,
      planCode: "one_off",
      status: "active",
      startsAt: org.created_at,
      renewsAt: org.created_at,
      commitmentMonths: 0,
      noticeMonths: 0,
      creditsRemaining: 0,
      creditsReserved: 0,
      presencesUsed: 0,
      storageUsedBytes: 0,
      storageQuotaBytes: 1,
    },
  };
}
