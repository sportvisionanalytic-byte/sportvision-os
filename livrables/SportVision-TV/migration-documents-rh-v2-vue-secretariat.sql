-- ============================================================================
-- migration-documents-rh-v2-vue-secretariat.sql
-- ============================================================================
-- Suite de migration-documents-rh-v2-collaborateurs.sql et
-- migration-documents-rh-v2-clients-clubs-avenants.sql : ce fichier unifie
-- les 7 catégories de documents demandées par le module Secrétaire derrière
-- UNE seule vue, `secretariat_documents`, avec le vocabulaire de statut à
-- 4 états attendu par les 4 filtres de l'écran :
--
--   valeur stockée/calculée   →   libellé filtre UI
--   'manquant'                →   "Manquants"
--   'a_valider'               →   "À valider"
--   'expire_bientot'          →   "Expirent bientôt"   (CALCULÉ, pas stocké)
--   'valide'                  →   "Complets"
--
-- DÉCISION (ambiguïté de la spec tranchée ici) : la spec citait un jeu de
-- 5 mots pour le statut (manquant/à_valider/valide/expire_bientôt/complet)
-- pour 4 filtres. "Complet" et "valide" ne sont pas deux états distincts
-- ici : 'valide' est le mot déjà utilisé dans cette base pour ce concept
-- (contenus.statut, migration-contenus.sql ; devis/contrats.signature_statut,
-- migration-phase3-4-5.sql) — réutilisé tel quel plutôt que d'introduire un
-- 2e synonyme ('complet') qui n'existe nulle part ailleurs dans le schéma.
-- Le libellé "Complets" reste une question d'affichage côté frontend, pas
-- une valeur supplémentaire à stocker. De même, "Expirent bientôt" n'est
-- JAMAIS écrit en base (colonne statut_affichage ci-dessous, recalculée à
-- chaque lecture) : un état stocké deviendrait faux le lendemain sans job
-- de rafraîchissement, alors que "valide + date_echeance dans les 30 jours"
-- est toujours exact. Seuil de 30 jours choisi par cohérence avec le seul
-- précédent d'alerte d'échéance du projet (migration-finance-alertes-
-- echeances.sql utilise 7 jours pour des dépenses récurrentes à échéance
-- rapprochée ; 30 jours est plus adapté ici pour des documents administratifs
-- — contrat, assurance, pièce d'identité — qui demandent un délai de
-- renouvellement plus long qu'une dépense). Ajustable sans migration
-- (littéral dans la vue) si Fouka veut un autre seuil.
--
-- 7 catégories couvertes, sources réelles (aucune nouvelle table au-delà de
-- celle des deux fichiers précédents) :
--   1. Contrats collaborateurs      → collaborateur_documents (type='contrat')
--   2. RIB (collaborateurs)         → collaborateur_documents (type='rib')
--   3. Contrats Full Com            → contrats (type_contrat='full_communication')
--   4. Avenants                     → client_documents (type='avenant')
--   5. Documents Club+              → client_documents (client_id d'un club, via clubs.portail_client_id)
--   6. Documents client             → client_documents (client_id d'un client non-club)
--   7. Pièces recrutement/onboarding → recruitment_applications (cv_path)
--      + collaborateur_documents (type='piece_identite') une fois le
--      candidat devenu collaborateur (profiles.onboarding_started_at
--      renseigné, cf. migration-equipe-rh-refonte-28-08.sql) — ce sont deux
--      lignes distinctes dans la vue (avant/après création du compte), pas
--      fusionnées : la candidature et le dossier collaborateur restent deux
--      entités séparées dans le schéma (recruitment_applications.
--      collaborateur_id est le seul pont entre les deux, déjà posé).
--
-- SÉCURITÉ (leçon de migration-securite-v101-revoke-write-updatable-views.sql
-- explicitement appliquée ici) : `secretariat_documents` est une vue UNION
-- ALL sur 4 sources — PostgreSQL ne rend JAMAIS ce type de vue "updatable"
-- automatiquement (contrairement aux vues à table unique visées par v101),
-- donc le risque d'écriture par la vue (propriétaire postgres, bypass RLS)
-- ne s'applique pas structurellement ici. REVOKE explicite quand même
-- ci-dessous, en défense en profondeur, même principe que v101. La LECTURE
-- reste filtrée par un `where exists (...)` sur profiles/auth.uid() intégré
-- à CHAQUE branche du UNION (même mécanisme que client_devis/client_contrats/
-- client_factures) : un auth.uid() NULL (requête anon) ne matche jamais
-- aucune branche → 0 ligne, fail-closed par construction.
--
-- Idempotente (create or replace view, drop policy/revoke sans erreur si
-- absent). Aucune exécution ici.
-- ============================================================================

create or replace view secretariat_documents as
with base as (

  -- ── 1+2+7(partiel) : RH — collaborateur_documents ──────────────────────
  -- Filtre RH sensible : admin/compta uniquement, PLUS le collaborateur sur
  -- ses propres lignes — identique à la policy déjà posée sur la table
  -- (migration-documents-rh-v2-collaborateurs.sql), pas un accès élargi.
  select
    'rh' as categorie,
    cd.id,
    cd.type as sous_type,
    cd.collaborateur_id as proprietaire_id,
    coalesce(nullif(trim(coalesce(p.prenom,'') || ' ' || coalesce(p.nom,'')), ''), 'Collaborateur') as proprietaire_label,
    null::uuid as client_id,
    null::boolean as est_club,
    cd.nom,
    cd.statut,
    cd.date_echeance,
    cd.storage_path,
    cd.created_at,
    cd.updated_at
  from public.collaborateur_documents cd
  left join public.profiles p on p.id = cd.collaborateur_id
  where
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','compta'))
    or cd.collaborateur_id = auth.uid()

  union all

  -- ── 4+5+6 : client_documents (avenants / Club+ / client) ────────────────
  select
    case
      when cd.type = 'avenant' then 'avenant'
      when exists (select 1 from public.clubs c2 where c2.portail_client_id = cd.client_id) then 'club_plus'
      else 'client'
    end as categorie,
    cd.id,
    cd.type as sous_type,
    cd.client_id as proprietaire_id,
    coalesce(cl.nom, 'Client') as proprietaire_label,
    cd.client_id,
    exists (select 1 from public.clubs c3 where c3.portail_client_id = cd.client_id) as est_club,
    cd.nom,
    cd.statut,
    cd.date_echeance,
    cd.storage_path,
    cd.created_at,
    cd.updated_at
  from public.client_documents cd
  join public.clients cl on cl.id = cd.client_id
  where exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','sec','com','compta'))

  union all

  -- ── 3 : Contrats Full Com (contrats existant, pas de nouvelle table) ────
  -- Pas de storage_path : le document signé vit chez Youtrust (déjà intégré,
  -- youtrust_signature_request_id sur contrats — migration-portail-v19.sql),
  -- pas dans sportvision-media-prive. Mappage du cycle de vie existant vers
  -- le vocabulaire à 3 états : non_demandee/refusee → manquant (rien à
  -- valider tant que la signature n'a pas été demandée, ou a été refusée et
  -- doit être relancée) ; demandee → a_valider (en attente de signature) ;
  -- signee → valide. date_fin sert d'échéance pour "Expirent bientôt"
  -- (renouvellement/fin de contrat approchant).
  select
    'contrat_full_com' as categorie,
    c.id,
    c.type_contrat as sous_type,
    c.client_id as proprietaire_id,
    coalesce(cl.nom, 'Client') as proprietaire_label,
    c.client_id,
    exists (select 1 from public.clubs c3 where c3.portail_client_id = c.client_id) as est_club,
    'Contrat Full Communication'::text as nom,
    case
      when c.signature_statut = 'signee' then 'valide'
      when c.signature_statut = 'demandee' then 'a_valider'
      else 'manquant'
    end as statut,
    c.date_fin as date_echeance,
    null::text as storage_path,
    c.created_at,
    c.updated_at
  from public.contrats c
  join public.clients cl on cl.id = c.client_id
  where c.type_contrat = 'full_communication'
    and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','sec','com','compta'))

  union all

  -- ── 7(partiel) : recrutement/onboarding — CV de candidature ─────────────
  -- Même filtre que la policy déjà posée sur recruitment_applications
  -- (recrutapp_staff_select utilise is_staff(), réutilisée ici telle
  -- quelle plutôt qu'une liste de rôles réécrite à la main). Le CV est une
  -- pièce jointe optionnelle à une candidature, pas un contrat/RIB à
  -- échéance : pas de date_echeance, statut binaire manquant/valide (aucun
  -- "à valider" distinct — la validation, c'est le pipeline recrutement
  -- lui-même, statut nouveau/a_appeler/entretien/retenu/refuse/vivier, hors
  -- périmètre du module Documents).
  select
    'recrutement_onboarding' as categorie,
    ra.id,
    'cv'::text as sous_type,
    ra.collaborateur_id as proprietaire_id,
    coalesce(nullif(trim(coalesce(ra.prenom,'') || ' ' || coalesce(ra.nom,'')), ''), 'Candidat') as proprietaire_label,
    null::uuid as client_id,
    null::boolean as est_club,
    'CV de candidature'::text as nom,
    case when ra.cv_path is null then 'manquant' else 'valide' end as statut,
    null::date as date_echeance,
    ra.cv_path as storage_path,
    ra.created_at,
    ra.created_at as updated_at -- recruitment_applications n'a pas de colonne updated_at
  from public.recruitment_applications ra
  where is_staff()

)
select
  categorie,
  id,
  sous_type,
  proprietaire_id,
  proprietaire_label,
  client_id,
  est_club,
  nom,
  statut,
  date_echeance,
  storage_path,
  created_at,
  updated_at,
  case
    when statut = 'valide' and date_echeance is not null and date_echeance <= current_date + 30
      then 'expire_bientot'
    else statut
  end as statut_affichage
from base;

comment on view public.secretariat_documents is
  'Vue unifiée du module Documents (interface Secrétaire) — 7 catégories (rh/avenant/club_plus/client/contrat_full_com/recrutement_onboarding), filtrée par auth.uid() dans chaque branche du UNION (pas de policy RLS sur une vue). Colonne statut_affichage = les 4 valeurs des filtres UI (manquant/a_valider/expire_bientot/valide) ; statut = les 3 valeurs stockées (expire_bientot est calculé, jamais stocké).';

-- Défense en profondeur (cf. note de sécurité en tête de fichier) : cette
-- vue UNION ALL n'est pas "updatable" nativement, mais on referme quand même
-- explicitement toute écriture, même principe que migration-securite-v101.
revoke insert, update, delete, truncate on public.secretariat_documents from authenticated, anon;

-- ============================================================================
-- À VÉRIFIER APRÈS EXÉCUTION (pas fait ici, hors périmètre de cette session) :
-- 1) select categorie, count(*) from secretariat_documents group by 1 —
--    exécuté avec un compte admin jetable, doit renvoyer des lignes pour
--    les catégories qui ont des données réelles, 0 pour les autres (normal,
--    tables neuves).
-- 2) Comparer le résultat pour un compte 'sec' jetable vs 'admin' jetable :
--    la catégorie 'rh' doit être VIDE pour 'sec' (RH sensible protégé),
--    présente pour 'admin'.
-- 3) PATCH/POST/DELETE /rest/v1/secretariat_documents (n'importe quel
--    compte) → doit échouer ("cannot insert/update/delete on view" ou
--    "permission denied", les deux sont un succès ici).
-- 4) Une échéance fixée à J+15 doit apparaître avec statut_affichage=
--    'expire_bientot' même si statut='valide' en base ; une échéance à
--    J+45 doit rester 'valide'.
-- ============================================================================
