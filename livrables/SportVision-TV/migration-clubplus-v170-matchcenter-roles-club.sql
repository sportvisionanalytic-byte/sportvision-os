-- v170 : le Match Center n'est plus vide pour la moitié du club (12/09/2026).
--
-- La policy de lecture des matchs, cma_member_select, s'écrivait :
--     is_club_member(club_id) and (team_id is null or is_team_educateur(team_id))
-- Autrement dit : soit le match ne vise aucune équipe, soit il faut être l'éducateur de cette
-- équipe. Or tous les matchs de production portent une équipe. Résultat : la Secrétaire, le
-- Trésorier, la Communication, l'Administratif, le Membre du bureau et la Lecture seule ouvraient
-- un Match Center parfaitement vide, sans un mot d'explication.
--
-- Le calendrier avait déjà été corrigé le 11/09 avec peut_lire_calendrier_equipe(), qui dit
-- exactement qui peut lire les événements d'une équipe : les dirigeants du club, les rôles
-- administratifs, la communication, la lecture seule, et l'éducateur de cette équipe. Les matchs
-- suivent la même règle, pour que les deux écrans racontent la même chose.
--
-- Cette migration RÉTABLIT AUSSI DANS LE DÉPÔT deux fonctions qui n'existaient qu'en production
-- (dérive constatée le 12/09) : peut_lire_calendrier_equipe, jamais écrite dans une migration, et
-- membre_borne_a_ses_equipes, dont la clause « sauf s'il est aussi joueur ou parent » est absente
-- de v158. Elles sont recopiées ici telles qu'elles tournent, sans changement de comportement :
-- une reconstruction depuis les migrations produirait sinon une base différente de la réalité.
-- Test : tests/matchcenter-roles-club.test.sql

-- Corps repris TEL QUEL de la production : c'est la version PL/pgSQL posée par
-- migration-blocages-review-3-rls-evaluation-unique.sql (autre session, même jour), qui évite la
-- re-planification par ligne dans les policies. On ne la remplace pas, on l'inscrit ici pour que ce
-- fichier soit rejouable seul sans faire regresser la performance.
create or replace function public.peut_lire_calendrier_equipe(p_team_id uuid)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if exists (
    select 1 from club_members cm, club_teams ct
    where ct.id = p_team_id and cm.club_id = ct.club_id and cm.user_id = auth.uid() and cm.status = 'actif'
      and cm.role in (
        'admin', 'president', 'secretaire', 'tresorier', 'membre_bureau', 'administratif',
        'comm', 'cm_externe', 'lecture_seule'
      )
  ) then
    return true;
  end if;
  return is_team_educateur(p_team_id);
end $$;
revoke execute on function public.peut_lire_calendrier_equipe(uuid) from public, anon;
grant execute on function public.peut_lire_calendrier_equipe(uuid) to authenticated;

-- Recopie conforme de la production (le coach est borné à ses équipes, sauf s'il est aussi joueur
-- du club ou parent confirmé d'un joueur : le lien de famille ouvre le calendrier complet depuis
-- la v120, et un rôle d'encadrement ne le retire pas).
create or replace function public.membre_borne_a_ses_equipes(p_club_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from club_members cm
    where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'actif'
      and cm.role in ('coach', 'resp_equipe', 'directeur_sportif')
  )
  and not exists (
    select 1 from player_profiles pp
     where pp.club_id = p_club_id
       and coalesce(pp.account_status, '') <> 'retire'
       and (pp.user_id = auth.uid() or is_confirmed_parent_of(pp.id))
  );
$$;
revoke execute on function public.membre_borne_a_ses_equipes(uuid) from public, anon;
grant execute on function public.membre_borne_a_ses_equipes(uuid) to authenticated;

drop policy if exists cma_member_select on public.club_matches;
create policy cma_member_select on public.club_matches for select to public
  using (is_club_member(club_id) and (team_id is null or peut_lire_calendrier_equipe(team_id)));
