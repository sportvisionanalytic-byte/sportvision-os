-- Migration : Centre de formation v3 — Signature numérique de présence
-- À exécuter dans Supabase → SQL Editor

-- 1. Colonnes signature sur formation_presences
alter table formation_presences
  add column if not exists signe boolean default false,
  add column if not exists signe_at timestamptz;

-- 2. Index pour retrouver rapidement les présences signées
create index if not exists idx_fpres_signe on formation_presences(session_id, signe);
