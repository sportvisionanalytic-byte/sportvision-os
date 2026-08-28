-- ============================================================================
-- migration-documents-rh-v2-collaborateurs.sql
-- ============================================================================
-- Contexte : refonte de l'interface Secrétaire — nouveau module "Documents"
-- avec 4 filtres transverses (Manquants | À valider | Expirent bientôt |
-- Complets), couvrant 7 catégories de documents. Ce fichier traite la
-- catégorie RH (contrats collaborateurs, RIB, pièces d'onboarding) ; les
-- catégories client/club/avenants sont traitées par
-- migration-documents-rh-v2-clients-clubs-avenants.sql, et la vue unifiée
-- des 4 filtres par migration-documents-rh-v2-vue-secretariat.sql.
--
-- AUDIT PRÉALABLE (deux notes contradictoires trouvées avant d'écrire quoi
-- que ce soit — tranché en lisant le code réel, pas en supposant) :
--   - `collaborateur_documents` EXISTE déjà (migration-equipe-rh-refonte-
--     28-08.sql, table à part entière, PAS une hypothèse). Colonnes
--     actuelles : id, collaborateur_id, type (contrat/rib/justificatif/
--     autre), nom, statut (present/manquant — PAS encore le vocabulaire à
--     4 états demandé par le module Documents), storage_path, notes,
--     uploaded_by, created_at, updated_at. RLS : admin/compta en écriture
--     totale, le collaborateur en lecture de ses seules lignes. AUCUNE
--     policy storage n'existe encore pour un chemin collaborateurs/ — le
--     commentaire de cette migration le dit explicitement ("storage_path
--     reste disponible pour un chantier futur").
--   - Cette migration RÉUTILISE cette table (ne la recrée pas), et ajoute
--     seulement ce qui manque : le vocabulaire de statut à 4 états, une
--     échéance optionnelle, un type de plus pour l'onboarding, et le
--     stockage privé réellement câblé (policies storage.objects, patron
--     sportvision-media-prive déjà en place pour messages/ et
--     recrutement-cv/ — migration-storage-v95 / migration-recrutement-v1).
--
-- DÉCISION RLS DÉLIBÉRÉE (à ne pas "corriger" par erreur plus tard) :
-- le rôle 'sec' N'EST PAS ajouté à la policy d'écriture/lecture globale de
-- cette table. La consigne du chantier Documents dit "RH sensible protégé" :
-- un contrat de collaborateur ou un RIB reste admin/compta uniquement,
-- exactement comme posé par migration-equipe-rh-refonte-28-08.sql. Le
-- Secrétariat verra ces lignes dans le module Documents seulement s'il a
-- lui-même le rôle admin/compta — la vue unifiée (fichier v2-vue-
-- secretariat) respecte ce même filtre, pas un accès élargi.
--
-- Idempotente : information_schema/pg_constraint avant chaque ALTER, drop
-- policy if exists avant chaque create. Aucune exécution ici (SQL only,
-- à exécuter et vérifier manuellement comme le reste du dossier).
-- ============================================================================

-- ─── 1. Vocabulaire de statut à 4 états ────────────────────────────────────
-- 'present'/'manquant' → remplacé par 'manquant'/'a_valider'/'valide', le
-- même vocabulaire que contenus.statut (migration-contenus.sql) et
-- devis/contrats.signature_statut (migration-phase3-4-5.sql), pour ne pas
-- inventer un troisième jeu de mots dans la même base. Le 4e filtre du
-- module ("Expirent bientôt") n'est PAS un 5e état stocké ici : c'est une
-- dérivation calculée à la lecture (valide + date_echeance proche), portée
-- par la vue unifiée du fichier v2-vue-secretariat.sql — un état stocké
-- deviendrait obsolète sans job de rafraîchissement (aucun pg_cron n'est
-- ouvert dans cette session, hors budget), alors qu'une date_echeance
-- recalculée à chaque lecture est toujours exacte.
do $$
begin
  -- Backfill défensif : si des lignes 'present' existent déjà (peu probable,
  -- la RH refonte n'a fait que de la metadata sans upload réel selon son
  -- propre commentaire, mais on ne suppose rien sans vérifier), on les
  -- reclasse en 'valide' AVANT de resserrer la contrainte CHECK, sinon
  -- l'ALTER échouerait sur les lignes existantes.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'collaborateur_documents' and column_name = 'statut'
  ) then
    update public.collaborateur_documents set statut = 'valide' where statut = 'present';
  end if;
end $$;

alter table public.collaborateur_documents drop constraint if exists collaborateur_documents_statut_check;
alter table public.collaborateur_documents alter column statut set default 'manquant';
alter table public.collaborateur_documents
  add constraint collaborateur_documents_statut_check
  check (statut in ('manquant','a_valider','valide'));

-- ─── 2. Type de document : ajout d'une pièce d'onboarding dédiée ───────────
-- Le générique 'justificatif' couvrait déjà tout document non contrat/RIB,
-- mais le module Documents doit pouvoir isoler les pièces d'identité
-- d'onboarding dans son propre libellé/filtre plutôt que de les noyer dans
-- "justificatif" (demande explicite de la spec : catégorie "pièces de
-- recrutement/onboarding"). Ajout additif, aucune valeur existante à migrer.
alter table public.collaborateur_documents drop constraint if exists collaborateur_documents_type_check;
alter table public.collaborateur_documents
  add constraint collaborateur_documents_type_check
  check (type in ('contrat','rib','justificatif','piece_identite','autre'));

-- ─── 3. Échéance optionnelle (RIB à reconfirmer, contrat à durée déterminée...) ──
alter table public.collaborateur_documents add column if not exists date_echeance date;

comment on column public.collaborateur_documents.date_echeance is
  'Optionnelle. Pilote le filtre "Expirent bientôt" du module Documents (calculé, cf. vue secretariat_documents) — pas de sens pour un justificatif permanent (ex. RIB sans reconduction), utile pour un contrat CDD, une pièce d''identité à durée de validité, etc.';

-- ─── 4. updated_at automatique ──────────────────────────────────────────────
-- La table avait created_at/updated_at dès sa création mais aucun trigger
-- pour maintenir updated_at (vérifié : absent de migration-equipe-rh-
-- refonte-28-08.sql). Réutilise la fonction générique déjà posée par
-- migration-contrats.sql ; recréée ici en CREATE OR REPLACE au cas où ce
-- fichier serait exécuté seul sur un projet qui ne l'aurait pas encore
-- (même précaution que migration-clubplus-v1.sql pour update_updated_at_generic).
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_collaborateur_documents_updated_at on public.collaborateur_documents;
create trigger trg_collaborateur_documents_updated_at
  before update on public.collaborateur_documents
  for each row execute procedure update_updated_at();

-- ─── 5. Stockage privé — enfin câblé (c'était le trou explicitement noté) ──
-- Bucket sportvision-media-prive (créé en v95), nouveau préfixe dédié
-- collaborateurs/<collaborateur_id>/<fichier> — même patron que messages/
-- (v95) et recrutement-cv/ (migration-recrutement-v1) : jamais d'URL
-- publique stockée en base, createSignedUrl() généré à l'affichage côté OS
-- à partir de collaborateur_documents.storage_path.
--
-- Écriture (upload/remplacement) : admin/compta uniquement, même périmètre
-- que la table (l'upload d'un document RH est un acte de secrétariat/
-- compta, pas un self-service collaborateur dans cette V1 — aucun écran
-- self-service n'est demandé par la spec, tranché ici par cohérence avec
-- la policy déjà posée sur la table elle-même).
-- Lecture : admin/compta, PLUS le collaborateur concerné sur son propre
-- dossier (segment 2 du chemin = son propre auth.uid()), pour permettre un
-- futur "mes documents" côté Connect personnel sans nouvelle migration.
drop policy if exists "sv_media_prive_collaborateurs_insert" on storage.objects;
create policy "sv_media_prive_collaborateurs_insert" on storage.objects for insert
  with check (
    bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'collaborateurs'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','compta'))
  );

drop policy if exists "sv_media_prive_collaborateurs_update" on storage.objects;
create policy "sv_media_prive_collaborateurs_update" on storage.objects for update
  using (
    bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'collaborateurs'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','compta'))
  );

drop policy if exists "sv_media_prive_collaborateurs_select" on storage.objects;
create policy "sv_media_prive_collaborateurs_select" on storage.objects for select
  using (
    bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'collaborateurs'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','compta'))
    )
  );

-- ============================================================================
-- À VÉRIFIER APRÈS EXÉCUTION (pas fait ici, hors périmètre de cette session) :
-- 1) information_schema.columns sur collaborateur_documents → date_echeance
--    présente, statut/type contraints par les nouvelles listes.
-- 2) storage.policies (ou test E2E upload/download jetable) sur le préfixe
--    collaborateurs/<id>/... : admin/compta OK, un autre collaborateur → échec,
--    le collaborateur propriétaire → lecture OK.
-- 3) Si des lignes existaient déjà avec statut='present', confirmer qu'elles
--    sont bien passées à 'valide' (select count(*) ... where statut='present'
--    doit renvoyer 0).
-- ============================================================================
