-- L'espace du coach : il ne voit que son équipe (v158, 12/09/2026).
--
-- Demande de Fouka : « que les coachs voient bien leur truc de coach… ils voient leur calendrier à
-- eux… vraiment les infos qui concernent leur équipe ». Audit du 12/09 : matchs, événements,
-- joueurs, effectifs et galeries étaient déjà cloisonnés ; le CALENDRIER (la fonction lue par
-- l'écran) et les SÉANCES D'ENTRAÎNEMENT rendaient toutes les équipes du club.
--
-- Volontairement non restreints : la liste des noms d'équipes (nécessaire aux formulaires, aucune
-- donnée sensible), les actualités du club et le planning éditorial (espaces éditoriaux communs).
-- Décor fictif : un club, deux équipes, le coach n'en encadre qu'une. Tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('fefefefe-0000-0000-0000-000000000001','zz-audit-coach@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Audit Coach', 'partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Audit Coach', id, 'performance' from cli returning id)
  select (select id from clu) club_id, (select id from cli) client_id;
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('fefefefe-0000-0000-0000-0000000000c0','zz-audit-cm@example.invalid','',now(),'authenticated','authenticated') on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role, actif) values ('fefefefe-0000-0000-0000-0000000000c0','QA','CM audit','cm',true) on conflict (id) do nothing;
insert into club_teams (club_id, name) select club_id, n from ctx, (values ('ZZ Mienne'), ('ZZ Autre')) v(n);
insert into club_members (user_id, club_id, role, status, teams)
select 'fefefefe-0000-0000-0000-000000000001'::uuid, club_id, 'coach', 'actif', '["ZZ Mienne"]'::jsonb from ctx;
insert into club_matches (club_id, team, team_id, opponent, match_date, kickoff_time)
select ctx.club_id, t.name, t.id, 'Adv ' || t.name, current_date + 3, '15:00' from ctx join club_teams t on t.club_id = ctx.club_id;
insert into club_team_training_slots (team_id, jour, heure_debut, heure_fin)
select t.id, 'mardi', '18:00', '19:30' from ctx join club_teams t on t.club_id = ctx.club_id;
insert into club_calendar_events (club_id, title, type, event_date, team, team_id)
select ctx.club_id, 'Événement ' || t.name, 'tournoi', current_date + 5, t.name, t.id from ctx join club_teams t on t.club_id = ctx.club_id;
insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
select club_id, 'QA', 'Joueur Mienne', date '2012-01-01', 'sans_compte' from ctx union all
select club_id, 'QA', 'Joueur Autre', date '2012-01-01', 'sans_compte' from ctx;
insert into team_memberships (player_id, team_id, club_id, statut, saison)
select p.id, t.id, ctx.club_id, 'active', '2026-2027' from ctx
  join player_profiles p on p.club_id = ctx.club_id
  join club_teams t on t.club_id = ctx.club_id and ((p.nom = 'Joueur Mienne' and t.name = 'ZZ Mienne') or (p.nom = 'Joueur Autre' and t.name = 'ZZ Autre'));

create temp table res (source text, mienne int, autre int) on commit drop;
create or replace function pg_temp.mesure(p_source text, p_sql text) returns void language plpgsql as $$
declare m int; a int;
begin
  perform set_config('request.jwt.claims', '{"sub":"fefefefe-0000-0000-0000-000000000001","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    execute format(p_sql, 'ZZ Mienne') into m;
    execute format(p_sql, 'ZZ Autre') into a;
  exception when others then m := -1; a := -1; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into res values (p_source, m, a);
end $$;

select pg_temp.mesure('club_matches (table)', 'select count(*)::int from club_matches where club_id = ''' || (select club_id from ctx) || ''' and team = %L');
select pg_temp.mesure('club_calendar_events (table)', 'select count(*)::int from club_calendar_events where club_id = ''' || (select club_id from ctx) || ''' and team = %L');
select pg_temp.mesure('club_team_training_slots (table)', 'select count(*)::int from club_team_training_slots s join club_teams t on t.id = s.team_id where t.club_id = ''' || (select club_id from ctx) || ''' and t.name = %L');
select pg_temp.mesure('team_memberships (effectif)', 'select count(*)::int from team_memberships tm join club_teams t on t.id = tm.team_id where t.club_id = ''' || (select club_id from ctx) || ''' and t.name = %L');
select pg_temp.mesure('player_profiles (joueurs)', 'select count(*)::int from player_profiles p join team_memberships tm on tm.player_id = p.id join club_teams t on t.id = tm.team_id where p.club_id = ''' || (select club_id from ctx) || ''' and t.name = %L');
select pg_temp.mesure('club_calendrier (RPC, matchs)', 'select count(*)::int from club_calendrier(''' || (select club_id from ctx) || ''', current_date, current_date + 30) c where c.genre = ''match'' and c.equipe = %L');
select pg_temp.mesure('club_calendrier (RPC, entrainements)', 'select count(*)::int from club_calendrier(''' || (select club_id from ctx) || ''', current_date, current_date + 30) c where c.genre = ''entrainement'' and c.equipe = %L');
select pg_temp.mesure('club_teams (liste des équipes)', 'select count(*)::int from club_teams where club_id = ''' || (select club_id from ctx) || ''' and name = %L');

-- Contenus (planning éditorial), galeries, présences, actualités, médias, projets d'équipe.
insert into contenus (client_id, cm_id, titre, type_contenu, statut, date_prevue, team_id)
select ctx.client_id, 'fefefefe-0000-0000-0000-0000000000c0'::uuid, 'Contenu ' || t.name, 'visuel', 'brouillon', current_date + 2, t.id from ctx join club_teams t on t.club_id = ctx.club_id;
insert into media_albums (title, club_id, team_id, status, event_date, published_at)
select 'Galerie ' || t.name, ctx.club_id, t.id, 'published', current_date, now() from ctx join club_teams t on t.club_id = ctx.club_id;
insert into club_newsroom_items (club_id, title, type, status, team)
select ctx.club_id, 'Actu ' || t.name, 'Actualité', 'recu', t.name from ctx join club_teams t on t.club_id = ctx.club_id;

select pg_temp.mesure('contenus (planning éditorial)', 'select count(*)::int from contenus c join club_teams t on t.id = c.team_id where t.club_id = ''' || (select club_id from ctx) || ''' and t.name = %L');
select pg_temp.mesure('media_club_galleries (RPC)', 'select count(*)::int from media_club_galleries(''' || (select club_id from ctx) || ''') g where g.equipe = %L');
select pg_temp.mesure('club_newsroom_items (actualités)', 'select count(*)::int from club_newsroom_items n where n.club_id = ''' || (select club_id from ctx) || ''' and n.team = %L');

-- Ce qui doit être vu de SON équipe, et jamais de l'autre.
create temp table attendu (source text, mienne int, autre int) on commit drop;
insert into attendu values
  ('club_matches (table)', 1, 0),
  ('club_calendar_events (table)', 1, 0),
  ('club_team_training_slots (table)', 1, 0),
  ('club_calendrier (RPC, matchs)', 1, 0),
  -- 13/09/2026 — Un creneau hebdomadaire du mardi donne 4 OU 5 occurrences sur une fenetre de
  -- 30 jours, selon le jour ou le test tourne. Ce nombre exact ne disait rien du cloisonnement,
  -- qui est le sujet de ce test : on verifie que le coach voit les siens et zero des autres.
  ('club_calendrier (RPC, entrainements)', -1, 0),
  ('team_memberships (effectif)', 1, 0),
  ('player_profiles (joueurs)', 1, 0),
  ('media_club_galleries (RPC)', 1, 0),
  -- 14/09/2026 — Attendu 0/0 jusqu'ici, non par cloisonnement voulu mais par effet de bord : la
  -- policy du club masquait les brouillons, et ce test n'insère que des brouillons. La v230 ouvre
  -- le planning au club sur demande de Fouka (« je veux qu'il voie les brouillons »). Le planning
  -- éditorial rejoint donc les actualités : un espace ÉDITORIAL COMMUN, que tout le club lit, et
  -- qui n'a jamais été découpé par équipe. Le cloisonnement du coach porte sur ce qui est propre à
  -- son équipe (matchs, effectif, joueurs, galeries) et reste vérifié ligne par ligne ci-dessus.
  ('contenus (planning éditorial)', 1, 1),
  ('club_teams (liste des équipes)', 1, 1),
  ('club_newsroom_items (actualités)', 1, 1);

-- `mienne = -1` signifie « au moins un, le nombre exact depend du calendrier ».
select case when (case when a.mienne = -1 then r.mienne > 0 else r.mienne = a.mienne end)
             and r.autre = a.autre then '✅' else '❌' end as ok,
       r.source as controle,
       'sienne ' || (case when a.mienne = -1 then 'au moins 1' else a.mienne::text end) || ' / autre ' || a.autre as attendu,
       'sienne ' || r.mienne || ' / autre ' || r.autre as obtenu
  from res r join attendu a on a.source = r.source
 order by r.source;
rollback;
