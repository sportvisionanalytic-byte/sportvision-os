-- L'ecusson de l'adversaire, jusqu'au calendrier.
--
-- Fouka, 09/09/2026 : « recupere meme les logos des club adverse ca peut faire bien ». Les 74
-- ecussons sont dans le bucket depuis hier, mais rien ne les reliait a un match : au moment de
-- l'import on gardait le NOM du club adverse, pas son identifiant. « Clichois UF U14 2 » ne
-- permet pas de retrouver « clichois-uf » sans un rapprochement approximatif qu'on ne veut pas
-- faire a chaque affichage.
--
-- On ajoute donc l'identifiant, et on resout l'ecusson par jointure sur l'annuaire plutot que de
-- copier l'URL sur chaque match : remplacer un ecusson met alors a jour tous les matchs d'un
-- coup, au lieu de laisser des centaines de copies se perimer une a une.
--
-- La fonction club_calendrier est RECREEE et non remplacee : ajouter une colonne de sortie change
-- sa signature, ce que CREATE OR REPLACE refuse. Sa definition est reprise telle qu'elle est en
-- base, a la colonne pres — la reecrire de memoire, c'est perdre une clause qu'on ne remarquera
-- que le jour ou un calendrier se videra.

begin;

alter table public.club_matches add column if not exists opponent_club_slug text;

comment on column public.club_matches.opponent_club_slug is
  'Identifiant du club adverse dans federation_clubs. Sert a resoudre son ecusson, et rien d''autre : le nom affiche reste `opponent`, tel que la source l''ecrit.';

create index if not exists idx_club_matches_opponent_slug
  on public.club_matches (opponent_club_slug) where opponent_club_slug is not null;

drop function if exists public.club_calendrier(uuid, date, date);

CREATE OR REPLACE FUNCTION public.club_calendrier(p_club_id uuid, p_du date, p_au date)
 RETURNS TABLE(ref text, genre text, date_evenement date, heure_debut time without time zone, heure_fin time without time zone, titre text, equipe text, team_id uuid, adversaire text, domicile boolean, lieu text, competition text, score text, statut text, couverture text, adversaire_logo text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
     where pp.match_id = m.id and coalesce(pp.statut,'prevu') <> 'annule' limit 1),
    -- L'ecusson n'est PAS copie sur le match : il est resolu par le slug du club adverse. Ainsi
    -- remplacer un ecusson dans l'annuaire met a jour tous les matchs d'un coup, au lieu de
    -- laisser 344 copies d'une URL peu a peu perimee.
    (select fc.logo_url from federation_clubs fc
      where fc.slug = m.opponent_club_slug and fc.logo_url is not null limit 1)
  from club_matches m, fenetre f
  where m.club_id = p_club_id and m.match_date between f.du and f.au

  union all

  select 'evenement:' || e.id::text, 'evenement', e.event_date, e.event_time, null::time,
    e.title, e.team, e.team_id, null, null, e.location, null, null,
    coalesce(e.type,'evenement'), null, null
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
    -- La couverture d'une SEANCE se retrouve par sa reference d'occurrence : c'est tout l'objet
    -- de cette reference. Sans cette ligne, une couverture posee sur un entrainement existait en
    -- base mais restait invisible au calendrier (constate en cliquant pour de vrai, 08/09/2026).
    (select pp.statut from planned_presences pp
     where pp.occurrence_ref = 'entrainement:' || s.id::text || ':' || to_char(j.jour,'YYYY-MM-DD')
       and coalesce(pp.statut,'prevu') <> 'annule' limit 1),
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


comment on function public.club_calendrier(uuid, date, date) is
  'Calendrier unifié d''un club : matchs, événements et entraînements projetés, sur une fenêtre bornée par les saisons actives. Depuis v17, la ligne d''un match porte aussi l''écusson de l''adversaire, résolu depuis federation_clubs par opponent_club_slug.';

commit;
