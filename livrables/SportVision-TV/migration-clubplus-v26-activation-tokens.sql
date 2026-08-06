-- ============================================================
-- SPORTVISION CLUB+ — Migration v26
-- Suite de migration-clubplus-v1 à v24.sql. Idempotente.
--
-- Portée : liens d'activation privés Club+ pour un club DÉJÀ suivi
-- commercialement par SportVision (ligne `clients` existante, avec ses
-- devis / prestations / factures dans le Portail). Le staff génère un
-- lien depuis la fiche client de SportVision OS ; le dirigeant du club
-- clique, crée son compte, et son espace Club+ arrive déjà relié à son
-- historique Portail — au lieu de repartir de zéro par l'inscription
-- self-service publique (clubplus-onboarding), qui devine le lien
-- Portail par simple correspondance d'e-mail.
--
-- C'est le flux annoncé en commentaire d'en-tête de clubplus-onboarding
-- ("clubplus-accept-invite / clubplus-activate") et déjà maquetté côté
-- Club+ (écrans act-valid / act-expired / act-used / act-withdrawn),
-- jamais construit jusqu'ici.
--
-- ── Sécurité ───────────────────────────────────────────────────────
-- Un token de cette table vaut, pour qui le possède, un accès en
-- lecture aux devis/factures/contrats réels d'un client Portail (via
-- client_users, cf. migration-portail-v1.sql). Il est donc traité comme
-- un secret :
--   • AUCUNE policy de lecture publique/anonyme. Un visiteur ne peut
--     jamais interroger cette table en REST direct avec la clé
--     publishable — sinon n'importe qui pourrait lister les tokens
--     actifs et activer le compte d'un club à sa place. La seule
--     vérification possible passe par l'Edge Function service-role
--     clubplus-check-activation-token, qui ne renvoie qu'un statut
--     ('valid' / 'expired' / 'used' / 'revoked' / 'invalid') et le nom
--     de club pré-rempli, jamais l'e-mail ni l'identité du client.
--   • Écriture/lecture réservées au staff SportVision ('admin','sec',
--     'com') pour la génération et la révocation depuis SportVision OS.
--   • Le token lui-même est généré côté Edge Function avec
--     crypto.randomUUID() (122 bits d'aléa cryptographique), jamais
--     côté client ni à partir d'une donnée devinable.
--   • Expiration par défaut à 30 jours + révocation manuelle possible
--     (revoked_at) sans supprimer la ligne, pour garder la trace de ce
--     qui a été envoyé à qui.
--
-- Ce fichier ne touche à aucune policy existante et n'accorde aucun
-- nouveau droit sur `clubs` : la création du club reste faite par une
-- Edge Function service-role (clubplus-activate), donc le trigger
-- protect_sensitive_club_fields (v24) reste la seule et unique porte
-- pour plan / pilot_mode / credits_* / portail_client_id.
-- ============================================================

create table if not exists clubplus_activation_tokens (
  id uuid default gen_random_uuid() primary key,
  client_id uuid references clients(id) on delete cascade not null,
  token text unique not null,
  club_nom_prefill text,
  plan text check (plan in ('club','performance')) default 'club',
  created_by uuid references profiles(id),
  expires_at timestamptz not null default (now() + interval '30 days'),
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz default now()
);

-- `token` est déjà indexé par sa contrainte unique (lookup de l'Edge
-- Function). L'index client_id sert la fiche client de SportVision OS,
-- qui liste les liens déjà émis pour un client donné.
create index if not exists idx_cpat_client on clubplus_activation_tokens (client_id);

alter table clubplus_activation_tokens enable row level security;

-- Staff SportVision uniquement (génération + révocation + suivi).
-- Aucune policy pour anon/authenticated : un dirigeant de club, un
-- client Portail ou un visiteur n'a strictement aucun accès direct.
drop policy if exists "cpat_staff_all" on clubplus_activation_tokens;
create policy "cpat_staff_all" on clubplus_activation_tokens for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'sec', 'com'))
) with check (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'sec', 'com'))
);
