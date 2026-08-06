-- ============================================================
-- SPORTVISION CONNECT — Migration v2 : organizations, memberships,
-- connect_modules, organization_entitlements.
--
-- Étape 1 du plan de migration (cf. livrables/SportVision-Connect/
-- ARCHITECTURE-CONNECT.md, §11). Objectif : poser le socle qui manque
-- pour "une seule connexion, plusieurs espaces" — sans lequel aucun
-- sélecteur d'organisation ni système de modules par entitlement n'est
-- possible.
--
-- ── Principe de conception : additif, pas destructif ────────────────
-- Cette migration NE MODIFIE NI NE SUPPRIME `clients` NI `clubs`. Elle
-- ajoute une couche par-dessus, alimentée une fois par copie, puis
-- laisse `clients`/`clubs` continuer à fonctionner exactement comme
-- aujourd'hui pour SportVision OS. Rien ne casse si cette migration
-- n'est jamais suivie d'une étape 2 : les nouvelles tables restent
-- simplement inutilisées par l'existant.
--
-- ── Choix clé : réutilisation des identifiants existants ────────────
-- organizations.id RÉUTILISE clubs.id pour un club, ou clients.id pour
-- un client Portail sans club associé (voir logique de peuplement plus
-- bas). Ce n'est PAS un nouvel identifiant généré au hasard : c'est
-- délibéré, pour que toutes les tables qui référencent déjà club_id
-- (club_teams, club_matches, club_media, club_sponsors, etc.) puissent
-- plus tard être relues comme "organization_id" SANS AUCUNE migration
-- de données — seulement un renommage de colonne, quand on sera prêt.
--
-- ── Pont déjà existant réutilisé ─────────────────────────────────────
-- clubs.portail_client_id (ajouté par migration-clubplus-v12.sql) relie
-- déjà un club à son client Portail. Cette migration s'appuie dessus
-- pour ne créer QU'UNE organisation par entité réelle : un club lié à
-- un client Portail devient une seule ligne organizations (celle du
-- club), pas deux.
--
-- Idempotente pour la structure (DROP ... IF EXISTS / CREATE TABLE IF
-- NOT EXISTS). Le peuplement (section 3) utilise des ON CONFLICT DO
-- NOTHING : rejouable sans dupliquer, mais ne remet pas à jour des
-- lignes déjà copiées si la source a changé depuis — voir note de fin
-- de fichier sur la stratégie à date fixe vs synchronisation continue.
--
-- À exécuter dans Supabase → SQL Editor, après relecture.
-- ============================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. STRUCTURE
-- ═══════════════════════════════════════════════════════════════

create table if not exists organizations (
  id uuid primary key,                     -- = clubs.id ou clients.id (voir peuplement)
  organization_type text not null check (organization_type in (
    'club','academie','coach','projet','sponsor'
  )),
  nom text not null,
  ville text,
  legacy_client_id uuid references clients(id) on delete set null,
  legacy_club_id uuid references clubs(id) on delete set null,
  legacy_type_client text,                 -- clients.type_client d'origine, conservé pour référence
  statut text not null default 'actif' check (statut in (
    'actif_premium','actif_standard','limite_fin_contrat','suspendu_impaye','archive','desactive'
  )),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table organizations is
  'Couche d''unification Connect. id = clubs.id ou clients.id (réutilisé, pas régénéré). '
  'Ne remplace pas clients/clubs, les complète. Voir ARCHITECTURE-CONNECT.md §2 et §11.';

alter table organizations enable row level security;

create table if not exists memberships (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  organization_id uuid references organizations(id) on delete cascade not null,
  role text not null,                      -- réutilise le vocabulaire de club_members.role, + 'client'
  status text not null default 'actif' check (status in ('actif','invitation','suspendu')),
  source text not null default 'manuel',   -- 'club_members' | 'client_users' | 'manuel' — traçabilité du peuplement
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, organization_id)
);

comment on table memberships is
  'Fusion cible de club_members + client_users. club_members/client_users restent la source '
  'de vérité actuelle pour OS/Club+/Portail tant que le frontend Connect n''existe pas.';

alter table memberships enable row level security;

create table if not exists connect_modules (
  key text primary key,
  label text not null,
  espace text not null check (espace in (
    'club','coach','academie','joueur','sponsor','projet','commun'
  ))
);

create table if not exists organization_entitlements (
  organization_id uuid references organizations(id) on delete cascade not null,
  module_key text references connect_modules(key) not null,
  actif boolean not null default true,
  quota_credits integer,
  quota_utilisateurs integer,
  reduction_pct numeric(4,2) not null default 0,
  priorite text not null default 'standard' check (priorite in ('standard','prioritaire')),
  source_contrat_id uuid references contrats(id) on delete set null,
  activated_at timestamptz default now(),
  expires_at timestamptz,
  primary key (organization_id, module_key)
);

comment on table organization_entitlements is
  'Ce qu''une organisation a le droit d''utiliser. Le frontend Connect doit toujours tester '
  'hasModule(org, key), jamais coder une offre commerciale en dur. Voir ARCHITECTURE-CONNECT.md §3.';

alter table organization_entitlements enable row level security;


-- ═══════════════════════════════════════════════════════════════
-- 2. FONCTION D'ACCÈS PARTAGÉE
-- ═══════════════════════════════════════════════════════════════

create or replace function is_org_member(p_org_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from memberships
    where organization_id = p_org_id and user_id = auth.uid() and status = 'actif'
  );
$$;

create or replace function is_staff()
returns boolean language sql stable security definer as $$
  select exists (select 1 from profiles where id = auth.uid());
$$;


-- ═══════════════════════════════════════════════════════════════
-- 3. PEUPLEMENT (copie unique depuis clients/clubs — voir note de fin)
-- ═══════════════════════════════════════════════════════════════

-- 3.1 — Une organisation par club (source la plus riche fonctionnellement)
insert into organizations (id, organization_type, nom, ville, legacy_club_id, legacy_client_id)
select
  c.id,
  'club',
  c.nom,
  c.ville,
  c.id,
  c.portail_client_id
from clubs c
on conflict (id) do nothing;

-- 3.2 — Une organisation par client Portail SANS club associé (client ponctuel = Espace Projet).
--       Exclut les clients déjà couverts via clubs.portail_client_id (évite le doublon).
insert into organizations (id, organization_type, nom, ville, legacy_client_id, legacy_type_client)
select
  cl.id,
  'projet',
  cl.nom,
  cl.ville,
  cl.id,
  cl.type_client
from clients cl
where not exists (
  select 1 from clubs c where c.portail_client_id = cl.id
)
on conflict (id) do nothing;

-- 3.3 — Memberships depuis club_members (organization_id = club_id, réutilisé tel quel)
insert into memberships (user_id, organization_id, role, status, source)
select cm.user_id, cm.club_id, cm.role, cm.status, 'club_members'
from club_members cm
on conflict (user_id, organization_id) do nothing;

-- 3.4 — Memberships depuis client_users. Si le client a un club associé, l'appartenance
--       pointe vers l'organisation DU CLUB (même entité réelle), pas vers une organisation
--       fantôme keyed sur clients.id qui n'a jamais été créée à l'étape 3.2.
insert into memberships (user_id, organization_id, role, status, source)
select
  cu.id,
  coalesce(
    (select c.id from clubs c where c.portail_client_id = cu.client_id limit 1),
    cu.client_id
  ),
  'client',
  'actif',
  'client_users'
from client_users cu
on conflict (user_id, organization_id) do nothing;

-- 3.5 — Catalogue des modules (seed initial, cf. ARCHITECTURE-CONNECT.md §3 et §6)
insert into connect_modules (key, label, espace) values
  ('equipes','Équipes','club'),
  ('match_center','Match Center','club'),
  ('newsroom','Newsroom','club'),
  ('demandes_visuels','Demandes de visuels','club'),
  ('sponsors','Sponsors','club'),
  ('statistiques','Statistiques','club'),
  ('workflow_validation','Workflow de validation','club'),
  ('cm_affilie','CM affilié','club'),
  ('planning_editorial','Planning éditorial','club'),
  ('presences','Présences','club'),
  ('bibliotheque_contenus','Bibliothèque de contenus','club'),
  ('reporting','Reporting','club'),
  ('joueurs_suivis','Joueurs suivis','coach'),
  ('seances','Séances','coach'),
  ('planning_coach','Planning','coach'),
  ('demandes_tournage','Demandes de tournage','coach'),
  ('groupes','Groupes','academie'),
  ('stages','Stages','academie'),
  ('inscriptions','Inscriptions','academie'),
  ('campagnes','Campagnes','academie'),
  ('prestation','Prestation','projet'),
  ('devis','Devis','projet'),
  ('paiement','Paiement','projet'),
  ('livrables','Livrables','projet'),
  ('support','Support','commun')
on conflict (key) do nothing;

-- 3.6 — Entitlements des clubs existants, dérivés de clubs.plan/engagement/credits_*
--       (aucun nouveau choix métier : on retranscrit ce qui est déjà facturé aujourd'hui)
insert into organization_entitlements (organization_id, module_key, quota_credits, reduction_pct, priorite)
select c.id, m.module_key, c.credits_monthly,
  case when c.plan = 'performance' then 10 else 5 end,
  case when c.plan = 'performance' then 'prioritaire' else 'standard' end
from clubs c
cross join lateral (
  values ('equipes'),('match_center'),('newsroom'),('demandes_visuels'),('sponsors'),('support')
) as m(module_key)
on conflict (organization_id, module_key) do nothing;

insert into organization_entitlements (organization_id, module_key, quota_credits, reduction_pct, priorite)
select c.id, m.module_key, c.credits_monthly, 10, 'prioritaire'
from clubs c
cross join lateral (
  values ('statistiques'),('workflow_validation')
) as m(module_key)
where c.plan = 'performance'
on conflict (organization_id, module_key) do nothing;


-- ═══════════════════════════════════════════════════════════════
-- 4. RLS — même logique d'accès que club_members/client_users existants
-- ═══════════════════════════════════════════════════════════════

drop policy if exists "org_member_select" on organizations;
create policy "org_member_select" on organizations for select using (
  is_org_member(id) or is_staff()
);

drop policy if exists "org_staff_write" on organizations;
create policy "org_staff_write" on organizations for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec'))
);

drop policy if exists "mb_self_select" on memberships;
create policy "mb_self_select" on memberships for select using (
  user_id = auth.uid() or is_staff() or is_org_member(organization_id)
);

drop policy if exists "mb_staff_write" on memberships;
create policy "mb_staff_write" on memberships for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec'))
);

drop policy if exists "modules_public_select" on connect_modules;
create policy "modules_public_select" on connect_modules for select using (true);

drop policy if exists "modules_staff_write" on connect_modules;
create policy "modules_staff_write" on connect_modules for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

drop policy if exists "ent_member_select" on organization_entitlements;
create policy "ent_member_select" on organization_entitlements for select using (
  is_org_member(organization_id) or is_staff()
);

drop policy if exists "ent_staff_write" on organization_entitlements;
create policy "ent_staff_write" on organization_entitlements for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','prod'))
);


-- ============================================================
-- NOTE — synchronisation après cette copie initiale
--
-- Cette migration copie l'état ACTUEL de clients/clubs/club_members/
-- client_users vers organizations/memberships. Si un nouveau club ou
-- client est créé APRÈS avoir exécuté cette migration, il n'apparaîtra
-- PAS automatiquement dans organizations tant que :
--   (a) soit tu rejoues manuellement les INSERT de la section 3
--       (idempotents, sans risque de doublon) ;
--   (b) soit une étape suivante ajoute des triggers de synchronisation
--       clubs/clients → organizations, ou bascule directement les
--       fonctions de création (clubplus-onboarding, portal-onboarding,
--       création client dans OS) pour écrire aussi dans organizations.
-- Tant que le frontend Connect n'existe pas encore, ce n'est pas
-- urgent — mais à faire avant de brancher le premier écran dessus,
-- sinon les organisations créées entre-temps seront invisibles côté
-- Connect. À traiter dans l'étape 2 du plan de migration.
--
-- VÉRIFICATION RECOMMANDÉE après exécution (à exécuter séparément,
-- ce ne sont pas des commentaires inertes mais deux requêtes utiles) :
--
-- select
--   (select count(*) from organizations) as nb_organizations,
--   (select count(*) from clubs) + (
--     select count(*) from clients cl
--     where not exists (select 1 from clubs c where c.portail_client_id = cl.id)
--   ) as nb_attendu;
--
-- select
--   (select count(*) from memberships) as nb_memberships,
--   (select count(*) from club_members) + (select count(*) from client_users) as nb_attendu;
--
-- Les deux paires de colonnes doivent être égales. Si nb_memberships est
-- inférieur à nb_attendu, c'est probablement dû à des doublons (user_id,
-- organization_id) légitimes entre club_members et client_users pour un
-- même utilisateur — à vérifier avant de s'inquiéter, ce n'est pas
-- forcément une erreur.
-- ============================================================
