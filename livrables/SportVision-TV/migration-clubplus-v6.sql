-- ============================================================
-- SPORTVISION CLUB+ — Migration v6
-- Suite de migration-clubplus-v1 à v5.sql. Idempotente.
--
-- Portée : Prestations SportVision. Le catalogue N'EST PAS dupliqué —
-- Club+ réutilise `catalogue_offres`, la même table déjà créée par
-- migration-portail-v1.sql et gérée par le staff SportVision (Portail /
-- futur SportVision OS). Cette migration ajoute seulement club_bookings,
-- les réservations faites par un club depuis Club+, qui référencent une
-- ligne de ce catalogue partagé.
--
-- Si catalogue_offres n'existe pas encore sur ce projet (Portail pas
-- encore déployé), exécuter migration-portail-v1.sql (et idéalement
-- migration-portail-seed.sql) avant celle-ci.
-- ============================================================

create table if not exists club_bookings (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  service_id uuid references catalogue_offres(id) on delete set null,
  service_label text not null,
  team text,
  event_date date,
  heure text,
  duree text,
  adresse text,
  contact text,
  acces text,
  objectif text,
  options jsonb default '[]',
  status text check (status in (
    'recue','qualifiee','confirmee','operateur_affecte','mission_realisee','livree'
  )) not null default 'recue',
  price_label text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_cbk_upd on club_bookings;
create trigger trg_cbk_upd before update on club_bookings
  for each row execute procedure update_updated_at_generic();

alter table club_bookings enable row level security;

drop policy if exists "cbk_member_select" on club_bookings;
create policy "cbk_member_select" on club_bookings for select using (is_club_member(club_id));

drop policy if exists "cbk_member_insert" on club_bookings;
create policy "cbk_member_insert" on club_bookings for insert with check (is_club_member(club_id));

drop policy if exists "cbk_admin_update" on club_bookings;
create policy "cbk_admin_update" on club_bookings for update using (is_club_admin(club_id));
-- Update restreint aux admins de club (contrairement à club_requests/club_matches où
-- tout membre actif peut faire évoluer le statut) : le pipeline d'une prestation
-- SportVision (recue → ... → livrée) est piloté par SportVision, pas par le club.
-- Le vrai déclencheur de changement de statut sera le staff SportVision (via OS,
-- futur travail) ; côté club, seul un admin devrait pouvoir modifier une réservation
-- en attendant (ex. annuler).

drop policy if exists "cbk_admin_delete" on club_bookings;
create policy "cbk_admin_delete" on club_bookings for delete using (is_club_admin(club_id));

create index if not exists idx_cbk_club on club_bookings(club_id, status);
