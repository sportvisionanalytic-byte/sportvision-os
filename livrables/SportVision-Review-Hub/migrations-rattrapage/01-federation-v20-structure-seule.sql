-- RATTRAPAGE REVIEW — port a la main de migration-federation-v20-exclusions-synchro.sql
-- Projet Review ffjktzmsezfrwmrtlhzo uniquement, le 12/09/2026.
--
-- Pourquoi porte a la main : la migration d'origine se termine par un insert + un delete qui
-- visent un club de PRODUCTION (Villemomble, f0d3bafa-3004-4831-bd85-249aa9af5c54) et un match
-- de la Coupe Nike du 19/09. Ce club n'existe pas dans Review : l'insert violait la cle
-- etrangere et faisait echouer toute la migration, structure comprise.
-- Seule la structure est portee (table, index, RLS, policy) : c'est elle qui manque a Review.
-- Aucune donnee de production n'est copiee dans Review, par construction.
begin;

create table if not exists public.calendar_sync_exclusions (
  id uuid default gen_random_uuid() primary key,
  club_id uuid not null references public.clubs(id) on delete cascade,
  provider text not null,
  external_event_id text not null,
  -- Conserves pour que la liste reste lisible sans avoir a interroger la source : « 5737241 » ne
  -- dit rien, « U18 F 1 vs Paris XIII, 19/09 » se comprend.
  libelle text,
  raison text,
  exclu_par uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  constraint calendar_sync_exclusions_provider_check
    check (provider in ('MANUAL','CSV','ICS','FOOTCLUBS_XLSX','PDF','FFF','SPORTCORICO','OTHER')),
  constraint calendar_sync_exclusions_uniq unique (club_id, provider, external_event_id)
);

comment on table public.calendar_sync_exclusions is
  'Evenements que la synchronisation ne doit PAS recreer, apres qu''un humain les a supprimes. Sans cette liste, tout nettoyage manuel serait annule au passage suivant : la source expose toujours l''evenement, et la synchro n''a aucune raison de ne pas le reprendre.';

create index if not exists idx_cse_lookup
  on public.calendar_sync_exclusions (club_id, provider, external_event_id);

alter table public.calendar_sync_exclusions enable row level security;

-- Lecture par le club concerne et par le staff : comprendre pourquoi un match n'apparait pas fait
-- partie du calendrier. L'ecriture passe par le service_role (la synchro), comme pour l'annuaire.
drop policy if exists cse_lecture on public.calendar_sync_exclusions;
create policy cse_lecture on public.calendar_sync_exclusions for select to authenticated
  using (is_club_member(club_id) or is_staff());


commit;
