-- ============================================================
-- SPORTVISION CLUB+ — Migration v3
-- Suite de migration-clubplus-v1.sql / v2.sql. Idempotente.
--
-- Portée : Newsroom du club (club_newsroom_items) et Match Center
-- (club_matches). Contrairement à l'invitation d'utilisateurs, ces deux
-- tables n'ont pas besoin d'Edge Function — tout passe par des policies
-- RLS directes (is_club_member déjà défini par migration-clubplus-v1.sql),
-- un membre actif du club peut lire/écrire les informations de son propre
-- club sans élévation de privilège nécessaire.
-- ============================================================

-- ── 1. NEWSROOM ──

create table if not exists club_newsroom_items (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  team text,
  type text check (type in ('Résultat','Actualité')) not null default 'Actualité',
  title text not null,
  description text,
  priority text check (priority in ('haute','normale','basse')) default 'normale',
  media_count integer default 0,
  sponsor text,
  status text check (status in (
    'recu','a_verifier','infos_manquantes','pret_a_transformer',
    'en_creation','programme','publie','archive'
  )) not null default 'recu',
  author_id uuid references auth.users on delete set null,
  author_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_cni_upd on club_newsroom_items;
create trigger trg_cni_upd before update on club_newsroom_items
  for each row execute procedure update_updated_at_generic();

alter table club_newsroom_items enable row level security;

drop policy if exists "cni_member_select" on club_newsroom_items;
create policy "cni_member_select" on club_newsroom_items for select using (is_club_member(club_id));

drop policy if exists "cni_member_insert" on club_newsroom_items;
create policy "cni_member_insert" on club_newsroom_items for insert with check (is_club_member(club_id));

drop policy if exists "cni_member_update" on club_newsroom_items;
create policy "cni_member_update" on club_newsroom_items for update using (is_club_member(club_id));

drop policy if exists "cni_admin_delete" on club_newsroom_items;
create policy "cni_admin_delete" on club_newsroom_items for delete using (is_club_admin(club_id));

create index if not exists idx_cni_club on club_newsroom_items(club_id, status);

-- ── 2. MATCH CENTER ──

create table if not exists club_matches (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  team text not null,
  opponent text not null,
  match_date date,
  lieu text,
  status text check (status in ('a_venir','a_transmettre','recu')) not null default 'a_venir',
  score text,
  scorers text,
  man_of_match text,
  contents jsonb default '[]',
  created_by uuid references auth.users on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_cma_upd on club_matches;
create trigger trg_cma_upd before update on club_matches
  for each row execute procedure update_updated_at_generic();

alter table club_matches enable row level security;

drop policy if exists "cma_member_select" on club_matches;
create policy "cma_member_select" on club_matches for select using (is_club_member(club_id));

drop policy if exists "cma_member_insert" on club_matches;
create policy "cma_member_insert" on club_matches for insert with check (is_club_member(club_id));

drop policy if exists "cma_member_update" on club_matches;
create policy "cma_member_update" on club_matches for update using (is_club_member(club_id));

drop policy if exists "cma_admin_delete" on club_matches;
create policy "cma_admin_delete" on club_matches for delete using (is_club_admin(club_id));

create index if not exists idx_cma_club on club_matches(club_id, status, match_date);
