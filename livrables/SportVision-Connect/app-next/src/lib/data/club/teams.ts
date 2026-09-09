import type { SupabaseClient } from "@supabase/supabase-js";
import type { Team } from "@/lib/types/teams";

// club_teams (migration-clubplus-v5.sql) : résumé d'équipe (nom, catégorie, coach, effectif en
// nombre) — pas de roster nominatif de joueurs (pas de table club_players). RLS : ctm_member_select
// via is_club_member(club_id). Voir le plan Phase 1 § Gaps de données : /teams/[id] reste
// verrouillé jusqu'à la Phase 2 (Joueur & Famille).

interface ClubTeamRow {
  id: string;
  name: string;
  categorie: string | null;
  categories: string[] | null;
  coach: string | null;
  members: number | null;
}

export async function fetchClubTeams(supabase: SupabaseClient, organizationId: string): Promise<Team[]> {
  const [teamsRes, clubRes] = await Promise.all([
    supabase
      .from("club_teams")
      .select("id, name, categorie, categories, coach, members")
      .eq("club_id", organizationId)
      // Une equipe archivee est mise de cote, elle ne doit plus apparaitre. La colonne
      // existait mais n'etait lue NULLE PART cote Club+ (constate le 09/09/2026 : archiver
      // U15 D2 ne la retirait d'aucun ecran, elle comptait encore dans « 39 equipes »).
      .or("archivee.is.null,archivee.is.false")
      .order("name"),
    supabase.from("clubs").select("saison").eq("id", organizationId).maybeSingle(),
  ]);

  const season = (clubRes.data as { saison: string } | null)?.saison ?? "";

  return ((teamsRes.data ?? []) as ClubTeamRow[]).map((row) => ({
    id: row.id,
    organizationId,
    name: row.name,
    category: row.categorie ?? "—",
    // Toutes les categories couvertes : sert au rapprochement a l'import, pour qu'une equipe
    // « U8-U9 » soit trouvee que le calendrier dise U8 ou U9.
    categories: row.categories ?? (row.categorie ? [row.categorie] : []),
    season,
    headCoachName: row.coach ?? "—",
    playerCount: row.members ?? 0,
  }));
}

/** Création d'équipe (19/08/2026, retour utilisateur : aucune UI ne le permettait alors que
 * club_teams.coach existe déjà comme simple champ texte — pas de FK vers club_members, même
 * choix que club_calendar_events.team). ctm_member_insert (RLS) autorise tout membre actif du
 * club, pas seulement l'admin — comportement volontairement inchangé ici. */
export async function createClubTeam(
  supabase: SupabaseClient,
  clubId: string,
  input: { name: string; categorie?: string; categories?: string[]; coach?: string },
): Promise<{ id: string }> {
  // `categorie` reste la categorie principale — celle qu'affichent les ecrans existants — et
  // `categories` dit ce que l'equipe couvre reellement quand deux ages jouent ensemble.
  const couvertes = (input.categories ?? []).filter(Boolean);
  const principale = input.categorie || couvertes[0] || null;
  const { data, error } = await supabase
    .from("club_teams")
    .insert({
      club_id: clubId,
      name: input.name,
      categorie: principale,
      categories: couvertes.length > 0 ? couvertes : principale ? [principale] : null,
      coach: input.coach || null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

/** Génère (ou régénère) un code d'invitation pour qu'un joueur rejoigne cette équipe précise —
 * create_team_invite_code (migration-connect-v26.sql), déjà utilisé côté joueur
 * (requestTeamMembershipAsPlayer, lib/data/player/team-requests.ts) mais jamais exposé côté club
 * pour le générer. SECURITY DEFINER, vérifie lui-même is_team_educateur/is_club_admin. */
export async function createTeamInviteCode(supabase: SupabaseClient, teamId: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_team_invite_code", { p_team_id: teamId });
  if (error) throw error;
  return (data as { code: string }).code;
}
