import type { SupabaseClient } from "@supabase/supabase-js";
import type { MembershipRole } from "@/lib/types";
import type { OrgUser } from "@/lib/types/settings";
import { mapClubRole, mapClubRoleToReal } from "@/lib/supabase/mappers";

// club_members (migration-clubplus-v1.sql) — RLS : cm_member_select (is_club_member), écriture
// (rôle/statut) réservée à is_club_admin. Pas d'email réel exposé (auth.users n'est pas
// accessible via PostgREST) : laissé vide plutôt qu'inventé, voir le plan de migration.

// `supabase.functions.invoke()` sur une réponse non-2xx renvoie une FunctionsHttpError dont
// `.message` est toujours le texte générique "Edge Function returned a non-2xx status code" —
// le vrai message (`{error: "..."}` renvoyé par la fonction, ex: plafond du plan atteint) reste
// dans `error.context` (la Response brute), jamais lu automatiquement par supabase-js. Trouvé en
// testant l'invitation d'un coach sur un club au plan Gratuit (03/09/2026) : l'admin ne voyait que
// le message générique, aucune indication qu'il fallait changer de plan.
async function extractFunctionErrorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      if (body?.error) return body.error;
    } catch {
      // corps non-JSON : on retombe sur le message générique ci-dessous.
    }
  }
  return error instanceof Error ? error.message : "Impossible d'envoyer l'invitation.";
}

interface ClubMemberRow {
  id: string;
  user_id: string;
  prenom: string | null;
  nom: string | null;
  telephone: string | null;
  role: string;
  status: string;
  created_at: string;
  teams: string[] | null;
}

const STATUS_MAP: Record<string, OrgUser["status"]> = {
  actif: "active",
  invitation: "invited",
  suspendu: "disabled",
};

export async function fetchClubMembers(supabase: SupabaseClient, clubId: string): Promise<OrgUser[]> {
  const { data, error } = await supabase
    .from("club_members")
    .select("id, user_id, prenom, nom, telephone, role, status, created_at, teams")
    .eq("club_id", clubId)
    .order("created_at", { ascending: true });

  if (error) throw error;

  return ((data ?? []) as ClubMemberRow[]).map((row) => ({
    id: row.user_id,
    membershipId: row.id,
    firstName: row.prenom ?? "",
    lastName: row.nom ?? "",
    email: "",
    phone: row.telephone ?? undefined,
    role: mapClubRole(row.role),
    teamScope: Array.isArray(row.teams) ? row.teams : [],
    status: STATUS_MAP[row.status] ?? "active",
    invitedAt: row.status === "invitation" ? row.created_at : undefined,
  }));
}

/** Invite un membre — edge function clubplus-invite (crée le compte auth.users via l'API Admin,
 * envoie l'e-mail d'invitation Supabase, insère la ligne club_members en status='invitation').
 * Vérifie elle-même côté serveur que l'appelant est admin actif du club (jamais de confiance dans
 * un rôle envoyé par le client). Idempotente : réinviter un e-mail déjà membre ne duplique pas.
 *
 * `team` (§7.1 du master doc : "équipe/catégorie facultative" dans le formulaire d'invitation) —
 * l'edge function acceptait déjà un tableau `teams` (voir clubplus-invite/index.ts) mais rien côté
 * Connect ne l'envoyait jusqu'ici : club_members.teams restait toujours '[]', rendant impossible
 * tout filtrage "lecture ciblée" pour un éducateur (§14). Un seul texte libre en V1 (pas de
 * multi-sélection, pas de table `teams` normalisée à ce jour côté club_bookings.team non plus).
 *
 * `mode` (23/08/2026, demande Fouka) : "email" (défaut, historique) envoie une invitation par
 * e-mail — l'invité choisit son mot de passe en cliquant le lien. "direct" crée le compte
 * immédiatement avec un mot de passe généré, sans e-mail (l'edge function le renvoie une seule
 * fois dans `password`, jamais stocké ni relogué ensuite) — utile quand l'e-mail est peu fiable
 * (lien d'invitation prescanné/consommé par le fournisseur avant le clic, même classe de problème
 * que l'incident de reset password du 23/08). */
export async function inviteClubMember(
  supabase: SupabaseClient,
  clubId: string,
  input: { email: string; firstName: string; lastName: string; role: MembershipRole; team?: string; mode?: "email" | "direct" },
): Promise<{ password: string | null; accountAlreadyExisted: boolean; alreadyMember: boolean }> {
  const { data, error } = await supabase.functions.invoke("clubplus-invite", {
    body: {
      email: input.email,
      prenom: input.firstName,
      nom: input.lastName,
      club_id: clubId,
      role: mapClubRoleToReal(input.role),
      teams: input.team?.trim() ? [input.team.trim()] : [],
      mode: input.mode === "direct" ? "direct" : "email",
    },
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  if (data?.error) throw new Error(data.error);
  return {
    password: data?.password ?? null,
    accountAlreadyExisted: Boolean(data?.account_already_existed),
    alreadyMember: Boolean(data?.already_invited),
  };
}

/** Un admin peut suspendre/réactiver un autre membre (jamais lui-même) — écriture directe
 * autorisée par la policy is_club_admin, pas de RPC dédiée pour ce champ côté club_members.
 * `.select()` est nécessaire : sur un update filtré par RLS qui ne matche aucune ligne (appelant
 * non-admin), Supabase renvoie `{error: null}` — seul un tableau vide en retour révèle l'échec. */
export async function setClubMemberStatus(
  supabase: SupabaseClient,
  membershipId: string,
  status: "actif" | "suspendu",
): Promise<void> {
  const { data, error } = await supabase.from("club_members").update({ status }).eq("id", membershipId).select();
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Action impossible : droits insuffisants ou membre introuvable.");
  }
}

/** Gap réel trouvé à l'audit transversal (scénario C6, 04/09/2026) : `teams` (noms d'équipes en
 * texte libre, cf. is_team_educateur) n'était modifiable qu'à la création de l'invitation —
 * clubplus-invite renvoie déjà-membre sans jamais mettre à jour `teams` sur un rappel. Un club
 * admin ne pouvait donc élargir le périmètre d'un coach déjà membre (ex: U15 A → U15 A + U15 B)
 * que par SQL manuel. La policy RLS `cm_admin_update` autorisait déjà cette écriture ; seule la
 * fonction data-layer manquait. */
export async function setClubMemberTeams(
  supabase: SupabaseClient,
  membershipId: string,
  teams: string[],
): Promise<void> {
  const { data, error } = await supabase.from("club_members").update({ teams }).eq("id", membershipId).select();
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Action impossible : droits insuffisants ou membre introuvable.");
  }
}
