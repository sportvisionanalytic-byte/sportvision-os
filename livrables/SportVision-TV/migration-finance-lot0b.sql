-- SportVision OS — Finance & Comptabilité, Lot 0b (correctif sécurité + paie)
-- Corrige un problème introduit par migration-finance-lot0.sql : les colonnes
-- salaire_brut_mensuel et charges_patronales_pct ajoutées sur `profiles`
-- étaient lisibles par n'importe quel collaborateur connecté (policy
-- "Staff lecture annuaire" : auth.uid() is not null, sans filtre de rôle).
-- Les salaires doivent vivre dans une table à part avec sa propre RLS.

-- ── 1. Retrait des colonnes sensibles de profiles ───────────────────────
alter table profiles drop column if exists salaire_brut_mensuel;
alter table profiles drop column if exists charges_patronales_pct;
-- type_contrat reste sur profiles : une catégorie (salarié/freelance/stagiaire)
-- n'est pas un montant, RLS "Staff lecture annuaire" acceptable ici.

-- ── 2. Table dédiée, RLS restreinte ──────────────────────────────────────
create table if not exists employee_costs (
  id uuid default gen_random_uuid() primary key,
  collaborateur_id uuid references profiles(id) on delete cascade unique,
  salaire_brut_mensuel numeric(10,2) not null default 0,
  charges_patronales_pct numeric(5,2) not null default 42,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_employee_costs_upd on employee_costs;
create trigger trg_employee_costs_upd before update on employee_costs
  for each row execute procedure update_updated_at_generic();

alter table employee_costs enable row level security;

drop policy if exists "employee_costs_manage" on employee_costs;
create policy "employee_costs_manage" on employee_costs for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta'))
);
drop policy if exists "employee_costs_read" on employee_costs;
create policy "employee_costs_read" on employee_costs for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta','expert_comptable','auditeur'))
);

-- ── 3. cost_allocations : une seule ligne par méthode (upsert possible) ─
-- migration-finance-lot0.sql ne seedait que 'forfait_par_mission' ; le
-- réglage 'pourcentage_ca' n'existait donc pas encore et ne pouvait pas être
-- modifié par un simple PATCH (0 ligne à mettre à jour).
alter table cost_allocations add constraint cost_allocations_methode_unique unique (methode);
insert into cost_allocations (methode, valeur, actif, description)
select 'pourcentage_ca', 0, true, 'Pourcentage du CA de la mission ajouté au coût indirect'
where not exists (select 1 from cost_allocations where methode = 'pourcentage_ca');
