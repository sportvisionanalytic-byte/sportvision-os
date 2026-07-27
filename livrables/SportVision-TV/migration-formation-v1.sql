-- Migration : Centre de formation v1 — SportVision OS
-- Remplace le stockage localStorage par une persistance Supabase
-- À exécuter dans Supabase → SQL Editor

-- 1. Inscriptions aux formations
create table if not exists formation_inscriptions (
  id uuid default gen_random_uuid() primary key,
  formation_id text not null,                          -- correspond aux id de FORMATIONS_CATALOG
  collaborateur_id uuid references profiles(id) on delete cascade,
  statut text check (statut in ('en_cours','terminee','abandonnee')) default 'en_cours',
  progression_pct integer default 0,
  xp_gagnes integer default 0,
  enrolled_at timestamptz default now(),
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(formation_id, collaborateur_id)
);

alter table formation_inscriptions enable row level security;

create policy "fi_own_read" on formation_inscriptions for select using (
  collaborateur_id = auth.uid()
  or exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);

create policy "fi_own_write" on formation_inscriptions for insert with check (
  collaborateur_id = auth.uid()
);

create policy "fi_admin_update" on formation_inscriptions for update using (
  collaborateur_id = auth.uid()
  or exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);

-- 2. Progression par leçon
create table if not exists formation_progression (
  id uuid default gen_random_uuid() primary key,
  inscription_id uuid references formation_inscriptions(id) on delete cascade,
  lecon_key text not null,                             -- format: "mi_li" ex: "0_2"
  completed_at timestamptz default now(),
  unique(inscription_id, lecon_key)
);

alter table formation_progression enable row level security;

create policy "fp_own" on formation_progression for all using (
  exists (
    select 1 from formation_inscriptions fi
    where fi.id = inscription_id
    and (
      fi.collaborateur_id = auth.uid()
      or exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
    )
  )
);

-- 3. Indexes
create index if not exists idx_fi_collab on formation_inscriptions(collaborateur_id, statut);
create index if not exists idx_fi_formation on formation_inscriptions(formation_id, statut);
create index if not exists idx_fp_inscription on formation_progression(inscription_id);
create index if not exists idx_fi_completed on formation_inscriptions(completed_at desc) where statut = 'terminee';

-- 4. Trigger updated_at
drop trigger if exists trg_fi_upd on formation_inscriptions;
create trigger trg_fi_upd before update on formation_inscriptions
  for each row execute procedure update_updated_at_generic();
