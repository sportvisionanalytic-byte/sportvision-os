-- ═══════════════════════════════════════════════════════════════════════════════
-- Bornes de saison, ET periode de validite propre aux creneaux d'entrainement
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Les dates de saison sont fournies par Fouka. Elles bornent le CALENDRIER, pas les
-- entrainements : une saison va du 1er juillet au 30 juin, mais personne ne s'entraine le
-- 15 juillet. Se servir des bornes de saison pour borner les seances reglerait le probleme de
-- juillet et en creerait un autre a Noel.
--
-- Les creneaux recoivent donc leur PROPRE periode d'activite. Deux colonnes nullables : rien ne
-- change pour les creneaux existants tant qu'elles ne sont pas renseignees, et le jour ou un club
-- dit « on s'entraine du 1er septembre au 15 juin », la projection le respecte.
--
-- Les exceptions ponctuelles (club_training_exceptions) restent le bon outil pour les vacances de
-- Noel : une periode d'activite ne sait pas exprimer un trou au milieu.

begin;

-- ── Les vraies bornes de la saison sportive ──────────────────────────────────
update saisons set date_debut = date '2026-07-01', date_fin = date '2027-06-30'
where label = '2026-2027';
update saisons set date_debut = date '2027-07-01', date_fin = date '2028-06-30'
where label = '2027-2028';

-- ── La periode d'activite d'un creneau ───────────────────────────────────────
alter table club_team_training_slots add column if not exists active_from date;
alter table club_team_training_slots add column if not exists active_to date;

comment on column club_team_training_slots.active_from is
  'Debut de la periode ou ce creneau produit des seances. NULL = des le debut de la saison affichee.';
comment on column club_team_training_slots.active_to is
  'Fin de cette periode. NULL = jusqu''a la fin de la saison affichee. Pour un trou au milieu (vacances), utiliser club_training_exceptions.';

-- ── La projection respecte les deux ──────────────────────────────────────────
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
    select coalesce(max(s.date_debut), p_du) as debut,
           coalesce(min(s.date_fin), p_au) as fin
    from saisons s where s.active and s.date_debut is not null and s.date_fin is not null
  ),
  fenetre as (
    select greatest(p_du, (select debut from bornes)) as du,
           least(p_au, (select fin from bornes)) as au
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
    -- La periode d'activite du creneau, quand elle est renseignee. Une borne absente ne borne
    -- rien : on ne suppose pas qu'un club s'entraine du 1er juillet au 30 juin.
    and (s.active_from is null or j.jour::date >= s.active_from)
    and (s.active_to is null or j.jour::date <= s.active_to)
$function$;

commit;

select label, date_debut, date_fin from saisons order by date_debut;
