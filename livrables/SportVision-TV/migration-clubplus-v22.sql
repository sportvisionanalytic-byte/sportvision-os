-- ============================================================
-- SPORTVISION CLUB+ — Migration v22
-- Suite de migration-clubplus-v1 à v21.sql. Idempotente.
--
-- Portée : Phase 12 du module « Espace Joueur & Famille »
-- (cf. CLUBPLUS_PLAYER_FAMILY_ARCHITECTURE.md) — renouvellement de
-- saison. Aucun accès ne doit être reconduit silencieusement (§20 du
-- prompt d'origine) : un rattachement actif reste actif jusqu'à ce
-- qu'un admin traite explicitement chaque joueur pour la saison
-- suivante (renouveler, déplacer, mettre en attente, archiver, ou
-- marquer comme ayant quitté le club).
-- ============================================================

create table if not exists season_membership_renewals (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  from_saison text not null,
  to_saison text not null,
  player_id uuid references player_profiles(id) on delete cascade not null,
  from_team_membership_id uuid references team_memberships(id) on delete set null,
  action text check (action in ('renouvele', 'deplace', 'archive', 'mis_en_attente', 'quitte_club')) not null,
  new_team_id uuid references club_teams(id) on delete set null,
  processed_by uuid references auth.users on delete set null,
  created_at timestamptz default now()
);

create index if not exists idx_smr_club on season_membership_renewals(club_id, created_at desc);
create index if not exists idx_smr_player on season_membership_renewals(player_id);

alter table season_membership_renewals enable row level security;

drop policy if exists "smr_admin_select" on season_membership_renewals;
create policy "smr_admin_select" on season_membership_renewals for select using (is_club_admin(club_id));

-- Une seule fonction porte les 5 actions : elle archive (ou transitionne)
-- le rattachement de la saison en cours et, pour renouveler/déplacer, crée
-- le nouveau rattachement 'active' sur la saison suivante — jamais une
-- simple mise à jour de la ligne existante, pour garder l'historique
-- complet par saison (cf. architecture §2.2, team_memberships est déjà
-- conçue pour ça : unique(player_id, team_id, saison)).
create or replace function renew_season_membership(
  p_membership_id uuid,
  p_action text,
  p_new_team_id uuid default null,
  p_to_saison text default null
)
returns team_memberships
language plpgsql security definer set search_path = public as $$
declare
  v_old team_memberships;
  v_new team_memberships;
  v_target_team uuid;
begin
  select * into v_old from team_memberships where id = p_membership_id;
  if v_old.id is null then raise exception 'Rattachement introuvable'; end if;
  if not is_club_admin(v_old.club_id) then raise exception 'Non autorisé'; end if;
  if p_action not in ('renouvele', 'deplace', 'archive', 'mis_en_attente', 'quitte_club') then
    raise exception 'Action invalide';
  end if;

  if p_action in ('renouvele', 'deplace') then
    if p_to_saison is null or p_to_saison = '' then raise exception 'Saison de destination requise'; end if;
    v_target_team := case when p_action = 'deplace' then p_new_team_id else v_old.team_id end;
    if v_target_team is null then raise exception 'Équipe de destination requise'; end if;

    update team_memberships set statut = 'archivee' where id = p_membership_id;

    insert into team_memberships (player_id, team_id, club_id, saison, statut)
    values (v_old.player_id, v_target_team, v_old.club_id, p_to_saison, 'active')
    on conflict (player_id, team_id, saison) do update set statut = 'active'
    returning * into v_new;
  else
    update team_memberships
    set statut = case p_action
      when 'archive' then 'archivee'
      when 'mis_en_attente' then 'en_attente_renouvellement'
      when 'quitte_club' then 'quittee_club'
    end
    where id = p_membership_id
    returning * into v_new;
  end if;

  insert into season_membership_renewals (club_id, from_saison, to_saison, player_id, from_team_membership_id, action, new_team_id, processed_by)
  values (v_old.club_id, v_old.saison, coalesce(p_to_saison, v_old.saison), v_old.player_id, v_old.id, p_action, v_target_team, auth.uid());

  return v_new;
end;
$$;
revoke all on function renew_season_membership(uuid, text, uuid, text) from public;
grant execute on function renew_season_membership(uuid, text, uuid, text) to authenticated;
