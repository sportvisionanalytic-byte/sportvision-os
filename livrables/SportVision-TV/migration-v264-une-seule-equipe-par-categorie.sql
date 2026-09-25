-- v264 — Une seule équipe par catégorie de U6 à U12, à Villemomble (25/09/2026)
--
-- DÉCISION DE FOUKA : « Pas d'équipe U6 A B C mais une seule U6, une seule U7, etc. Un joueur qui
-- joue en A aujourd'hui peut jouer en B le lendemain. Et de toute façon les parents paient le
-- Pass, tout est redirigé vers eux. » Les féminines restent à part.
--
-- CE QUI A TRANCHÉ, ET CE N'EST PAS UN AVIS. En dessous de U14, la fédération ne publie RIEN :
-- zéro match officiel sur U6→U13, contre 344 de U14 à Seniors. Pas de championnat à cet âge, que
-- des plateaux. Les sous-équipes A/B/C/D n'existent donc que pour l'organisation interne du club,
-- et rien d'extérieur ne les connaît. À partir de U14 c'est l'inverse, et on n'y touche pas :
-- U14 D1 et U14 D4 ne jouent pas la même division.
--
-- LES FÉMININES NE FUSIONNENT PAS. U11 F et U12 F ne sont pas un niveau interne, c'est une
-- compétition distincte. Les fondre dans le groupe mixte mélangerait deux choses différentes.
--
-- LES PLATEAUX DEVIENNENT UN SEUL MATCH, et c'est voulu. Neuf journées voyaient les quatre
-- équipes d'une catégorie jouer le même adversaire à la même heure — c'est la définition d'un
-- plateau. Après fusion, « U10 Avenir vs Bussy FC », « U10 Élite vs Bussy FC »… deviennent « U10
-- vs Bussy FC ». Aucun de ces matchs ne porte de score : rien ne se perd.
--
-- RIEN N'EST SUPPRIMÉ. Les équipes fusionnées sont ARCHIVÉES, pas effacées : leur historique
-- reste lisible, et on peut revenir en arrière si le club change d'organisation.
--
-- Idempotente : relancée, elle ne trouve plus d'équipe à fusionner et ne fait rien.

do $$
declare
  -- Deux clubs, deux perimetres, decides par Fouka club par club : Villemomble jusqu'a U12,
  -- Fontainebleau jusqu'a U11. Ce n'est pas une regle generale, c'est l'organisation de chacun.
  v_clubs jsonb := jsonb_build_array(
    jsonb_build_object('id', 'f0d3bafa-3004-4831-bd85-249aa9af5c54',
                       'cats', jsonb_build_array('U6','U7','U8','U9','U10','U11','U12')),
    jsonb_build_object('id', '0ab96066-2ca5-4fb1-98eb-2204771ecf8d',
                       'cats', jsonb_build_array('U6','U7','U8','U9','U10','U11'))
  );
  v_entree jsonb;
  v_club uuid;
  v_cat  text;
  v_survivante uuid;
  v_autres uuid[];
  v_supprimes int := 0;
  v_deplaces int := 0;
begin
  -- ARCHIVER UNE EQUIPE EST PROTEGE, et c'est bien : le trigger proteger_existence_equipe refuse
  -- qu'un educateur fasse disparaitre une equipe. Il laisse passer le role de service, ce qu'une
  -- migration EST. On se declare donc pour ce qu'on est, plutot que de desactiver la protection
  -- le temps du passage — un trigger remis en place « apres » est un trigger qu'on oublie de
  -- remettre.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  for v_entree in select * from jsonb_array_elements(v_clubs) loop
  v_club := (v_entree->>'id')::uuid;
  for v_cat in select jsonb_array_elements_text(v_entree->'cats') loop

    -- L'équipe qui survit : celle qui porte déjà exactement le nom de la catégorie si elle
    -- existe, sinon la première par ordre alphabétique. Choix stable et reproductible, jamais
    -- au hasard — une migration qui choisit différemment à chaque exécution est intestable.
    select (array_agg(id order by (name = v_cat) desc, name))[1],
           array_remove(array_agg(id order by (name = v_cat) desc, name),
                        (array_agg(id order by (name = v_cat) desc, name))[1])
      into v_survivante, v_autres
    from club_teams
    where club_id = v_club and categorie = v_cat
      and coalesce(archivee, false) = false
      -- Le « F » isolé en fin de nom désigne les féminines. « U12 REG » n'est pas concerné.
      and name !~* '(^|[^a-z])f$';

    continue when v_survivante is null or coalesce(array_length(v_autres, 1), 0) = 0;

    -- ── Les matchs : on supprime d'abord ce qui entrerait en collision ──────────────────────
    -- L'index de repli de club_matches est (club_id, team_id, lower(opponent), match_date,
    -- kickoff_time). Quatre équipes d'une catégorie au même plateau produiraient quatre lignes
    -- identiques après fusion. On garde la plus ancienne, on retire les autres.
    with a_fusionner as (
      select id, lower(opponent) as adv, match_date, kickoff_time, created_at,
             row_number() over (partition by lower(opponent), match_date, kickoff_time
                                order by created_at, id) as rang
      from club_matches
      where club_id = v_club and (team_id = v_survivante or team_id = any(v_autres))
        and external_event_id is null
    )
    delete from club_matches m using a_fusionner f
     where m.id = f.id and f.rang > 1;
    get diagnostics v_supprimes = row_count;

    update club_matches set team_id = v_survivante, team = v_cat
     where club_id = v_club and team_id = any(v_autres);
    get diagnostics v_deplaces = row_count;

    -- ── Tout le reste suit l'équipe ────────────────────────────────────────────────────────
    -- Les tables à contrainte d'unicité sur (equipe, …) sont nettoyées avant d'être déplacées :
    -- sans ça, la mise à jour échouerait sur un doublon et annulerait toute la migration.
    delete from team_memberships a using team_memberships b
     where a.team_id = any(v_autres) and b.team_id = v_survivante
       and a.player_id = b.player_id and coalesce(a.saison,'') = coalesce(b.saison,'');
    update team_memberships set team_id = v_survivante where team_id = any(v_autres);

    delete from club_team_source_mappings a using club_team_source_mappings b
     where a.team_id = any(v_autres) and b.team_id = v_survivante
       and a.provider = b.provider and a.external_team_id = b.external_team_id;
    update club_team_source_mappings set team_id = v_survivante where team_id = any(v_autres);

    -- Deux equipes d'une meme categorie partagent evidemment leur creneau d'entrainement : elles
    -- s'entrainent ensemble. Trouve par l'essai en transaction annulee, sur le jeudi 17h30.
    delete from club_team_training_slots a using club_team_training_slots b
     where a.team_id = any(v_autres) and b.team_id = v_survivante
       and a.jour = b.jour and a.heure_debut = b.heure_debut
       and a.venue_id is not distinct from b.venue_id
       and a.active_from is not distinct from b.active_from
       and a.active_to is not distinct from b.active_to;
    -- Et entre elles : deux equipes archivees peuvent partager le meme creneau.
    delete from club_team_training_slots a using club_team_training_slots b
     where a.team_id = any(v_autres) and b.team_id = any(v_autres) and a.id > b.id
       and a.jour = b.jour and a.heure_debut = b.heure_debut
       and a.venue_id is not distinct from b.venue_id
       and a.active_from is not distinct from b.active_from
       and a.active_to is not distinct from b.active_to;

    update club_matches              set team_id = v_survivante where team_id = any(v_autres);
    update club_calendar_events      set team_id = v_survivante where team_id = any(v_autres);
    update club_bookings             set team_id = v_survivante where team_id = any(v_autres);
    update club_team_training_slots  set team_id = v_survivante where team_id = any(v_autres);
    update contenus                  set team_id = v_survivante where team_id = any(v_autres);
    update media_access_rules        set team_id = v_survivante where team_id = any(v_autres);
    update media_albums              set team_id = v_survivante where team_id = any(v_autres);
    update membership_requests       set team_id = v_survivante where team_id = any(v_autres);
    update player_invitations        set team_id = v_survivante where team_id = any(v_autres);
    update team_invite_codes         set team_id = v_survivante where team_id = any(v_autres);
    update team_projects             set team_id = v_survivante where team_id = any(v_autres);
    update season_membership_renewals set new_team_id = v_survivante where new_team_id = any(v_autres);

    -- ── L'équipe qui reste porte le nom de sa catégorie, les autres sont archivées ─────────
    update club_teams set name = v_cat, updated_at = now() where id = v_survivante;
    update club_teams set archivee = true, archivee_at = now(), updated_at = now()
     where id = any(v_autres);

    raise notice '% : % match(s) de plateau fusionne(s), % deplace(s), % equipe(s) archivee(s)',
      v_cat, v_supprimes, v_deplaces, array_length(v_autres, 1);
  end loop;
  end loop;
end $$;

-- Ce qui reste, pour lecture immédiate.
select c.nom as club, ct.categorie, count(*) as equipes_actives,
       string_agg(ct.name, ', ' order by ct.name) as noms
from club_teams ct join clubs c on c.id = ct.club_id
where ct.club_id in ('f0d3bafa-3004-4831-bd85-249aa9af5c54','0ab96066-2ca5-4fb1-98eb-2204771ecf8d')
  and coalesce(ct.archivee, false) = false
  and ct.categorie in ('U6','U7','U8','U9','U10','U11','U12','U13','U14')
group by c.nom, ct.categorie order by c.nom, ct.categorie;
