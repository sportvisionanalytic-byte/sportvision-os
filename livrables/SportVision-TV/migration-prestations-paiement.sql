-- Migration : date_paiement / mode_paiement sur prestations
-- Les 3 flux de confirmation de paiement (acompte compta, impayé compta,
-- relance secrétaire) écrivent statut_financier + date_paiement +
-- mode_paiement dans un seul PATCH sur prestations. date_paiement et
-- mode_paiement n'ont jamais existé sur cette table, donc le PATCH entier
-- échouait : statut_financier n'était jamais mis à jour non plus, aucun
-- acompte ni paiement n'a donc jamais pu être enregistré via ces écrans.
-- Idempotente : peut être rejouée sans erreur.
-- À exécuter dans Supabase → SQL Editor

alter table prestations
  add column if not exists date_paiement date,
  add column if not exists mode_paiement text;
