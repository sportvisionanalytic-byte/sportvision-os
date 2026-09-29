-- v337 — photo de profil d'un enfant (posée par son parent) + téléphone/email du parent visibles
-- par le coach/CM dans la fiche équipe.
--
-- Contexte (Fouka, 29/09/2026) : "qu'ils puissent mettre photo de profil... comme ça on peut voir
-- aussi info numéro adresse mail etc". player_profiles.photo_url existe depuis longtemps
-- (migration-clubplus-v13) mais n'était écrit nulle part ; le téléphone du parent
-- (parent_profiles.telephone) n'était lisible que par is_club_admin (parp_club_admin_select,
-- migration-clubplus-v31), jamais par le coach de l'équipe.

-- 1. Le parent confirmé pose la photo de son enfant. Écriture par RPC plutôt que par une policy
-- UPDATE directe sur player_profiles : une policy RLS ne peut pas restreindre l'écriture à la
-- seule colonne photo_url, alors qu'une RPC le peut nativement.
create or replace function public.parent_set_child_photo(p_player_id uuid, p_photo_url text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not is_confirmed_parent_of(p_player_id) then
    return false;
  end if;
  update player_profiles set photo_url = p_photo_url, updated_at = now() where id = p_player_id;
  return found;
end;
$function$;

-- 2. Contacts (téléphone + email) des parents confirmés de l'effectif d'une équipe, pour son
-- coach/CM. Gardé par is_team_educateur (déjà scopé à l'équipe du coach, admin/président inclus
-- de fait) : ni parp_club_admin_select (admin seul) ni aucune autre policy existante ne couvrait
-- ce cas. Un seul parent par joueur (le premier confirmé) : suffisant pour contacter la famille,
-- pas une liste exhaustive de tous les détenteurs de l'autorité parentale.
create or replace function public.equipe_roster_contacts(p_team_id uuid)
returns table(player_id uuid, telephone text, email text)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not is_team_educateur(p_team_id) then
    return;
  end if;

  return query
  select distinct on (ppr.player_id)
    ppr.player_id,
    pp.telephone,
    u.email::text
  from parent_player_relationships ppr
  join parent_profiles pp on pp.id = ppr.parent_id
  join auth.users u on u.id = pp.user_id
  where ppr.statut = 'confirme'
    and ppr.player_id in (
      select tm.player_id from team_memberships tm where tm.team_id = p_team_id and tm.statut = 'active'
    )
  order by ppr.player_id, ppr.confirmed_at asc nulls last, ppr.created_at asc;
end;
$function$;
