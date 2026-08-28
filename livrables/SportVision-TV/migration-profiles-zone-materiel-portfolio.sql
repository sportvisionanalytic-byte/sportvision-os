-- Migration : zone / matériel personnel / portfolio sur profiles
-- À exécuter dans Supabase → SQL Editor.
-- EXÉCUTÉE — appliquée en base réelle le 28/08/2026 (refonte interface
-- Responsable Production, §11 "Affectation opérateur" et §18 "Équipe
-- terrain" : la fiche opérateur doit afficher zone/matériel personnel, et
-- les filtres d'affectation doivent pouvoir les utiliser).
--
-- Ces trois informations existent déjà côté candidature
-- (recruitment_applications.zone/materiel/portfolio_url) mais ne sont PAS
-- reprises lors de la conversion candidat→collaborateur (recrutCreerCollaborateur,
-- SportVision-OS-Full.html — vérifié : seuls ville/telephone/vehicule/permis
-- sont copiés vers profiles). Résultat : cette donnée existe pour un candidat
-- puis disparaît silencieusement dès qu'il devient collaborateur — c'est un
-- vrai trou de données, pas une fonctionnalité à inventer.
--
-- Décision volontairement PAS prise ici : "sport(s)" et "niveau" (★1-4)
-- demandés par la spec Production n'ont AUCUNE source de donnée existante
-- nulle part dans le projet (ni recruitment_applications, ni ailleurs) —
-- les ajouter maintenant créerait des colonnes vides sans écran pour les
-- remplir, un schéma qui a l'air fonctionnel mais qui ne l'est pas. Non
-- ajoutées : à trancher avec Fouka (saisie manuelle admin ? champ candidature
-- à ajouter au formulaire de recrutement ?) avant d'ouvrir ce chantier.
--
-- Idempotente. Additive uniquement, aucune perte de donnée.

alter table public.profiles
  add column if not exists zone text,
  add column if not exists materiel_personnel text,
  add column if not exists portfolio_url text;

comment on column public.profiles.zone is
  'Zone géographique d''intervention (ex. IDF, 89, 10, 45) — reprise de recruitment_applications.zone à la conversion candidat→collaborateur. Texte libre, même convention que recruitment_applications.zone (pas d''enum : les zones réelles varient par bassin).';
comment on column public.profiles.materiel_personnel is
  'Matériel personnel du collaborateur (ex. "Sony A7 III"), pour savoir s''il faut lui attribuer un kit SportVision. Reprise de recruitment_applications.materiel à la conversion.';
comment on column public.profiles.portfolio_url is
  'Lien portfolio (ex. Instagram, site perso). Reprise de recruitment_applications.portfolio_url à la conversion.';

-- Backfill des collaborateurs déjà convertis (recruitment_applications.collaborateur_id
-- déjà posé) : rattrape les conversions faites AVANT cette migration, pour ne pas
-- limiter le bénéfice aux seules futures conversions.
update public.profiles p
set
  zone = coalesce(p.zone, ra.zone),
  materiel_personnel = coalesce(p.materiel_personnel, ra.materiel),
  portfolio_url = coalesce(p.portfolio_url, ra.portfolio_url)
from public.recruitment_applications ra
where ra.collaborateur_id = p.id
  and (p.zone is null or p.materiel_personnel is null or p.portfolio_url is null);

-- Vérification (à exécuter manuellement après migration) :
-- select count(*) from profiles where zone is not null or materiel_personnel is not null or portfolio_url is not null;
