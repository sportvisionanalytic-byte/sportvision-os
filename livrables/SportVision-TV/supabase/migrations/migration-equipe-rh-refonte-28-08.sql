-- Refonte Équipe & RH (28/08/2026) — migration idempotente.
-- Contexte : le menu Équipe passe de 5 onglets internes (+ 1 item modal-only
-- Candidatures) à 3 pages réelles (Vue d'ensemble / Collaborateurs /
-- Recrutement). Annuaire/Disponibilité/Grades & XP/Formation deviennent des
-- onglets dans la fiche d'un collaborateur (modalFicheCollaborateur), sans
-- dupliquer aucune donnée existante (prestations_equipe, disponibilites,
-- formation_*, kit_reservations, grade_recommendations, xp_events restent la
-- seule source de vérité, lus tels quels).
--
-- Ce fichier n'ajoute QUE ce qui n'existe pas déjà (audité au préalable via
-- information_schema.columns sur le projet réel) :
--   1. recruitment_applications.collaborateur_id — relie une candidature au
--      collaborateur créé à partir d'elle (évite les doublons de création).
--   2. Contrainte CHECK sur recruitment_applications.statut — le pipeline à
--      6 statuts (nouveau/a_appeler/entretien/retenu/refuse/vivier) n'était
--      pas formalisé (colonne texte libre, un seul enregistrement existant,
--      statut='nouveau', déjà conforme).
--   3. profiles.onboarding_started_at — nullable, aucune valeur par défaut,
--      donc AUCUNE ligne existante n'est modifiée par cette migration (audité
--      avant/après). Distingue un collaborateur "en onboarding" (actif=false
--      ET onboarding_started_at renseigné, positionné uniquement par le
--      nouveau flux "Créer le collaborateur" depuis Recrutement) d'une
--      désactivation ordinaire (actif=false, onboarding_started_at NULL,
--      mécanisme confirmerDesactiverUser déjà existant et inchangé).
--   4. collaborateur_documents — table de suivi des documents administratifs
--      (contrat/RIB/justificatif), inexistante dans le schéma actuel malgré
--      les tables `contrats`/`client_contrats` (qui concernent les CLIENTS,
--      pas les collaborateurs). RLS strict : admin/compta uniquement, plus le
--      collaborateur concerné en lecture de ses propres documents. Metadata
--      uniquement dans cette session (pas d'upload de fichier réel — aucune
--      policy storage dédiée n'existe encore pour un préfixe collaborateurs/,
--      hors budget de cette session, `storage_path` reste disponible pour un
--      chantier futur).

-- 1. recruitment_applications.collaborateur_id
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='recruitment_applications' and column_name='collaborateur_id'
  ) then
    alter table public.recruitment_applications
      add column collaborateur_id uuid references public.profiles(id);
  end if;
end $$;

-- 2. Contrainte CHECK sur le pipeline de statuts
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'recruitment_applications_statut_check'
  ) then
    alter table public.recruitment_applications
      add constraint recruitment_applications_statut_check
      check (statut in ('nouveau','a_appeler','entretien','retenu','refuse','vivier'));
  end if;
end $$;

-- 3. profiles.onboarding_started_at (nullable, additive, zéro écriture sur l'existant)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='profiles' and column_name='onboarding_started_at'
  ) then
    alter table public.profiles add column onboarding_started_at timestamptz;
  end if;
end $$;

-- 4. collaborateur_documents
create table if not exists public.collaborateur_documents (
  id uuid primary key default gen_random_uuid(),
  collaborateur_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('contrat','rib','justificatif','autre')),
  nom text not null,
  statut text not null default 'present' check (statut in ('present','manquant')),
  storage_path text,
  notes text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_collaborateur_documents_collab on public.collaborateur_documents(collaborateur_id);

alter table public.collaborateur_documents enable row level security;

drop policy if exists cd_admin_compta_all on public.collaborateur_documents;
create policy cd_admin_compta_all on public.collaborateur_documents
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','compta')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','compta')));

drop policy if exists cd_self_select on public.collaborateur_documents;
create policy cd_self_select on public.collaborateur_documents
  for select
  using (collaborateur_id = auth.uid());
