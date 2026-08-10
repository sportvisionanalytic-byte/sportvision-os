-- ============================================================
-- SPORTVISION CONNECT — Migration v20 : types d'organisation `event` et
-- `cm_agency` + rattachement staff (tokens d'activation génériques).
--
-- ── Contexte ─────────────────────────────────────────────────────────────
-- Les modules Eventtimeline, Live et la branche "accès délégué" d'Accompagnement
-- sont verrouillés depuis leur construction (design) car `organizations.
-- organization_type` (migration-connect-v2-organizations-entitlements.sql,
-- CHECK constraint) n'autorise que 'club','academie','coach','projet','sponsor'
-- — 'event' (client Full Communication ponctuel, type tournoi) et 'cm_agency'
-- (agence externe de Community Management avec accès délégué multi-clubs)
-- n'existent nulle part côté base réelle, bien qu'ils soient déjà prévus côté
-- design (OrgType dans app-next/src/lib/types.ts les liste déjà).
--
-- Décidé avec Fouka (10/08/2026) : ce sont de vraies entités métier, pas un
-- scénario de design abandonné — à construire pour de vrai.
--
-- ── Pourquoi un rattachement STAFF, pas self-service ────────────────────
-- `cm_agency` est déjà explicitement exclu de l'inscription self-service
-- (app-next/src/app/signup/signup-context.tsx : "Non proposés à l'inscription
-- (rattachement uniquement)"). `event` est de la même famille : lié à un
-- forfait Full Communication vendu commercialement, pas un compte que
-- n'importe qui crée tout seul. `connect-org-signup` (self-service) ne gère
-- donc PAS ces deux types — une nouvelle paire d'edge functions les couvre
-- (`connect-staff-create-org` / `connect-org-activate`), sur le modèle exact
-- de `clubplus-generate-activation` / `clubplus-activate` : lien privé à
-- usage unique généré par le staff, JAMAIS envoyé automatiquement, le
-- rattachement à une fiche `clients` (si applicable) est PORTÉ PAR LE TOKEN
-- (choisi par le staff à la génération), jamais deviné par correspondance
-- d'e-mail à l'activation — même raisonnement de sécurité que clubplus-activate.
--
-- Idempotente. À exécuter après migration-connect-v2-organizations-entitlements.sql
-- et migration-connect-v6-org-admin.sql (organization_role_catalog).
-- ============================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. EXTENSION DE LA CONTRAINTE organizations.organization_type
-- ═══════════════════════════════════════════════════════════════

alter table organizations drop constraint if exists organizations_organization_type_check;
alter table organizations add constraint organizations_organization_type_check
  check (organization_type in ('club','academie','coach','projet','sponsor','event','cm_agency'));


-- ═══════════════════════════════════════════════════════════════
-- 2. CATALOGUE DE RÔLES — event et cm_agency
-- ═══════════════════════════════════════════════════════════════
-- Roles minimalistes, comme sponsor à sa création (migration-connect-v6) :
-- un rôle admin, un rôle par défaut non-admin. À affiner si un vrai usage
-- révèle un besoin plus fin — pas inventé ici faute de cas réel à observer.

insert into organization_role_catalog (organization_type, role_key, label, is_admin, is_default) values
  ('event', 'responsable', 'Responsable événement', true, false),
  ('event', 'partenaire', 'Partenaire', false, true),
  ('cm_agency', 'proprietaire', 'Propriétaire', true, false),
  ('cm_agency', 'collaborateur', 'Collaborateur', false, true)
on conflict (organization_type, role_key) do nothing;


-- ═══════════════════════════════════════════════════════════════
-- 3. TABLE DES TOKENS D'ACTIVATION GÉNÉRIQUES (staff → event/cm_agency)
-- ═══════════════════════════════════════════════════════════════
-- Sur le modèle exact de clubplus_activation_tokens (migration-clubplus-v26),
-- mais générique à organizations plutôt que spécifique à clubs/clients :
-- client_id reste NULLABLE ici (contrairement à clubplus_activation_tokens
-- où il est obligatoire) — un événement ponctuel ou une agence externe n'ont
-- pas forcément de fiche `clients` CRM préexistante à relier ; le staff en
-- choisit une si elle existe, sinon l'organisation reste sans historique
-- Portail (rattachable plus tard à la main en SQL Editor si besoin, même
-- limite déjà documentée pour clubplus-onboarding).

create table if not exists connect_org_activation_tokens (
  id uuid default gen_random_uuid() primary key,
  organization_type text not null check (organization_type in ('event','cm_agency')),
  nom_prefill text,
  client_id uuid references clients(id) on delete set null,
  token text unique not null,
  created_by uuid references profiles(id),
  expires_at timestamptz not null default (now() + interval '30 days'),
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_coat_client on connect_org_activation_tokens (client_id);

alter table connect_org_activation_tokens enable row level security;

drop policy if exists "coat_staff_all" on connect_org_activation_tokens;
create policy "coat_staff_all" on connect_org_activation_tokens for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','com'))
);

-- Aucune policy pour un utilisateur non-staff : la vérification/consommation
-- du token se fait exclusivement via les edge functions (service_role),
-- jamais par lecture directe REST — même choix que clubplus_activation_tokens
-- (le token lui-même, 122 bits d'aléa, est le seul secret qui compte).


-- ============================================================
-- NOTE — ce qui reste hors périmètre de cette migration
--
-- La colonne organizations.legacy_client_id existe déjà (migration-connect-
-- v2) et sert de pont vers `clients`, posée par connect-org-activate au
-- moment de l'activation (voir edge function). Aucune UI OS pour rattacher/
-- modifier ce lien après coup — même limite déjà documentée pour
-- clubs.portail_client_id (audit clubplus-onboarding, 10/08).
--
-- organization_entitlements n'est pas peuplée ici pour event/cm_agency :
-- ces deux types n'ont pas de plan/quota vendu au sens Club+ (Full
-- Communication est vendu commercialement, pas mesuré par crédits) — même
-- logique que coach/académie/sponsor, qui n'ont jamais eu d'entitlements
-- non plus.
-- ============================================================
