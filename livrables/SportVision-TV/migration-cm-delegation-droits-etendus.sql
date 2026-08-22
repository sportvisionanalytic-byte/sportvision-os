-- ============================================================================
-- migration-cm-delegation-droits-etendus.sql
-- ============================================================================
-- Demande explicite de Fouka (22/08/2026) : un CM délégué à un club
-- (cm_agency_club_access, cf. migration-connect-v80) doit pouvoir tout gérer
-- comme un admin du club — pas seulement les catégories/équipes (déjà
-- fonctionnel), mais aussi modifier le logo/l'identité du club et envoyer
-- des invitations Connect aux joueurs.
--
-- is_club_member() reconnaît déjà une délégation valide (migration-connect-
-- v80) mais is_club_admin() ne le faisait pas — d'où le blocage sur
-- clubs_admin_update (Paramètres du club) et ctm_admin_delete (suppression
-- d'équipe). is_team_educateur() (génération de code d'invitation par
-- équipe) ne le reconnaissait pas non plus. Étend les deux fonctions avec
-- exactement le même bloc de vérification que is_club_member(), pour rester
-- cohérent avec le pattern déjà en place plutôt que d'inventer une nouvelle
-- logique de délégation.
-- ============================================================================

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
  );
$$;
