-- ═══════════════════════════════════════════════════════════════════════════════
-- CORRECTIF — les bornes de saison sont une UNION, jamais une intersection
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Regression introduite par la v17, trouvee en verifiant juste apres : le calendrier renvoyait
-- ZERO evenement.
--
-- Deux saisons sont actives en base (2026-2027 et 2027-2028). Je prenais max(date_debut) et
-- min(date_fin), c'est-a-dire leur INTERSECTION : du 01/07/2027 au 30/06/2027, une fenetre
-- inversee, donc vide. Tout le calendrier disparaissait en silence.
--
-- Les bornes doivent couvrir toutes les saisons actives : min(debut), max(fin). Et la fenetre ne
-- doit jamais pouvoir s'inverser, quel que soit le contenu de la table.

create or replace function public.club_calendrier(p_club_id uuid, p_du date, p_au date)
returns table (
  ref text, genre text, date_evenement date, heure_debut time, heure_fin time,
  titre text, equipe text, team_id uuid, adversaire text, domicile boolean,
  lieu text, competition text, score text, statut text, couverture text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with bornes as (
    select min(s.date_debut) as debut, max(s.date_fin) as fin
    from saisons s where s.active and s.date_debut is not null and s.date_fin is not null
  ),
  fenetre as (
    select greatest(p_du, coalesce((select debut from bornes), p_du)) as du,
           least(p_au, coalesce((select fin from bornes), p_au)) as au
  )

  select 'match:' || m.id::text, 'match', m.match_date, m.kickoff_time, null::time,
    coalesce(m.team,'Équipe') || ' — ' || coalesce(m.opponent,'?'),
    m.team, m.team_id, m.opponent, m.is_home, m.lieu, m.competition,
    nullif(btrim(coalesce(m.score,'')),''), coalesce(m.sport_status,'scheduled'),
    (select pp.statut from planned_presences pp
     where pp.match_id = m.id and coalesce(pp.statut,'prevu') <> 'annule' limit 1)
  from club_matches m, fenetre f
  where m.club_id = p_club_id and m.match_date between f.du and f.au

  union all

  select 'evenement:' || e.id::text, 'evenement', e.event_date, e.event_time, null::time,
    e.title, e.team, e.team_id, null, null, e.location, null, null,
    coalesce(e.type,'evenement'), null
  from club_calendar_events e, fenetre f
  where e.club_id = p_club_id and e.event_date between f.du and f.au

  union all

  select
    'entrainement:' || s.id::text || ':' || to_char(j.jour, 'YYYY-MM-DD'),
    'entrainement', j.jour::date,
    coalesce(x.heure_debut, s.heure_debut), coalesce(x.heure_fin, s.heure_fin),
    'Entraînement ' || coalesce(t.name,''), t.name, t.id, null, null,
    coalesce(vx.nom, v.nom), null, null,
    case when x.statut = 'annule' then 'annulee'
         when x.statut = 'modifie' then 'modifiee'
         else 'scheduled' end,
    null
  from club_team_training_slots s
  join club_teams t on t.id = s.team_id
  left join club_venues v on v.id = s.venue_id
  cross join fenetre f
  cross join lateral generate_series(f.du::timestamp, f.au::timestamp, interval '1 day') as j(jour)
  left join club_training_exceptions x on x.slot_id = s.id and x.date_seance = j.jour::date
  left join club_venues vx on vx.id = x.venue_id
  where t.club_id = p_club_id
    and not coalesce(t.archivee, false)
    and s.jour = (array['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'])
                   [extract(isodow from j.jour)::int]
    and (s.active_from is null or j.jour::date >= s.active_from)
    and (s.active_to is null or j.jour::date <= s.active_to)
$function$;

select 'OK — bornes de saison corrigees' as verdict;
