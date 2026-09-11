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
  role: string;
  status: string;
  created_at: string;
  teams: string[] | null;
  fonction?: string | null;
}

const STATUS_MAP: Record<string, OrgUser["status"]> = {
  actif: "active",
  invitation: "invited",
  suspendu: "disabled",
};

// 11/09/2026 — Décision de Fouka : les coordonnées des AUTRES membres d'un club ne sont lisibles
// que par l'Owner Club+, le Président, le CM SportVision du club, la Secrétaire et le Trésorier
// (plus le staff SportVision). Chacun lit toujours sa propre fiche ; noms et rôles restent
// visibles (sélecteurs d'encadrant, « coach : X » sur une équipe…).
//
// La colonne `telephone` est donc fermée à `authenticated` (migration club-donnees-restreintes-2) :
// la demander ferait échouer TOUTE la liste, pour tout le monde. On lit la liste sans elle, puis
// les téléphones par club_membres_coordonnees(), qui ne rend que ce que la personne a le droit de
// voir. Un échec de cette seconde lecture laisse la liste s'afficher, sans téléphone.
export async function fetchClubMembers(supabase: SupabaseClient, clubId: string): Promise<OrgUser[]> {
  const [{ data, error }, coordonnees] = await Promise.all([
    supabase
      .from("club_members")
      .select("id, user_id, prenom, nom, role, status, created_at, teams, fonction")
      .eq("club_id", clubId)
      .order("created_at", { ascending: true }),
    supabase.rpc("club_membres_coordonnees", { p_club_id: clubId }),
  ]);

  if (error) throw error;

  const telephones = new Map<string, string | null>();
  for (const c of (coordonnees.error ? [] : (coordonnees.data ?? [])) as { membre_id: string; telephone: string | null }[]) {
    telephones.set(c.membre_id, c.telephone);
  }

  return ((data ?? []) as ClubMemberRow[]).map((row) => ({
    id: row.user_id,
    membershipId: row.id,
    firstName: row.prenom ?? "",
    lastName: row.nom ?? "",
    email: "",
    phone: telephones.get(row.id) ?? undefined,
    fonction: row.fonction === "adjoint" || row.fonction === "principal" ? row.fonction : undefined,
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
): Promise<{ password: string | null; accountAlreadyExisted: boolean; alreadyMember: boolean; membershipId: string | null }> {
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
    // L'edge function renvoie l'id club_members dans les deux cas (créé ou déjà présent). Sans
    // lui, un appelant qui reçoit `alreadyMember` ne peut rien faire de plus : `fetchClubMembers`
    // n'expose aucun e-mail (auth.users n'est pas lisible via PostgREST), donc retrouver la ligne
    // concernée à partir de l'adresse saisie est impossible côté client.
    membershipId: typeof data?.id === "string" ? data.id : null,
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
  // `select("id")` et non `select()` : ce dernier redemande toutes les colonnes, téléphone compris,
  // que `authenticated` ne peut plus lire (11/09/2026) — l'écriture réussirait, et la réponse
  // échouerait (42501), l'écran annonçant alors un échec qui n'en est pas un.
  const { data, error } = await supabase.from("club_members").update({ status }).eq("id", membershipId).select("id");
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
  // `select("id")` : voir setClubMemberStatus ci-dessus.
  const { data, error } = await supabase.from("club_members").update({ teams }).eq("id", membershipId).select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Action impossible : droits insuffisants ou membre introuvable.");
  }
}

/** Ajoute UNE équipe au périmètre d'un membre, sans toucher au reste.
 *
 * Le trou que ça bouche (09/09/2026, fiche équipe) : `clubplus-invite` est idempotente, elle
 * renvoie `already_invited` dès que la personne est déjà membre du club — et dans ce cas elle
 * n'écrit PAS `teams`. Inviter depuis la fiche d'une équipe un coach qui en encadre déjà une
 * autre ne lui donnait donc rien : l'écran annonçait une invitation partie, la base restait
 * inchangée, et `is_team_educateur` continuait de lui refuser l'équipe.
 *
 * On relit `teams` avant d'écrire plutôt que de faire confiance à ce que l'écran affiche : entre
 * le chargement de la page et le clic, un autre admin a pu élargir ce périmètre, et un `update`
 * calculé sur une liste périmée l'effacerait. */
export async function addTeamToClubMember(
  supabase: SupabaseClient,
  membershipId: string,
  team: string,
): Promise<void> {
  const nom = team.trim();
  if (!nom) return;

  const { data, error } = await supabase
    .from("club_members")
    .select("teams")
    .eq("id", membershipId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Membre introuvable.");

  const brut = (data as { teams: string[] | null }).teams;
  const actuelles = Array.isArray(brut) ? brut : [];
  // Comparaison exacte, comme `is_team_educateur` en base (cm.teams @> to_jsonb(ct.name)) : une
  // comparaison plus tolérante ici ferait croire le périmètre accordé alors que la RLS, elle, ne
  // le reconnaîtrait pas.
  if (actuelles.includes(nom)) return;

  await setClubMemberTeams(supabase, membershipId, [...actuelles, nom]);
}

/** Retire UNE équipe du périmètre d'un membre. Symétrique de `addTeamToClubMember` : un membre
 * dont le périmètre tombe à zéro reste membre du club, il perd seulement la lecture ciblée. */
export async function removeTeamFromClubMember(
  supabase: SupabaseClient,
  membershipId: string,
  team: string,
): Promise<void> {
  const nom = team.trim();
  const { data, error } = await supabase
    .from("club_members")
    .select("teams")
    .eq("id", membershipId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Membre introuvable.");

  const brut = (data as { teams: string[] | null }).teams;
  const actuelles = Array.isArray(brut) ? brut : [];
  if (!actuelles.includes(nom)) return;

  await setClubMemberTeams(supabase, membershipId, actuelles.filter((t) => t !== nom));
}
