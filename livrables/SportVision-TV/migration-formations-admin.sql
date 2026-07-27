-- Migration : Centre de Formation — gestion admin
-- À exécuter dans Supabase → SQL Editor
-- Crée : formations_custom, formations_quiz_custom

-- ─── 1. formations_custom ────────────────────────────────────────────────────
create table if not exists formations_custom (
  id             text primary key,                            -- slug généré côté client
  titre          text not null,
  icone          text default '📚',
  categorie      text,
  niveau         text,
  type           text check (type in ('en_ligne','hybride','terrain')) default 'en_ligne',
  duree          text,
  xp             integer default 50,
  formateur      text,
  obligatoire    boolean default false,
  description    text,
  modules        jsonb default '[]',
  statut         text check (statut in ('publiée','brouillon','archivée')) default 'publiée',
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

alter table formations_custom enable row level security;

-- Lecture : tous les utilisateurs connectés (collaborateurs voient le catalogue)
create policy "fc_select" on formations_custom for select using (
  exists (select 1 from profiles where id = auth.uid())
);

-- Insertion, modification, suppression : admin uniquement
create policy "fc_insert" on formations_custom for insert with check (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
create policy "fc_update" on formations_custom for update using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
create policy "fc_delete" on formations_custom for delete using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- Auto-maj updated_at
create or replace function update_fc_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists trg_fc_updated_at on formations_custom;
create trigger trg_fc_updated_at before update on formations_custom
  for each row execute function update_fc_updated_at();

-- ─── 2. formations_quiz_custom ────────────────────────────────────────────────
create table if not exists formations_quiz_custom (
  id             uuid default gen_random_uuid() primary key,
  formation_id   text not null references formations_custom(id) on delete cascade,
  question       text not null,
  options        jsonb not null default '[]',    -- tableau de strings
  reponse_correcte integer not null default 0,   -- index dans options[]
  ordre          integer default 0,
  created_at     timestamptz default now()
);

-- Permet aussi les quiz pour les formations intégrées (formation_id non FK-contraint)
-- Si vous voulez autoriser les quiz sur formations intégrées, désactivez la FK :
-- alter table formations_quiz_custom drop constraint formations_quiz_custom_formation_id_fkey;
-- add column formation_id text not null;

alter table formations_quiz_custom enable row level security;

-- Lecture : tous les utilisateurs connectés
create policy "fqc_select" on formations_quiz_custom for select using (
  exists (select 1 from profiles where id = auth.uid())
);

-- Écriture : admin uniquement
create policy "fqc_insert" on formations_quiz_custom for insert with check (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
create policy "fqc_delete" on formations_quiz_custom for delete using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

create index if not exists idx_fqc_formation on formations_quiz_custom(formation_id, ordre asc);

-- ─── 3. Variante sans FK pour les formations intégrées ───────────────────────
-- Si vous souhaitez aussi gérer les quiz des formations intégrées (non en DB),
-- exécutez les instructions suivantes APRÈS les deux CREATE TABLE ci-dessus :
--
-- alter table formations_quiz_custom drop constraint formations_quiz_custom_formation_id_fkey;
-- Ce changement rend formation_id libre de référencer n'importe quel ID (intégré ou custom).
-- Les inscriptions/progressions continueront de fonctionner normalement.
