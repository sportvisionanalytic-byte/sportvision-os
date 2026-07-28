-- Migration : champs étendus sur la table profiles
-- À exécuter dans Supabase → SQL Editor

alter table profiles
  add column if not exists avatar_url  text,
  add column if not exists bio         text,
  add column if not exists adresse     text,
  add column if not exists ville       text,
  add column if not exists code_postal text,
  add column if not exists vehicule    boolean default false,
  add column if not exists permis      boolean default false,
  add column if not exists telephone   text;
