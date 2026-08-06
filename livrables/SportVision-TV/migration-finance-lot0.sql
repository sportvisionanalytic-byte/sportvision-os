-- SportVision OS — Finance & Comptabilité, Lot 0 (fondation)
-- Suite au cahier des charges "Finance & Comptabilité" (44 pages, 06/08/2026).
-- Scope de ce Lot 0 : ce qui manque réellement aujourd'hui et qui n'oblige
-- pas à retoucher le pipeline devis→facture→paiement déjà en prod :
--   - vraie rentabilité par mission (coûts réels + indirects alloués)
--   - dépenses générales & fournisseurs (distinct des notes de frais collab.)
--   - commissions commerciales
--   - clôtures mensuelles qui verrouillent réellement les écritures
--   - rôle expert_comptable (lecture/export) + auditeur (lecture seule globale)
--   - journal d'audit financier dédié (montants avant/après)
-- Hors scope Lot 0 (renvoyé à un lot ultérieur, nécessite plus de conception
-- ou des accès externes non configurés) : rapprochement bancaire Revolut,
-- budgets/scénarios de prévision, provisionnement TVA/charges automatique,
-- export FEC structuré. SportVision OS reste un outil de pilotage interne,
-- pas le système légal de tenue comptable (expert-comptable/logiciel dédié).

-- ── 1. Rôles ─────────────────────────────────────────────────────────────
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin','sec','prod','photo','cm','compta','com','expert_comptable','auditeur'));

-- ── 2. Fournisseurs & dépenses ──────────────────────────────────────────
create table if not exists vendors (
  id uuid default gen_random_uuid() primary key,
  nom text not null,
  categorie text check (categorie in ('materiel','logiciel','marketing','loyer','assurance','transport','sous_traitance','banque','autre')) default 'autre',
  siret text,
  contact_email text,
  contact_telephone text,
  iban text,
  actif boolean default true,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists expenses (
  id uuid default gen_random_uuid() primary key,
  vendor_id uuid references vendors(id) on delete set null,
  prestation_id uuid references prestations(id) on delete set null,
  categorie text check (categorie in ('materiel','logiciel','marketing','loyer','assurance','transport','sous_traitance','banque','autre')) not null default 'autre',
  libelle text not null,
  montant_ht numeric(10,2) not null default 0,
  tva_pct numeric(5,2) default 20,
  montant_ttc numeric(10,2) not null default 0,
  recurrence text check (recurrence in ('ponctuelle','mensuelle','trimestrielle','annuelle')) default 'ponctuelle',
  date_depense date not null default current_date,
  date_prochaine_echeance date,
  statut text check (statut in ('prevue','engagee','payee','comptabilisee')) not null default 'engagee',
  justificatif_url text,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_expenses_date on expenses(date_depense);
create index if not exists idx_expenses_prestation on expenses(prestation_id);

drop trigger if exists trg_vendors_upd on vendors;
create trigger trg_vendors_upd before update on vendors
  for each row execute procedure update_updated_at_generic();
drop trigger if exists trg_expenses_upd on expenses;
create trigger trg_expenses_upd before update on expenses
  for each row execute procedure update_updated_at_generic();

alter table vendors enable row level security;
alter table expenses enable row level security;

drop policy if exists "vendors_manage" on vendors;
create policy "vendors_manage" on vendors for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta'))
);
drop policy if exists "vendors_read" on vendors;
create policy "vendors_read" on vendors for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta','expert_comptable','auditeur','sec'))
);

drop policy if exists "expenses_manage" on expenses;
create policy "expenses_manage" on expenses for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta'))
);
drop policy if exists "expenses_read" on expenses;
create policy "expenses_read" on expenses for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta','expert_comptable','auditeur'))
);

-- ── 3. Type de contrat collaborateur (pour l'allocation des coûts) ──────
alter table profiles add column if not exists type_contrat text
  check (type_contrat in ('salarie','freelance','stagiaire')) default 'freelance';
alter table profiles add column if not exists salaire_brut_mensuel numeric(10,2);
alter table profiles add column if not exists charges_patronales_pct numeric(5,2) default 42;

-- ── 4. Commissions commerciales ──────────────────────────────────────────
create table if not exists commissions (
  id uuid default gen_random_uuid() primary key,
  commercial_id uuid references profiles(id) on delete set null,
  prestation_id uuid references prestations(id) on delete set null,
  base_calcul numeric(10,2) not null default 0,
  taux_pct numeric(5,2) not null default 0,
  montant_commission numeric(10,2) not null default 0,
  statut text check (statut in ('calculee','validee','payee')) not null default 'calculee',
  date_calcul date not null default current_date,
  date_paiement date,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);
create index if not exists idx_commissions_commercial on commissions(commercial_id);

alter table commissions enable row level security;
drop policy if exists "commissions_manage" on commissions;
create policy "commissions_manage" on commissions for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta'))
);
drop policy if exists "commissions_read_own" on commissions;
create policy "commissions_read_own" on commissions for select using (
  commercial_id = auth.uid()
  or exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta','expert_comptable','auditeur'))
);

-- ── 5. Allocation des coûts indirects (pour le calcul de rentabilité) ───
create table if not exists cost_allocations (
  id uuid default gen_random_uuid() primary key,
  methode text check (methode in ('forfait_par_mission','pourcentage_ca')) not null default 'forfait_par_mission',
  valeur numeric(10,2) not null default 0,
  actif boolean default true,
  description text,
  created_at timestamptz default now()
);
alter table cost_allocations enable row level security;
drop policy if exists "cost_allocations_manage" on cost_allocations;
create policy "cost_allocations_manage" on cost_allocations for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
drop policy if exists "cost_allocations_read" on cost_allocations;
create policy "cost_allocations_read" on cost_allocations for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta','expert_comptable','auditeur'))
);
insert into cost_allocations (methode, valeur, actif, description)
select 'forfait_par_mission', 25, true, 'Forfait indirect par mission (matériel, licences, structure) — à ajuster par l''admin'
where not exists (select 1 from cost_allocations);

-- ── 6. Clôtures mensuelles réelles (verrouillage) ───────────────────────
create table if not exists accounting_periods (
  id uuid default gen_random_uuid() primary key,
  periode text unique not null, -- format 'YYYY-MM'
  statut text check (statut in ('ouverte','cloturee')) not null default 'ouverte',
  cloturee_par uuid references profiles(id),
  cloturee_le timestamptz,
  created_at timestamptz default now()
);
alter table accounting_periods enable row level security;
drop policy if exists "accounting_periods_manage" on accounting_periods;
create policy "accounting_periods_manage" on accounting_periods for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta'))
);
drop policy if exists "accounting_periods_read" on accounting_periods;
create policy "accounting_periods_read" on accounting_periods for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta','expert_comptable','auditeur'))
);

-- Empêche toute nouvelle dépense/commission sur une période déjà clôturée.
-- (Les prestations/factures existantes ne sont volontairement pas verrouillées
-- ici : leur propre cycle de statut est piloté ailleurs dans l'OS.)
create or replace function check_periode_non_clotoree()
returns trigger language plpgsql as $$
declare v_periode text; v_statut text;
begin
  v_periode := to_char(coalesce(new.date_depense, new.date_calcul, current_date), 'YYYY-MM');
  select statut into v_statut from accounting_periods where periode = v_periode;
  if v_statut = 'cloturee' then
    raise exception 'La période % est clôturée : impossible d''ajouter ou modifier une écriture.', v_periode;
  end if;
  return new;
end; $$;

drop trigger if exists trg_expenses_periode on expenses;
create trigger trg_expenses_periode before insert or update on expenses
  for each row execute procedure check_periode_non_clotoree();
drop trigger if exists trg_commissions_periode on commissions;
create trigger trg_commissions_periode before insert or update on commissions
  for each row execute procedure check_periode_non_clotoree();

-- ── 7. Journal d'audit financier dédié ───────────────────────────────────
create table if not exists financial_audit_log (
  id uuid default gen_random_uuid() primary key,
  acteur_id uuid references profiles(id) on delete set null,
  action text not null,
  table_cible text not null,
  ligne_id uuid,
  montant_avant numeric(10,2),
  montant_apres numeric(10,2),
  details jsonb default '{}',
  created_at timestamptz default now()
);
alter table financial_audit_log enable row level security;
drop policy if exists "financial_audit_insert" on financial_audit_log;
create policy "financial_audit_insert" on financial_audit_log for insert with check (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta'))
);
drop policy if exists "financial_audit_read" on financial_audit_log;
create policy "financial_audit_read" on financial_audit_log for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta','expert_comptable','auditeur'))
);

-- ── 8. Vue de rentabilité réelle par mission ────────────────────────────
-- Remplace l'approximation de loadComptaRentabilite (qui ne comptait que
-- prestations_equipe + frais) par un calcul complet : rémunérations réelles
-- + notes de frais + dépenses rattachées à la mission + quote-part de coûts
-- indirects (cost_allocations). Basé sur montant_ht pour comparer des coûts
-- hors taxe à une marge hors taxe.
create or replace view v_rentabilite_missions
with (security_invoker = true) as
select
  p.id as prestation_id,
  p.reference,
  p.type_prestation,
  p.client_id,
  c.nom as client_nom,
  p.date_prestation,
  p.statut_financier,
  coalesce(p.montant_ht, 0) as revenu_ht,
  coalesce(re.total_remunerations, 0) as cout_remunerations,
  coalesce(fr.total_frais, 0) as cout_frais,
  coalesce(de.total_depenses, 0) as cout_depenses_directes,
  coalesce((select valeur from cost_allocations where actif = true and methode = 'forfait_par_mission' limit 1), 0)
    + coalesce(p.montant_ht, 0) * coalesce((select valeur from cost_allocations where actif = true and methode = 'pourcentage_ca' limit 1), 0) / 100.0
    as cout_indirect_alloue,
  coalesce(p.montant_ht, 0)
    - coalesce(re.total_remunerations, 0)
    - coalesce(fr.total_frais, 0)
    - coalesce(de.total_depenses, 0)
    - (coalesce((select valeur from cost_allocations where actif = true and methode = 'forfait_par_mission' limit 1), 0)
       + coalesce(p.montant_ht, 0) * coalesce((select valeur from cost_allocations where actif = true and methode = 'pourcentage_ca' limit 1), 0) / 100.0)
    as marge_nette
from prestations p
left join clients c on c.id = p.client_id
left join (
  select prestation_id, sum(remuneration) as total_remunerations
  from prestations_equipe where statut = 'acceptée'
  group by prestation_id
) re on re.prestation_id = p.id
left join (
  select prestation_id, sum(montant) as total_frais
  from frais where statut in ('validé','remboursé')
  group by prestation_id
) fr on fr.prestation_id = p.id
left join (
  select prestation_id, sum(montant_ht) as total_depenses
  from expenses where statut in ('engagee','payee','comptabilisee')
  group by prestation_id
) de on de.prestation_id = p.id;
