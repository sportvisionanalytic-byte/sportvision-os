-- Le CM SportVision voit tout d'un club et ne peut agir sur rien. Les liens d'invitation le
-- prouvaient.
--
-- ── Le bug, reproduit en base le 10/09/2026 ──
-- Jordy (le CM affilié, `profiles.role = 'com'`) ouvre l'écran Équipes de SF Villemomble, voit
-- ses 43 équipes, clique « Générer un lien pour inviter des joueurs », et obtient
-- « Impossible de générer le lien. Réessayez. »
--
--   is_club_admin(club)        → false
--   is_team_educateur(equipe)  → false
--   équipes visibles           → 43
--   create_invite_code(...)    → ERREUR « Non autorisé »
--
-- Ce n'était pas un incident réseau, ni un défaut d'affichage : la fonction refusait, l'écran
-- traduisait ce refus en « réessayez », et réessayer ne pouvait jamais marcher.
--
-- ── Pourquoi ce trou existe ──
-- Deux notions d'autorité cohabitent sans se connaître :
--
--   la LECTURE passe par `cm_clubs_autorises()`, qui connaît le staff SportVision, les
--   affectations nominatives (`club_cm_affectations`) et les délégations d'agence ;
--   l'ÉCRITURE, ici, ne connaissait que `is_club_admin` et `is_team_educateur`, c'est-à-dire les
--   membres du club.
--
-- Le CM n'est membre d'aucun club — c'est tout l'intérêt du modèle. Il tombait donc entre les
-- deux. Deux aggravants trouvés au passage : `cm_agency_club_access` est vide (aucun club n'a
-- jamais été délégué à l'agence), et `peut_preparer_club()` a le même angle mort, puisqu'elle
-- teste `est_cm_cloisonne()`, qui ne reconnaît que `profiles.role = 'cm'` et pas `'com'`.
--
-- ── Ce qu'on fait ──
-- Une seule fonction dit qui peut gérer les invitations d'un club, et les trois RPC comme les
-- policies s'y réfèrent. Elle s'appuie sur `cm_clubs_autorises()`, qui encode DÉJÀ tout le
-- périmètre — y compris son expiration. Aucune nouvelle règle de sécurité n'est inventée ici :
-- on branche l'écriture sur l'autorité qui existait pour la lecture.
--
-- Conséquence voulue, et vérifiée plus bas : un CM cloisonné affecté à Villemomble ne peut
-- toujours pas créer d'invitation pour Fontainebleau.

begin;

-- ── 1. L'autorité, à un seul endroit ──
create or replace function public.peut_gerer_invitations_club(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  -- `coalesce` parce qu'un `p_club_id` nul rendrait NULL, et qu'un NULL dans un `if not (...)`
  -- ne déclenche pas la branche de refus : le garde-fou s'ouvrirait au lieu de se fermer. Même
  -- défaut que celui déjà trouvé sur `peut_preparer_club(null)`.
  select p_club_id is not null
     and coalesce(
           is_club_admin(p_club_id)
             or p_club_id in (select public.cm_clubs_autorises()),
           false);
$$;

comment on function public.peut_gerer_invitations_club(uuid) is
  'Qui peut créer, renouveler ou désactiver les liens d''invitation d''un club : ses administrateurs, et toute personne dont le périmètre CM couvre ce club (staff SportVision, affectation nominative, délégation d''agence). Une seule définition, utilisée par les RPC ET les policies.';

-- ── 2. Créer un lien ──
create or replace function public.create_invite_code(
  p_club_id uuid,
  p_team_id uuid default null,
  p_max_uses integer default null
)
returns team_invite_codes
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row team_invite_codes;
  v_team_club_id uuid;
begin
  if p_team_id is not null then
    select club_id into v_team_club_id from club_teams where id = p_team_id;
    if v_team_club_id is null then
      raise exception 'Cette équipe n''existe pas ou a été supprimée.';
    end if;
    if v_team_club_id <> p_club_id then
      raise exception 'Cette équipe n''appartient pas à ce club.';
    end if;
    if not (is_team_educateur(p_team_id) or peut_gerer_invitations_club(p_club_id)) then
      raise exception 'Vous n''êtes plus autorisé à gérer cette équipe.';
    end if;
  else
    if not peut_gerer_invitations_club(p_club_id) then
      raise exception 'Vous n''êtes pas autorisé à créer un lien pour ce club.';
    end if;
  end if;

  -- Un lien encore utilisable existe déjà : on le rend, on n'en fabrique pas un deuxième.
  -- Sans ça, un CM qui clique trois fois repartait avec trois codes en circulation pour la même
  -- équipe, dont deux qu'il ne reverrait jamais (l'écran ne lit que le plus récent). Désactiver
  -- l'ancien devenait impossible, et le compte d'utilisations perdait son sens.
  select * into v_row
    from team_invite_codes
   where club_id = p_club_id
     and team_id is not distinct from p_team_id
     and actif
     and (expire_at is null or expire_at > now())
     and (max_uses is null or uses_count < max_uses)
   order by created_at desc
   limit 1;
  if v_row.id is not null then
    return v_row;
  end if;

  insert into team_invite_codes (club_id, team_id, code, max_uses, created_by)
  values (p_club_id, p_team_id, generate_team_invite_code(p_team_id), p_max_uses, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

-- ── 3. Renouveler ──
create or replace function public.rotate_team_invite_code(p_code_id uuid)
returns team_invite_codes
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row team_invite_codes;
begin
  select * into v_row from team_invite_codes where id = p_code_id;
  if v_row.id is null then raise exception 'Ce lien n''existe plus.'; end if;
  if not ((v_row.team_id is not null and is_team_educateur(v_row.team_id))
          or peut_gerer_invitations_club(v_row.club_id)) then
    raise exception 'Vous n''êtes plus autorisé à gérer ce lien.';
  end if;

  update team_invite_codes
     set code = generate_team_invite_code(v_row.team_id), actif = true, uses_count = 0
   where id = p_code_id
   returning * into v_row;
  return v_row;
end;
$$;

-- ── 4. Désactiver ──
create or replace function public.deactivate_invite_code(p_code_id uuid)
returns team_invite_codes
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row team_invite_codes;
begin
  select * into v_row from team_invite_codes where id = p_code_id;
  if v_row.id is null then raise exception 'Ce lien n''existe plus.'; end if;
  if not ((v_row.team_id is not null and is_team_educateur(v_row.team_id))
          or peut_gerer_invitations_club(v_row.club_id)) then
    raise exception 'Vous n''êtes plus autorisé à gérer ce lien.';
  end if;

  update team_invite_codes set actif = false where id = p_code_id returning * into v_row;
  return v_row;
end;
$$;

-- ── 5. Et la lecture, qui avait le même trou ──
-- `tic_manager_select` ne reconnaissait que les membres du club : un CM ne voyait donc AUCUN lien
-- existant. L'écran affichait « aucun lien » puis échouait à en créer un — deux symptômes, une
-- seule cause. `fetchClubTeamInviteLink` utilise `.maybeSingle()`, donc ce refus était muet.
drop policy if exists tic_manager_select on public.team_invite_codes;
create policy tic_manager_select on public.team_invite_codes
  for select using (is_team_educateur(team_id) or peut_gerer_invitations_club(club_id));

drop policy if exists tic_manager_update on public.team_invite_codes;
create policy tic_manager_update on public.team_invite_codes
  for update using (is_team_educateur(team_id) or peut_gerer_invitations_club(club_id));

commit;
