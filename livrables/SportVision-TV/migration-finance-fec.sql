-- SportVision OS — Finance & Comptabilité, Export FEC (brouillon de préparation)
-- ATTENTION : cet export prépare un fichier au FORMAT FEC (18 colonnes,
-- arrêté du 29/07/2013, article A47 A-1 du Livre des procédures fiscales)
-- mais les numéros de compte du Plan Comptable Général utilisés (table
-- pcg_mapping) sont INDICATIFS. SportVision OS reste un outil de pilotage
-- interne : ce brouillon doit être validé par l'expert-comptable avant toute
-- transmission, il ne remplace pas la tenue comptable officielle.

create table if not exists pcg_mapping (
  id uuid default gen_random_uuid() primary key,
  type_operation text not null unique check (type_operation in (
    'vente_prestation','tva_collectee','client_tiers',
    'depense_materiel','depense_logiciel','depense_marketing','depense_loyer',
    'depense_assurance','depense_sous_traitance','depense_banque','depense_autre',
    'tva_deductible','fournisseur_tiers',
    'remuneration_freelance','salaire_net','charges_patronales','commission_commerciale',
    'personnel_du'
  )),
  compte_numero text not null,
  compte_libelle text not null,
  updated_at timestamptz default now()
);

drop trigger if exists trg_pcg_mapping_upd on pcg_mapping;
create trigger trg_pcg_mapping_upd before update on pcg_mapping
  for each row execute procedure update_updated_at_generic();

alter table pcg_mapping enable row level security;
drop policy if exists "pcg_mapping_manage" on pcg_mapping;
create policy "pcg_mapping_manage" on pcg_mapping for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta'))
);
drop policy if exists "pcg_mapping_read" on pcg_mapping;
create policy "pcg_mapping_read" on pcg_mapping for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta','expert_comptable','auditeur'))
);

-- Valeurs de départ indicatives (Plan Comptable Général français, à valider) :
insert into pcg_mapping (type_operation, compte_numero, compte_libelle) values
  ('vente_prestation','706','Prestations de services'),
  ('tva_collectee','445711','TVA collectée'),
  ('client_tiers','411','Clients'),
  ('depense_materiel','6063','Fournitures et matériel'),
  ('depense_logiciel','6156','Maintenance / abonnements logiciels'),
  ('depense_marketing','6231','Annonces et publicité'),
  ('depense_loyer','6132','Locations immobilières'),
  ('depense_assurance','616','Primes d''assurance'),
  ('depense_sous_traitance','611','Sous-traitance générale'),
  ('depense_banque','627','Services bancaires'),
  ('depense_autre','6288','Autres charges diverses'),
  ('tva_deductible','445662','TVA déductible sur autres biens et services'),
  ('fournisseur_tiers','401','Fournisseurs'),
  ('remuneration_freelance','6226','Honoraires'),
  ('salaire_net','641','Rémunérations du personnel'),
  ('charges_patronales','645','Charges de sécurité sociale et de prévoyance'),
  ('commission_commerciale','6226','Honoraires / commissions'),
  ('personnel_du','421','Personnel — rémunérations dues')
on conflict (type_operation) do nothing;

-- Traçabilité des exports déjà générés
create table if not exists fec_exports (
  id uuid default gen_random_uuid() primary key,
  periode text not null,
  genere_par uuid references profiles(id),
  genere_le timestamptz default now(),
  nb_lignes integer,
  notes text
);
alter table fec_exports enable row level security;
drop policy if exists "fec_exports_insert" on fec_exports;
create policy "fec_exports_insert" on fec_exports for insert with check (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta','expert_comptable'))
);
drop policy if exists "fec_exports_read" on fec_exports;
create policy "fec_exports_read" on fec_exports for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta','expert_comptable','auditeur'))
);
