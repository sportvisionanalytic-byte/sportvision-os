-- Migration : Table frais & kilométrage
-- À exécuter dans Supabase → SQL Editor
-- Utilisée par : prod.frais, compta.depenses, compta.frais, admin dashboard

create table if not exists frais (
  id             uuid default gen_random_uuid() primary key,
  collaborateur_id uuid references profiles(id) on delete set null,
  prestation_id  uuid references prestations(id) on delete set null,
  type           text check (type in ('km','repas','materiel','logistique','marketing','autre')) not null default 'autre',
  montant        numeric(10,2) not null default 0,
  km             integer,
  description    text,
  statut         text check (statut in ('en_attente','validé','remboursé','refusé')) not null default 'en_attente',
  date_frais     date not null default current_date,
  created_at     timestamptz default now()
);

alter table frais enable row level security;

-- Lecture : tout collaborateur connecté peut lire (prod voit tout, photo voit les siens)
create policy "frais_select" on frais for select using (
  exists (select 1 from profiles where id = auth.uid())
);

-- Insertion : tout collaborateur connecté peut déclarer ses frais
create policy "frais_insert" on frais for insert with check (
  exists (select 1 from profiles where id = auth.uid())
);

-- Modification : admin et prod peuvent valider/rembourser
create policy "frais_update" on frais for update using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod','compta'))
);

-- Suppression : admin seulement
create policy "frais_delete" on frais for delete using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

create index if not exists idx_frais_collab on frais(collaborateur_id, date_frais desc);
create index if not exists idx_frais_prestation on frais(prestation_id) where prestation_id is not null;
create index if not exists idx_frais_statut on frais(statut, date_frais desc);
