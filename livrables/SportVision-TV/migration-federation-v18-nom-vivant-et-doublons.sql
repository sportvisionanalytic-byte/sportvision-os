-- Le calendrier affiche le nom VIVANT de l'equipe, et les derniers doublons Excel/federal partent.
--
-- ═══ 1. Le nom d'equipe etait fige ═══
-- Constate juste apres avoir uniformise la casse : le calendrier affichait toujours
-- « U10 ELITE » alors que l'equipe s'appelle desormais « U10 Élite ». La branche « match » de
-- club_calendrier rendait `m.team`, le libelle recopie au moment de l'import, et non le nom de
-- l'equipe rattachee. Renommer une equipe ne changeait donc rien a ce qu'on lit.
--
-- On prend maintenant le nom de l'equipe quand le match lui est rattache, et on ne retombe sur le
-- libelle d'origine que pour les matchs sans equipe — ou il est la seule indication disponible.
--
-- ═══ 2. Douze doublons Excel/federal restants ═══
-- Le nettoyage precedent comparait les sept premiers caracteres du nom de l'adversaire. Il ne
-- pouvait pas voir que « JS Suresnes » et « Suresnes JS Seniors F 1 » sont le meme club, ni
-- « Etoile Bobigny » et « Bobigny Etoile Seniors 1 ».
--
-- On rapproche desormais sur un mot SIGNIFICATIF — le nom de la commune ou du club — en ecartant
-- les mots generiques. Sans cet ecart, « Seniors » suffisait a rapprocher deux adversaires
-- differents du meme jour, et on aurait supprime un vrai match.
--
-- Verifie avant ecriture : aucune des douze lignes ne porte de score, de contenu, d'homme du
-- match ni d'operateur affecte. Seule la ligne du fichier Excel part ; la version federale porte
-- un identifiant stable, la competition et l'ecusson de l'adversaire.
--
-- Un doublon reste connu et NON traite : « Stade de l'est » / « Stade Est Pavillon Seniors 1 » le
-- 20/09. Les deux noms ne partagent que le mot « stade », qui est generique. L'elargir pour
-- l'attraper reviendrait a rapprocher tous les « Stade X » entre eux. Mieux vaut manquer un
-- doublon que supprimer un vrai match.

begin;

with generiques(mot) as (values ('seniors'),('senior'),('feminines'),('feminine'),('veterans'),('anciens'),('fc'),('as'),('us'),('cs'),('sc'),('es'),('ac'),('js'),('csl'),('esp'),('rc'),('uf'),('club'),('sports'),('sport'),('football'),('stade'),('academie'),('de'),('la'),('le'),('les'),('du'),('des'),('saint'),('sur'),('sous'),('u6'),('u7'),('u8'),('u9'),('u10'),('u11'),('u12'),('u13'),('u14'),('u15'),('u16'),('u17'),('u18'),('u19')),
mots as (
  select id, team_id, match_date, provider,
         string_to_array(lower(unaccent(regexp_replace(opponent, '[^a-zA-Z ]', ' ', 'g'))), ' ') w
    from club_matches
   where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and team_id is not null
),
a_supprimer as (
  select a.id from mots a
   where a.provider = 'OTHER'
     and exists (
       select 1 from mots b
        where b.team_id = a.team_id and b.match_date = a.match_date
          and b.id <> a.id and b.provider = 'SPORTCORICO'
          and exists (
            select 1 from unnest(a.w) x join unnest(b.w) y on x = y
             where length(x) > 3 and x not in (select mot from generiques)
          )
     )
)
delete from public.club_matches where id in (select id from a_supprimer);

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
    coalesce(mt.name, m.team, 'Équipe') || ' — ' || coalesce(m.opponent,'?'),
    coalesce(mt.name, m.team), m.team_id, m.opponent, m.is_home, m.lieu, m.competition,
    nullif(btrim(coalesce(m.score,'')),''), coalesce(m.sport_status,'scheduled'),
    (select pp.statut from planned_presences pp
     where pp.match_id = m.id and coalesce(pp.statut,'prevu') <> 'annule' limit 1),
    -- L'ecusson n'est PAS copie sur le match : il est resolu par le slug du club adverse. Ainsi
    -- remplacer un ecusson dans l'annuaire met a jour tous les matchs d'un coup, au lieu de
    -- laisser 344 copies d'une URL peu a peu perimee.
    (select fc.logo_url from federation_clubs fc
      where fc.slug = m.opponent_club_slug and fc.logo_url is not null limit 1)
  from club_matches m
  left join club_teams mt on mt.id = m.team_id
  cross join fenetre f
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
  'Calendrier unifié d''un club : matchs, événements et entraînements projetés, sur une fenêtre bornée par les saisons actives. La ligne d''un match porte l''écusson de l''adversaire (v17) et le nom VIVANT de l''équipe rattachée, pas le libellé figé à l''import (v18).';

commit;
