-- Migration : Centre SportVision — Grades, XP, Ressources, Validations
-- À exécuter dans Supabase → SQL Editor

-- 1. Colonnes grade et XP sur la table profiles
alter table profiles
  add column if not exists grade integer default 0,
  add column if not exists xp integer default 0,
  add column if not exists grade_valide_at timestamptz,
  add column if not exists grade_valide_par uuid references profiles(id);

-- 2. Table ressources documentaires du Centre
create table if not exists centre_ressources (
  id uuid default gen_random_uuid() primary key,
  type text check (type in ('reglement','procedure','guide','faq','politique','modele','formation','info')) default 'guide',
  titre text not null,
  contenu text,
  section text,
  roles_cibles text[] default '{}',
  confidentialite text default 'tous' check (confidentialite in ('tous','equipe','management','admin')),
  obligatoire boolean default false,
  version text default '1.0',
  publie boolean default false,
  publie_par uuid references profiles(id),
  ordre integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table centre_ressources enable row level security;

create policy "centre_res_read" on centre_ressources for select using (
  publie = true
  and exists (select 1 from profiles where id = auth.uid())
  and (
    array_length(roles_cibles, 1) is null
    or (select role from profiles where id = auth.uid()) = any(roles_cibles)
  )
);

create policy "centre_res_admin" on centre_ressources for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- 3. Table validations (lecture / acceptation documents)
create table if not exists centre_validations (
  id uuid default gen_random_uuid() primary key,
  collaborateur_id uuid references profiles(id) on delete cascade,
  ressource_id uuid references centre_ressources(id) on delete cascade,
  chapitre_id text,
  version text default '1.0',
  type text default 'lu' check (type in ('lu','accepte','refuse')),
  created_at timestamptz default now(),
  unique(collaborateur_id, chapitre_id, version)
);

alter table centre_validations enable row level security;

create policy "validations_own" on centre_validations for all using (
  collaborateur_id = auth.uid()
  or exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec'))
);

-- 4. Table événements XP
create table if not exists xp_events (
  id uuid default gen_random_uuid() primary key,
  collaborateur_id uuid references profiles(id) on delete cascade,
  montant integer not null,
  type text check (type in ('formation','certification','prestation','responsabilite','manuel','bonus')) default 'manuel',
  source_id uuid,
  source_type text,
  description text,
  attribue_par uuid references profiles(id),
  created_at timestamptz default now()
);

alter table xp_events enable row level security;

create policy "xp_own_select" on xp_events for select using (
  collaborateur_id = auth.uid()
  or exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta'))
);

create policy "xp_admin_insert" on xp_events for insert with check (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- 5. Table recommandations de grade
create table if not exists grade_recommendations (
  id uuid default gen_random_uuid() primary key,
  collaborateur_id uuid references profiles(id) on delete cascade,
  grade_actuel integer,
  grade_propose integer,
  score_xp integer,
  score_prestations integer,
  score_global integer,
  statut text default 'en_attente' check (statut in ('en_attente','examine','valide','refuse')),
  examine_par uuid references profiles(id),
  valide_par uuid references profiles(id),
  commentaire text,
  created_at timestamptz default now()
);

alter table grade_recommendations enable row level security;

create policy "grade_rec_access" on grade_recommendations for all using (
  collaborateur_id = auth.uid()
  or exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);

-- 6. Indexes
create index if not exists idx_xp_events_collab on xp_events(collaborateur_id, created_at desc);
create index if not exists idx_centre_val_collab on centre_validations(collaborateur_id);
create index if not exists idx_grade_rec_collab on grade_recommendations(collaborateur_id, statut);
create index if not exists idx_centre_res_section on centre_ressources(section, publie, ordre);

-- 7. Trigger updated_at sur centre_ressources
create or replace function update_centre_res_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_centre_res_upd on centre_ressources;
create trigger trg_centre_res_upd before update on centre_ressources
  for each row execute procedure update_centre_res_updated_at();
