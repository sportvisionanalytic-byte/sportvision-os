-- Migration : suivi réel de la consultation du briefing par l'équipe terrain
--
-- Constat : l'écran "Briefings" du Responsable Production affichait un statut
-- "Complet" / "Consulté" entièrement fabriqué à partir du statut de pipeline
-- de la prestation (ex: "prête" ou "production_démarrée"), sans aucun lien
-- avec le contenu réel du briefing ni avec le fait que l'opérateur ait
-- effectivement ouvert sa fiche mission. Ce n'était donc jamais fiable.
--
-- Cette migration ajoute une colonne pour tracer la première consultation
-- réelle du briefing par un membre de l'équipe (photographe/vidéaste),
-- posée par SportVision-OS-Full.html au moment où modalPhotoBriefing()
-- s'ouvre pour la première fois sur une prestation donnée.
--
-- "Brief complet" est désormais calculé côté application à partir des
-- champs réels description_besoin et livrables_demandes (déjà existants),
-- et non plus depuis cette migration.
--
-- Idempotente : add column if not exists.
-- À exécuter dans Supabase → SQL Editor.

alter table prestations add column if not exists briefing_vu_at timestamptz;

comment on column prestations.briefing_vu_at is
  'Date/heure de la première consultation du briefing par un membre de l''équipe terrain (via modalPhotoBriefing). NULL tant que personne ne l''a ouvert.';
