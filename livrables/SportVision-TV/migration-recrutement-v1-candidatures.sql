-- ============================================================================
-- migration-recrutement-v1-candidatures.sql
-- ============================================================================
-- Formulaire de candidature public (vitrine, page recrutement/*.html), premier
-- poste ouvert : Photographe/Vidéaste freelance (21/08/2026). Table générique
-- (colonne `poste`) pour pouvoir réutiliser la même table quand les offres
-- Community Manager seront ouvertes, sans nouvelle migration.
--
-- CE QUE FAIT CE FICHIER :
--   1. Table recruitment_applications — écrite uniquement par l'edge function
--      submit-recruitment-application (service_role, visiteur anonyme donc pas
--      de session/RLS possible côté client, même contrainte que create-guest-
--      request). Lecture réservée au staff (is_staff()), pas d'UI OS pour
--      l'instant : le staff est notifié par e-mail à chaque candidature
--      (cf. edge function) et peut consulter/exporter cette table directement
--      si besoin en attendant un écran dédié.
--   2. CV optionnel : réutilise le bucket privé sportvision-media-prive (déjà
--      créé en v95) avec un nouveau préfixe recrutement-cv/, même patron que
--      messages/ : écriture via service_role uniquement (pas de policy insert
--      nécessaire, l'edge function bypass la RLS), lecture (signed URL) scopée
--      is_staff() pour permettre une consultation future depuis l'OS sans
--      nouvelle migration.
-- ============================================================================

create table if not exists recruitment_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null default 'photographe_videaste',
  poste text not null,
  prenom text not null,
  nom text not null,
  email text not null,
  telephone text,
  zone text,
  ville text,
  experience_niveau text,
  materiel text,
  disponibilites text,
  portfolio_url text,
  cv_path text,
  message text,
  statut text not null default 'nouveau'
);

alter table recruitment_applications enable row level security;

create policy "recrutapp_staff_select" on recruitment_applications for select
  using (is_staff());

create policy "recrutapp_staff_update" on recruitment_applications for update
  using (is_staff());

create policy "sv_media_prive_recrutement_select" on storage.objects for select
  using (
    bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'recrutement-cv'
    and is_staff()
  );
