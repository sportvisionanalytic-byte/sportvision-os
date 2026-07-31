-- Migration : Ressources publiées — Centre SportVision
-- Idempotente : peut être rejouée sans erreur (DROP POLICY IF EXISTS avant chaque CREATE)
-- À exécuter dans Supabase → SQL Editor

create table if not exists centre_ressources (
  id uuid default gen_random_uuid() primary key,
  titre text not null
);

-- Sécurité : si la table existait déjà (partiellement ou avec un autre schéma),
-- on garantit que toutes les colonnes attendues sont bien présentes.
alter table centre_ressources
  add column if not exists description text,
  add column if not exists type text default 'lien',
  add column if not exists url text,
  add column if not exists contenu text,
  add column if not exists icone text default '📄',
  add column if not exists ordre integer default 0,
  add column if not exists actif boolean default true,
  add column if not exists created_by uuid references profiles(id) on delete set null,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table centre_ressources drop constraint if exists centre_ressources_type_check;
alter table centre_ressources add constraint centre_ressources_type_check
  check (type in ('lien','fichier','texte'));

alter table centre_ressources enable row level security;

drop policy if exists "cr_read"   on centre_ressources;
drop policy if exists "cr_manage" on centre_ressources;

create policy "cr_read" on centre_ressources for select using (
  actif = true
  or exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);

create policy "cr_manage" on centre_ressources for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);

create index if not exists idx_cr_actif on centre_ressources(actif, ordre);

create or replace function update_updated_at_generic()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_cr_upd on centre_ressources;
create trigger trg_cr_upd before update on centre_ressources
  for each row execute procedure update_updated_at_generic();
