-- migration-clubplus-v53-sponsor-logo.sql (03/09/2026)
--
-- Demande Fouka : l'onboarding club doit permettre d'ajouter le logo de chaque sponsor, pas
-- seulement son nom. club_sponsors n'avait aucune colonne logo jusqu'ici. Réutilise le bucket
-- Storage `club-logos` déjà créé (migration-clubplus-v47) plutôt que d'en créer un nouveau — ses
-- policies vérifient déjà is_club_admin() sur le premier segment du chemin (club_id), qui reste
-- identique pour un logo de sponsor stocké sous {club_id}/sponsor-{sponsor_id}.{ext} : aucune
-- nouvelle policy Storage nécessaire.

alter table public.club_sponsors add column if not exists logo_url text;
comment on column public.club_sponsors.logo_url is 'Logo du sponsor, bucket Storage club-logos, chemin {club_id}/sponsor-{sponsor_id}.{ext} (migration-clubplus-v53).';
