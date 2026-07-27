-- Migration : CRM v2 — Suivi contacts & relances
-- À exécuter dans Supabase → SQL Editor

-- 1. Table journal des contacts par client
create table if not exists client_contacts (
  id uuid default gen_random_uuid() primary key,
  client_id uuid references clients(id) on delete cascade,
  auteur_id uuid references profiles(id) on delete set null,
  type text check (type in ('appel','email','reunion','relance','devis_envoyé','visite','autre')) default 'appel',
  resultat text check (resultat in ('positif','neutre','negatif','sans_reponse')) default 'neutre',
  note text not null,
  next_action text,
  next_action_date date,
  created_at timestamptz default now()
);

alter table client_contacts enable row level security;
create policy "clco_read" on client_contacts for select using (
  exists (select 1 from profiles where id = auth.uid())
);
create policy "clco_write" on client_contacts for all using (
  exists (select 1 from profiles where id = auth.uid())
);

create index if not exists idx_clco_client on client_contacts(client_id, created_at desc);
create index if not exists idx_clco_next on client_contacts(next_action_date) where next_action_date is not null;

-- 2. Colonnes suivi sur la table clients
alter table clients
  add column if not exists prochaine_action text,
  add column if not exists date_prochaine_action date,
  add column if not exists score_priorite integer default 0;
