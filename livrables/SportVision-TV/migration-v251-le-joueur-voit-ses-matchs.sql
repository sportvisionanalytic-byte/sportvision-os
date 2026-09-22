-- v251 — Le joueur voit les matchs de son équipe (22/09/2026)
--
-- LE PROBLÈME, constaté en ouvrant l'application avec un vrai compte joueur de SF Villemomble :
-- calendrier vide, alors que le club porte 409 matchs. Les matchs importés de la fédération
-- gardent le nom d'équipe de la fédération (« U18 1 »), pendant que le club nomme ses équipes à
-- sa façon (« U18 R3 »). Les deux règles de lecture de la famille comparaient précisément ces
-- deux noms :
--
--   cma_family_select  : club_teams.name = club_matches.team
--   ccal_family_select : club_teams.name = club_calendar_events.team
--
-- Mesure faite avant d'écrire une ligne : 670 matchs en base, 665 avec un team_id valide et du
-- bon club, 244 seulement avec un nom qui correspond. Autrement dit, deux matchs sur trois
-- étaient invisibles pour les familles, sans erreur, sans message, sans trace.
--
-- LE CORRECTIF. Quand le match porte un team_id, c'est lui qui fait foi — c'est l'identifiant,
-- pas une chaîne de caractères saisie par deux systèmes différents. Le chemin par le nom est
-- conservé pour les lignes sans team_id, qui existent encore (5 matchs).
--
-- CE QUI NE CHANGE PAS : le périmètre. Une famille ne voit que les équipes dont elle fait partie
-- (is_family_of_team), jamais le club entier. On répare la correspondance, on n'élargit rien.
--
-- Vérification : tests/joueur-voit-ses-matchs.test.sql (rouge avant, vert après).

begin;

drop policy if exists cma_family_select on club_matches;
create policy cma_family_select on club_matches
  for select to authenticated
  using (
    case
      when team_id is not null then is_family_of_team(team_id)
      else exists (
        select 1 from club_teams ct
        where ct.club_id = club_matches.club_id
          and ct.name = club_matches.team
          and is_family_of_team(ct.id)
      )
    end
  );

drop policy if exists ccal_family_select on club_calendar_events;
create policy ccal_family_select on club_calendar_events
  for select to authenticated
  using (
    case
      when team_id is not null then is_family_of_team(team_id)
      else exists (
        select 1 from club_teams ct
        where ct.club_id = club_calendar_events.club_id
          and ct.name = club_calendar_events.team
          and is_family_of_team(ct.id)
      )
    end
  );

-- ccal_player_select porte la même comparaison par le nom, en second filtre d'une règle qui
-- vérifie d'abord que la personne est bien de ce club. Même correction, même périmètre.
drop policy if exists ccal_player_select on club_calendar_events;
create policy ccal_player_select on club_calendar_events
  for select to authenticated
  using (
    exists (
      select 1 from player_profiles pp
      where pp.club_id = club_calendar_events.club_id
        and pp.account_status <> 'retire'
        and (pp.user_id = auth.uid() or is_confirmed_parent_of(pp.id))
    )
    and (
      case
        when team_id is not null then is_family_of_team(team_id)
        when team is null then true
        else exists (
          select 1 from club_teams ct
          where ct.club_id = club_calendar_events.club_id
            and ct.name = club_calendar_events.team
            and is_family_of_team(ct.id)
        )
      end
    )
  );

commit;
