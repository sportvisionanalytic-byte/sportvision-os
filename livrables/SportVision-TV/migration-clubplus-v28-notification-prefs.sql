-- ============================================================
-- SPORTVISION CLUB+ — Migration v28
-- Suite de migration-clubplus-v1 à v26.sql. Idempotente.
--
-- Portée : centre de préférences de notification pour les comptes
-- Club+ (dirigeants/staff club via club_members, joueurs via
-- player_profiles, parents via parent_profiles — les trois espaces
-- s'authentifient directement en Supabase Auth, aucun d'eux n'a de
-- ligne `profiles`, contrairement au staff SportVision interne). La
-- clé d'identification est donc `auth.uid()` directement, pas
-- `profiles.id`.
--
-- Prérequis : migration-communication-hub.sql et
-- migration-communication-hub-part2.sql déjà exécutées (table
-- communication_templates avec ses colonnes `category` et `mandatory`,
-- table notification_outbox).
--
-- ── Règle SECURITY/LEGAL/BILLING non désactivables ──────────────────
-- Ces 3 catégories sont critiques (sécurité du compte, obligations
-- légales, facturation) : on n'empêche PAS l'écriture d'une préférence
-- désactivée dessus côté client (complexité inutile, et une ligne
-- écrite ne fait rien de dangereux à elle seule) — c'est la LECTURE
-- côté dispatch-notifications qui ignore toute préférence désactivée
-- sur ces 3 catégories et envoie quand même. Voir dispatch-notifications
-- /index.ts pour l'implémentation exacte de cette règle.
-- ============================================================

create table if not exists notification_preferences (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  category text not null check (category in ('SECURITY','LEGAL','BILLING','OPERATIONS','SUPPORT','PRODUCT','MARKETING')),
  email_enabled boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, category)
);

drop trigger if exists trg_notification_preferences_updated_at on notification_preferences;
create or replace function set_notification_preferences_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger trg_notification_preferences_updated_at before update on notification_preferences
  for each row execute procedure set_notification_preferences_updated_at();

alter table notification_preferences enable row level security;
drop policy if exists "np_owner_all" on notification_preferences;
create policy "np_owner_all" on notification_preferences for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Nouveau statut outbox : préférence désactivée ────────────────────
-- dispatch-notifications marque désormais une notification ignorée par
-- préférence (catégorie non obligatoire, email_enabled=false) avec ce
-- statut plutôt que de la laisser PENDING indéfiniment ou de la confondre
-- avec CANCELLED (canal non branché) ou SUPPRESSED (bounce/désinscription
-- globale). Jamais utilisé pour SECURITY/LEGAL/BILLING, non désactivables.
alter table notification_outbox drop constraint if exists notification_outbox_status_check;
alter table notification_outbox add constraint notification_outbox_status_check
  check (status in ('PENDING','QUEUED','SENT','DELIVERED','DEFERRED','SOFT_BOUNCE','HARD_BOUNCE','COMPLAINT','FAILED','SUPPRESSED','CANCELLED','SKIPPED_PREFERENCE'));
