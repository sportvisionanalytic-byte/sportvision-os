-- ============================================================
-- Migration : idempotence des webhooks Youtrust.
--
-- ─── Faille corrigée ─────────────────────────────────────────────────────────
-- `youtrust-webhook` (supabase/functions/youtrust-webhook/index.ts) vérifie
-- bien la signature HMAC sur le corps brut, mais ne stocke jamais l'événement
-- traité avant d'agir : un même événement rejoué (retry Youtrust après un
-- timeout réseau côté Supabase, par exemple) est réappliqué sans contrôle.
-- Pour `signature_request.done` c'est aujourd'hui sans conséquence grave (le
-- patch met juste les mêmes colonnes aux mêmes valeurs), mais ce n'est pas un
-- mécanisme générique de protection contre le rejeu comme l'exige le cahier
-- des charges — et toute évolution future du webhook (ex: notification à
-- chaque signature, incrémentation d'un compteur) casserait silencieusement
-- cette hypothèse. Même patron que `stripe_events` (migration-portail-v1.sql),
-- qui protège déjà stripe-webhook de la même façon.
--
-- Idempotente : DROP ... IF EXISTS avant chaque CREATE, peut être rejouée sans
-- effet de bord. À exécuter dans Supabase → SQL Editor.

create table if not exists youtrust_events (
  id text primary key,
  type text not null,
  processed_at timestamptz default now()
);

alter table youtrust_events enable row level security;

drop policy if exists "youtrust_events_staff_read" on youtrust_events;
create policy "youtrust_events_staff_read" on youtrust_events for select using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
-- Écrit uniquement par l'Edge Function youtrust-webhook (service role) : pas
-- de policy client, pas de policy staff insert — même choix que stripe_events.
