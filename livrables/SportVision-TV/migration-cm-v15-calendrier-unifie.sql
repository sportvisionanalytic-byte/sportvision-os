-- ═══════════════════════════════════════════════════════════════════════════════
-- VAGUE B — Le calendrier unifié devient la source unique
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Trois choses vivaient jusqu'ici séparément : les matchs (club_matches), les créneaux
-- d'entraînement (club_team_training_slots, des règles hebdomadaires) et les événements club
-- (club_calendar_events). Chaque écran les recomposait à sa façon — le tableau de bord projetait
-- déjà les créneaux dans son coin. Deux projections finissent toujours par diverger.
--
-- Désormais une seule fonction, club_calendrier(club, du, au), les agrège. Le tableau de bord
-- l'appelle comme l'écran calendrier : par construction, ils ne peuvent plus différer.
--
-- ── Les entraînements ne sont PAS matérialisés ──
-- Un créneau « U16, jeudi, 19h45-21h » reste UNE ligne. La fonction génère les occurrences de la
-- période demandée. Créer 80 séances en base ferait payer chaque changement d'horaire 80 fois, et
-- rendrait le calendrier faux dès qu'un créneau bouge.
--
-- ── Chaque occurrence a une référence stable ──
-- « entrainement:<slot_id>:<AAAA-MM-JJ> ». Elle permet de désigner LA séance du 12/11/2026 sans
-- qu'elle existe comme ligne. C'est ce qui rendra possible, en vague C, « SportVision sera présent
-- à cet entraînement » sans que ça vaille pour tous les jeudis de la saison.

begin;

-- ── Les exceptions : ce qui déroge à la règle hebdomadaire ────────────────────
create table if not exists public.club_training_exceptions (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references club_team_training_slots(id) on delete cascade,
  date_seance date not null,
  statut text not null default 'annule' check (statut in ('annule','modifie')),
  -- Renseignés uniquement pour 'modifie' : une séance déplacée d'une heure ou de terrain.
  heure_debut time,
  heure_fin time,
  venue_id uuid references club_venues(id) on delete set null,
  motif text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Une seule dérogation par séance : sinon on ne saurait pas laquelle appliquer.
  unique (slot_id, date_seance)
);

alter table public.club_training_exceptions enable row level security;

-- Lecture pour qui voit le club, écriture pour qui le prépare : même moteur que partout ailleurs.
drop policy if exists cte_lecture on club_training_exceptions;
create policy cte_lecture on club_training_exceptions for select to authenticated
  using (exists (select 1 from club_team_training_slots s
                 join club_teams t on t.id = s.team_id
                 where s.id = slot_id and (is_club_member(t.club_id) or peut_preparer_club(t.club_id))));

drop policy if exists cte_ecriture on club_training_exceptions;
create policy cte_ecriture on club_training_exceptions for all to authenticated
  using (exists (select 1 from club_team_training_slots s
                 join club_teams t on t.id = s.team_id
                 where s.id = slot_id and peut_preparer_club(t.club_id)))
  with check (exists (select 1 from club_team_training_slots s
                      join club_teams t on t.id = s.team_id
                      where s.id = slot_id and peut_preparer_club(t.club_id)));

drop policy if exists cm_perim_club_training_exceptions on club_training_exceptions;
create policy cm_perim_club_training_exceptions on club_training_exceptions as restrictive for all to authenticated
  using (not est_cm_cloisonne() or exists (
    select 1 from club_team_training_slots s join club_teams t on t.id = s.team_id
    where s.id = slot_id and t.club_id in (select cm_clubs_autorises())))
  with check (not est_cm_cloisonne() or exists (
    select 1 from club_team_training_slots s join club_teams t on t.id = s.team_id
    where s.id = slot_id and t.club_id in (select cm_clubs_autorises())));

-- ── La source unique ─────────────────────────────────────────────────────────
create or replace function public.club_calendrier(p_club_id uuid, p_du date, p_au date)
returns table (
  ref text,
  genre text,
  date_evenement date,
  heure_debut time,
  heure_fin time,
  titre text,
  equipe text,
  team_id uuid,
  adversaire text,
  domicile boolean,
  lieu text,
  competition text,
  score text,
  statut text,
  couverture text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with bornes as (
    -- Une saison sans dates ne borne rien : on n'invente pas un 1er juillet qui n'est écrit nulle
    -- part. Elle borne dès que le club renseigne date_debut/date_fin.
    select coalesce(max(s.date_debut), p_du) as debut,
           coalesce(min(s.date_fin), p_au) as fin
    from saisons s where s.active and s.date_debut is not null and s.date_fin is not null
  ),
  fenetre as (
    select greatest(p_du, (select debut from bornes)) as du,
           least(p_au, (select fin from bornes)) as au
  )

  -- ── Matchs ──
  select
    'match:' || m.id::text,
    'match',
    m.match_date,
    m.kickoff_time,
    null::time,
    coalesce(m.team,'Équipe') || ' — ' || coalesce(m.opponent,'?'),
    m.team, m.team_id, m.opponent, m.is_home, m.lieu, m.competition,
    nullif(btrim(coalesce(m.score,'')),''),
    coalesce(m.sport_status,'scheduled'),
    (select pp.statut from planned_presences pp
     where pp.match_id = m.id and coalesce(pp.statut,'prevu') <> 'annule' limit 1)
  from club_matches m, fenetre f
  where m.club_id = p_club_id and m.match_date between f.du and f.au

  union all

  -- ── Événements du club ──
  select
    'evenement:' || e.id::text,
    'evenement',
    e.event_date,
    e.event_time,
    null::time,
    e.title,
    e.team, e.team_id, null, null, e.location, null, null,
    coalesce(e.type,'evenement'),
    null
  from club_calendar_events e, fenetre f
  where e.club_id = p_club_id and e.event_date between f.du and f.au

  union all

  -- ── Entraînements : projection des règles hebdomadaires, occurrence par occurrence ──
  select
    'entrainement:' || s.id::text || ':' || to_char(j.jour, 'YYYY-MM-DD'),
    'entrainement',
    j.jour::date,
    coalesce(x.heure_debut, s.heure_debut),
    coalesce(x.heure_fin, s.heure_fin),
    'Entraînement ' || coalesce(t.name,''),
    t.name, t.id, null, null,
    coalesce(vx.nom, v.nom),
    null, null,
    case when x.statut = 'annule' then 'annulee'
         when x.statut = 'modifie' then 'modifiee'
         else 'scheduled' end,
    null
  from club_team_training_slots s
  join club_teams t on t.id = s.team_id
  left join club_venues v on v.id = s.venue_id
  cross join fenetre f
  -- generate_series borne la projection à la fenêtre demandée : aucune séance ne peut naître
  -- hors des dates réclamées, ni hors saison quand la saison est bornée.
  cross join lateral generate_series(f.du::timestamp, f.au::timestamp, interval '1 day') as j(jour)
  left join club_training_exceptions x on x.slot_id = s.id and x.date_seance = j.jour::date
  left join club_venues vx on vx.id = x.venue_id
  where t.club_id = p_club_id
    and not coalesce(t.archivee, false)
    and s.jour = (array['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'])
                   [extract(isodow from j.jour)::int]
    -- Une séance annulée reste VISIBLE, barrée : la masquer ferait croire qu'elle n'a jamais
    -- existé, et personne ne comprendrait pourquoi le jeudi a disparu.
$function$;

comment on function public.club_calendrier(uuid, date, date) is
  'Source unique du calendrier d''un club : matchs, evenements et occurrences d''entrainement projetees depuis les creneaux hebdomadaires. Reference stable par occurrence (entrainement:<slot>:<date>).';

commit;

select 'OK — calendrier unifie en place' as verdict;
