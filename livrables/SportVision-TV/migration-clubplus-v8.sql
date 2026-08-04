-- ============================================================
-- SPORTVISION CLUB+ — Migration v8
-- Suite de migration-clubplus-v1 à v7.sql. Idempotente.
--
-- Portée : Studio de création (club_creations). Les modèles ("Modèles du
-- club") restent statiques côté app.html pour l'instant — leur gestion
-- (visuels réels, verrouillage premium) est un sujet de design d'assets,
-- pas seulement de données, hors scope de cette migration. RLS directe
-- via is_club_member, pas d'Edge Function requise.
-- ============================================================

create table if not exists club_creations (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  title text not null,
  type text not null,
  team text,
  status text check (status in ('brouillon','a_valider','valide','publie')) not null default 'brouillon',
  sponsor text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_ccr_upd on club_creations;
create trigger trg_ccr_upd before update on club_creations
  for each row execute procedure update_updated_at_generic();

alter table club_creations enable row level security;

drop policy if exists "ccr_member_select" on club_creations;
create policy "ccr_member_select" on club_creations for select using (is_club_member(club_id));

drop policy if exists "ccr_member_insert" on club_creations;
create policy "ccr_member_insert" on club_creations for insert with check (is_club_member(club_id));

drop policy if exists "ccr_member_update" on club_creations;
create policy "ccr_member_update" on club_creations for update using (is_club_member(club_id));

drop policy if exists "ccr_admin_delete" on club_creations;
create policy "ccr_admin_delete" on club_creations for delete using (is_club_admin(club_id));

create index if not exists idx_ccr_club on club_creations(club_id, status);
