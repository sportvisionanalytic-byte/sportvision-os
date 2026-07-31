-- ============================================================
-- SPORTVISION PORTAIL — Migration v1
-- Connecte SportVision Portail au même projet Supabase que l'OS.
-- Idempotente : peut être rejouée sans erreur (drop policy if exists avant chaque create).
-- N'altère aucune table existante de l'OS de façon cassante (ajouts uniquement).
-- À exécuter dans Supabase → SQL Editor, après les migrations OS existantes.
-- ============================================================

-- ── FONCTION GÉNÉRIQUE updated_at (réutilisée si déjà créée par migration-medias.sql) ──

create or replace function update_updated_at_generic()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- ── 1. PRÉPARATION CLUB+ (colonnes réservées, non utilisées pour l'instant) ──

alter table clients add column if not exists club_plus_actif boolean default false;
alter table clients add column if not exists club_plus_plan text;

-- ── 2. IDENTITÉ CLIENT — client_users ──
-- Table séparée de `profiles` (staff). Un compte client n'a jamais de ligne dans `profiles`,
-- donc toutes les policies existantes `exists (select 1 from profiles where id = auth.uid())`
-- échouent naturellement pour un client : fail-closed par défaut sur l'OS, aucune policy
-- existante à modifier. Alimentée par l'Edge Function d'onboarding (service role).

create table if not exists client_users (
  id uuid references auth.users on delete cascade primary key,
  client_id uuid references clients(id) on delete cascade not null,
  prenom text,
  nom text,
  telephone text,
  created_at timestamptz default now()
);

alter table client_users enable row level security;

drop policy if exists "cu_self_select" on client_users;
drop policy if exists "cu_self_update" on client_users;
drop policy if exists "cu_staff_all" on client_users;

create policy "cu_self_select" on client_users for select using (auth.uid() = id);
create policy "cu_self_update" on client_users for update using (auth.uid() = id);
create policy "cu_staff_all" on client_users for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','com','compta'))
);

create index if not exists idx_cu_client on client_users(client_id);

-- ── 3. CATALOGUE PUBLIC — catalogue_offres ──
-- Distinct du champ libre prestations.type_prestation (usage interne).
-- C'est le catalogue commercial affiché publiquement sur le Portail, avec tarifs structurés.

create table if not exists catalogue_offres (
  id uuid default gen_random_uuid() primary key,
  slug text unique not null,
  nom text not null,
  categorie text check (categorie in ('photo','video','pack','tournoi','stage','shooting','drone','veo','contenu')) not null,
  description text,
  description_longue text,
  image_url text,
  tarif_type text check (tarif_type in ('fixe','sur_devis')) default 'fixe',
  prix_ht numeric(10,2),
  tva_pct numeric(5,2) default 20,
  duree_estimee text,
  livrables_inclus text,
  options jsonb default '[]',
  actif boolean default true,
  ordre integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table catalogue_offres enable row level security;

drop policy if exists "catalogue_public_read" on catalogue_offres;
drop policy if exists "catalogue_staff_write" on catalogue_offres;

create policy "catalogue_public_read" on catalogue_offres for select using (actif = true);
create policy "catalogue_staff_write" on catalogue_offres for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','com'))
);

drop trigger if exists trg_catalogue_upd on catalogue_offres;
create trigger trg_catalogue_upd before update on catalogue_offres
  for each row execute procedure update_updated_at_generic();

create index if not exists idx_catalogue_categorie on catalogue_offres(categorie, actif);

-- ── 4. FACTURATION — factures ──
-- L'OS n'a jamais eu de facturation structurée (seulement des champs sur prestations + avoirs).
-- Nécessaire pour que le client télécharge de vraies factures numérotées depuis le Portail.

create sequence if not exists facture_seq start 1;

create table if not exists factures (
  id uuid default gen_random_uuid() primary key,
  numero text unique,
  prestation_id uuid references prestations(id) on delete set null,
  devis_id uuid references devis(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  type_facture text check (type_facture in ('acompte','solde','totalite')) default 'acompte',
  lignes jsonb not null default '[]',
  montant_ht numeric(10,2) default 0,
  tva_pct numeric(5,2) default 20,
  montant_ttc numeric(10,2) default 0,
  statut text check (statut in ('brouillon','emise','payee','en_retard','annulee','remboursee')) default 'brouillon',
  date_emission date,
  date_echeance date,
  pdf_url text,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function generate_facture_numero()
returns trigger language plpgsql as $$
begin
  if new.numero is null then
    new.numero := 'FAC-' || extract(year from now())::text || '-' || lpad(nextval('facture_seq')::text,4,'0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_facture_numero on factures;
create trigger trg_facture_numero
  before insert on factures
  for each row execute procedure generate_facture_numero();

drop trigger if exists trg_factures_upd on factures;
create trigger trg_factures_upd before update on factures
  for each row execute procedure update_updated_at_generic();

alter table factures enable row level security;

drop policy if exists "factures_staff" on factures;
create policy "factures_staff" on factures for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','compta'))
);
-- Pas de policy client directe : accès en lecture via la vue client_factures (voir plus bas),
-- pour ne jamais exposer created_by ni les lignes internes non filtrées par erreur future.

create index if not exists idx_factures_client on factures(client_id, statut);
create index if not exists idx_factures_prestation on factures(prestation_id);

-- ── 5. PAIEMENTS — ledger Stripe ──

create table if not exists paiements (
  id uuid default gen_random_uuid() primary key,
  prestation_id uuid references prestations(id) on delete set null,
  devis_id uuid references devis(id) on delete set null,
  facture_id uuid references factures(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  type_paiement text check (type_paiement in ('acompte','solde','totalite')) default 'acompte',
  montant numeric(10,2) not null,
  devise text default 'eur',
  statut text check (statut in ('en_attente','reussi','echoue','rembourse','annule')) default 'en_attente',
  stripe_checkout_session_id text,
  stripe_payment_intent_id text unique,
  recu_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_paiements_upd on paiements;
create trigger trg_paiements_upd before update on paiements
  for each row execute procedure update_updated_at_generic();

alter table paiements enable row level security;

drop policy if exists "paiements_staff" on paiements;
drop policy if exists "paiements_client_own" on paiements;

create policy "paiements_staff" on paiements for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','compta'))
);
-- Table sans colonne interne sensible (pas de marge, pas de coût) : lecture directe possible pour le client.
create policy "paiements_client_own" on paiements for select using (
  exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = paiements.client_id)
);

create index if not exists idx_paiements_client on paiements(client_id, statut);
create index if not exists idx_paiements_prestation on paiements(prestation_id);

-- ── 6. JOURNAL WEBHOOKS STRIPE — idempotence ──
-- Écrit uniquement par l'Edge Function stripe-webhook (service role) : pas de policy client, pas de policy staff insert.

create table if not exists stripe_events (
  id text primary key,
  type text not null,
  processed_at timestamptz default now()
);

alter table stripe_events enable row level security;

drop policy if exists "stripe_events_staff_read" on stripe_events;
create policy "stripe_events_staff_read" on stripe_events for select using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- ── 7. MESSAGERIE CLIENT — messages_client ──
-- La table `messages` existante relie deux `profiles` (staff↔staff), inutilisable pour un client.

create table if not exists messages_client (
  id uuid default gen_random_uuid() primary key,
  prestation_id uuid references prestations(id) on delete cascade,
  client_id uuid references clients(id) not null,
  auteur_type text check (auteur_type in ('client','staff')) not null,
  auteur_client_id uuid references client_users(id) on delete set null,
  auteur_staff_id uuid references profiles(id) on delete set null,
  contenu text not null,
  piece_jointe_url text,
  lu boolean default false,
  created_at timestamptz default now()
);

alter table messages_client enable row level security;

drop policy if exists "mc_client_select" on messages_client;
drop policy if exists "mc_client_insert" on messages_client;
drop policy if exists "mc_staff_all" on messages_client;

create policy "mc_client_select" on messages_client for select using (
  exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = messages_client.client_id)
);
create policy "mc_client_insert" on messages_client for insert with check (
  auteur_type = 'client'
  and auteur_client_id = auth.uid()
  and exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = messages_client.client_id)
);
create policy "mc_staff_all" on messages_client for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','com','prod'))
);

create index if not exists idx_mc_client on messages_client(client_id, created_at desc);
create index if not exists idx_mc_prestation on messages_client(prestation_id);

-- ── 8. RENDEZ-VOUS — rendez_vous ──
-- Demandes de créneau (découverte, audit...) prises depuis le Portail, confirmées par le staff dans l'OS.

create table if not exists rendez_vous (
  id uuid default gen_random_uuid() primary key,
  client_id uuid references clients(id) on delete cascade,
  prestation_id uuid references prestations(id) on delete set null,
  type_rdv text check (type_rdv in ('appel','physique')) not null,
  objet text,
  date_demandee date,
  heure_demandee time,
  statut text check (statut in ('a_confirmer','confirme','annule','realise')) default 'a_confirmer',
  confirme_par uuid references profiles(id) on delete set null,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_rdv_upd on rendez_vous;
create trigger trg_rdv_upd before update on rendez_vous
  for each row execute procedure update_updated_at_generic();

alter table rendez_vous enable row level security;

drop policy if exists "rdv_client_own" on rendez_vous;
drop policy if exists "rdv_staff_all" on rendez_vous;

create policy "rdv_client_own" on rendez_vous for select using (
  exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = rendez_vous.client_id)
);
create policy "rdv_client_insert" on rendez_vous for insert with check (
  exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = rendez_vous.client_id)
);
create policy "rdv_staff_all" on rendez_vous for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','com'))
);

create index if not exists idx_rdv_client on rendez_vous(client_id, statut);

-- ── 9. AUDIT — audit_logs ──
-- Obligatoire par PERMISSIONS.md : le mode "voir en tant que client" côté staff doit être
-- une action distincte et tracée, jamais une bascule silencieuse.

create table if not exists audit_logs (
  id uuid default gen_random_uuid() primary key,
  acteur_id uuid references profiles(id) on delete set null,
  action text not null,
  cible_type text,
  cible_id uuid,
  details jsonb default '{}',
  created_at timestamptz default now()
);

alter table audit_logs enable row level security;

drop policy if exists "audit_staff_insert" on audit_logs;
drop policy if exists "audit_admin_read" on audit_logs;

create policy "audit_staff_insert" on audit_logs for insert with check (
  exists (select 1 from profiles where id = auth.uid())
);
create policy "audit_admin_read" on audit_logs for select using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

create index if not exists idx_audit_cible on audit_logs(cible_type, cible_id);
create index if not exists idx_audit_acteur on audit_logs(acteur_id, created_at desc);

-- ── 10. EXTENSION contrats — contrats de mission (signature) ──
-- La table `contrats` existante sert aux abonnements récurrents (type_contrat 'abonnement_mensuel'...).
-- On la réutilise pour les contrats liés à une prestation ponctuelle plutôt que d'en créer une nouvelle.

alter table contrats add column if not exists prestation_id uuid references prestations(id) on delete set null;
alter table contrats add column if not exists statut_signature text check (statut_signature in ('a_signer','signe','refuse')) default 'a_signer';
alter table contrats add column if not exists signataire_nom text;
alter table contrats add column if not exists signe_at timestamptz;

create index if not exists idx_contrats_prestation on contrats(prestation_id);

-- ── 11. VUES CLIENT — lecture restreinte, colonnes internes exclues ──
-- Important : ces vues ne définissent PAS security_invoker = true. Elles s'exécutent donc avec
-- les droits du propriétaire de la vue (comportement par défaut de Postgres), pas ceux de
-- l'appelant : les policies RLS de prestations/devis/contrats/factures ne s'appliquent pas ici,
-- seul le filtre `where exists (...)` ci-dessous fait foi. Aucune policy client n'est ajoutée sur
-- les tables brutes : un client qui interrogerait prestations/devis/contrats/factures directement
-- via l'API obtient donc zéro ligne (fail-closed), la vue est le seul chemin d'accès.

drop view if exists client_prestations;
create view client_prestations as
select
  p.id, p.reference, p.statut, p.type_prestation, p.client_id,
  p.date_prestation, p.heure_debut, p.heure_fin, p.lieu, p.adresse_complete,
  p.sport, p.equipes, p.description_besoin, p.livrables_demandes,
  p.montant_ttc, p.acompte_montant, p.acompte_recu, p.acompte_date, p.statut_financier,
  p.created_at, p.updated_at
from prestations p
where exists (
  select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = p.client_id
);

drop view if exists client_devis;
create view client_devis as
select
  d.id, d.numero, d.statut, d.client_id, d.prestation_id,
  d.lignes, d.sous_total, d.remise_pct, d.remise_montant, d.tva_pct, d.total_ht, d.total_ttc,
  d.validite_jours, d.date_envoi, d.date_expiration, d.date_acceptation, d.notes,
  d.created_at, d.updated_at
from devis d
where exists (
  select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = d.client_id
);

drop view if exists client_contrats;
create view client_contrats as
select
  c.id, c.type_contrat, c.statut, c.statut_signature, c.signataire_nom, c.signe_at,
  c.client_id, c.prestation_id, c.montant_mensuel, c.frequence, c.date_debut, c.date_fin,
  c.created_at, c.updated_at
from contrats c
where exists (
  select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = c.client_id
);

drop view if exists client_factures;
create view client_factures as
select
  f.id, f.numero, f.type_facture, f.statut, f.client_id, f.prestation_id, f.devis_id,
  f.lignes, f.montant_ht, f.tva_pct, f.montant_ttc, f.date_emission, f.date_echeance, f.pdf_url,
  f.created_at
from factures f
where exists (
  select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = f.client_id
);

drop view if exists client_media_livrables;
create view client_media_livrables as
select
  ml.id, ml.prestation_id, ml.nom, ml.type_livrable, ml.format, ml.duree,
  ml.nb_fichiers, ml.date_validation, ml.date_expiration, ml.instructions, ml.statut,
  ml.created_at
from media_livrables ml
join prestations p on p.id = ml.prestation_id
where ml.statut in ('livre','consulte')
  and exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = p.client_id);

-- ── 12. ACCEPTATION DE DEVIS PAR LE CLIENT — fonction dédiée plutôt qu'une policy UPDATE ──
-- Une policy RLS "for update ... with check (statut in (...))" ne restreint que la valeur finale
-- de `statut`, pas les autres colonnes modifiables dans la même requête (total_ttc, lignes...).
-- Cette fonction ne touche jamais que statut/date_acceptation, quoi que le client transmette.

create or replace function client_decide_devis(p_devis_id uuid, p_decision text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_statut_actuel text;
begin
  if p_decision not in ('accepté','refusé') then
    raise exception 'Décision invalide';
  end if;

  select client_id, statut into v_client_id, v_statut_actuel from devis where id = p_devis_id;

  if v_client_id is null then
    raise exception 'Devis introuvable';
  end if;

  if not exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = v_client_id) then
    raise exception 'Non autorisé';
  end if;

  if v_statut_actuel not in ('envoyé','en_attente') then
    raise exception 'Ce devis ne peut plus être accepté ou refusé';
  end if;

  update devis
  set statut = p_decision,
      date_acceptation = case when p_decision = 'accepté' then current_date else date_acceptation end,
      updated_at = now()
  where id = p_devis_id;

  insert into document_events (event_type, document_ref, document_type, description)
  values ('modification', (select numero from devis where id = p_devis_id), 'devis',
          case when p_decision = 'accepté' then 'Devis accepté par le client' else 'Devis refusé par le client' end);
end;
$$;

revoke all on function client_decide_devis(uuid, text) from public;
grant execute on function client_decide_devis(uuid, text) to authenticated;
