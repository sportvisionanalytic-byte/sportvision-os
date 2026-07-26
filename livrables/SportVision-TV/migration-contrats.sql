-- Migration : table contrats & abonnements
-- À exécuter dans Supabase → SQL Editor
-- Permet de gérer les contrats récurrents avec les clubs/clients

create table if not exists contrats (
  id uuid default gen_random_uuid() primary key,

  client_id uuid references clients(id) on delete cascade,
  created_by uuid references profiles(id),

  type_contrat text check (type_contrat in (
    'abonnement_mensuel','abonnement_annuel','forfait_saison','ponctuel','partenariat'
  )) default 'abonnement_mensuel',

  statut text check (statut in ('brouillon','actif','suspendu','résilié','expiré')) default 'brouillon',

  montant_mensuel numeric(10,2),
  frequence text check (frequence in ('mensuel','trimestriel','semestriel','annuel')) default 'mensuel',

  date_debut date,
  date_fin date,

  renouvellement_auto boolean default false,

  quotas jsonb default '{}',
  notes text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Trigger de mise à jour automatique du updated_at
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_contrats_updated_at on contrats;
create trigger trg_contrats_updated_at
  before update on contrats
  for each row execute procedure update_updated_at();

-- RLS
alter table contrats enable row level security;

create policy "contrats_acces" on contrats for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','com','compta'))
);

-- Index utile pour filtres fréquents
create index if not exists idx_contrats_client on contrats(client_id);
create index if not exists idx_contrats_statut on contrats(statut);
