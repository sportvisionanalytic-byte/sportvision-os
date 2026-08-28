-- ============================================================================
-- migration-documents-rh-v2-clients-clubs-avenants.sql
-- ============================================================================
-- Suite de migration-documents-rh-v2-collaborateurs.sql : ce fichier couvre
-- les 4 catégories restantes du module Documents (Secrétaire) qui ne sont
-- PAS de la RH — "documents Club+", "documents client" et "avenants".
-- "Contrats Full Com" n'a pas besoin de nouvelle table (voir plus bas) : il
-- est déjà entièrement modélisé par `contrats`/`client_contrats`, seulement
-- absorbé dans la vue unifiée du fichier v2-vue-secretariat.sql.
--
-- AUDIT PRÉALABLE (vérifié en lisant le code, pas supposé) :
--   - AUCUNE table "documents client"/"documents club" n'existe. Ce qui
--     existe et pourrait y ressembler :
--       * `contrats` (migration-contrats.sql + v2-types-banque + phase3-4-5)
--         — cycle de vie du CONTRAT (statut, signature_statut via Youtrust,
--         type_contrat dont 'full_communication' et 'club_plus'), mais
--         aucune colonne de stockage de fichier ni de suivi "pièce
--         justificative associée".
--       * `client_contrats`/`client_devis`/`client_factures` (migration-
--         portail-v1.sql, étendues par migration-clubplus-v33-club-
--         documents-access.sql) — des VUES en lecture seule sur
--         devis/contrats/factures, pas des tables de pièces jointes.
--       * `client_organigramme` (migration-crm-fiche-client-detaillee.sql)
--         — un annuaire de personnes, pas des documents.
--       * `parental_authorizations` (migration-clubplus-v15/v30) — un
--         mécanisme de CONSENTEMENT (booléen + type), pas un document
--         stocké.
--     Le commentaire de migration-storage-v95 confirme explicitement qu'un
--     futur préfixe "family-docs/" est prévu mais "n'existe pas encore de
--     code d'upload" — cette migration ne comble pas family-docs/ (hors
--     périmètre : ce sont des documents FAMILLE/joueur côté Connect, pas
--     des documents CLUB/CLIENT gérés par le Secrétariat OS), mais pose le
--     même patron de bucket pour clients/, réutilisable plus tard côté
--     family-docs/ si besoin.
--   - "documents Club+" et "documents client" partagent le même point
--     d'ancrage réel dans le schéma : un club n'a pas de fiche
--     administrative séparée, il est relié à une ligne `clients` via
--     `clubs.portail_client_id` (confirmé par migration-clubplus-v33, PAS
--     `clubs.client_id` qui a été supprimée — voir cette migration pour le
--     détail de la confusion historique). Une seule table `client_documents`
--     ancrée sur `clients(id)` couvre donc les deux catégories : un document
--     "Club+" est simplement un client_documents dont le client_id
--     correspond à un club (déductible via clubs.portail_client_id, exposé
--     ci-dessous en colonne calculée côté vue plutôt qu'en dupliquant la
--     donnée).
--   - "avenants" : AUCUNE table ni colonne n'existe (recherché explicitement
--     — seule trace : deux questions de quiz mentionnant le mot, aucun
--     schéma). Modélisé ici comme une LIGNE de client_documents
--     (type='avenant'), avec un lien optionnel vers le contrat modifié
--     (contrat_id → contrats.id) plutôt qu'une table séparée : un avenant
--     est un document rattaché à un contrat existant, pas une nouvelle
--     entité métier autonome — cohérent avec le principe déjà en place
--     dans ce projet de ne pas créer de table pour un sous-cas qui se
--     modélise comme une ligne typée d'une table plus générale (ex. notifications
--     avec source_type/source_id plutôt qu'une table par type de source).
--
-- PÉRIMÈTRE RLS (décision délibérée) : cette table est réservée au
-- STAFF — admin/sec/com/compta, EXACTEMENT le même jeu de rôles que la
-- policy "contrats_acces" déjà posée sur `contrats` (migration-contrats.sql)
-- puisque ces documents sont le pendant "pièces jointes" du même domaine
-- (contrats/devis/factures client). Aucun accès client_users/club_members
-- n'est ajouté ici : la mission de ce chantier est l'interface SECRÉTAIRE
-- (usage interne), pas un espace self-service club/client. Si un jour un
-- écran "mes documents" est demandé côté Connect/Club+, suivre le patron
-- déjà en place pour client_contrats/client_devis/client_factures (vue
-- dédiée + club_member_has_client_access(), migration-clubplus-v33) plutôt
-- que d'ouvrir une policy RLS directement sur cette table de base — même
-- principe déjà documenté dans cette base : "aucune policy client n'est
-- ajoutée sur les tables sources, la vue est le seul chemin d'accès".
--
-- Idempotente. Aucune exécution ici.
-- ============================================================================

-- ─── 1. client_documents ────────────────────────────────────────────────────
create table if not exists public.client_documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  contrat_id uuid references public.contrats(id) on delete set null,
  type text not null check (type in (
    'rib','kbis_statuts','assurance','piece_identite_representant',
    'autorisation_image','avenant','cgv_signees','autre'
  )),
  nom text not null,
  statut text not null default 'manquant' check (statut in ('manquant','a_valider','valide')),
  date_echeance date,
  storage_path text,
  notes text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.client_documents is
  'Documents administratifs rattachés à une fiche client (clients.id) — couvre à la fois "documents client" et "documents Club+" (un club = un client_documents.client_id qui correspond à clubs.portail_client_id) et les avenants (type=''avenant'', contrat_id optionnel vers le contrat modifié). Distinct de contrats/devis/factures : ceci est le classeur de pièces justificatives, pas le cycle de vie commercial.';
comment on column public.client_documents.contrat_id is
  'Rempli uniquement pour type=''avenant'' (ou toute pièce rattachée à un contrat précis) — nullable, un document peut ne concerner aucun contrat particulier (ex. K-bis, RIB générique du client).';
comment on column public.client_documents.date_echeance is
  'Optionnelle. Pilote le filtre "Expirent bientôt" du module Documents (calculé, cf. vue secretariat_documents), ex. assurance annuelle du club, K-bis à renouveler.';

create index if not exists idx_client_documents_client on public.client_documents(client_id);
create index if not exists idx_client_documents_contrat on public.client_documents(contrat_id) where contrat_id is not null;
create index if not exists idx_client_documents_statut on public.client_documents(statut);

alter table public.client_documents enable row level security;

drop policy if exists "client_documents_staff_all" on public.client_documents;
create policy "client_documents_staff_all" on public.client_documents for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','sec','com','compta')))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','sec','com','compta')));

create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_client_documents_updated_at on public.client_documents;
create trigger trg_client_documents_updated_at
  before update on public.client_documents
  for each row execute procedure update_updated_at();

-- ─── 2. Stockage privé — préfixe clients/<client_id>/<fichier> ─────────────
-- Même bucket sportvision-media-prive, même patron que collaborateurs/
-- (fichier précédent) et messages/ (v95) : jamais d'URL publique stockée,
-- createSignedUrl() à l'affichage depuis client_documents.storage_path.
-- Écriture ET lecture réservées au staff (admin/sec/com/compta) — pas de
-- branche club_member_has_client_access() ici, cf. note RLS ci-dessus
-- (hors périmètre self-service pour cette V1 du module Secrétaire).
drop policy if exists "sv_media_prive_clients_insert" on storage.objects;
create policy "sv_media_prive_clients_insert" on storage.objects for insert
  with check (
    bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'clients'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','sec','com','compta'))
  );

drop policy if exists "sv_media_prive_clients_update" on storage.objects;
create policy "sv_media_prive_clients_update" on storage.objects for update
  using (
    bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'clients'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','sec','com','compta'))
  );

drop policy if exists "sv_media_prive_clients_select" on storage.objects;
create policy "sv_media_prive_clients_select" on storage.objects for select
  using (
    bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'clients'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','sec','com','compta'))
  );

-- ============================================================================
-- À VÉRIFIER APRÈS EXÉCUTION (pas fait ici, hors périmètre de cette session) :
-- 1) information_schema.tables → client_documents existe, RLS activée.
-- 2) Un compte 'sec' jetable peut lire/écrire client_documents ; un compte
--    'photo'/'prod'/'cm' (staff mais hors périmètre documenté) → refusé.
-- 3) Test E2E upload/download jetable sur clients/<id>/... : staff autorisé
--    OK, un compte club_members/client_users (non-staff) → refusé (aucune
--    policy ne leur donne accès, comportement fail-closed attendu).
-- ============================================================================
