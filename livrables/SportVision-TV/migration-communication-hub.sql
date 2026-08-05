-- Migration : Communication Hub — fondations P0
-- Cahier des charges : SportVision_OS_Connect_Connectiques_Automatisations_Developpeur.pdf
--
-- ─── Choix d'architecture (à confirmer avec Fouka, voir réponse texte) ──────
-- Le stack actuel n'a AUCUN serveur backend permanent ni file Redis/BullMQ —
-- uniquement des Edge Functions Supabase (stateless) et le Postgres lui-même.
-- Plutôt que d'ajouter Redis/Upstash (coût + complexité supplémentaires pour
-- un volume qui reste celui d'une TPE), le rôle de "Queue / Workers" du
-- cahier des charges est assuré par :
--   - cette table notification_outbox comme file persistante (déjà la
--     responsabilité qu'aurait un Redis ici),
--   - un pg_cron qui déclenche périodiquement une Edge Function
--     "dispatch-notifications" chargée d'envoyer les messages PENDING/QUEUED,
--   - le retry exponentiel géré en relisant next_attempt_at plutôt que via
--     des délais de file dédiés.
-- C'est une architecture plus simple, moins chère, et cohérente avec
-- l'existant (déjà utilisé pour les rappels de prestation cette semaine).
-- Si le volume d'envois grossit fortement plus tard, migrer vers une vraie
-- file (Redis/Upstash ou Cloud Tasks) reste possible sans changer le schéma.
--
-- Ce fichier ne couvre QUE ce qui ne nécessite aucun compte externe : le
-- modèle de données. Gmail, Brevo/Postmark, WhatsApp et Google Calendar sont
-- des connecteurs séparés, à activer une fois les comptes créés (voir la
-- liste envoyée à Fouka).
--
-- Idempotente : create table if not exists / drop policy if exists partout.
-- À exécuter dans Supabase → SQL Editor.

-- ─── 1. Modèles de messages, versionnés ─────────────────────────────────────
create table if not exists communication_templates (
  id uuid default gen_random_uuid() primary key,
  template_key text not null unique,          -- ex: 'auth.password_reset'
  category text not null check (category in ('SECURITY','LEGAL','BILLING','OPERATIONS','SUPPORT','PRODUCT','MARKETING')),
  channel text not null check (channel in ('EMAIL','WHATSAPP','IN_APP')),
  mandatory boolean not null default false,   -- catégories SECURITY/LEGAL/BILLING : true, jamais désactivable
  active boolean not null default true,
  description text,
  created_at timestamptz default now()
);

create table if not exists communication_template_versions (
  id uuid default gen_random_uuid() primary key,
  template_id uuid not null references communication_templates(id) on delete cascade,
  version integer not null,
  locale text not null default 'fr-FR',
  provider_template_id text,                  -- id template chez Brevo/Postmark si applicable
  subject_template text,
  body_html_template text,
  body_whatsapp_template text,
  required_variables text[] not null default '{}',
  active_from timestamptz default now(),
  active_to timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  unique(template_id, version)
);

-- ─── 2. Outbox — file persistante de tout envoi sortant ─────────────────────
create table if not exists notification_outbox (
  id uuid default gen_random_uuid() primary key,
  event_type text not null,                   -- ex: 'password.reset.requested'
  entity_type text,                           -- 'client' | 'prestation' | 'contrat' | 'collaborateur' | ...
  entity_id uuid,
  recipient_email text,
  recipient_phone_e164 text,
  recipient_user_id uuid,                     -- profiles.id si collaborateur
  recipient_client_id uuid references clients(id) on delete set null,
  channel text not null check (channel in ('EMAIL','WHATSAPP','IN_APP')),
  template_key text not null,
  template_version integer,
  payload_json jsonb not null default '{}',   -- variables déjà validées, jamais de secret
  idempotency_key text not null unique,       -- évite les doublons (même event + destinataire + canal + version)
  scheduled_at timestamptz not null default now(),
  status text not null default 'PENDING' check (status in ('PENDING','QUEUED','SENT','DELIVERED','DEFERRED','SOFT_BOUNCE','HARD_BOUNCE','COMPLAINT','FAILED','SUPPRESSED','CANCELLED')),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz default now(),
  provider text,                              -- 'brevo' | 'postmark' | 'whatsapp_cloud'
  provider_message_id text,
  last_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_outbox_status_next on notification_outbox(status, next_attempt_at);
create index if not exists idx_outbox_entity on notification_outbox(entity_type, entity_id);

create table if not exists notification_attempts (
  id uuid default gen_random_uuid() primary key,
  outbox_id uuid not null references notification_outbox(id) on delete cascade,
  attempt_number integer not null,
  status text not null,
  error text,
  provider_response jsonb,
  created_at timestamptz default now()
);
create index if not exists idx_attempts_outbox on notification_attempts(outbox_id);

-- ─── 3. Webhooks entrants (statuts de livraison, réponses, etc.) ────────────
create table if not exists webhook_events (
  id uuid default gen_random_uuid() primary key,
  provider text not null,                     -- 'brevo' | 'whatsapp' | 'google_gmail' | 'google_calendar' | 'stripe' | 'youtrust'
  provider_event_id text not null,
  outbox_id uuid references notification_outbox(id) on delete set null,
  event_type text,
  payload jsonb not null,
  signature_valid boolean,
  processed_at timestamptz,
  created_at timestamptz default now(),
  unique(provider, provider_event_id)
);
create index if not exists idx_webhook_events_outbox on webhook_events(outbox_id);

-- ─── 4. Suppression list (bounces, plaintes, désinscriptions) ───────────────
create table if not exists communication_suppressions (
  id uuid default gen_random_uuid() primary key,
  channel text not null check (channel in ('EMAIL','WHATSAPP')),
  address text not null,                      -- email ou phone_e164
  reason text not null check (reason in ('hard_bounce','complaint','unsubscribe','manual')),
  created_at timestamptz default now(),
  unique(channel, address)
);

-- ─── 5. Consentement WhatsApp (préparation P1) ──────────────────────────────
create table if not exists whatsapp_opt_ins (
  id uuid default gen_random_uuid() primary key,
  client_id uuid references clients(id) on delete cascade,
  phone_e164 text not null,
  opt_in_status text not null default 'UNKNOWN' check (opt_in_status in ('OPTED_IN','OPTED_OUT','UNKNOWN')),
  opt_in_source text,
  categories text[] default '{}',
  proof_reference text,
  last_user_message_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(client_id, phone_e164)
);

-- ─── 6. Connexions Google (Gmail + Calendar), tokens chiffrés côté serveur ──
-- Les refresh_token ne sont JAMAIS renvoyés au frontend : seule une Edge
-- Function avec la clé service_role peut les lire.
create table if not exists email_connections (
  id uuid default gen_random_uuid() primary key,
  provider text not null default 'google',
  mailbox_address text not null,
  scopes text[] not null default '{}',
  refresh_token_encrypted text,
  status text not null default 'DISCONNECTED' check (status in ('CONNECTED','DISCONNECTED','REAUTH_REQUIRED')),
  connected_by uuid references profiles(id),
  last_sync_at timestamptz,
  gmail_history_id text,
  gmail_watch_expiration timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists calendar_connections (
  id uuid default gen_random_uuid() primary key,
  provider text not null default 'google',
  calendar_id text not null,
  label text,
  scopes text[] not null default '{}',
  refresh_token_encrypted text,
  status text not null default 'DISCONNECTED' check (status in ('CONNECTED','DISCONNECTED','REAUTH_REQUIRED')),
  connected_by uuid references profiles(id),
  sync_direction text not null default 'OS_TO_GOOGLE' check (sync_direction in ('OS_TO_GOOGLE','BIDIRECTIONAL')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists calendar_sync_channels (
  id uuid default gen_random_uuid() primary key,
  calendar_connection_id uuid not null references calendar_connections(id) on delete cascade,
  channel_id text not null,
  resource_id text,
  expiration timestamptz,
  created_at timestamptz default now()
);

-- ─── 7. Journal d'audit métier (preuve complète, section 0/16) ──────────────
create table if not exists communication_audit_logs (
  id uuid default gen_random_uuid() primary key,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  actor_id uuid references profiles(id),
  outbox_id uuid references notification_outbox(id) on delete set null,
  detail text,
  created_at timestamptz default now()
);
create index if not exists idx_audit_entity on communication_audit_logs(entity_type, entity_id);

-- ─── 8. RLS : tout ce module est piloté par le backend (Edge Functions avec
--     service_role), jamais directement par le navigateur en écriture. Seule
--     la lecture par le staff (timeline dossier) est ouverte. ────────────────
alter table communication_templates enable row level security;
alter table communication_template_versions enable row level security;
alter table notification_outbox enable row level security;
alter table notification_attempts enable row level security;
alter table webhook_events enable row level security;
alter table communication_suppressions enable row level security;
alter table whatsapp_opt_ins enable row level security;
alter table email_connections enable row level security;
alter table calendar_connections enable row level security;
alter table calendar_sync_channels enable row level security;
alter table communication_audit_logs enable row level security;

-- Lecture staff (annuaire déjà en place : tout profil connecté peut lire ces
-- tables de configuration/suivi — l'écriture reste réservée au service_role
-- des Edge Functions, qui bypass RLS, donc aucune policy d'écriture ici).
drop policy if exists "Staff lecture templates" on communication_templates;
create policy "Staff lecture templates" on communication_templates for select using (auth.uid() is not null);
drop policy if exists "Staff lecture template_versions" on communication_template_versions;
create policy "Staff lecture template_versions" on communication_template_versions for select using (auth.uid() is not null);
drop policy if exists "Staff lecture outbox" on notification_outbox;
create policy "Staff lecture outbox" on notification_outbox for select using (auth.uid() is not null);
drop policy if exists "Staff lecture attempts" on notification_attempts;
create policy "Staff lecture attempts" on notification_attempts for select using (auth.uid() is not null);
drop policy if exists "Staff lecture webhook_events" on webhook_events;
create policy "Staff lecture webhook_events" on webhook_events for select using (auth.uid() is not null);
drop policy if exists "Staff lecture suppressions" on communication_suppressions;
create policy "Staff lecture suppressions" on communication_suppressions for select using (auth.uid() is not null);
drop policy if exists "Staff lecture opt_ins" on whatsapp_opt_ins;
create policy "Staff lecture opt_ins" on whatsapp_opt_ins for select using (auth.uid() is not null);
drop policy if exists "Admin lecture email_connections" on email_connections;
create policy "Admin lecture email_connections" on email_connections for select using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
drop policy if exists "Admin lecture calendar_connections" on calendar_connections;
create policy "Admin lecture calendar_connections" on calendar_connections for select using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
drop policy if exists "Admin lecture calendar_sync_channels" on calendar_sync_channels;
create policy "Admin lecture calendar_sync_channels" on calendar_sync_channels for select using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
drop policy if exists "Staff lecture audit_logs" on communication_audit_logs;
create policy "Staff lecture audit_logs" on communication_audit_logs for select using (auth.uid() is not null);

-- ─── 9. Modèles P0 — catalogue initial (contenu des sections 6.1/6.2 du cahier) ──
insert into communication_templates (template_key, category, channel, mandatory, description) values
  ('auth.invitation', 'SECURITY', 'EMAIL', true, 'Invitation à rejoindre SportVision (collaborateur)'),
  ('auth.email_verification', 'SECURITY', 'EMAIL', true, 'Vérification de l''adresse e-mail'),
  ('auth.welcome', 'SECURITY', 'EMAIL', false, 'Bienvenue / compte activé'),
  ('auth.password_reset', 'SECURITY', 'EMAIL', true, 'Mot de passe oublié'),
  ('auth.password_changed', 'SECURITY', 'EMAIL', true, 'Mot de passe modifié'),
  ('auth.email_changed', 'SECURITY', 'EMAIL', true, 'Adresse e-mail modifiée')
on conflict (template_key) do nothing;
