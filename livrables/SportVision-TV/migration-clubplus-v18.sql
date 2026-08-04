-- ============================================================
-- SPORTVISION CLUB+ — Migration v18
-- Suite de migration-clubplus-v1 à v17.sql. Idempotente.
--
-- Portée : Phase 8 du module « Espace Joueur & Famille »
-- (cf. CLUBPLUS_PLAYER_FAMILY_ARCHITECTURE.md) — media_access_rules
-- (le mécanisme « Publier vers Espace Joueur » côté club), l'extension
-- additive des policies club_media/club_creations pour la famille
-- (annoncée mais volontairement différée en v16), et les favoris.
--
-- Fail-closed par construction : tant qu'aucune media_access_rules
-- n'existe pour un club_media/club_creations donné, il reste invisible
-- côté joueur/famille — même après cette migration, aucune galerie
-- existante ne devient visible tant que le club n'a pas explicitement
-- publié (cf. architecture §15, "ne jamais donner accès automatiquement
-- à toutes les galeries du club").
-- ============================================================

-- ── 1. MEDIA_ACCESS_RULES ──

create table if not exists media_access_rules (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  media_ref_type text check (media_ref_type in ('club_media','club_creations')) not null,
  media_ref_id uuid not null,
  team_id uuid references club_teams(id) on delete cascade,
  consultation_only boolean default false,
  telechargement_autorise boolean default true,
  partage_autorise boolean default false,
  expire_at timestamptz,
  visible_parent boolean default true,
  visible_joueur boolean default true,
  lie_mineurs boolean default false,
  created_at timestamptz default now(),
  unique (media_ref_type, media_ref_id)
);

create index if not exists idx_mar_team on media_access_rules(team_id);

alter table media_access_rules enable row level security;

drop policy if exists "mar_member_select" on media_access_rules;
create policy "mar_member_select" on media_access_rules for select using (is_club_member(club_id));

drop policy if exists "mar_manager_insert" on media_access_rules;
create policy "mar_manager_insert" on media_access_rules for insert with check (
  is_club_admin(club_id) or (team_id is not null and is_team_educateur(team_id))
);

drop policy if exists "mar_manager_update" on media_access_rules;
create policy "mar_manager_update" on media_access_rules for update using (
  is_club_admin(club_id) or (team_id is not null and is_team_educateur(team_id))
);

drop policy if exists "mar_manager_delete" on media_access_rules;
create policy "mar_manager_delete" on media_access_rules for delete using (
  is_club_admin(club_id) or (team_id is not null and is_team_educateur(team_id))
);

-- ── 2. VISIBILITÉ FAMILLE — fonction + policies additives ──
-- SECURITY DEFINER : nécessaire pour que la sous-requête sur
-- media_access_rules/team_memberships/player_profiles ne soit pas elle-même
-- filtrée par le RLS de CES tables au moment d'évaluer la policy de
-- club_media/club_creations (même raisonnement que is_family_of_team, v13).
-- Distingue explicitement le joueur du parent (visible_joueur/visible_parent),
-- ce que is_family_of_team seul ne fait pas.

create or replace function is_media_visible_to_family(p_media_ref_type text, p_media_ref_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from media_access_rules r
    join team_memberships tm on tm.team_id = r.team_id and tm.statut = 'active'
    join player_profiles p on p.id = tm.player_id
    where r.media_ref_type = p_media_ref_type and r.media_ref_id = p_media_ref_id
      and (r.expire_at is null or r.expire_at > now())
      and (
        (p.user_id = auth.uid() and r.visible_joueur)
        or (is_confirmed_parent_of(p.id) and r.visible_parent)
      )
  );
$$;

drop policy if exists "cmd_family_select" on club_media;
create policy "cmd_family_select" on club_media for select using (is_media_visible_to_family('club_media', id));

drop policy if exists "ccr_family_select" on club_creations;
create policy "ccr_family_select" on club_creations for select using (is_media_visible_to_family('club_creations', id));

-- ── 3. FAVORIS ──

create table if not exists favorite_collections (
  id uuid default gen_random_uuid() primary key,
  owner_user_id uuid references auth.users on delete cascade not null,
  player_id uuid references player_profiles(id) on delete cascade not null,
  name text not null,
  created_at timestamptz default now()
);

alter table favorite_collections enable row level security;
drop policy if exists "fc_owner_all" on favorite_collections;
create policy "fc_owner_all" on favorite_collections for all
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

-- Pas de FK native possible vers club_media OU club_creations (référence
-- polymorphe) : contrôle applicatif par trigger, lui-même soumis au RLS de
-- la table référencée (pas security definer) — un joueur/parent ne peut
-- donc mettre en favori QUE ce qu'il peut déjà voir via §2 ci-dessus.
create table if not exists player_favorites (
  id uuid default gen_random_uuid() primary key,
  owner_user_id uuid references auth.users on delete cascade not null,
  player_id uuid references player_profiles(id) on delete cascade not null,
  collection_id uuid references favorite_collections(id) on delete set null,
  media_ref_type text check (media_ref_type in ('club_media','club_creations')) not null,
  media_ref_id uuid not null,
  created_at timestamptz default now(),
  unique (owner_user_id, player_id, media_ref_type, media_ref_id)
);

create or replace function check_favorite_media_exists()
returns trigger language plpgsql as $$
begin
  if new.media_ref_type = 'club_media' and not exists (select 1 from club_media where id = new.media_ref_id) then
    raise exception 'media introuvable ou non accessible';
  elsif new.media_ref_type = 'club_creations' and not exists (select 1 from club_creations where id = new.media_ref_id) then
    raise exception 'création introuvable ou non accessible';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_fav_check on player_favorites;
create trigger trg_fav_check before insert on player_favorites
  for each row execute procedure check_favorite_media_exists();

alter table player_favorites enable row level security;
drop policy if exists "pf_owner_all" on player_favorites;
create policy "pf_owner_all" on player_favorites for all
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
