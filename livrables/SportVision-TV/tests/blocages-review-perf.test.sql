-- Point 5 de l'audit Review du 11/09/2026 : coût des lectures RLS des widgets Club+, par rôle,
-- AVANT puis APRÈS migration-blocages-review-3, dans la même transaction annulée.
--
-- POURQUOI UN VOLUME INJECTÉ. Villeneuve 340 SC est trop petit pour que le coût se voie (226
-- événements, quelques lignes ailleurs) : par le chemin réel, rien ne dépasse 0,9 s. Le 57014 de
-- Review vient d'un coût LINÉAIRE en nombre de lignes. On injecte donc dans Villeneuve 340 SC, le
-- temps de la transaction, un volume proche de Review (30 équipes, 400 joueurs dont 200 avec un
-- parent confirmé, 800 événements, 150 actualités, demandes, créations, matchs et contenus), puis
-- on incarne chaque rôle comme sous PostgREST et on chronomètre les requêtes des écrans.
--
-- CE QUE LE TEST AFFIRME.
--   - Aucun rôle ne lit une ligne de plus ou de moins après la migration (aucun changement de droits).
--   - Sur les tables dont la policy appelle peut_operer_club à chaque ligne (actualités, créations,
--     matchs, calendrier), le temps cumulé des rôles hors CM SportVision est au moins divisé par 2.
-- Le détail avant/après par requête et par rôle est rendu dans la dernière colonne.
--
--   AVEC_MIGRATION=1 SEULEMENT=PERF node livrables/SportVision-TV/tests/blocages-review.test.mjs
--
-- Rien ne subsiste : rollback final. Villeneuve 340 SC uniquement.

begin;
set local statement_timeout = '170s';

create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $i$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p::text, 'role', 'authenticated')::text, true);
end $i$;
create or replace function pg_temp.hors() returns void language plpgsql as $i$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $i$;
create temp table ids (k text primary key, v uuid) on commit drop;
create temp table mesures (phase text, qui text, requete text, ms numeric, lignes int, err text) on commit drop;
create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant all on ids, mesures, verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;

-- ── Volume et personnes ───────────────────────────────────────────────────────────────────────
do $$
declare
  v_club uuid; v_client uuid; v_saison text; u uuid; r text; i int; t uuid; pl uuid; par uuid;
  v_teams uuid[]; v_noms text[]; v_cm_contenus uuid;
begin
  perform pg_temp.hors();
  select id, portail_client_id, saison into v_club, v_client, v_saison from clubs where nom = 'Villeneuve 340 SC';
  if v_club is null or v_client is null then raise exception 'club de test introuvable ou sans client'; end if;
  insert into ids values ('_club', v_club), ('_client', v_client);
  for i in 1..30 loop
    insert into club_teams (club_id, name) values (v_club, 'ZZ Perf ' || lpad(i::text, 2, '0')) returning id into t;
    v_teams := v_teams || t; v_noms := v_noms || ('ZZ Perf ' || lpad(i::text, 2, '0'));
  end loop;
  for i in 1..400 loop
    insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
      values (v_club, 'ZZ', 'Perf ' || i, '2012-01-01', 'actif') returning id into pl;
    insert into team_memberships (player_id, team_id, club_id, saison, statut)
      values (pl, v_teams[1 + (i % 30)], v_club, v_saison, 'active');
    if i % 2 = 0 then
      u := gen_random_uuid();
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
        values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-perf-parent-' || u || '@example.invalid', '', now(), now(), now());
      insert into parent_profiles (user_id, prenom, nom) values (u, 'ZZ', 'Parent perf') returning id into par;
      insert into parent_player_relationships (parent_id, player_id, statut) values (par, pl, 'confirme');
    end if;
    if i % 3 = 0 then
      insert into membership_requests (club_id, team_id, player_id, source, statut)
        values (v_club, v_teams[1 + (i % 30)], pl, 'code_equipe', 'a_verifier');
    end if;
  end loop;
  for i in 1..800 loop
    insert into club_calendar_events (club_id, title, event_date, team, team_id, type)
      values (v_club, 'ZZ Perf evt ' || i, current_date + (i % 200), v_noms[1 + (i % 30)], v_teams[1 + (i % 30)], 'tournoi');
  end loop;
  -- Un CM existant signe les contenus (contenus.cm_id est obligatoire) ; aucun n'est modifié.
  select id into v_cm_contenus from profiles where role = 'cm' order by created_at limit 1;
  for i in 1..150 loop
    insert into club_requests (club_id, type, status, team) values (v_club, 'post', 'recues', v_noms[1 + (i % 30)]);
    insert into club_newsroom_items (club_id, title, type, status, team) values (v_club, 'ZZ Perf actu ' || i, 'Actualité', 'recu', v_noms[1 + (i % 30)]);
    insert into club_creations (club_id, title, type, status, team) values (v_club, 'ZZ Perf création ' || i, 'post', 'a_valider', v_noms[1 + (i % 30)]);
    insert into club_matches (club_id, team, team_id, opponent, match_date) values (v_club, v_noms[1 + (i % 30)], v_teams[1 + (i % 30)], 'ZZ Adversaire ' || i, current_date + (i % 150));
    insert into contenus (client_id, cm_id, titre, statut) values (v_client, v_cm_contenus, 'ZZ Perf contenu ' || i, 'valide');
  end loop;

  foreach r in array array['admin', 'president', 'coach', 'secretaire', 'tresorier', 'comm', 'cm_externe', 'directeur_sportif', 'lecture_seule'] loop
    u := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-perf-' || replace(r, '_', '') || '-' || u || '@example.invalid', '', now(), now(), now());
    insert into club_members (club_id, user_id, role, status, prenom, nom, teams)
      values (v_club, u, r, 'actif', 'ZZ', 'Perf ' || r,
              case when r in ('coach', 'directeur_sportif') then jsonb_build_array(v_noms[1]) else '[]'::jsonb end);
    insert into ids values (r, u);
  end loop;
  u := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-perf-cm-' || u || '@example.invalid', '', now(), now(), now());
  insert into profiles (id, role, prenom, nom, email, actif) values (u, 'cm', 'ZZ', 'CM perf', 'zz-perf-cm-' || u || '@example.invalid', true);
  insert into club_cm_affectations (club_id, cm_id, role, actif) values (v_club, u, 'principal', true);
  insert into ids values ('cm_sportvision', u);
end $$;

-- Statistiques à jour pour le volume injecté (annulées avec le reste par le rollback).
analyze club_teams; analyze player_profiles; analyze team_memberships; analyze parent_profiles;
analyze parent_player_relationships; analyze membership_requests; analyze club_calendar_events;
analyze club_requests; analyze club_newsroom_items; analyze club_creations; analyze club_matches;
analyze contenus; analyze club_members;

-- Les requêtes des écrans (mêmes tables, mêmes filtres que Club+).
create or replace function pg_temp.mesurer(p_phase text) returns void language plpgsql as $m$
declare
  p record; q record; t0 timestamptz; n int; essai int; best numeric;
  c uuid := (select v from ids where k = '_club');
  cl uuid := (select v from ids where k = '_client');
begin
  for p in select k, v from ids where k not like '\_%' order by k loop
    perform pg_temp.incarner(p.v);
    for q in select * from (values
      ('actualités (newsroom)', format('select id, team, type, title, status from club_newsroom_items where club_id = %L', c)),
      ('créations à valider (tableau de bord)', format('select id, title, team from club_creations where club_id = %L and status = ''a_valider''', c)),
      ('matchs du club (tableau de bord)', format('select id, team, opponent, match_date from club_matches where club_id = %L', c)),
      ('calendrier, lecture directe', format('select id from club_calendar_events where club_id = %L', c)),
      ('équipes', format('select id, name, categorie, categories, coach, members from club_teams where club_id = %L and (archivee is null or archivee is false)', c)),
      ('demandes de visuels', format('select id, team, type, status from club_requests where club_id = %L order by created_at desc', c)),
      ('demandes d''adhésion (+ équipe, joueur)', format('select mr.id, t.name, pp.prenom from membership_requests mr left join lateral (select name from club_teams where id = mr.team_id) t on true left join lateral (select prenom, nom from player_profiles where id = mr.player_id) pp on true where mr.club_id = %L', c)),
      ('contenus (tableau de bord)', format('select id, titre, statut from contenus where client_id = %L', cl))
    ) as x(nom, sql) loop
      best := null; n := null;
      for essai in 1..2 loop
        begin
          t0 := clock_timestamp();
          execute format('select count(*) from (%s) s', q.sql) into n;
          best := least(coalesce(best, 1e9), extract(epoch from clock_timestamp() - t0) * 1000);
        exception when others then
          insert into mesures values (p_phase, p.k, q.nom, null, null, sqlstate);
          n := null; exit;
        end;
      end loop;
      if n is not null then insert into mesures values (p_phase, p.k, q.nom, round(best, 1), n, null); end if;
    end loop;
  end loop;
  perform pg_temp.hors();
end $m$;
grant execute on function pg_temp.mesurer(text) to authenticated;

select pg_temp.mesurer('avant');

-- @@MIGRATIONS@@

select pg_temp.mesurer('apres');

-- ── Verdicts ─────────────────────────────────────────────────────────────────────────────────
insert into verdicts (controle, attendu, obtenu)
select format('[%s] %s : même nombre de lignes avant/après', a.qui, a.requete),
       coalesce(a.lignes::text, a.err), coalesce(b.lignes::text, b.err)
  from mesures a join mesures b on b.phase = 'apres' and b.qui = a.qui and b.requete = a.requete
 where a.phase = 'avant'
 order by a.requete, a.qui;

insert into verdicts (controle, attendu, obtenu)
select format('%s : temps cumulé des rôles hors CM SportVision au moins divisé par 2', x.requete),
       'oui',
       case when sum(b.ms) * 2 <= sum(a.ms) then 'oui' else 'non' end
         || format('  — avant %s ms, après %s ms (×%s)', round(sum(a.ms)), round(sum(b.ms)), round(sum(a.ms) / nullif(sum(b.ms), 0), 1))
  from (values ('actualités (newsroom)'), ('créations à valider (tableau de bord)'), ('matchs du club (tableau de bord)'), ('calendrier, lecture directe')) x(requete)
  join mesures a on a.phase = 'avant' and a.requete = x.requete and a.qui <> 'cm_sportvision'
  join mesures b on b.phase = 'apres' and b.requete = x.requete and b.qui = a.qui
 group by x.requete;

-- Le relevé complet, pour le rapport (toujours « ✅ » : ce sont des chiffres, pas des contrôles).
insert into verdicts (controle, attendu, obtenu)
select format('relevé — %s', a.requete), 'relevé',
       'relevé  — ' || string_agg(format('%s %s→%s ms', a.qui, a.ms, b.ms), ', ' order by a.qui)
  from mesures a join mesures b on b.phase = 'apres' and b.qui = a.qui and b.requete = a.requete
 where a.phase = 'avant'
 group by a.requete;

select case when attendu = split_part(obtenu, '  — ', 1) then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;

rollback;
