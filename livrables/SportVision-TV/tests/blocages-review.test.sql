-- Blocages de l'audit Review du 11/09/2026, prouvés AVANT exécution des migrations, en transaction
-- annulée sur la base de production. Chaque personne est incarnée comme sous PostgREST (role
-- authenticated + sub du jeton) : la RLS et les droits s'appliquent comme pour l'application.
--
--   Point 1 — le CM externe lit l'annuaire et les sponsors (montants compris), jamais le SIRET ni
--             les identifiants Stripe (migration-blocages-review-1).
--   Point 2 — club_calendrier : tout le club aux rôles administratifs et à qui opère le club ;
--             aux rôles d'équipe leurs équipes + les événements sans équipe (migration-blocages-review-2).
--   Point 5 — peut_operer_club et peut_lire_calendrier_equipe réécrites : MÊME réponse pour toute
--             personne, tout club, toute équipe (migration-blocages-review-3). Les réponses sont
--             relevées AVANT les migrations, puis APRÈS, dans la même transaction.
--
-- Rouge sans les migrations (points 1 et 2), vert avec :
--   node livrables/SportVision-TV/tests/blocages-review.test.mjs SEULEMENT=SQL
--   AVEC_MIGRATION=1 SEULEMENT=SQL node livrables/SportVision-TV/tests/blocages-review.test.mjs
-- Les migrations sont injectées à la ligne « @@MIGRATIONS@@ » ci-dessous, sans leurs begin/commit.
--
-- DÉCOR. Club de test « Villeneuve 340 SC » uniquement. Identités fabriquées dans la transaction,
-- tout est annulé par le rollback final. Contrôles de vitalité : l'Owner Club+ DOIT lire chaque
-- valeur témoin, le Président DOIT voir plus d'événements que le coach, sinon on mesurerait le vide.

begin;

create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $i$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p::text, 'role', 'authenticated')::text, true);
end $i$;
create or replace function pg_temp.anonyme() returns void language plpgsql as $i$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end $i$;
create or replace function pg_temp.hors() returns void language plpgsql as $i$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $i$;
create or replace function pg_temp.valeur(q text) returns text language plpgsql as $i$
declare v text;
begin
  execute q into v;
  return coalesce(v, '∅');
exception
  when insufficient_privilege then return 'REFUS';
  when undefined_function then return 'ABSENTE';
  when others then return 'ERREUR ' || sqlstate;
end $i$;

create temp table ids (k text primary key, v uuid) on commit drop;
create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create temp table equivalence (phase text, fn text, qui uuid, arg uuid, rep text) on commit drop;
create temp table lectures (phase text, qui text, tbl text, n text) on commit drop;
grant all on ids, verdicts, equivalence, lectures to authenticated, anon;
grant usage on sequence verdicts_n_seq to authenticated, anon;

-- ── Décor ─────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_club uuid; v_team uuid; v_team_nom text; v_autre uuid; v_autre_nom text; u uuid; r text;
  v_joueur uuid; v_parent uuid; v_sp uuid; v_op uuid; v_org uuid; v_evt uuid; v_cible uuid;
begin
  perform pg_temp.hors();
  select id into v_club from clubs where nom = 'Villeneuve 340 SC';
  if v_club is null then raise exception 'club de test introuvable'; end if;
  select id, name into v_team, v_team_nom from club_teams where club_id = v_club and not archivee order by name limit 1;
  select id, name into v_autre, v_autre_nom from club_teams where club_id = v_club and not archivee and id <> v_team order by name limit 1;
  if v_autre is null then raise exception 'il faut deux équipes sur le club de test'; end if;
  insert into ids values ('_club', v_club), ('_team', v_team), ('_autre', v_autre);

  -- Valeurs témoins : SIRET et Stripe (le CM externe ne doit JAMAIS les lire).
  update clubs set siret = '999 999 999 00017', stripe_customer_id = 'cus_ZZBLOCAGES', stripe_subscription_id = 'sub_ZZBLOCAGES'
   where id = v_club;

  -- Les membres du club. Rôles d'équipe sur la PREMIÈRE équipe seulement.
  foreach r in array array['admin', 'president', 'secretaire', 'tresorier', 'sponsor_mgr', 'coach', 'resp_equipe',
                           'directeur_sportif', 'comm', 'lecture_seule', 'membre_bureau', 'administratif', 'cm_externe'] loop
    u := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              'zz-blocages-' || replace(r, '_', '') || '-' || u || '@example.invalid', '', now(), now(), now());
    insert into club_members (club_id, user_id, role, status, prenom, nom, telephone, teams)
      values (v_club, u, r, 'actif', 'ZZ', 'Blocages ' || r, '06 00 00 00 10',
              case when r in ('coach', 'resp_equipe', 'directeur_sportif') then jsonb_build_array(v_team_nom) else '[]'::jsonb end);
    insert into ids values (r, u);
  end loop;

  -- La cible de « lit-il le téléphone d'un AUTRE membre ».
  u := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-blocages-cible-' || u || '@example.invalid', '', now(), now(), now());
  insert into club_members (club_id, user_id, role, status, prenom, nom, telephone)
    values (v_club, u, 'lecture_seule', 'actif', 'ZZ', 'Cible', '06 99 99 99 99') returning id into v_cible;
  insert into ids values ('_cible', v_cible);

  -- Le staff de l'OS : un CM SportVision affecté au club, un CM d'un autre club, un Admin SportVision.
  foreach r in array array['os_cm', 'os_cm_autre', 'os_admin'] loop
    u := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-blocages-' || replace(r, '_', '') || '-' || u || '@example.invalid', '', now(), now(), now());
    insert into profiles (id, role, prenom, nom, email, actif)
      values (u, case when r = 'os_admin' then 'admin' else 'cm' end, 'ZZ', upper(r), 'zz-blocages-' || replace(r, '_', '') || '-' || u || '@example.invalid', true);
    insert into ids values (r, u);
  end loop;
  insert into club_cm_affectations (club_id, cm_id, role, actif) values (v_club, (select v from ids where k = 'os_cm'), 'principal', true);

  -- Une agence CM déléguée sur le club (chemin is_club_admin / is_club_member sans club_members),
  -- et un « CM responsable » d'agence (cm_super_access). Aucun n'existe en production : sans eux,
  -- l'équivalence de peut_operer_club ne couvrirait pas ces branches.
  insert into organizations (id, organization_type, nom) values (gen_random_uuid(), 'cm_agency', 'ZZ Agence blocages') returning id into v_org;
  foreach r in array array['agence', 'agence_super'] loop
    u := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-blocages-' || replace(r, '_', '') || '-' || u || '@example.invalid', '', now(), now(), now());
    insert into memberships (user_id, organization_id, role, status, cm_super_access) values (u, v_org, 'cm', 'actif', r = 'agence_super');
    insert into ids values (r, u);
  end loop;
  insert into cm_agency_club_access (cm_agency_org_id, club_id) values (v_org, v_club);

  -- Une famille Connect : un joueur de la SECONDE équipe, son parent confirmé. Et un coach de la
  -- première équipe qui est aussi parent confirmé de ce joueur.
  u := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-blocages-joueur-' || u || '@example.invalid', '', now(), now(), now());
  insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
    values (v_club, u, 'ZZ', 'Joueur', '2010-01-01', 'actif') returning id into v_joueur;
  insert into team_memberships (player_id, team_id, club_id, saison, statut)
    values (v_joueur, v_autre, v_club, coalesce((select saison from clubs where id = v_club), '2026-2027'), 'active');
  insert into ids values ('joueur', u);
  foreach r in array array['parent', 'coach_parent'] loop
    u := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-blocages-' || replace(r, '_', '') || '-' || u || '@example.invalid', '', now(), now(), now());
    insert into parent_profiles (user_id, prenom, nom) values (u, 'ZZ', 'Parent') returning id into v_parent;
    insert into parent_player_relationships (parent_id, player_id, statut) values (v_parent, v_joueur, 'confirme');
    if r = 'coach_parent' then
      insert into club_members (club_id, user_id, role, status, prenom, nom, teams)
        values (v_club, u, 'coach', 'actif', 'ZZ', 'Coach parent', jsonb_build_array(v_team_nom));
    end if;
    insert into ids values (r, u);
  end loop;

  -- Un compte sans aucun lien avec le club.
  u := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-blocages-sanslien-' || u || '@example.invalid', '', now(), now(), now());
  insert into ids values ('sans_lien', u);

  -- Un événement du club rattaché à AUCUNE équipe (Villeneuve n'en a pas en production), et un
  -- sur la seconde équipe : le coach doit voir le premier, jamais le second.
  insert into club_calendar_events (club_id, title, event_date, type) values (v_club, 'ZZ Assemblée du club', current_date + 3, 'tournoi') returning id into v_evt;
  insert into ids values ('_evt_club', v_evt);
  insert into club_calendar_events (club_id, title, event_date, team, team_id, type)
    values (v_club, 'ZZ Tournoi seconde équipe', current_date + 4, v_autre_nom, v_autre, 'tournoi') returning id into v_evt;
  insert into ids values ('_evt_autre', v_evt);

  -- Un sponsor avec son montant, et une opération.
  insert into club_sponsors (club_id, name, montant) values (v_club, 'ZZ Sponsor blocages', 4321) returning id into v_sp;
  insert into sponsor_operations (sponsor_id, label, date) values (v_sp, 'ZZ Opération blocages', current_date) returning id into v_op;
  insert into ids values ('_sponsor', v_sp), ('_operation', v_op);
end $$;

-- Toutes les personnes que connaît la base, plus celles du décor, plus un identifiant inconnu.
create temp table personnes on commit drop as
  select id as v from auth.users
  union select '00000000-0000-0000-0000-00000000dead'::uuid;
create temp table cibles_club on commit drop as
  select id as v from clubs union all select null::uuid union all select '00000000-0000-0000-0000-00000000beef'::uuid;
create temp table cibles_equipe on commit drop as
  select id as v from club_teams union all select null::uuid union all select '00000000-0000-0000-0000-00000000beef'::uuid;
grant select on personnes, cibles_club, cibles_equipe to authenticated, anon;

-- ── Relevé AVANT : chaque fonction réécrite, pour chaque personne ────────────────────────────
do $$
declare p record;
begin
  for p in select v from personnes loop
    perform pg_temp.incarner(p.v);
    insert into equivalence select 'avant', 'peut_operer_club', p.v, c.v, coalesce(peut_operer_club(c.v)::text, 'NULL') from cibles_club c;
    insert into equivalence select 'avant', 'peut_lire_calendrier_equipe', p.v, e.v, coalesce(peut_lire_calendrier_equipe(e.v)::text, 'NULL') from cibles_equipe e;
  end loop;
  perform pg_temp.anonyme();
  insert into equivalence select 'avant', 'peut_operer_club', null, c.v, coalesce(peut_operer_club(c.v)::text, 'NULL') from cibles_club c;
  insert into equivalence select 'avant', 'peut_lire_calendrier_equipe', null, e.v, coalesce(peut_lire_calendrier_equipe(e.v)::text, 'NULL') from cibles_equipe e;
  perform pg_temp.hors();
end $$;

-- Ce que chaque personne du décor lit dans les tables des widgets, AVANT (point 5 : les
-- migrations de performance ne doivent rien changer à ces nombres).
do $$
declare p record; c uuid := (select v from ids where k = '_club'); t text;
begin
  for p in select k, v from ids where k not like '\_%' loop
    perform pg_temp.incarner(p.v);
    foreach t in array array['club_newsroom_items', 'club_creations', 'club_matches', 'club_calendar_events',
                             'club_requests', 'membership_requests', 'club_teams', 'club_team_training_slots'] loop
      insert into lectures values ('avant', p.k, t,
        pg_temp.valeur(case when t = 'club_team_training_slots'
                            then format('select count(*)::text from club_team_training_slots s join club_teams ct on ct.id = s.team_id where ct.club_id = %L', c)
                            else format('select count(*)::text from %I where club_id = %L', t, c) end));
    end loop;
  end loop;
  perform pg_temp.hors();
end $$;

-- @@MIGRATIONS@@

-- ── Relevé APRÈS ─────────────────────────────────────────────────────────────────────────────
do $$
declare p record;
begin
  for p in select v from personnes loop
    perform pg_temp.incarner(p.v);
    insert into equivalence select 'apres', 'peut_operer_club', p.v, c.v, coalesce(peut_operer_club(c.v)::text, 'NULL') from cibles_club c;
    insert into equivalence select 'apres', 'peut_lire_calendrier_equipe', p.v, e.v, coalesce(peut_lire_calendrier_equipe(e.v)::text, 'NULL') from cibles_equipe e;
  end loop;
  perform pg_temp.anonyme();
  insert into equivalence select 'apres', 'peut_operer_club', null, c.v, coalesce(peut_operer_club(c.v)::text, 'NULL') from cibles_club c;
  insert into equivalence select 'apres', 'peut_lire_calendrier_equipe', null, e.v, coalesce(peut_lire_calendrier_equipe(e.v)::text, 'NULL') from cibles_equipe e;
  perform pg_temp.hors();
end $$;

do $$
declare p record; c uuid := (select v from ids where k = '_club'); t text;
begin
  for p in select k, v from ids where k not like '\_%' loop
    perform pg_temp.incarner(p.v);
    foreach t in array array['club_newsroom_items', 'club_creations', 'club_matches', 'club_calendar_events',
                             'club_requests', 'membership_requests', 'club_teams', 'club_team_training_slots'] loop
      insert into lectures values ('apres', p.k, t,
        pg_temp.valeur(case when t = 'club_team_training_slots'
                            then format('select count(*)::text from club_team_training_slots s join club_teams ct on ct.id = s.team_id where ct.club_id = %L', c)
                            else format('select count(*)::text from %I where club_id = %L', t, c) end));
    end loop;
  end loop;
  perform pg_temp.hors();
end $$;

-- ── Point 5 : équivalence ────────────────────────────────────────────────────────────────────
insert into verdicts (controle, attendu, obtenu)
select format('[point 5] %s : même réponse avant/après pour chaque personne et chaque cible', f.fn),
       '0 écart',
       (select count(*) from equivalence a join equivalence b
          on b.phase = 'apres' and b.fn = a.fn and b.qui is not distinct from a.qui and b.arg is not distinct from a.arg
         where a.phase = 'avant' and a.fn = f.fn and a.rep <> b.rep)::text || ' écart'
         || case when (select count(*) from equivalence where phase = 'avant' and fn = f.fn)
                    = (select count(*) from equivalence where phase = 'apres' and fn = f.fn) then '' else ' (relevés de tailles différentes)' end
         || format('  — %s couples mesurés, %s réponses « vrai »',
                   (select count(*) from equivalence where phase = 'apres' and fn = f.fn),
                   (select count(*) from equivalence where phase = 'apres' and fn = f.fn and rep = 'true'))
  from (values ('peut_operer_club'), ('peut_lire_calendrier_equipe')) f(fn);
-- Vitalité : l'équivalence n'a de sens que si les deux réponses existent vraiment.
insert into verdicts (controle, attendu, obtenu)
select format('[point 5] vitalité : %s rend vrai ET faux dans le relevé', f.fn), 'oui',
       case when exists (select 1 from equivalence where fn = f.fn and rep = 'true')
             and exists (select 1 from equivalence where fn = f.fn and rep = 'false') then 'oui' else 'non' end
  from (values ('peut_operer_club'), ('peut_lire_calendrier_equipe')) f(fn);
insert into verdicts (controle, attendu, obtenu)
select format('[point 5] [%s] lit autant de lignes de %s avant/après', a.qui, a.tbl), a.n, b.n
  from lectures a join lectures b on b.phase = 'apres' and b.qui = a.qui and b.tbl = a.tbl
 where a.phase = 'avant'
 order by a.tbl, a.qui;

-- ── Point 1 : le CM externe lit l'annuaire et les sponsors, pas le SIRET ni Stripe ───────────
do $$
declare
  p record; a text; b text;
  c uuid := (select v from ids where k = '_club');
  cible uuid := (select v from ids where k = '_cible');
  sp uuid := (select v from ids where k = '_sponsor');
  op uuid := (select v from ids where k = '_operation');
begin
  for p in select k, v from ids where k in ('cm_externe', 'admin', 'os_cm', 'coach', 'comm') loop
    perform pg_temp.incarner(p.v);
    a := pg_temp.valeur(format('select telephone from club_membres_coordonnees(%L) where membre_id = %L', c, cible));
    insert into verdicts (controle, attendu, obtenu) values (format('[point 1] [%s] annuaire : téléphone d''un autre membre', p.k),
      case when p.k in ('cm_externe', 'admin', 'os_cm') then '06 99 99 99 99' else '∅' end, a);
    a := pg_temp.valeur(format('select name || '' / '' || montant::text from club_sponsors where id = %L', sp));
    insert into verdicts (controle, attendu, obtenu) values (format('[point 1] [%s] sponsors : nom et montant', p.k),
      case when p.k in ('cm_externe', 'admin', 'os_cm') then 'ZZ Sponsor blocages / 4321' else '∅' end,
      case when a like 'ZZ Sponsor blocages / 4321%' then 'ZZ Sponsor blocages / 4321' else a end);
    a := pg_temp.valeur(format('select label from sponsor_operations where id = %L', op));
    insert into verdicts (controle, attendu, obtenu) values (format('[point 1] [%s] opérations sponsor', p.k),
      case when p.k in ('cm_externe', 'admin', 'os_cm') then 'ZZ Opération blocages' else '∅' end, a);
    -- SIRET et Stripe : par la fonction, la table et la vue. Jamais pour le CM, externe ou non.
    a := pg_temp.valeur(format('select concat(siret, stripe_customer_id) from club_donnees_restreintes(%L)', c));
    b := pg_temp.valeur(format('select concat(siret, stripe_customer_id) from clubs where id = %L', c));
    insert into verdicts (controle, attendu, obtenu) values (format('[point 1] [%s] SIRET et Stripe', p.k),
      case when p.k = 'admin' then 'lus' else 'non lus' end,
      case when concat(a, b) like '%999 999 999 00017%' or concat(a, b) like '%ZZBLOCAGES%' then 'lus' else 'non lus' end || format('  — fonction=%s table=%s', a, b));
  end loop;
  perform pg_temp.hors();
end $$;

-- ── Point 2 : club_calendrier selon le rôle ──────────────────────────────────────────────────
create temp table calendrier (qui text, n int, hors_perimetre int, voit_club boolean, voit_autre boolean, err text) on commit drop;
grant all on calendrier to authenticated;
do $$
declare
  p record; n int; hp int; vc boolean; va boolean;
  c uuid := (select v from ids where k = '_club');
  eq uuid := (select v from ids where k = '_team');
begin
  for p in select k, v from ids where k not like '\_%' loop
    perform pg_temp.incarner(p.v);
    begin
      select count(*),
             count(*) filter (where e.team_id is not null and e.team_id <> eq),
             bool_or(e.ref = 'evenement:' || (select v from ids where k = '_evt_club')),
             bool_or(e.ref = 'evenement:' || (select v from ids where k = '_evt_autre'))
        into n, hp, vc, va
        from club_calendrier(c, current_date - 365, current_date + 365) e;
      insert into calendrier values (p.k, n, hp, coalesce(vc, false), coalesce(va, false), null);
    exception when others then
      insert into calendrier values (p.k, null, null, null, null, sqlstate);
    end;
  end loop;
  perform pg_temp.hors();
end $$;

-- Les trois périmètres de référence, comptés hors RLS sur le calendrier lui-même : tout le club,
-- la première équipe + les événements sans équipe, les seuls événements sans équipe.
create temp table reference on commit drop as
select count(*) as tout,
       count(*) filter (where e.team_id is null or e.team_id = (select v from ids where k = '_team')) as equipe,
       count(*) filter (where e.team_id is null) as club
  from club_calendrier_interne((select v from ids where k = '_club'), current_date - 365, current_date + 365) e;

insert into verdicts (controle, attendu, obtenu)
select format('[point 2] [%s] club_calendrier', c.qui),
       case
         -- Sans lien avec le club, ou CM d'un autre club : peut_lire_calendrier_club refuse (v120).
         when c.qui in ('sans_lien', 'os_cm_autre') then 'refus 42501'
         when c.qui in ('coach', 'resp_equipe', 'directeur_sportif') then 'son équipe + le club'
         when c.qui = 'sponsor_mgr' then 'le club seulement'
         -- Le coach qui est aussi parent d'un joueur du club garde ce que la v120 lui donne à ce titre.
         else 'tout le club'
       end,
       case
         when c.err is not null then 'refus ' || c.err
         when c.n = r.tout and c.voit_club and c.voit_autre then 'tout le club'
         when c.n = r.equipe and c.hors_perimetre = 0 and c.voit_club and not c.voit_autre then 'son équipe + le club'
         when c.n = r.club and c.hors_perimetre = 0 and c.voit_club and not c.voit_autre then 'le club seulement'
         else format('%s événements dont %s d''une autre équipe', c.n, c.hors_perimetre)
       end || format('  — %s événements (tout %s, équipe + club %s, club %s)', coalesce(c.n::text, '-'), r.tout, r.equipe, r.club)
  from calendrier c cross join reference r
 order by c.qui;

-- Vitalité : sans elles, « son équipe » et « tout » pourraient se confondre.
insert into verdicts (controle, attendu, obtenu)
select '[point 2] vitalité : les trois périmètres de référence sont distincts et non vides', 'oui',
       case when r.club >= 1 and r.club < r.equipe and r.equipe < r.tout then 'oui' else 'non' end
         || format('  — tout %s, équipe + club %s, club %s', r.tout, r.equipe, r.club)
  from reference r;

-- La fiche d'équipe (equipe_apercu appelle club_calendrier) : le coach y lit exactement ce que
-- le Président y lit pour cette équipe.
do $$
declare a text; b text; eq uuid := (select v from ids where k = '_team');
begin
  perform pg_temp.incarner((select v from ids where k = 'coach'));
  a := pg_temp.valeur(format('select concat(equipe_apercu(%L)->''prochain_evenement'', '' | '', equipe_apercu(%L)->''prochain_entrainement'')', eq, eq));
  perform pg_temp.incarner((select v from ids where k = 'president'));
  b := pg_temp.valeur(format('select concat(equipe_apercu(%L)->''prochain_evenement'', '' | '', equipe_apercu(%L)->''prochain_entrainement'')', eq, eq));
  perform pg_temp.hors();
  insert into verdicts (controle, attendu, obtenu) values ('[point 2] fiche d''équipe : le coach lit le même prochain événement / entraînement que le Président',
    'identique', case when a = b and a not in ('REFUS', '∅', ' | ') and a not like 'ERREUR%' then 'identique' else format('coach=%s président=%s', a, b) end);
end $$;

-- ── Vitalité du décor ─────────────────────────────────────────────────────────────────────────
insert into verdicts (controle, attendu, obtenu)
select 'décor : valeurs témoins posées sur le club', 'oui',
       case when siret = '999 999 999 00017' and stripe_customer_id = 'cus_ZZBLOCAGES' then 'oui' else 'non' end
  from clubs where id = (select v from ids where k = '_club');

select case when attendu = split_part(obtenu, '  — ', 1) then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;

rollback;
