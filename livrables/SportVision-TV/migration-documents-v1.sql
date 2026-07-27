-- Migration : Documents, Avoirs, Journal — Centre documentaire SportVision OS
-- À exécuter dans Supabase → SQL Editor

-- 1. Séquences de numérotation (avoirs, etc.)
create table if not exists document_sequences (
  id uuid default gen_random_uuid() primary key,
  type text not null,
  year integer not null,
  counter integer default 0,
  created_at timestamptz default now(),
  unique(type, year)
);

alter table document_sequences enable row level security;
create policy "doc_seq_access" on document_sequences for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','compta'))
);

-- 2. Table avoirs (notes de crédit)
create table if not exists avoirs (
  id uuid default gen_random_uuid() primary key,
  numero text unique,
  prestation_id uuid references prestations(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  motif text,
  montant_ht numeric(10,2) default 0,
  tva_pct numeric(5,2) default 20,
  montant_ttc numeric(10,2) default 0,
  statut text check (statut in ('emis','comptabilise','rembourse')) default 'emis',
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table avoirs enable row level security;

create policy "avoirs_manage" on avoirs for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta','sec'))
);

create policy "avoirs_read" on avoirs for select using (
  exists (select 1 from profiles where id = auth.uid())
);

-- 3. Journal des événements documentaires
create table if not exists document_events (
  id uuid default gen_random_uuid() primary key,
  event_type text check (event_type in (
    'creation','envoi','signature','paiement','modification','annulation','avoir','relance','vue'
  )) not null,
  document_ref text,
  document_type text,
  description text,
  user_id uuid references profiles(id),
  created_at timestamptz default now()
);

alter table document_events enable row level security;

create policy "doc_events_read" on document_events for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','compta'))
);

create policy "doc_events_write" on document_events for insert with check (
  exists (select 1 from profiles where id = auth.uid())
);

-- 4. Trigger updated_at sur avoirs
create or replace function update_avoirs_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_avoirs_upd on avoirs;
create trigger trg_avoirs_upd before update on avoirs
  for each row execute procedure update_avoirs_updated_at();

-- 5. Index
create index if not exists idx_avoirs_client on avoirs(client_id, statut);
create index if not exists idx_avoirs_prestation on avoirs(prestation_id);
create index if not exists idx_doc_events_at on document_events(created_at desc);
create index if not exists idx_doc_seq on document_sequences(type, year);
