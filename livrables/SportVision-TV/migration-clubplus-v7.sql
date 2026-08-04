-- ============================================================
-- SPORTVISION CLUB+ — Migration v7
-- Suite de migration-clubplus-v1 à v6.sql. Idempotente.
--
-- Portée : Banque média (club_media). RLS directe via is_club_member,
-- pas d'Edge Function requise.
-- ============================================================

create table if not exists club_media (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  title text not null,
  type text check (type in ('photo','video','logo','document','creation')) not null default 'photo',
  team text,
  source text check (source in ('externe','interne','sportvision')) not null default 'externe',
  link text,
  tags text,
  expired boolean default false,
  author_id uuid references auth.users on delete set null,
  author_name text,
  created_at timestamptz default now()
);

alter table club_media enable row level security;

drop policy if exists "cmd_member_select" on club_media;
create policy "cmd_member_select" on club_media for select using (is_club_member(club_id));

drop policy if exists "cmd_member_insert" on club_media;
create policy "cmd_member_insert" on club_media for insert with check (is_club_member(club_id));

drop policy if exists "cmd_admin_delete" on club_media;
create policy "cmd_admin_delete" on club_media for delete using (is_club_admin(club_id));

create index if not exists idx_cmd_club on club_media(club_id, type);
