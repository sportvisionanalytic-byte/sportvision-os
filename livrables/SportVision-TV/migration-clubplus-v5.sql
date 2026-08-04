-- ============================================================
-- SPORTVISION CLUB+ — Migration v5
-- Suite de migration-clubplus-v1/v2/v3/v4.sql. Idempotente.
--
-- Portée : Sponsors (club_sponsors, contreparties en jsonb comme
-- club_requests.comments — pas de table séparée, ça reste une liste
-- courte lue/écrite toujours avec le sponsor) et Équipes (club_teams).
-- RLS directe via is_club_member/is_club_admin, pas d'Edge Function requise.
-- ============================================================

-- ── 1. SPONSORS ──

create table if not exists club_sponsors (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  name text not null,
  secteur text,
  niveau text check (niveau in ('Or','Argent','Bronze')) default 'Bronze',
  teams jsonb default '[]',
  contact text,
  date_debut date,
  date_fin date,
  montant numeric(10,2) default 0,
  commitments jsonb default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_csp_upd on club_sponsors;
create trigger trg_csp_upd before update on club_sponsors
  for each row execute procedure update_updated_at_generic();

alter table club_sponsors enable row level security;

drop policy if exists "csp_member_select" on club_sponsors;
create policy "csp_member_select" on club_sponsors for select using (is_club_member(club_id));

drop policy if exists "csp_member_insert" on club_sponsors;
create policy "csp_member_insert" on club_sponsors for insert with check (is_club_member(club_id));

drop policy if exists "csp_member_update" on club_sponsors;
create policy "csp_member_update" on club_sponsors for update using (is_club_member(club_id));

drop policy if exists "csp_admin_delete" on club_sponsors;
create policy "csp_admin_delete" on club_sponsors for delete using (is_club_admin(club_id));

create index if not exists idx_csp_club on club_sponsors(club_id);

-- ── 2. ÉQUIPES ──

create table if not exists club_teams (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  name text not null,
  categorie text,
  section text check (section in ('Masculin','Féminin','Mixte')) default 'Masculin',
  coach text,
  resp_comm text,
  members integer default 0,
  next_match text,
  couleur text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_ctm_upd on club_teams;
create trigger trg_ctm_upd before update on club_teams
  for each row execute procedure update_updated_at_generic();

alter table club_teams enable row level security;

drop policy if exists "ctm_member_select" on club_teams;
create policy "ctm_member_select" on club_teams for select using (is_club_member(club_id));

drop policy if exists "ctm_member_insert" on club_teams;
create policy "ctm_member_insert" on club_teams for insert with check (is_club_member(club_id));

drop policy if exists "ctm_member_update" on club_teams;
create policy "ctm_member_update" on club_teams for update using (is_club_member(club_id));

drop policy if exists "ctm_admin_delete" on club_teams;
create policy "ctm_admin_delete" on club_teams for delete using (is_club_admin(club_id));

create index if not exists idx_ctm_club on club_teams(club_id);
