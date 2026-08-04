-- ============================================================
-- SPORTVISION CLUB+ — Migration v11
-- Suite de migration-clubplus-v1 à v10.sql. Idempotente.
--
-- Portée : tickets de support (club_support_tickets). Le club peut créer
-- et consulter ses propres tickets ; le changement de statut (traité par
-- le support SportVision) n'est pas exposé côté client pour l'instant —
-- aucune policy UPDATE n'est créée ici, à ajouter quand SportVision OS
-- traitera réellement ces tickets.
-- ============================================================

create table if not exists club_support_tickets (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  subject text not null,
  category text,
  message text,
  status text check (status in ('ouvert','en_cours','resolu')) not null default 'ouvert',
  created_by uuid references auth.users on delete set null,
  author_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_cst_upd on club_support_tickets;
create trigger trg_cst_upd before update on club_support_tickets
  for each row execute procedure update_updated_at_generic();

alter table club_support_tickets enable row level security;

drop policy if exists "cst_member_select" on club_support_tickets;
create policy "cst_member_select" on club_support_tickets for select using (is_club_member(club_id));

drop policy if exists "cst_member_insert" on club_support_tickets;
create policy "cst_member_insert" on club_support_tickets for insert with check (is_club_member(club_id));

drop policy if exists "cst_admin_delete" on club_support_tickets;
create policy "cst_admin_delete" on club_support_tickets for delete using (is_club_admin(club_id));

create index if not exists idx_cst_club on club_support_tickets(club_id, status);
