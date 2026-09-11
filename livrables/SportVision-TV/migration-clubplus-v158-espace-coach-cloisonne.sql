-- v158 : le coach ne voit que son équipe dans le calendrier et les séances (12/09/2026).
--
-- Demande de Fouka : « ils voient leur calendrier à eux… vraiment les infos qui concernent leur
-- équipe ». L'audit du 12/09 a montré que matchs, événements, joueurs, effectifs et galeries
-- étaient déjà cloisonnés, mais que deux sources ne l'étaient pas :
--   • club_calendrier (la fonction que lit l'écran Calendrier) rendait les matchs ET les
--     entraînements de toutes les équipes du club ;
--   • club_team_training_slots restait lisible par tout membre du club (ctts_member_select).
--
-- Règle appliquée, la même que partout ailleurs (is_team_educateur) : un coach, un responsable
-- d'équipe ou un directeur sportif ne voit que ses équipes, plus ce qui n'appartient à aucune
-- équipe (un événement de club). Président, secrétariat, CM affecté, agence et staff : inchangé.
-- Volontairement non restreints : la liste des noms d'équipes et les actualités du club.
-- Test : tests/espace-coach-cloisonne.test.sql

-- Membre dont la vue est bornée à ses équipes : coach, responsable d'équipe, directeur sportif.
create or replace function public.membre_borne_a_ses_equipes(p_club_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from club_members cm
    where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'actif'
      and cm.role in ('coach', 'resp_equipe', 'directeur_sportif')
  );
$$;
revoke execute on function public.membre_borne_a_ses_equipes(uuid) from public, anon;
grant execute on function public.membre_borne_a_ses_equipes(uuid) to authenticated;

create or replace function public.club_calendrier(p_club_id uuid, p_du date, p_au date)
returns table(ref text, genre text, date_evenement date, heure_debut time without time zone, heure_fin time without time zone, titre text, equipe text, team_id uuid, adversaire text, domicile boolean, lieu text, competition text, score text, statut text, couverture text, adversaire_logo text, type_couverture text, buteurs text, passeurs text, homme_du_match text, cartons text)
language plpgsql stable security definer
set search_path = public, pg_temp as $$
begin
  if not peut_lire_calendrier_club(p_club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  -- v158 : le calendrier d'un coach est celui de ses équipes, plus les rendez-vous du club.
  return query
    select * from club_calendrier_interne(p_club_id, p_du, p_au) c
     where not membre_borne_a_ses_equipes(p_club_id)
        or c.team_id is null
        or is_team_educateur(c.team_id);
end;
$$;

-- Les séances d'entraînement suivent la même règle.
drop policy if exists ctts_member_select on public.club_team_training_slots;
create policy ctts_member_select on public.club_team_training_slots for select to authenticated
  using (exists (
    select 1 from club_teams ct
    where ct.id = club_team_training_slots.team_id
      and is_club_member(ct.club_id)
      and (not membre_borne_a_ses_equipes(ct.club_id) or is_team_educateur(ct.id))
  ));
