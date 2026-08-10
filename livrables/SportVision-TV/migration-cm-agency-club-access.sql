-- ============================================================
-- SPORTVISION CONNECT — Accès délégués Agence CM ↔ Club
-- (plan Tier C § Phase 3 « Accompagnement », 10/08/2026)
--
-- ─── Contexte ────────────────────────────────────────────────────────────
-- `organizations.organization_type` accepte désormais 'cm_agency' (migration-
-- connect-v20-event-cm-agency-org-types.sql, exécutée) : une agence CM externe
-- qui produit/publie pour le compte de plusieurs clubs. app-next `/accompagnement`
-- affiche déjà côté UI, pour ce type d'organisation, « Mes accès délégués » — une
-- carte par club avec le périmètre autorisé/refusé et une date d'expiration — mais
-- sur un mock (`delegatedAccessByCmOrg`, src/lib/mock/persona.ts). Aucune table
-- réelle ne portait cette relation jusqu'ici : cette migration la crée.
--
-- ─── Table ────────────────────────────────────────────────────────────────
-- Une ligne = un club a délégué un périmètre précis à une agence CM, pour une
-- durée limitée (`expires_at`). `allowed`/`denied` sont des tableaux de libellés
-- texte libres (ex. "Créer des publications", "Facturation") plutôt qu'un enum
-- fermé : périmètre volontairement en texte libre côté staff, cohérent avec la
-- nature commerciale/négociée de chaque délégation (voir ACTIONS.md §21, mock
-- d'origine). Un `(cm_agency_org_id, club_id)` unique : au plus une délégation
-- active à la fois pour un couple agence/club — révoquer, c'est supprimer la
-- ligne (pas de statut "révoqué" conservé, pas demandé par le design).
--
-- Pas de contrainte DB forçant organizations.organization_type = 'cm_agency'
-- pour cm_agency_org_id (les CHECK constraints Postgres ne peuvent pas
-- interroger une autre table) : c'est l'écran staff (SportVision-OS-Full.html)
-- qui restreint le sélecteur aux organisations réellement 'cm_agency' — voir
-- la fonction _cmAgencyAccessView() ci-contre.
--
-- ─── RLS ─────────────────────────────────────────────────────────────────
-- Lecture : membres actifs de l'agence CM concernée OU membres actifs du club
-- concerné (`is_org_member`, migration-connect-v2-organizations-entitlements.
-- sql — fonction déjà existante et réutilisée telle quelle, pas redéfinie ici ;
-- signature : is_org_member(p_org_id uuid) returns boolean, vérifie une ligne
-- `memberships` active pour l'utilisateur courant sur cet organization_id) OU
-- staff (`is_staff()`, même fichier). `club_id` référence `clubs(id)`, qui
-- partage le même UUID que l'organisation club correspondante (peuplement
-- 1:1 documenté dans migration-connect-v2, §3.1 : `insert into organizations
-- (id, ...) select c.id, 'club', ... from clubs c`) — is_org_member(club_id)
-- fonctionne donc directement, pas besoin d'une fonction is_club_member dédiée
-- (celle-ci existe bien mais interroge l'ancienne table `club_members`
-- directement, migration-clubplus-v1.sql — hors-jeu ici car un club member
-- arrivé via le tunnel Connect (memberships) n'y a pas forcément de ligne).
-- is_staff() est nécessaire pour que l'écran d'administration
-- (authentifié comme un compte `profiles`, jamais membre d'aucune
-- organisation) puisse lister ce qu'il gère.
--
-- Écriture : réservée au staff avec role in ('admin','sec','com') — même
-- ensemble de rôles que les autres actions d'administration Connect (ex.
-- migration-audit-08-08-corrections-interfaces.sql). Explicitement PAS
-- is_org_member(cm_agency_org_id) : un membre d'agence CM ne peut jamais
-- s'accorder ou modifier ses propres accès délégués, seul le staff SportVision
-- décide. Aucune ligne `profiles` n'existe pour un compte membre d'agence CM
-- (comptes Connect et comptes staff sont deux populations disjointes), donc
-- cette règle est de toute façon structurellement impossible à contourner —
-- documenté explicitement ici pour que l'intention soit claire en relecture.
--
-- Additive, idempotente (create table if not exists, drop policy if exists
-- avant chaque create policy). NON EXÉCUTÉE PAR L'AGENT — à exécuter par
-- Fouka dans Supabase → SQL Editor après relecture.
-- ============================================================

create table if not exists cm_agency_club_access (
  id uuid default gen_random_uuid() primary key,
  cm_agency_org_id uuid references organizations(id) on delete cascade not null,
  club_id uuid references clubs(id) on delete cascade not null,
  allowed text[] not null default '{}',
  denied text[] not null default '{}',
  expires_at date,
  granted_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now(),
  constraint cm_agency_club_access_unique unique (cm_agency_org_id, club_id)
);

comment on table cm_agency_club_access is
  'Périmètre qu''un club délègue à une agence CM externe (organizations.organization_type=''cm_agency'') '
  'pour produire/publier en son nom — app-next /accompagnement « Mes accès délégués ». '
  'Écrite uniquement par le staff (admin/sec/com), jamais par l''agence elle-même.';

alter table cm_agency_club_access enable row level security;

create index if not exists idx_cmaa_agency on cm_agency_club_access(cm_agency_org_id);
create index if not exists idx_cmaa_club on cm_agency_club_access(club_id);

drop policy if exists "cmaa_member_select" on cm_agency_club_access;
create policy "cmaa_member_select" on cm_agency_club_access for select using (
  is_org_member(cm_agency_org_id) or is_org_member(club_id) or is_staff()
);

drop policy if exists "cmaa_staff_write" on cm_agency_club_access;
create policy "cmaa_staff_write" on cm_agency_club_access for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','com'))
) with check (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','com'))
);
