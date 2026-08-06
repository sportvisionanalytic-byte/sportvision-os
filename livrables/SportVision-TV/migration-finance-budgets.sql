-- SportVision OS — Finance & Comptabilité, Budgets & scénarios de prévision
-- Projection simple à partir d'un run-rate calculé côté client (moyenne des
-- 3 derniers mois complets, cf. loadComptaBudgets dans SportVision-OS-Full.html) :
-- CA(mois n) = run-rate CA × (1+taux_croissance_ca_pct/100)^n
-- Charges(mois n) = run-rate charges × (1+taux_evolution_charges_pct/100)^n
-- L'horizon (3/6/12/24 mois) est un paramètre d'affichage, pas une colonne.

create table if not exists forecast_scenarios (
  id uuid default gen_random_uuid() primary key,
  type text not null unique check (type in ('prudent','central','ambitieux','stress')),
  taux_croissance_ca_pct numeric(5,2) not null default 0,
  taux_evolution_charges_pct numeric(5,2) not null default 0,
  notes text,
  updated_at timestamptz default now()
);

drop trigger if exists trg_forecast_scenarios_upd on forecast_scenarios;
create trigger trg_forecast_scenarios_upd before update on forecast_scenarios
  for each row execute procedure update_updated_at_generic();

alter table forecast_scenarios enable row level security;

drop policy if exists "forecast_scenarios_manage" on forecast_scenarios;
create policy "forecast_scenarios_manage" on forecast_scenarios for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta'))
);
drop policy if exists "forecast_scenarios_read" on forecast_scenarios;
create policy "forecast_scenarios_read" on forecast_scenarios for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta','expert_comptable','auditeur'))
);

insert into forecast_scenarios (type, taux_croissance_ca_pct, taux_evolution_charges_pct, notes)
select 'prudent', 0, 1, 'Pas de croissance du CA, charges en légère hausse.'
where not exists (select 1 from forecast_scenarios where type = 'prudent');
insert into forecast_scenarios (type, taux_croissance_ca_pct, taux_evolution_charges_pct, notes)
select 'central', 2, 1, 'Scénario de référence : croissance modérée du CA.'
where not exists (select 1 from forecast_scenarios where type = 'central');
insert into forecast_scenarios (type, taux_croissance_ca_pct, taux_evolution_charges_pct, notes)
select 'ambitieux', 5, 2, 'Forte croissance (nouveaux clubs partenaires signés).'
where not exists (select 1 from forecast_scenarios where type = 'ambitieux');
insert into forecast_scenarios (type, taux_croissance_ca_pct, taux_evolution_charges_pct, notes)
select 'stress', -5, 1, 'CA en baisse, charges qui continuent d''augmenter légèrement.'
where not exists (select 1 from forecast_scenarios where type = 'stress');
