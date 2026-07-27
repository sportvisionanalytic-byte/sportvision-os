-- Migration : Kits & Matériel v2 — inventaire, compositions, contrôles, incidents, maintenance
-- À exécuter dans Supabase → SQL Editor

-- 1. Extensions kits existants
alter table kits
  add column if not exists num_interne text,
  add column if not exists localisation text,
  add column if not exists responsable_id uuid references profiles(id),
  add column if not exists photo_url text,
  add column if not exists notes text,
  add column if not exists valeur_totale numeric(10,2),
  add column if not exists updated_at timestamptz default now();

-- 2. Matériels individuels
create table if not exists materiels (
  id uuid default gen_random_uuid() primary key,
  nom text not null,
  categorie text check (categorie in (
    'boitier_photo','camera','objectif','microphone','drone','stabilisateur',
    'trepied','eclairage','batterie','carte_memoire','chargeur','cable',
    'ordinateur','telephone','sac','accessoire','consommable','autre'
  )) default 'autre',
  marque text,
  modele text,
  num_interne text,
  num_serie text,
  statut text check (statut in (
    'disponible','affecte_kit','pre_reserve','reserve','a_preparer','pret',
    'sorti','en_prestation','a_retourner','retourne','a_controler',
    'fonctionnel','fonctionnel_reserve','defectueux','endommage',
    'element_manquant','en_maintenance','en_reparation','perdu','retire','archive'
  )) default 'disponible',
  kit_id uuid references kits(id) on delete set null,
  valeur numeric(10,2),
  date_achat date,
  description text,
  photo_url text,
  certification_requise text,
  derniere_verification date,
  prochaine_maintenance date,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table materiels enable row level security;
create policy "materiels_access" on materiels for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod','compta','photo','sec'))
);
create policy "materiels_photo_select" on materiels for select using (
  exists (select 1 from profiles where id = auth.uid() and role = 'photo')
);

-- 3. Compositions de kit (matériels dans kits)
create table if not exists kit_compositions (
  id uuid default gen_random_uuid() primary key,
  kit_id uuid references kits(id) on delete cascade,
  materiel_id uuid references materiels(id) on delete cascade,
  quantite integer default 1,
  obligatoire boolean default true,
  ordre integer default 0,
  notes text,
  date_ajout timestamptz default now(),
  ajoute_par uuid references profiles(id),
  unique(kit_id, materiel_id)
);

alter table kit_compositions enable row level security;
create policy "kit_comp_access" on kit_compositions for all using (
  exists (select 1 from profiles where id = auth.uid())
);

-- 4. Extension kit_reservations
alter table kit_reservations
  add column if not exists responsable_id uuid references profiles(id),
  add column if not exists heure_sortie timestamptz,
  add column if not exists heure_retour_prevue timestamptz,
  add column if not exists heure_retour_reelle timestamptz,
  add column if not exists lieu_recuperation text,
  add column if not exists lieu_retour text,
  add column if not exists consignes text,
  add column if not exists controle_avant_id uuid,
  add column if not exists controle_apres_id uuid;

-- 5. Contrôles avant/après prestation
create table if not exists kit_controles (
  id uuid default gen_random_uuid() primary key,
  kit_id uuid references kits(id) on delete cascade,
  kit_reservation_id uuid references kit_reservations(id) on delete set null,
  prestation_id uuid references prestations(id) on delete set null,
  collaborateur_id uuid references profiles(id),
  type text check (type in ('avant','apres')) not null,
  statut text check (statut in ('en_cours','valide','anomalie','bloquant')) default 'en_cours',
  commentaire_global text,
  signature_at timestamptz,
  items_total integer default 0,
  items_ok integer default 0,
  items_reserve integer default 1,
  items_ko integer default 0,
  items_absent integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table kit_controles enable row level security;
create policy "kit_ctrl_access" on kit_controles for all using (
  exists (select 1 from profiles where id = auth.uid())
);

-- 6. Items de contrôle (un par matériel dans le kit)
create table if not exists kit_controle_items (
  id uuid default gen_random_uuid() primary key,
  controle_id uuid references kit_controles(id) on delete cascade,
  materiel_id uuid references materiels(id) on delete cascade,
  statut_item text check (statut_item in (
    'ok','reserve','defectueux','absent','non_verifie'
  )) default 'non_verifie',
  commentaire text,
  photo_urls text[],
  created_at timestamptz default now()
);

alter table kit_controle_items enable row level security;
create policy "kit_ctrl_items_access" on kit_controle_items for all using (
  exists (select 1 from profiles where id = auth.uid())
);

-- 7. Incidents matériel
create table if not exists materiel_incidents (
  id uuid default gen_random_uuid() primary key,
  kit_id uuid references kits(id) on delete set null,
  materiel_id uuid references materiels(id) on delete set null,
  prestation_id uuid references prestations(id) on delete set null,
  kit_reservation_id uuid references kit_reservations(id) on delete set null,
  collaborateur_id uuid references profiles(id),
  type_incident text check (type_incident in (
    'panne','chute','choc','casse','perte','vol','element_manquant',
    'surchauffe','batterie_defectueuse','carte_defectueuse',
    'probleme_audio','probleme_image','mauvaise_manipulation','incident_externe','autre'
  )) default 'autre',
  description text,
  gravite text check (gravite in ('mineur','important','critique')) default 'mineur',
  statut text check (statut in ('ouvert','en_cours','resolu','classe')) default 'ouvert',
  impact_prestation text,
  action_immediate text,
  photo_urls text[],
  resolution text,
  resolu_par uuid references profiles(id),
  resolu_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table materiel_incidents enable row level security;
create policy "incidents_access" on materiel_incidents for all using (
  exists (select 1 from profiles where id = auth.uid())
);

-- 8. Maintenances
create table if not exists materiel_maintenances (
  id uuid default gen_random_uuid() primary key,
  materiel_id uuid references materiels(id) on delete cascade,
  kit_id uuid references kits(id) on delete set null,
  incident_id uuid references materiel_incidents(id) on delete set null,
  description text,
  statut text check (statut in (
    'a_diagnostiquer','diagnostic_en_cours','validation_requise','attente_piece',
    'en_reparation','repare','test_a_effectuer','remis_en_service',
    'non_reparable','remplace','archive'
  )) default 'a_diagnostiquer',
  priorite text check (priorite in ('faible','normale','haute','urgente')) default 'normale',
  responsable_id uuid references profiles(id),
  prestataire text,
  devis numeric(10,2),
  cout_final numeric(10,2),
  date_declaration date,
  date_envoi date,
  date_retour_prevue date,
  date_retour_reelle date,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table materiel_maintenances enable row level security;
create policy "maintenances_access" on materiel_maintenances for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod','compta'))
);

-- 9. Index
create index if not exists idx_materiels_kit on materiels(kit_id, statut);
create index if not exists idx_materiels_statut on materiels(statut);
create index if not exists idx_kit_comp_kit on kit_compositions(kit_id, ordre);
create index if not exists idx_kit_ctrl_resa on kit_controles(kit_reservation_id);
create index if not exists idx_kit_ctrl_items on kit_controle_items(controle_id);
create index if not exists idx_incidents_statut on materiel_incidents(statut, gravite);
create index if not exists idx_incidents_kit on materiel_incidents(kit_id, statut);
create index if not exists idx_maintenances_statut on materiel_maintenances(statut, priorite);

-- 10. Trigger updated_at
create or replace function update_updated_at_generic()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_materiels_upd on materiels;
create trigger trg_materiels_upd before update on materiels
  for each row execute procedure update_updated_at_generic();

drop trigger if exists trg_kit_ctrl_upd on kit_controles;
create trigger trg_kit_ctrl_upd before update on kit_controles
  for each row execute procedure update_updated_at_generic();

drop trigger if exists trg_incidents_upd on materiel_incidents;
create trigger trg_incidents_upd before update on materiel_incidents
  for each row execute procedure update_updated_at_generic();

drop trigger if exists trg_maintenances_upd on materiel_maintenances;
create trigger trg_maintenances_upd before update on materiel_maintenances
  for each row execute procedure update_updated_at_generic();
