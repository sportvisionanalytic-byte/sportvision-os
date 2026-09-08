-- ═══════════════════════════════════════════════════════════════════════════════
-- Une séance d'entraînement appartient à UNE saison, pas à « une saison active quelque part »
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Question de Fouka : pourquoi un créneau 2026-2027 se projette-t-il en juillet 2027 ?
--
-- Réponse : parce que RIEN ne le rattache à une saison. Ni club_team_training_slots (pas de
-- colonne saison), ni club_teams.saison_id, qui existe mais est vide pour toutes les équipes. La
-- seule borne disponible était l'union des saisons actives — d'où le débordement. Et le jour où
-- 2028-2029 sera créée, elle ferait « revivre » les créneaux de 2026 jusqu'en 2029.
--
-- La règle devient une cascade, du plus précis au plus général :
--   1. la période d'activité du créneau (active_from / active_to), si renseignée ;
--   2. sinon la saison de SON équipe (club_teams.saison_id), si renseignée ;
--   3. sinon, et seulement sinon, la fenêtre demandée.
--
-- Aucune colonne nouvelle : les deux crochets existent déjà, ils n'étaient pas utilisés. Et un
-- niveau plus précis n'est jamais écrasé par un niveau plus général.
--
-- Les vacances de Noël restent du ressort de club_training_exceptions : une période continue ne
-- sait pas exprimer un trou au milieu.

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
    -- Union des saisons actives, jamais leur intersection (regression du 08/09) : avec deux
    -- saisons ouvertes, max(debut)/min(fin) donnait une fenetre inversee et un calendrier vide.
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
  left join saisons ts on ts.id = t.saison_id
  left join club_venues v on v.id = s.venue_id
  cross join fenetre f
  cross join lateral generate_series(f.du::timestamp, f.au::timestamp, interval '1 day') as j(jour)
  left join club_training_exceptions x on x.slot_id = s.id and x.date_seance = j.jour::date
  left join club_venues vx on vx.id = x.venue_id
  where t.club_id = p_club_id
    and not coalesce(t.archivee, false)
    and s.jour = (array['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'])
                   [extract(isodow from j.jour)::int]
    -- 1. La période du créneau prime sur tout le reste.
    and (s.active_from is null or j.jour::date >= s.active_from)
    and (s.active_to is null or j.jour::date <= s.active_to)
    -- 2. À défaut, la saison de son équipe. Une équipe sans saison ne borne rien : on ne devine
    --    pas à quelle saison appartient un créneau.
    and (s.active_from is not null or ts.date_debut is null or j.jour::date >= ts.date_debut)
    and (s.active_to is not null or ts.date_fin is null or j.jour::date <= ts.date_fin)
$function$;

select 'OK — les seances suivent la periode du creneau, sinon la saison de leur equipe' as verdict;
