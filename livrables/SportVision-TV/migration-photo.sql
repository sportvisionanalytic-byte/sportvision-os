-- Migration : Interface photographe — déclaration heures & notes refus
-- À exécuter dans Supabase → SQL Editor

-- 1. Colonne motif de refus dans prestations_equipe
alter table prestations_equipe
  add column if not exists notes_refus text;

-- 2. Colonnes déclaration heures / km / frais par le photographe
alter table prestations_equipe
  add column if not exists heures_declarees numeric(5,2),
  add column if not exists km_declares integer,
  add column if not exists frais_declares numeric(8,2),
  add column if not exists notes_declaration text;
