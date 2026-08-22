-- ============================================================================
-- migration-cm-agency-super-access-staff.sql
-- ============================================================================
-- Demande Fouka (22/08/2026) : chaque CM interne SportVision (profiles.role=
-- 'com') doit pouvoir naviguer dans Club+ comme un CM d'agence externe
-- (cm_agency_club_access, déjà en place), avec deux niveaux confirmés :
--   - "CM affilié" : seulement les clubs qui lui sont explicitement délégués
--     (cm_agency_club_access, mécanisme existant, inchangé).
--   - "CM responsable / super CM" : accès à TOUS les clubs, sans délégation
--     par club — nouveau, porté par une colonne booléenne sur `memberships`,
--     par PERSONNE (pas par organisation entière, décision Fouka : plusieurs
--     CM peuvent partager la même organisation "SportVision" avec des
--     niveaux différents).
-- Il veut aussi voir, depuis ce même compte : les demandes d'adhésion
-- joueur/parent (membership_requests, agrégées tous clubs — voir la nouvelle
-- vue CmAgencyRequestsView côté app-next) et les demandes d'activation Club+
-- (déjà visibles côté OS pour role='com', aucun changement nécessaire là).
--
-- Prérequis découvert en vérifiant avant d'écrire une ligne : is_staff()
-- (migration-connect-v58) exclut délibérément tout compte `profiles` ayant
-- une ligne `memberships` — garde-fou anti-pollution de l'annuaire staff par
-- un compte client Connect (bug réel corrigé par v31/v58), pas une décision
-- visant un vrai staff avec un second rôle CM. Ajouter tel quel une ligne
-- `memberships` à un compte staff pour lui donner Club+ lui ferait donc
-- perdre silencieusement is_staff() partout dans l'OS (des dizaines de
-- policies/RPC, voir migration-connect-v58/v60). is_staff() est corrigée ici
-- pour tolérer UNIQUEMENT une adhésion à une organisation cm_agency (le cas
-- volontaire introduit par ce chantier) — une adhésion à tout autre type
-- d'organisation (club, académie, etc., un vrai compte client) continue de
-- faire perdre is_staff(), exactement comme avant.
--
-- Aucune nouvelle policy RLS sur `memberships`/`organizations` n'est
-- nécessaire : mb_staff_write et org_staff_write (déjà en place) autorisent
-- déjà admin/sec à écrire n'importe quelle ligne de ces deux tables — donc à
-- créer l'organisation "SportVision" et ses memberships directement, du même
-- geste que la gestion existante de cm_agency_club_access
-- (_cmAgencyAccessView, SportVision-OS-Full.html).
-- ============================================================================

alter table memberships add column if not exists cm_super_access boolean not null default false;
comment on column memberships.cm_super_access is 'Uniquement significatif pour une organisation organization_type=cm_agency : si vrai, ce membre a accès à tous les clubs Club+ (CM responsable SportVision), sans besoin d''une ligne cm_agency_club_access par club.';

-- ── is_staff() : exception contrôlée pour une adhésion cm_agency uniquement ──
create or replace function is_staff()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and p.role in ('admin','sec','prod','photo','cm','compta','com')
      and not exists (
        select 1 from memberships m
        join organizations o on o.id = m.organization_id
        where m.user_id = p.id and o.organization_type <> 'cm_agency'
      )
      and not exists (select 1 from player_profiles pp where pp.user_id = p.id)
      and not exists (select 1 from connect_profile_settings cps where cps.user_id = p.id)
  );
$$;

-- ── is_club_member / is_club_admin / is_team_educateur : branche accès total ──
create or replace function is_club_member(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from club_members
    where club_id = target_club_id and user_id = auth.uid() and status = 'actif'
  )
  or exists (
    select 1
    from cm_agency_club_access caa
    join memberships m on m.organization_id = caa.cm_agency_org_id
    where caa.club_id = target_club_id
      and m.user_id = auth.uid()
      and m.status = 'actif'
      and (caa.expires_at is null or caa.expires_at >= current_date)
  )
  or exists (
    select 1 from memberships m
    join organizations o on o.id = m.organization_id
    where m.user_id = auth.uid() and m.status = 'actif' and m.cm_super_access = true
      and o.organization_type = 'cm_agency'
  );
$$;

create or replace function is_club_admin(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from club_members
    where club_id = target_club_id and user_id = auth.uid()
      and role = 'admin' and status = 'actif'
  )
  or exists (
    select 1
    from cm_agency_club_access caa
    join memberships m on m.organization_id = caa.cm_agency_org_id
    where caa.club_id = target_club_id
      and m.user_id = auth.uid()
      and m.status = 'actif'
      and (caa.expires_at is null or caa.expires_at >= current_date)
  )
  or exists (
    select 1 from memberships m
    join organizations o on o.id = m.organization_id
    where m.user_id = auth.uid() and m.status = 'actif' and m.cm_super_access = true
      and o.organization_type = 'cm_agency'
  );
$$;

create or replace function is_team_educateur(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from club_members cm, club_teams ct
    where ct.id = p_team_id and cm.club_id = ct.club_id and cm.user_id = auth.uid() and cm.status = 'actif'
      and (
        cm.role in ('admin', 'president')
        or (cm.role in ('coach', 'resp_equipe', 'directeur_sportif') and cm.teams @> to_jsonb(ct.name::text))
      )
  )
  or exists (
    select 1
    from club_teams ct
    join cm_agency_club_access caa on caa.club_id = ct.club_id
    join memberships m on m.organization_id = caa.cm_agency_org_id
    where ct.id = p_team_id
      and m.user_id = auth.uid()
      and m.status = 'actif'
      and (caa.expires_at is null or caa.expires_at >= current_date)
  )
  or exists (
    select 1 from memberships m
    join organizations o on o.id = m.organization_id
    where m.user_id = auth.uid() and m.status = 'actif' and m.cm_super_access = true
      and o.organization_type = 'cm_agency'
  );
$$;

-- ── Bootstrap : organisation "SportVision" (cm_agency) + premier membre ──
-- Jordy Mulasa (profiles.role='com', seul CM interne existant au 22/08/2026) reçoit une ligne
-- memberships pour cette organisation, cm_super_access=false par défaut (CM affilié) — Fouka
-- délègue ensuite les clubs voulus via _cmAgencyAccessView (OS) et peut activer l'accès total
-- via la nouvelle case à cocher du même écran si besoin.
insert into organizations (id, nom, organization_type, statut)
select gen_random_uuid(), 'SportVision', 'cm_agency', 'actif_standard'
where not exists (select 1 from organizations where nom = 'SportVision' and organization_type = 'cm_agency');

insert into memberships (user_id, organization_id, role, status, source, cm_super_access)
select p.id, o.id, 'collaborateur', 'actif', 'staff_bootstrap', false
from profiles p, organizations o
where p.email = 'jordy.mulasa@hotmail.com'
  and o.nom = 'SportVision' and o.organization_type = 'cm_agency'
  and not exists (
    select 1 from memberships m where m.user_id = p.id and m.organization_id = o.id
  );
