-- Migration : colonnes manquantes sur la table notifications
-- Le code (panneau de notifications, moteur d'événements dispatchSVEvent,
-- tâches auto, notifications kits/incidents) écrit et lit priorite,
-- lien_prestation_id, lien_client_id, source_type, source_id et
-- expediteur_id — aucune de ces colonnes n'avait été migrée, ce qui
-- faisait échouer silencieusement toutes les insertions/lectures.
-- Idempotente : peut être rejouée sans erreur.
-- À exécuter dans Supabase → SQL Editor

alter table notifications
  add column if not exists priorite text default 'medium',
  add column if not exists lien_prestation_id uuid references prestations(id) on delete set null,
  add column if not exists lien_client_id uuid references clients(id) on delete set null,
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  add column if not exists expediteur_id uuid references profiles(id) on delete set null;

create index if not exists idx_notif_destinataire on notifications(destinataire_id, lue, created_at desc);
