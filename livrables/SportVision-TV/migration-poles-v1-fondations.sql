-- migration-poles-v1-fondations.sql
--
-- Migration multi-pôles (Football + Basket), Lot 1 — Fondations.
-- À exécuter APRÈS migration-poles-v0-rename-calendrier-departement.sql
-- (qui libère le mot "pole" de toute ambiguïté avec le département
-- fonctionnel interne de v_calendar_global).
--
-- Périmètre : purement ADDITIF. Aucune colonne obligatoire, aucune policy
-- RLS existante modifiée, aucune donnée existante altérée. Peut être
-- exécutée sans coordination avec le backfill (migration v2) — le système
-- continue de fonctionner exactement comme avant tant que v2/v3 n'ont pas
-- tourné, `pole_id` étant nullable ici.
--
-- Contenu :
--   1. Table `poles` (le pôle sportif — Football, Basket, futurs pôles).
--   2. Table `pole_affectations` (relation user <-> pole <-> rôle, permet
--      l'appartenance multi-pôle — voir plan de migration §Décisions
--      d'architecture, précédent direct : profiles.niveau_cm).
--   3. RLS activée dès la création sur les deux nouvelles tables (jamais de
--      fenêtre "table sans policy").
--   4. Colonnes pole_id nullable sur clients/prestations (backfill + bascule
--      NOT NULL dans la migration v2, séparément).
--   5. Insertion du pôle Football + affectation automatique de tous les
--      profils existants en tant que 'membre' (aucun 'responsable' désigné
--      automatiquement — action manuelle volontaire de Fouka ensuite).
--
-- Idempotente : create table if not exists, insert ... on conflict do
-- nothing, alter table add column if not exists.
--
-- ROLLBACK (à exécuter dans cet ordre si besoin de revenir en arrière) :
--   alter table prestations drop column if exists pole_id;
--   alter table clients drop column if exists pole_id;
--   drop table if exists pole_affectations;
--   drop table if exists poles;

-- ── 1. Table poles ──────────────────────────────────────────────────────
create table if not exists poles (
  id uuid default gen_random_uuid() primary key,
  nom text not null,
  slug text not null unique,
  sport text not null,
  statut text not null default 'actif' check (statut in ('lancement', 'actif', 'en_pause')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table poles is 'Pôle sportif (business unit interne) — Football, Basket, futurs pôles. Introduit le 31/08/2026 (migration multi-pôles). Ne pas confondre avec la colonne "departement" de v_calendar_global (département fonctionnel interne, concept différent, renommé depuis "pole" par migration-poles-v0 précisément pour éviter cette confusion).';
comment on column poles.slug is 'Identifiant stable pour jointures/défauts (ex: ''football'', ''basket''), distinct de nom/sport pour permettre un futur renommage d''affichage sans casser de FK.';

alter table poles enable row level security;

drop policy if exists "poles_select_staff" on poles;
create policy "poles_select_staff" on poles for select using (
  exists (select 1 from profiles where id = auth.uid())
);

drop policy if exists "poles_admin_write" on poles;
create policy "poles_admin_write" on poles for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- ── 2. Table pole_affectations ──────────────────────────────────────────
create table if not exists pole_affectations (
  id uuid default gen_random_uuid() primary key,
  pole_id uuid not null references poles(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role_pole text not null default 'membre' check (role_pole in ('responsable', 'membre')),
  actif boolean not null default true,
  affecte_le timestamptz default now(),
  affecte_par uuid references profiles(id),
  unique (pole_id, user_id)
);

comment on table pole_affectations is 'Relation many-to-many user <-> pole. Un profil (profiles.role reste le rôle FONCTIONNEL, inchangé) peut appartenir à plusieurs pôles ; role_pole distingue responsable/membre AU SEIN d''un pôle donné. Précédent direct dans ce repo : profiles.niveau_cm (sous-niveau orthogonal au rôle).';

create index if not exists idx_pole_affectations_user on pole_affectations(user_id) where actif;
create index if not exists idx_pole_affectations_pole on pole_affectations(pole_id) where actif;

alter table pole_affectations enable row level security;

drop policy if exists "pole_affectations_admin_all" on pole_affectations;
create policy "pole_affectations_admin_all" on pole_affectations for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

drop policy if exists "pole_affectations_self_select" on pole_affectations;
create policy "pole_affectations_self_select" on pole_affectations for select using (
  user_id = auth.uid()
);

drop policy if exists "pole_affectations_responsable_select" on pole_affectations;
create policy "pole_affectations_responsable_select" on pole_affectations for select using (
  exists (
    select 1 from pole_affectations pa2
    where pa2.pole_id = pole_affectations.pole_id
      and pa2.user_id = auth.uid()
      and pa2.role_pole = 'responsable'
      and pa2.actif = true
  )
);

-- ── 3. Colonnes pole_id (nullable — bascule NOT NULL en v2) ─────────────
alter table clients add column if not exists pole_id uuid references poles(id);
alter table prestations add column if not exists pole_id uuid references poles(id);

comment on column clients.pole_id is 'Pôle sportif d''autorité (remplace clients.sport comme source de vérité pour le scoping/RLS/finance). clients.sport est conservé en lecture seule de fait pour compat descendante UI, non supprimé.';
comment on column prestations.pole_id is 'Auto-dérivé du client via trigger sync_prestation_pole_id (migration-poles-v2) — jamais fixé directement par le front.';

-- ── 4. Pôle Football + affectation de tous les profils existants ────────
insert into poles (nom, slug, sport, statut)
values ('Football', 'football', 'Football', 'actif')
on conflict (slug) do nothing;

insert into pole_affectations (pole_id, user_id, role_pole)
select (select id from poles where slug = 'football'), id, 'membre'
from profiles
on conflict (pole_id, user_id) do nothing;
