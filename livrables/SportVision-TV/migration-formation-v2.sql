-- Migration : Centre de formation v2 — Sessions, Quiz, Certifications
-- Idempotente : peut être rejouée sans erreur (DROP POLICY IF EXISTS avant chaque CREATE)
-- À exécuter dans Supabase → SQL Editor

-- 1. Score quiz sur formation_inscriptions
alter table formation_inscriptions
  add column if not exists score_quiz integer,
  add column if not exists quiz_passe boolean default false;

-- 2. Sessions de formation (présentiel / en ligne / direct)
create table if not exists formation_sessions (
  id uuid default gen_random_uuid() primary key,
  formation_id text not null,
  titre text,
  formateur_id uuid references profiles(id) on delete set null,
  formateur_ext text,                       -- formateur externe (nom libre)
  date_session timestamptz not null,
  duree_minutes integer default 120,
  lieu text,
  lien_visio text,
  capacite integer default 20,
  statut text check (statut in ('planifiee','confirmee','en_cours','terminee','annulee')) default 'planifiee',
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table formation_sessions enable row level security;
drop policy if exists "fsess_read"   on formation_sessions;
drop policy if exists "fsess_manage" on formation_sessions;
create policy "fsess_read" on formation_sessions for select using (
  exists (select 1 from profiles where id = auth.uid())
);
create policy "fsess_manage" on formation_sessions for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);

-- 3. Présences aux sessions
create table if not exists formation_presences (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references formation_sessions(id) on delete cascade,
  collaborateur_id uuid references profiles(id) on delete cascade,
  statut text check (statut in ('inscrit','present','retard','partiel','absent_justifie','absent')) default 'inscrit',
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(session_id, collaborateur_id)
);

alter table formation_presences enable row level security;
drop policy if exists "fpres_read"   on formation_presences;
drop policy if exists "fpres_manage" on formation_presences;
create policy "fpres_read" on formation_presences for select using (
  collaborateur_id = auth.uid()
  or exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);
create policy "fpres_manage" on formation_presences for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);

-- 4. Validations terrain
create table if not exists formation_validations_terrain (
  id uuid default gen_random_uuid() primary key,
  inscription_id uuid references formation_inscriptions(id) on delete cascade,
  formateur_id uuid references profiles(id) on delete set null,
  statut text check (statut in ('en_attente','valide','valide_reserve','nouvelle_situation','refuse')) default 'en_attente',
  grille jsonb default '{}',
  note_globale integer,
  commentaire text,
  prestation_ref text,
  date_validation timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(inscription_id)
);

alter table formation_validations_terrain enable row level security;
drop policy if exists "fvt_read"   on formation_validations_terrain;
drop policy if exists "fvt_manage" on formation_validations_terrain;
create policy "fvt_read" on formation_validations_terrain for select using (
  exists (
    select 1 from formation_inscriptions fi
    where fi.id = inscription_id
    and (fi.collaborateur_id = auth.uid()
      or exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod')))
  )
);
create policy "fvt_manage" on formation_validations_terrain for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);

-- 5. Certifications obtenues par les collaborateurs
create table if not exists collaborateur_certifications (
  id uuid default gen_random_uuid() primary key,
  collaborateur_id uuid references profiles(id) on delete cascade,
  code_certification text not null,
  nom text not null,
  badge text default '🏅',
  formation_id text,
  inscription_id uuid references formation_inscriptions(id) on delete set null,
  date_obtention timestamptz default now(),
  date_expiration timestamptz,
  statut text check (statut in ('active','expiree','suspendue','revoquee')) default 'active',
  numero_certificat text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(collaborateur_id, code_certification)
);

alter table collaborateur_certifications enable row level security;
drop policy if exists "cc_own_read"    on collaborateur_certifications;
drop policy if exists "cc_admin_manage" on collaborateur_certifications;
create policy "cc_own_read" on collaborateur_certifications for select using (
  collaborateur_id = auth.uid()
  or exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);
create policy "cc_admin_manage" on collaborateur_certifications for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);

-- 6. Index
create index if not exists idx_fsessions_formation on formation_sessions(formation_id, statut);
create index if not exists idx_fsessions_date on formation_sessions(date_session);
create index if not exists idx_fpres_session on formation_presences(session_id);
create index if not exists idx_fpres_collab on formation_presences(collaborateur_id);
create index if not exists idx_fvt_inscription on formation_validations_terrain(inscription_id);
create index if not exists idx_cc_collab on collaborateur_certifications(collaborateur_id, statut);
create index if not exists idx_cc_expiration on collaborateur_certifications(date_expiration) where statut = 'active';

-- 7. Triggers updated_at
drop trigger if exists trg_fsessions_upd on formation_sessions;
create trigger trg_fsessions_upd before update on formation_sessions
  for each row execute procedure update_updated_at_generic();

drop trigger if exists trg_fpres_upd on formation_presences;
create trigger trg_fpres_upd before update on formation_presences
  for each row execute procedure update_updated_at_generic();

drop trigger if exists trg_fvt_upd on formation_validations_terrain;
create trigger trg_fvt_upd before update on formation_validations_terrain
  for each row execute procedure update_updated_at_generic();

drop trigger if exists trg_cc_upd on collaborateur_certifications;
create trigger trg_cc_upd before update on collaborateur_certifications
  for each row execute procedure update_updated_at_generic();

-- 8. Fonction utilitaire : mettre à jour statut des certifications expirées
create or replace function sync_certifications_statut()
returns void language plpgsql as $$
begin
  update collaborateur_certifications
  set statut = 'expiree', updated_at = now()
  where statut = 'active'
  and date_expiration is not null
  and date_expiration < now();
end; $$;
