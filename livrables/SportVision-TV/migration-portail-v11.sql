-- ============================================================
-- SPORTVISION PORTAIL — Migration v11
-- Anti-abus sur les formulaires accessibles sans compte (configurateur invité,
-- prise de rendez-vous invité). Table dédiée à la limite de fréquence, utilisée
-- par les Edge Functions create-guest-request et create-guest-rdv via la
-- service role (RLS activée mais sans policy : aucun accès direct depuis le
-- navigateur, ni anonyme ni authentifié, seule la service role peut y écrire/lire).
-- Idempotente. À exécuter après migration-portail-v10.sql.
-- ============================================================

create table if not exists guest_rate_limits (
  id uuid default gen_random_uuid() primary key,
  identifiant text not null,
  created_at timestamptz default now()
);

create index if not exists idx_guest_rate_limits_identifiant_date
  on guest_rate_limits (identifiant, created_at);

alter table guest_rate_limits enable row level security;
-- Aucune policy : seule la service role (utilisée par les Edge Functions) peut lire/écrire.
