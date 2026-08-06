-- SportVision OS — Finance & Comptabilité, Provisionnement TVA
-- Ajoute une table de provisionnement/estimation de TVA (pilotage interne
-- uniquement — pas une déclaration officielle, cf. bandeau affiché à
-- l'écran). Le calcul est fait côté client à partir de `factures` et
-- `expenses` déjà en place (migration-finance-lot0.sql).
-- Réutilise la fonction update_updated_at_generic() déjà définie ailleurs
-- (ex. migration-portail-v1.sql) — pas de redéfinition ici.

create table if not exists tax_reserves (
  id uuid default gen_random_uuid() primary key,
  periode text not null unique, -- format 'YYYY-MM', cohérent avec accounting_periods.periode
  tva_collectee numeric(10,2) not null default 0,
  tva_deductible numeric(10,2) not null default 0,
  tva_nette numeric(10,2) not null default 0, -- = tva_collectee - tva_deductible
  statut text check (statut in ('provisionnee','declaree','payee')) not null default 'provisionnee',
  date_echeance date,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_tax_reserves_upd on tax_reserves;
create trigger trg_tax_reserves_upd before update on tax_reserves
  for each row execute procedure update_updated_at_generic();

alter table tax_reserves enable row level security;

drop policy if exists "tax_reserves_manage" on tax_reserves;
create policy "tax_reserves_manage" on tax_reserves for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta'))
);
drop policy if exists "tax_reserves_read" on tax_reserves;
create policy "tax_reserves_read" on tax_reserves for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta','expert_comptable','auditeur'))
);
