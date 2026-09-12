-- Le calendrier d'un coach : l'autorisation se calcule une fois par équipe, plus une fois par événement.
--
-- Mesuré le 12/09/2026 sur la production, avec le jeton d'un vrai coach (RCP Fontainbleau,
-- 3 320 événements, 33 équipes) : 2 274 ms pour 105 lignes rendues. Sur l'environnement Review
-- (3 772 événements), le même appel met 55 s en direct et se fait couper à 8 s par PostgREST
-- (57014). Ce n'est pas une dérive de Review : c'est le comportement de la production, qui
-- deviendra bloquant dès qu'un club aura un calendrier un peu fourni — SF Villemomble en a 4 664.
--
-- Cause : `is_team_educateur(c.team_id)` est évalué LIGNE À LIGNE sur tout le calendrier interne,
-- et chaque appel repasse par les tables et leur RLS. Un coach paie donc 4 000 vérifications pour
-- en rendre 100.
--
-- Correctif : la liste des équipes qu'il a le droit de voir est calculée UNE fois (une évaluation
-- par équipe du club, soit 33 au lieu de 3 320), puis le filtre devient une simple appartenance.
-- La règle ne change pas d'un iota : c'est exactement `is_team_educateur`, appliquée aux mêmes
-- équipes, plus les événements sans équipe. `is_team_educateur`, `membre_borne_a_ses_equipes` et
-- `club_calendrier_interne` ne sont pas touchées.
--
-- Garde-fou : si `club_calendrier` a changé depuis le 12/09, rien n'est modifié.

begin;

do $garde$
declare h text := md5(pg_get_functiondef('public.club_calendrier(uuid,date,date)'::regprocedure));
begin
  if h <> 'ee8becdd21e4822daea873794d787c43' then
    raise exception 'calendrier-coach-perf : club_calendrier a changé depuis le 12/09/2026 (md5 %). Rien n''a été modifié — reporter le calcul unique sur sa nouvelle définition.', h;
  end if;
end $garde$;

create or replace function public.club_calendrier(p_club_id uuid, p_du date, p_au date)
 returns table(ref text, genre text, date_evenement date, heure_debut time without time zone, heure_fin time without time zone, titre text, equipe text, team_id uuid, adversaire text, domicile boolean, lieu text, competition text, score text, statut text, couverture text, adversaire_logo text, type_couverture text, buteurs text, passeurs text, homme_du_match text, cartons text)
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_borne boolean;
  v_equipes uuid[];
begin
  if not peut_lire_calendrier_club(p_club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  -- v158 : le calendrier d'un coach est celui de ses équipes, plus les rendez-vous du club.
  v_borne := membre_borne_a_ses_equipes(p_club_id);

  if v_borne then
    -- Une évaluation par équipe du club, au lieu d'une par événement (12/09/2026, performance).
    select coalesce(array_agg(ct.id), '{}'::uuid[])
      into v_equipes
      from club_teams ct
     where ct.club_id = p_club_id
       and is_team_educateur(ct.id);
  end if;

  return query
    select * from club_calendrier_interne(p_club_id, p_du, p_au) c
     where not v_borne
        or c.team_id is null
        or c.team_id = any (v_equipes);
end;
$function$;

commit;
