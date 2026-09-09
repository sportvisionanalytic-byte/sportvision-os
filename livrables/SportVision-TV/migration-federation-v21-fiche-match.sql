-- Le calendrier expose de quoi faire une vraie fiche match.
--
-- Fouka, 09/09/2026 : « le panneau detail du match est encore trop pauvre et trop technique. On a
-- bien l'evenement, mais on ne ressent pas assez le match. »
--
-- Le panneau ne pouvait pas faire mieux : il n'avait pas la matiere. Il recevait un titre, une
-- date, un lieu et un statut brut. Pas de type de couverture, pas de buteur, pas d'homme du match.
--
-- On n'ajoute AUCUNE donnee : les cinq colonnes existent deja dans club_matches et
-- planned_presences. On les fait simplement remonter jusqu'a l'ecran, dans la meme requete —
-- les chercher separement couterait une requete par match ouvert, pour afficher deux mots.
--
-- Les elements de resultat sont vides chez tous les clubs au 09/09/2026, la saison vient de
-- commencer. La fiche les masque tant qu'ils le sont ; les exposer maintenant evite d'y revenir a
-- la premiere feuille de match remplie.
--
-- La fonction est RECREEE et non remplacee : ajouter des colonnes de sortie change sa signature.
-- Sa definition est reprise telle qu'elle est en base, aux colonnes pres.

begin;

drop function if exists public.club_calendrier(uuid, date, date);

CREATE OR REPLACE FUNCTION public.club_calendrier(p_club_id uuid, p_du date, p_au date)
 RETURNS TABLE(ref text, genre text, date_evenement date, heure_debut time without time zone, heure_fin time without time zone, titre text, equipe text, team_id uuid, adversaire text, domicile boolean, lieu text, competition text, score text, statut text, couverture text, adversaire_logo text, type_couverture text, buteurs text, passeurs text, homme_du_match text, cartons text)
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
    coalesce(mt.name, m.team, 'Équipe') || ' — ' || coalesce(m.opponent,'?'),
    coalesce(mt.name, m.team), m.team_id, m.opponent, m.is_home, m.lieu, m.competition,
    nullif(btrim(coalesce(m.score,'')),''), coalesce(m.sport_status,'scheduled'),
    (select pp.statut from planned_presences pp
     where pp.match_id = m.id and coalesce(pp.statut,'prevu') <> 'annule' limit 1),
    -- L'ecusson n'est PAS copie sur le match : il est resolu par le slug du club adverse. Ainsi
    -- remplacer un ecusson dans l'annuaire met a jour tous les matchs d'un coup, au lieu de
    -- laisser 344 copies d'une URL peu a peu perimee.
    (select fc.logo_url from federation_clubs fc
      where fc.slug = m.opponent_club_slug and fc.logo_url is not null limit 1),
    -- Le TYPE de couverture (photo, video, les deux) vient de la meme ligne que son statut : les
    -- separer obligerait l'ecran a une requete de plus par match pour afficher deux mots.
    (select pp.type_couverture from planned_presences pp
     where pp.match_id = m.id and coalesce(pp.statut,'prevu') <> 'annule' limit 1),
    -- Elements de resultat. Vides pour l'instant chez tous les clubs (aucun match joue au
    -- 09/09/2026) : la fiche les masque tant qu'ils le sont, plutot que d'afficher des sections
    -- creuses. Les exposer maintenant evite d'y revenir a la premiere feuille de match remplie.
    nullif(btrim(coalesce(m.scorers,'')),''),
    nullif(btrim(coalesce(m.assists,'')),''),
    nullif(btrim(coalesce(m.man_of_match,'')),''),
    nullif(btrim(coalesce(m.cards,'')),'')
  from club_matches m
  left join club_teams mt on mt.id = m.team_id
  cross join fenetre f
  where m.club_id = p_club_id and m.match_date between f.du and f.au

  union all

  select 'evenement:' || e.id::text, 'evenement', e.event_date, e.event_time, null::time,
    e.title, e.team, e.team_id, null, null, e.location, null, null,
    coalesce(e.type,'evenement'), null, null, null, null, null, null, null
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
    null,
    -- Un entrainement peut etre couvert : son type l'accompagne, comme pour un match.
    (select pp.type_couverture from planned_presences pp
      where pp.occurrence_ref = 'entrainement:' || s.id::text || ':' || to_char(j.jour,'YYYY-MM-DD')
        and coalesce(pp.statut,'prevu') <> 'annule' limit 1),
    null, null, null, null
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
  'Calendrier unifié d''un club : matchs, événements et entraînements projetés, sur une fenêtre bornée par les saisons actives. Porte de quoi afficher une fiche complète sans requête supplémentaire — écusson de l''adversaire (v17), nom vivant de l''équipe (v18), type de couverture et éléments de résultat (v21).';

commit;
