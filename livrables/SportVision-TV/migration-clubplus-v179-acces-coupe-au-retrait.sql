-- v179 : retirer un joueur coupe vraiment son accès (12/09/2026).
--
-- Trouvé par l'audit du cloisonnement. Le club pouvait « retirer » un joueur ou le suspendre :
-- l'écran le disait parti, la base ne changeait rien du tout.
--
--   • is_own_player() et is_confirmed_parent_of() ne regardaient pas account_status : une fiche
--     retirée continuait d'ouvrir les photos identifiées du joueur, ses autorisations, son
--     calendrier, et la famille restait « famille de l'équipe » ;
--   • l'affiliation à l'équipe (team_memberships) restait « active », si bien que l'effectif
--     affichait « Retiré » sur une ligne que toutes les fonctions comptaient comme présente ;
--   • le joueur pouvait se REMETTRE en actif tout seul, par une écriture directe, même quand
--     c'était le club qui l'avait retiré ;
--   • il pouvait aussi changer son club_id lui-même, donc s'affilier à n'importe quel club sans
--     aucune demande. Cette exception datait du temps où rejoindre un second club réécrivait la
--     fiche ; depuis le multi-club du 04/09, rejoindre un autre club crée une NOUVELLE fiche, et
--     cette permission n'a plus de raison d'exister.
--
-- Ce qui reste possible, volontairement : se retirer soi-même (on ne piège personne), et être
-- remis en actif par le club.
-- Test : tests/acces-coupe-au-retrait.test.sql

-- ── 1. Une fiche retirée ou suspendue n'ouvre plus rien ──
create or replace function public.is_own_player(p_player_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from player_profiles
     where id = p_player_id and user_id = auth.uid()
       and coalesce(account_status, 'actif') not in ('retire', 'suspendu')
  );
$$;

create or replace function public.is_confirmed_parent_of(p_player_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from parent_player_relationships ppr
    join parent_profiles pp on pp.id = ppr.parent_id
    join player_profiles p on p.id = ppr.player_id
    where ppr.player_id = p_player_id and pp.user_id = auth.uid() and ppr.statut = 'confirme'
      and coalesce(p.account_status, 'actif') not in ('retire', 'suspendu')
  );
$$;

-- ── 2. Retirer le joueur retire aussi son affiliation ──
-- Sans cela, l'équipe le comptait encore dans son effectif et dans toutes les fonctions qui
-- lisent team_memberships.statut = 'active'.
create or replace function public.retirer_affiliations_au_retrait()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.account_status in ('retire', 'suspendu') and coalesce(old.account_status, '') not in ('retire', 'suspendu') then
    update team_memberships
       set statut = case when new.account_status = 'retire' then 'quittee_club' else 'archivee' end
     where player_id = new.id and statut = 'active';
  end if;
  return new;
end $$;
drop trigger if exists trg_retirer_affiliations_au_retrait on public.player_profiles;
create trigger trg_retirer_affiliations_au_retrait
  after update of account_status on public.player_profiles
  for each row execute function public.retirer_affiliations_au_retrait();

-- ── 3. On ne se remet pas en actif soi-même, et on ne change pas de club tout seul ──
create or replace function public.guard_player_profile_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if not is_club_admin(new.club_id) then
    if new.user_id is distinct from old.user_id
       or (
         new.account_status is distinct from old.account_status
         -- Se retirer soi-même reste possible : on ne piège personne dans un club.
         -- Revenir, en revanche, se demande au club : sinon le joueur que le club a retiré se
         -- remet en actif d'un seul appel, et le retrait ne veut plus rien dire.
         and not (new.account_status = 'retire' and old.user_id = auth.uid())
       )
       -- Changer de club soi-même : supprimé (12/09/2026). Rejoindre un autre club crée une
       -- nouvelle fiche depuis le multi-club du 04/09, cette écriture n'a plus d'usage légitime
       -- et permettait de s'affilier n'importe où sans demande.
       or new.club_id is distinct from old.club_id
       or (
         new.date_naissance is distinct from old.date_naissance
         and old.user_id is distinct from auth.uid()
       )
    then
      raise exception 'Modification non autorisée sur ces champs';
    end if;
  end if;
  return new;
end $$;
