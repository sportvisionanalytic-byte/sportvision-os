-- Migration : Table disponibilites collaborateurs
-- À exécuter dans Supabase → SQL Editor
-- Utilisée par : vue "Équipe en direct" (admin + prod), annuaire

create table if not exists disponibilites (
  id                uuid default gen_random_uuid() primary key,
  collaborateur_id  uuid not null references profiles(id) on delete cascade,
  date              date not null default current_date,
  statut            text check (statut in ('disponible','sous_conditions','indisponible')) not null default 'disponible',
  note              text,
  updated_at        timestamptz default now(),

  -- Une seule entrée par collaborateur par date
  unique (collaborateur_id, date)
);

alter table disponibilites enable row level security;

-- Lecture : tous les collaborateurs connectés
create policy "dispo_select" on disponibilites for select using (
  exists (select 1 from profiles where id = auth.uid())
);

-- Insertion : chaque collaborateur peut déclarer sa dispo
create policy "dispo_insert" on disponibilites for insert with check (
  auth.uid() = collaborateur_id
);

-- Modification : chaque collaborateur peut modifier sa propre dispo
-- Admin et prod peuvent modifier celle de n'importe qui
create policy "dispo_update" on disponibilites for update using (
  auth.uid() = collaborateur_id
  or exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);

-- Suppression : admin seulement
create policy "dispo_delete" on disponibilites for delete using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- Index pour les requêtes courantes
create index if not exists idx_dispo_date     on disponibilites(date desc);
create index if not exists idx_dispo_collab   on disponibilites(collaborateur_id, date desc);
create index if not exists idx_dispo_statut   on disponibilites(statut, date desc);

-- Trigger auto-maj updated_at
create or replace function update_dispo_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists trg_dispo_updated_at on disponibilites;
create trigger trg_dispo_updated_at before update on disponibilites
  for each row execute function update_dispo_updated_at();
