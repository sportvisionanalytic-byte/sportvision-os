-- ============================================================
-- SPORTVISION OS — SCHÉMA COMPLET v2
-- À exécuter dans Supabase → SQL Editor
-- ============================================================

-- ── ENUMS ────────────────────────────────────────────────────

create type statut_client as enum (
  'prospect','qualifié','client','inactif','bloqué'
);

create type statut_prestation as enum (
  'demande_reçue','à_qualifier','offre_en_préparation',
  'devis_envoyé','en_attente_réponse','devis_accepté',
  'en_attente_signature','en_attente_acompte','documents_complets',
  'à_valider_production','confirmée','à_planifier','planifiée',
  'équipe_affectée','prête','équipe_en_route','arrivée_sur_place',
  'production_démarrée','production_terminée','médias_à_transférer',
  'médias_complets','à_monter','montage_en_cours','prêt_validation',
  'à_valider_client','prête_à_livrer','livrée',
  'facturée','partiellement_payée','payée','clôturée',
  'annulée','refusée'
);

create type statut_devis as enum (
  'brouillon','envoyé','en_attente','accepté','refusé','expiré','annulé'
);

create type statut_kit as enum (
  'disponible','pré_réservé','réservé','à_récupérer','sorti',
  'en_prestation','à_retourner','retourné','en_contrôle',
  'endommagé','en_maintenance','indisponible'
);

create type statut_affectation as enum (
  'invitation_envoyée','en_attente','acceptée','refusée','remplacée','annulée'
);

create type niveau_incident as enum ('mineur','important','critique');

create type statut_facture as enum (
  'non_facturée','en_préparation','facturée',
  'partiellement_payée','payée','en_retard','annulée','remboursée'
);

-- ── CLIENTS ──────────────────────────────────────────────────

create table if not exists clients (
  id uuid default gen_random_uuid() primary key,
  statut statut_client not null default 'prospect',
  type_client text check (type_client in ('club','association','entreprise','particulier','fédération')) default 'club',
  nom text not null,
  nom_contact text,
  prenom_contact text,
  email text,
  telephone text,
  ville text,
  code_postal text,
  adresse text,
  sport text,
  ligue text,
  division text,
  origine_prospect text,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── PRESTATIONS ───────────────────────────────────────────────

create sequence if not exists prestation_seq start 1;

create table if not exists prestations (
  id uuid default gen_random_uuid() primary key,
  reference text unique,
  statut statut_prestation not null default 'demande_reçue',
  type_prestation text default 'match',

  client_id uuid references clients(id),

  date_prestation date,
  heure_debut time,
  heure_fin time,
  heure_rdv time,
  heure_depart time,
  lieu text,
  adresse_complete text,
  contact_sur_place text,
  telephone_sur_place text,

  sport text,
  equipes text,
  description_besoin text,
  livrables_demandes text,
  budget_client numeric(10,2),

  responsable_prod_id uuid references profiles(id),
  responsable_prestation_id uuid references profiles(id),

  montant_ht numeric(10,2),
  tva_pct numeric(5,2) default 20,
  montant_ttc numeric(10,2),
  acompte_montant numeric(10,2),
  acompte_recu boolean default false,
  acompte_date date,
  statut_financier statut_facture default 'non_facturée',

  contrat_signe boolean default false,
  notes_internes text,

  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function generate_prestation_ref()
returns trigger language plpgsql as $$
begin
  if new.reference is null then
    new.reference := 'SV-' || extract(year from now())::text || '-' || lpad(nextval('prestation_seq')::text,4,'0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prestation_ref on prestations;
create trigger trg_prestation_ref
  before insert on prestations
  for each row execute procedure generate_prestation_ref();

-- ── DEVIS ─────────────────────────────────────────────────────

create sequence if not exists devis_seq start 1;

create table if not exists devis (
  id uuid default gen_random_uuid() primary key,
  numero text unique,
  statut statut_devis not null default 'brouillon',

  client_id uuid references clients(id),
  prestation_id uuid references prestations(id),
  created_by uuid references profiles(id),

  lignes jsonb not null default '[]',

  sous_total numeric(10,2) default 0,
  remise_pct numeric(5,2) default 0,
  remise_montant numeric(10,2) default 0,
  remise_approuvee_par uuid references profiles(id),
  tva_pct numeric(5,2) default 20,
  total_ht numeric(10,2) default 0,
  total_ttc numeric(10,2) default 0,

  validite_jours integer default 30,
  date_envoi date,
  date_expiration date,
  date_acceptation date,
  notes text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function generate_devis_numero()
returns trigger language plpgsql as $$
begin
  if new.numero is null then
    new.numero := 'DEV-' || extract(year from now())::text || '-' || lpad(nextval('devis_seq')::text,4,'0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_devis_numero on devis;
create trigger trg_devis_numero
  before insert on devis
  for each row execute procedure generate_devis_numero();

-- ── ÉQUIPE PAR PRESTATION ─────────────────────────────────────

create table if not exists prestations_equipe (
  id uuid default gen_random_uuid() primary key,
  prestation_id uuid references prestations(id) on delete cascade,
  collaborateur_id uuid references profiles(id),
  est_responsable boolean default false,
  fonction text,
  heure_rdv time,
  remuneration numeric(10,2),
  frais_km numeric(10,2),
  km_estimes integer,
  statut statut_affectation default 'invitation_envoyée',
  date_reponse timestamptz,
  notes text,
  created_at timestamptz default now()
);

-- ── KITS ──────────────────────────────────────────────────────

create table if not exists kits (
  id uuid default gen_random_uuid() primary key,
  nom text not null,
  type_kit text not null,
  description text,
  contenu jsonb default '[]',
  statut statut_kit default 'disponible',
  valeur numeric(10,2),
  notes text,
  created_at timestamptz default now()
);

-- ── RÉSERVATIONS KITS ─────────────────────────────────────────

create table if not exists kit_reservations (
  id uuid default gen_random_uuid() primary key,
  kit_id uuid references kits(id),
  prestation_id uuid references prestations(id) on delete cascade,
  collaborateur_id uuid references profiles(id),
  statut statut_kit default 'pré_réservé',
  date_sortie timestamptz,
  date_retour_prevue timestamptz,
  date_retour_effective timestamptz,
  etat_sortie text,
  etat_retour text,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- ── INCIDENTS ─────────────────────────────────────────────────

create table if not exists incidents (
  id uuid default gen_random_uuid() primary key,
  prestation_id uuid references prestations(id),
  declare_par uuid references profiles(id),
  type_incident text not null,
  niveau niveau_incident not null default 'mineur',
  description text not null,
  date_incident timestamptz default now(),
  cloture boolean default false,
  cloture_par uuid references profiles(id),
  cloture_at timestamptz,
  resolution text,
  created_at timestamptz default now()
);

-- ── NOTIFICATIONS ─────────────────────────────────────────────

create table if not exists notifications (
  id uuid default gen_random_uuid() primary key,
  destinataire_id uuid references profiles(id),
  type text not null,
  titre text not null,
  message text,
  lue boolean default false,
  prestation_id uuid references prestations(id),
  created_at timestamptz default now()
);

-- ── HISTORIQUE ────────────────────────────────────────────────

create table if not exists historique (
  id uuid default gen_random_uuid() primary key,
  table_cible text not null,
  entite_id uuid not null,
  action text not null,
  champ_modifie text,
  ancienne_valeur text,
  nouvelle_valeur text,
  effectue_par uuid references profiles(id),
  created_at timestamptz default now()
);

-- ── RLS ───────────────────────────────────────────────────────

alter table clients enable row level security;
alter table prestations enable row level security;
alter table devis enable row level security;
alter table prestations_equipe enable row level security;
alter table kits enable row level security;
alter table kit_reservations enable row level security;
alter table incidents enable row level security;
alter table notifications enable row level security;
alter table historique enable row level security;

create policy "clients_acces" on clients for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','com','compta','prod'))
);

create policy "prestations_acces" on prestations for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','prod','compta'))
  or exists (select 1 from prestations_equipe where prestation_id = prestations.id and collaborateur_id = auth.uid())
  or (exists (select 1 from profiles where id = auth.uid() and role = 'cm') and type_prestation = 'réseaux_sociaux')
);

create policy "devis_acces" on devis for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','com','compta'))
);

create policy "equipe_acces" on prestations_equipe for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod','sec'))
  or collaborateur_id = auth.uid()
);

create policy "kits_acces" on kits for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod','sec','compta'))
  or exists (select 1 from kit_reservations kr join prestations_equipe pe on pe.prestation_id = kr.prestation_id where kr.kit_id = kits.id and pe.collaborateur_id = auth.uid())
);

create policy "kit_resa_acces" on kit_reservations for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
  or collaborateur_id = auth.uid()
);

create policy "incidents_acces" on incidents for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod','sec'))
  or declare_par = auth.uid()
);

create policy "notifs_acces" on notifications for all using (
  destinataire_id = auth.uid()
  or exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

create policy "historique_acces" on historique for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);

-- ── DONNÉES INITIALES — KITS ──────────────────────────────────

insert into kits (nom, type_kit, description, statut) values
('Kit Photo 01','photo','Sony A7 IV + 70-200mm + 24-70mm','disponible'),
('Kit Photo 02','photo','Sony A7 III + 100-400mm','disponible'),
('Kit Vidéo 01','vidéo','Sony FX3 + cage + moniteur','disponible'),
('Kit Vidéo 02','vidéo','Sony FX6 + trépied fluid','disponible'),
('Kit Drone 01','drone','DJI Mavic 3 Pro','disponible'),
('Kit Drone 02','drone','DJI Air 3','disponible'),
('Kit Audio 01','audio','Rode NTG5 + Zoom H6','disponible'),
('Kit Streaming 01','streaming','Encodeur ATEM Mini + switcher','disponible');
