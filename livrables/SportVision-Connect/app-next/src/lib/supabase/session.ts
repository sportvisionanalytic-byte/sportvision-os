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
  cm_super_access: boolean;
  organizations: { id: string; nom: string; organization_type: string; statut: string } | null;
}

export async function getSpaces(supabase: SupabaseClient, userId: string): Promise<Space[]> {
  // Espaces Joueur/Famille retirés de Club+ (19/08/2026, décision Fouka après audit démo) :
  // ces personas appartiennent exclusivement à SportVision Connect (app-connect), jamais à
  // Club+, qui est l'espace professionnel de la structure. buildPlayerActiveContext/
  // buildParentActiveContext (plus bas dans ce fichier) et le kind "player"/"parent" de `Space`
  // restent en place (code atteignable en théorie si un cookie sv_active_space pointe encore
  // dessus) mais ne sont plus jamais PROPOSÉS : getSpaces() ne requête plus player_profiles/
  // parent_profiles, donc aucun nouvel espace de ce type n'apparaît dans le sélecteur.
  // Vérifié avant ce changement : 0 ligne player_profiles avec club_id, 0 ligne parent_profiles,
  // 0 relation parent_player_relationships confirmée en base — aucun compte réel n'utilise ce
  // chemin aujourd'hui, rien ne casse.
  const [orgRes] = await Promise.all([
    // 17/08/2026 — le filtre `.eq("status", "actif")` excluait totalement un membre invité ou
    // suspendu de cette liste : il n'apparaissait dans AUCUN écran, pas même une invitation à
    // accepter. Retiré : les 3 statuts réels (actif/invitation/suspendu) sont maintenant tous
    // remontés, `status` (déjà mappé sur chaque Space, voir plus bas) permet à l'appelant de
    // décider quoi en faire — pickActiveSpace (ci-dessous) ne sélectionne toujours automatiquement
    // qu'un espace `status === "active"`, jamais un espace invité/suspendu.
    supabase
      .from("memberships")
      .select("id, organization_id, role, status, cm_super_access, organizations(id, nom, organization_type, statut)")
      .eq("user_id", userId),
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

  // Clubs délégués à une agence CM dont l'utilisateur est membre actif (17/08/2026, "vraie
  // bascule d'espace" cm_agency, brief Fouka) — voir buildDelegatedClubActiveContext ci-dessous,
  // qui revérifie tout en direct au moment d'entrer (jamais confiance dans cette liste seule).
  // RLS de cm_agency_club_access (is_org_member(cm_agency_org_id) or is_org_member(club_id) or
  // is_staff()) fait déjà tout le travail de filtrage ici : cette requête ne peut renvoyer que les
  // délégations des agences dont l'utilisateur est réellement membre actif.
  const cmAgencyOrgIds = ((orgRes.data ?? []) as unknown as MembershipRow[])
    .filter((row) => row.organizations?.organization_type === "cm_agency" && row.status === "actif")
    .map((row) => row.organization_id);

  const delegatedClubIds = new Set<string>();

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
      delegatedClubIds.add(row.club_id);
    }
  }

  // "CM responsable" (22/08/2026, demande Fouka) : un membre actif d'une organisation cm_agency
  // avec memberships.cm_super_access=true voit TOUS les clubs, pas seulement ceux délégués via
  // cm_agency_club_access — voir migration-cm-agency-super-access-staff.sql et le même bloc dans
  // is_club_member/is_club_admin/is_team_educateur (RLS). Dédoublonné avec les délégations
  // explicites ci-dessus (un club peut avoir les deux, la délégation explicite garde son libellé).
  const hasSuperAccess = ((orgRes.data ?? []) as unknown as MembershipRow[]).some(
    (row) => row.organizations?.organization_type === "cm_agency" && row.status === "actif" && row.cm_super_access,
  );
  if (hasSuperAccess) {
    const { data: allClubs } = await supabase.from("clubs").select("id, nom").order("nom");
    for (const c of (allClubs ?? []) as { id: string; nom: string }[]) {
      if (delegatedClubIds.has(c.id)) continue;
      spaces.push({
        kind: "delegated_club",
        id: c.id,
        name: c.nom,
        subtitle: "Accès total (CM SportVision)",
        clickable: true,
        organizationType: "club",
      });
      delegatedClubIds.add(c.id);
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
  logo_url: string | null;
  adresse: string | null;
  instagram_handle: string | null;
  siret: string | null;
  couleur_primaire: string | null;
  couleur_secondaire: string | null;
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
      .select(
        "id, ville, discipline, plan, engagement, credits_balance, credits_monthly, credits_reserved, portail_client_id, logo_url, adresse, instagram_handle, siret, couleur_primaire, couleur_secondaire",
      )
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
  // RPC client_has_active_fullcomm_contract (migration-clubplus-v96, 20/08) — PAS client_contrats
  // (vue) : `client_contrats` a une RLS restreinte à club_member_has_financial_view_access
  // (admin/president/tresorier/membre_bureau/secretaire/administratif uniquement), donc un membre
  // coach/resp_equipe/cm_externe d'un VRAI club Full Communication obtenait quand même 0 ligne —
  // même panne qu'INC-004 (11/08), reproduite en E2E le 20/08 sur ce chemin précis. Le RPC ne
  // renvoie qu'un booléen (aucune fuite de donnée financière) et reconnaît tout membre actif via
  // is_club_member() (club_members OU délégation cm_agency_club_access).
  let isFullCommunication = false;
  if (club.portail_client_id) {
    const { data: hasContract } = await supabase.rpc("client_has_active_fullcomm_contract", {
      p_client_id: club.portail_client_id,
    });
    isFullCommunication = hasContract === true;
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
      logoUrl: club.logo_url ?? undefined,
      address: club.adresse ?? undefined,
      instagramHandle: club.instagram_handle ?? undefined,
      siret: club.siret ?? undefined,
      brandColors:
        club.couleur_primaire || club.couleur_secondaire
          ? [club.couleur_primaire ?? "#4F7DFF", club.couleur_secondaire ?? "#A855F7"]
          : undefined,
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
    supabase
      .from("memberships")
      .select("organization_id, cm_super_access, organizations(organization_type)")
      .eq("user_id", authUser.id)
      .eq("status", "actif"),
  ]);

  const club = clubRes.data as ClubRow | null;
  if (!club) return null;

  const myMemberships = (myMembershipsRes.data ?? []) as unknown as {
    organization_id: string;
    cm_super_access: boolean;
    organizations: { organization_type: string } | null;
  }[];
  const myOrgIds = myMemberships.map((m) => m.organization_id);
  if (myOrgIds.length === 0) return null;

  // "CM responsable" (22/08/2026) : un accès total (cm_super_access sur une organisation
  // cm_agency) dispense de la ligne cm_agency_club_access par club — même garde-fou que getSpaces()
  // ci-dessus. Toujours revérifié en direct ici, jamais confiance dans le Space déjà résolu.
  const hasSuperAccess = myMemberships.some((m) => m.cm_super_access && m.organizations?.organization_type === "cm_agency");

  // Identifiant stable pour membership.id ci-dessous : celui de la ligne cm_agency_club_access
  // réelle quand elle existe, un tag fixe "super" sinon (accès total, aucune ligne par club).
  let delegationMembershipId = "super";
  if (!hasSuperAccess) {
    const { data: delegation } = await supabase
      .from("cm_agency_club_access")
      .select("id, expires_at")
      .eq("club_id", space.id)
      .in("cm_agency_org_id", myOrgIds)
      .maybeSingle();
    if (!delegation) return null;
    if (delegation.expires_at && delegation.expires_at < new Date().toISOString().slice(0, 10)) return null;
    delegationMembershipId = delegation.id;
  }

  const { data: org } = await supabase.from("organizations").select("id, nom, created_at").eq("id", space.id).maybeSingle();
  if (!org) return null;

  // Voir le commentaire équivalent dans buildClubActiveContext ci-dessus (même correctif,
  // migration-clubplus-v96, 20/08) — ce chemin délégué (agence CM externe, cm_agency_club_access)
  // n'a JAMAIS de ligne club_members pour ce club : avec l'ancienne lecture de client_contrats,
  // isFullCommunication était donc TOUJOURS false ici, quel que soit le contrat réel. is_club_member()
  // (utilisée par le RPC) couvre déjà ce chemin de délégation, pas seulement l'appartenance directe.
  let isFullCommunication = false;
  if (club.portail_client_id) {
    const { data: hasContract } = await supabase.rpc("client_has_active_fullcomm_contract", {
      p_client_id: club.portail_client_id,
    });
    isFullCommunication = hasContract === true;
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
      id: `delegated-${delegationMembershipId}`,
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
 * entitlements undefined (aucun module Projet n'est gated par une clé connect_modules de toute
 * façon).
 *
 * planCode "one_off" ("Facturé à la commande") par défaut, "full_communication" si un contrat réel
 * actif de ce type existe pour ce client (31/08/2026, audit Communication & Contenu — bug trouvé :
 * cette fonction posait "one_off" sans jamais vérifier `contrats`, alors que /communication,
 * /publications, /mycm, /validations savent PARFAITEMENT servir un espace Projet Full
 * Communication dès qu'on y accède par URL directe — useClientId() résout déjà client_id = org.id
 * pour "generic" ; seul le dashboard/aiguilleur (dashboard/page.tsx) et la navigation
 * (resolveNavigation, gated sur ctx.subscription.planCode) ignoraient totalement ce cas. Un client
 * Projet Full Communication réel n'avait donc AUCUN moyen de découvrir Communication/Publications/
 * Mon CM/À valider — badge "Prestation unique" trompeur en prime. Même vue `client_contrats` que
 * fetchIsFullCommunication (data/shared/community-manager.ts), donc même filtre RLS déjà éprouvé
 * (client_users) : pas de nouvelle surface d'accès. Club/cm_agency-délégué restent la seule
 * référence pour la détection RPC `client_has_active_fullcomm_contract` — non réutilisable ici, son
 * second EXISTS exige une ligne `clubs`, qu'un espace Projet n'a jamais.
 */
export async function buildProjetActiveContext(
  supabase: SupabaseClient,
  authUser: SupabaseUser,
  space: Space,
): Promise<ActiveContext | null> {
  if (space.kind !== "organization" || space.organizationType !== "projet" || !space.clickable) return null;

  const [orgRes, contractRes] = await Promise.all([
    supabase
      .from("organizations")
      .select("id, nom, organization_type, created_at, credits_balance, credits_reserved")
      .eq("id", space.id)
      .maybeSingle(),
    supabase
      .from("client_contrats")
      .select("id")
      .eq("client_id", space.id)
      .eq("type_contrat", "full_communication")
      .eq("statut", "actif")
      .limit(1)
      .maybeSingle(),
  ]);
  const org = orgRes.data as ProjetOrgRow | null;
  if (!org || !space.role) return null;
  const isFullCommunication = Boolean(contractRes.data);

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
      planCode: isFullCommunication ? "full_communication" : "one_off",
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

// Sous-ensemble de GENERIC_ORG_TYPES qui vend réellement un contrat Full Communication (31/08/2026,
// bug trouvé en creusant le correctif buildProjetActiveContext du même jour) : resolveNavigation()
// (navigation.ts) a TOUJOURS eu des arbres dédiés NAV_COACH_FULLCOM/NAV_ACADEMY_FULLCOM/
// NAV_TOURNAMENT_FULLCOM/NAV_CAMP_FULLCOM, gated sur planCode==="full_communication" — mais
// buildOrgSpaceActiveContext ci-dessous figeait planCode à "one_off" pour TOUS les types génériques
// sans jamais vérifier `client_contrats`, rendant ces 4 arbres de navigation intégralement morts :
// un coach/académie/organisateur de tournoi/stage payant Full Communication n'avait aucune entrée
// vers Communication/Publications/Mon CM/Validations, malgré des pages entièrement fonctionnelles
// en accès direct (même symptôme exact que le bug Espace Projet corrigé juste avant). Sponsor et
// agence CM restent volontairement exclus : aucune variante NAV_SPONSOR_FULLCOM/NAV_CM_AGENCY_
// FULLCOM n'existe (ces deux types ne sont jamais eux-mêmes titulaires d'un contrat Full
// Communication — l'agence CM accède aux clubs qu'elle gère via délégation, pas via son propre
// espace ; structure_coaching non plus, aucun NAV_*_FULLCOM dédié).
const FULLCOM_ELIGIBLE_ORG_TYPES = ["coach", "academie", "tournoi", "stage"] as const;

/**
 * Construit l'ActiveContext pour un espace Coach, Académie, Sponsor, Tournoi/Événement, Stage/
 * Camp ou Agence CM. Les 6 partagent le même socle réel (migration-connect-v3/v4/v6/v20,
 * migration-clubplus-v44) : une vraie ligne `memberships`, un rôle réel via
 * `organization_role_catalog` (pas de check constraint en dur comme pour club_members), et
 * aucune `organization_entitlements` (pas de plan/quota vendu). Une seule fonction paramétrée
 * plutôt que 6 quasi-identiques : les 6 backends sont structurellement identiques, seul le rôle
 * diffère.
 *
 * planCode "one_off" par défaut, "full_communication" si un contrat réel actif de ce type existe
 * pour ce type d'organisation (voir FULLCOM_ELIGIBLE_ORG_TYPES ci-dessus) — même vue
 * `client_contrats` que buildProjetActiveContext/fetchIsFullCommunication, même filtre RLS déjà
 * éprouvé (client_users), pas de nouvelle surface d'accès.
 */
export async function buildOrgSpaceActiveContext(
  supabase: SupabaseClient,
  authUser: SupabaseUser,
  space: Space,
): Promise<ActiveContext | null> {
  if (space.kind !== "organization" || !space.clickable) return null;
  if (!GENERIC_ORG_TYPES.includes(space.organizationType as GenericOrgType)) return null;
  const orgType = space.organizationType as GenericOrgType;
  const checkFullCom = (FULLCOM_ELIGIBLE_ORG_TYPES as readonly string[]).includes(orgType);

  const [orgRes, contractRes] = await Promise.all([
    supabase
      .from("organizations")
      .select("id, nom, organization_type, created_at")
      .eq("id", space.id)
      .maybeSingle(),
    checkFullCom
      ? supabase
          .from("client_contrats")
          .select("id")
          .eq("client_id", space.id)
          .eq("type_contrat", "full_communication")
          .eq("statut", "actif")
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const org = orgRes.data as { id: string; nom: string; organization_type: string; created_at: string } | null;
  if (!org || !space.role) return null;
  const isFullCommunication = checkFullCom && Boolean(contractRes.data);

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
      planCode: isFullCommunication ? "full_communication" : "one_off",
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
