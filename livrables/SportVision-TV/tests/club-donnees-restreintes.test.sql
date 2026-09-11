-- Données restreintes d'un club : qui lit le SIRET, les identifiants Stripe, le téléphone des
-- autres membres, les sponsors et leurs montants. Décisions de Fouka du 11/09/2026.
--
-- CE QUE LE TEST MESURE. Pour chaque personne, ce que la base lui rend réellement, par TOUS les
-- chemins qu'un écran ou un appel direct à l'API peut emprunter : la table, la vue clubs_safe, les
-- fonctions (club_donnees_restreintes, club_membres_coordonnees, find_duplicate_club_candidates,
-- equipe_apercu). « Lit » = au moins un chemin rend la valeur témoin. Chaque personne est
-- incarnée comme sous PostgREST (role authenticated + sub du jeton) : la RLS ET les droits de
-- colonne s'appliquent alors exactement comme pour l'application.
--
-- Il rejoue aussi les requêtes des écrans adaptés (Club+, OS), avec leur liste de colonnes exacte,
-- pour chaque rôle qui ouvre l'écran : après la migration 2, une requête qui demande une colonne
-- fermée échoue ENTIÈREMENT (42501), elle ne rend pas une colonne vide.
--
-- Rouge sans les migrations, vert avec :
--   TEST=club-donnees-restreintes.test.sql node livrables/SportVision-TV/tests/clubplus-roles-ecritures.run.mjs
--   TEST=club-donnees-restreintes.test.sql AVEC_MIGRATION=1 \
--     MIGRATION=migration-club-donnees-restreintes-1-lectures.sql,migration-club-donnees-restreintes-2-colonnes.sql \
--     node livrables/SportVision-TV/tests/clubplus-roles-ecritures.run.mjs
--
-- DÉCOR. Club de test « Villeneuve 340 SC » uniquement. Identités fabriquées dans la transaction,
-- valeurs témoins posées sur le club dans la transaction : tout est annulé par le rollback final,
-- rien ne subsiste en production. Contrôles de vitalité : l'Owner Club+ DOIT lire chaque valeur
-- témoin ; sinon on mesurerait le vide et chaque « ne lit pas » passerait pour de mauvaises raisons.

begin;

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
-- La valeur rendue par une requête, ou la raison pour laquelle il n'y en a pas. Un refus de
-- droit (42501) est une réponse valable : « ne lit pas ». Une fonction absente (42883, avant la
-- migration 1) aussi. Toute autre erreur est rapportée telle quelle.
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
create temp table mesures (qui text, donnee text, lit boolean, detail text) on commit drop;
create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant all on ids, mesures, verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;

-- Les rôles de club mesurés. `cm_externe` est le CM externe invité directement par le club (pas le
-- CM SportVision). Absent des décisions du 11/09 au matin, il a rejoint l'annuaire et les sponsors
-- le 11/09 au soir (décision de Fouka : mêmes droits que le CM SportVision, migration
-- blocages-review-1) ; il reste exclu du SIRET et de Stripe, comme le CM SportVision.
create temp table roles_club (role text) on commit drop;
insert into roles_club values ('admin'), ('president'), ('secretaire'), ('tresorier'), ('sponsor_mgr'),
  ('coach'), ('resp_equipe'), ('directeur_sportif'), ('comm'), ('lecture_seule'), ('membre_bureau'),
  ('administratif'), ('cm_externe');
grant select on roles_club to authenticated;

-- ── Décor ─────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_club uuid; v_team uuid; v_team_nom text; u uuid; r record; i int := 10; x text;
  v_joueur uuid; v_parent uuid; v_sp uuid; v_op uuid; v_cible uuid;
begin
  perform pg_temp.hors();
  select id into v_club from clubs where nom = 'Villeneuve 340 SC';
  if v_club is null then raise exception 'club de test introuvable'; end if;
  select id, name into v_team, v_team_nom from club_teams where club_id = v_club and not archivee order by name limit 1;
  insert into ids values ('_club', v_club), ('_team', v_team);

  -- Valeurs témoins : Villeneuve n'a ni SIRET ni identifiant Stripe en production.
  update clubs set siret = '999 999 999 00017', stripe_customer_id = 'cus_ZZRESTREINT', stripe_subscription_id = 'sub_ZZRESTREINT'
   where id = v_club;

  -- Les membres du club, chacun avec un téléphone témoin « 06 00 00 00 NN ».
  for r in select role from roles_club loop
    u := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              'zz-restreint-' || replace(r.role, '_', '') || '-' || u || '@example.invalid', '', now(), now(), now());
    insert into club_members (club_id, user_id, role, status, prenom, nom, telephone, teams)
      values (v_club, u, r.role, 'actif', 'ZZ', 'Restreint ' || r.role, '06 00 00 00 ' || i,
              case when r.role in ('coach', 'resp_equipe', 'directeur_sportif') then jsonb_build_array(v_team_nom) else '[]'::jsonb end);
    insert into ids values (r.role, u);
    i := i + 1;
  end loop;

  -- La cible de « lit-il le téléphone d'un AUTRE membre » : un membre jamais incarné.
  u := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-restreint-cible-' || u || '@example.invalid', '', now(), now(), now());
  insert into club_members (club_id, user_id, role, status, prenom, nom, telephone)
    values (v_club, u, 'lecture_seule', 'actif', 'ZZ', 'Cible', '06 99 99 99 99') returning id into v_cible;
  insert into ids values ('_cible', v_cible);

  -- Le staff SportVision de l'OS, et deux CM : l'un affecté au club, l'autre à aucun.
  foreach x in array array['admin', 'compta', 'com', 'sec', 'prod', 'photo', 'cm', 'cm_autre'] loop
    u := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              'zz-restreint-os' || replace(x, '_', '') || '-' || u || '@example.invalid', '', now(), now(), now());
    insert into profiles (id, role, prenom, nom, email, actif)
      values (u, case when x = 'cm_autre' then 'cm' else x end, 'ZZ', upper(x),
              'zz-restreint-os' || replace(x, '_', '') || '-' || u || '@example.invalid', true);
    insert into ids values ('os_' || x, u);
  end loop;
  insert into club_cm_affectations (club_id, cm_id, role, actif) values (v_club, (select v from ids where k = 'os_cm'), 'principal', true);

  -- Une famille Connect du club : un joueur de l'équipe, son parent confirmé.
  u := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-restreint-joueur-' || u || '@example.invalid', '', now(), now(), now());
  insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
    values (v_club, u, 'ZZ', 'Joueur', '2010-01-01', 'actif') returning id into v_joueur;
  insert into team_memberships (player_id, team_id, club_id, saison, statut)
    values (v_joueur, v_team, v_club, coalesce((select saison from clubs where id = v_club), '2026-2027'), 'active');
  insert into ids values ('joueur_connect', u);
  u := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-restreint-parent-' || u || '@example.invalid', '', now(), now(), now());
  insert into parent_profiles (user_id, prenom, nom) values (u, 'ZZ', 'Parent') returning id into v_parent;
  insert into parent_player_relationships (parent_id, player_id, statut) values (v_parent, v_joueur, 'confirme');
  insert into ids values ('parent_connect', u);

  -- Un sponsor avec son montant, une opération, et l'invitation d'un encadrant sur l'équipe.
  insert into club_sponsors (club_id, name, montant) values (v_club, 'ZZ Sponsor restreint', 4321) returning id into v_sp;
  insert into sponsor_operations (sponsor_id, label, date) values (v_sp, 'ZZ Opération restreinte', current_date) returning id into v_op;
  insert into ids values ('_sponsor', v_sp), ('_operation', v_op);
  insert into club_invitations (club_id, email, role, teams)
    values (v_club, 'zz-restreint-invite@example.invalid', 'coach', jsonb_build_array(v_team_nom));
end $$;

-- ── Mesures, personne par personne ──────────────────────────────────────────────────────────
do $$
declare
  p record;
  c uuid := (select v from ids where k = '_club');
  eq uuid := (select v from ids where k = '_team');
  cible uuid := (select v from ids where k = '_cible');
  sp uuid := (select v from ids where k = '_sponsor');
  op uuid := (select v from ids where k = '_operation');
  est_membre boolean;
  a text; b text; d text; e text;
begin
  for p in select k, v from ids where k not like '\_%' order by k loop
    perform pg_temp.incarner(p.v);
    est_membre := p.k in (select role from roles_club);

    -- Décision 1a — identifiants Stripe : la table, la fonction, la vue.
    a := pg_temp.valeur(format('select concat(stripe_customer_id, stripe_subscription_id) from clubs where id = %L', c));
    b := pg_temp.valeur(format('select concat(stripe_customer_id, stripe_subscription_id) from club_donnees_restreintes(%L)', c));
    d := pg_temp.valeur(format('select concat(stripe_customer_id, stripe_subscription_id) from clubs_safe where id = %L', c));
    insert into mesures values (p.k, 'stripe', concat(a, b, d) like '%ZZRESTREINT%', format('table=%s rpc=%s vue=%s', a, b, d));

    -- Décision 1b — SIRET : table, fonction, vue, et la détection de doublons par le nom.
    a := pg_temp.valeur(format('select siret from clubs where id = %L', c));
    b := pg_temp.valeur(format('select siret from club_donnees_restreintes(%L)', c));
    d := pg_temp.valeur(format('select siret from clubs_safe where id = %L', c));
    e := pg_temp.valeur(format('select club_siret from find_duplicate_club_candidates(null, %L, null) where club_id = %L', 'Villeneuve 340 SC', c));
    insert into mesures values (p.k, 'siret', concat(a, b, d, e) like '%999 999 999 00017%', format('table=%s rpc=%s vue=%s doublons=%s', a, b, d, e));

    -- Décision 2 — le téléphone d'un AUTRE membre, puis le sien.
    a := pg_temp.valeur(format('select telephone from club_members where id = %L', cible));
    b := pg_temp.valeur(format('select telephone from club_membres_coordonnees(%L) where membre_id = %L', c, cible));
    insert into mesures values (p.k, 'annuaire', concat(a, b) like '%06 99 99 99 99%', format('table=%s rpc=%s', a, b));
    if est_membre then
      a := pg_temp.valeur(format('select telephone from club_members where club_id = %L and user_id = auth.uid()', c));
      b := pg_temp.valeur(format('select telephone from club_membres_coordonnees(%L) where user_id = auth.uid()', c));
      insert into mesures values (p.k, 'sa fiche', concat(a, b) like '%06 00 00 00%', format('table=%s rpc=%s', a, b));
    end if;
    -- L'e-mail d'un encadrant invité sur l'équipe, tel que le rend la fiche d'équipe.
    a := pg_temp.valeur(format('select case when equipe_apercu(%L)::text like ''%%zz-restreint-invite%%'' then ''EMAIL'' else ''sans e-mail'' end', eq));
    insert into mesures values (p.k, 'e-mail invité', a = 'EMAIL', a);

    -- Décision 3 — le sponsor, son montant, ses opérations.
    a := pg_temp.valeur(format('select name from club_sponsors where id = %L', sp));
    insert into mesures values (p.k, 'sponsors', a = 'ZZ Sponsor restreint', a);
    a := pg_temp.valeur(format('select montant::text from club_sponsors where id = %L', sp));
    insert into mesures values (p.k, 'montants', a like '4321%', a);
    a := pg_temp.valeur(format('select label from sponsor_operations where id = %L', op));
    insert into mesures values (p.k, 'opérations sponsor', a = 'ZZ Opération restreinte', a);
  end loop;
  perform pg_temp.hors();
end $$;

-- ── Verdicts : exactement les listes des décisions, ni plus ni moins ─────────────────────────
insert into verdicts (controle, attendu, obtenu)
select format('[%s] %s', m.qui, m.donnee),
       case when m.qui = any (case m.donnee
              when 'stripe'   then array['admin', 'president', 'os_admin', 'os_compta']
              when 'siret'    then array['admin', 'president', 'secretaire', 'tresorier', 'os_admin', 'os_compta']
              when 'annuaire' then array['admin', 'president', 'secretaire', 'tresorier', 'cm_externe', 'os_cm', 'os_admin', 'os_com', 'os_sec']
              when 'sa fiche' then array(select role from roles_club)
              -- La fiche d'équipe ne s'ouvre qu'à qui opère le club et au coach de l'équipe : parmi
              -- eux, l'e-mail ne va qu'à l'annuaire (le coach, le responsable d'équipe et le
              -- directeur sportif lisent le nom et le statut, pas l'adresse). Le CM externe, dans
              -- l'annuaire depuis blocages-review-1, n'ouvre pas la fiche d'équipe : il ne lit rien.
              when 'e-mail invité' then array['admin', 'president', 'os_cm', 'os_admin', 'os_com', 'os_sec']
              -- Les opérations (libellé, date : aucun montant) restent lisibles par tout le staff de
              -- l'OS (sop_staff_all, is_staff) — « + staff SportVision de l'OS » dans la décision —,
              -- mais plus par un CM hors de son club (policy restrictive cm_perim_sponsor_operations).
              when 'opérations sponsor' then array['admin', 'president', 'secretaire', 'tresorier', 'sponsor_mgr', 'cm_externe', 'os_cm',
                                                   'os_admin', 'os_com', 'os_sec', 'os_compta', 'os_prod', 'os_photo']
              else array['admin', 'president', 'secretaire', 'tresorier', 'sponsor_mgr', 'cm_externe', 'os_cm', 'os_admin', 'os_com', 'os_sec']
            end) then 'lit' else 'ne lit pas' end,
       case when m.lit then 'lit' else 'ne lit pas' end || '  — ' || m.detail
  from mesures m
 order by m.donnee, m.qui;

-- ── Les requêtes des écrans adaptés, telles qu'ils les envoient ──────────────────────────────
-- Une requête qui touche une colonne fermée échoue entière : chaque écran est rejoué pour chaque
-- rôle qui l'ouvre. « répond » = aucune erreur, et au moins une ligne quand l'écran en attend une.
do $$
declare
  p record; c uuid := (select v from ids where k = '_club'); r text; cols_clubs text; cols_membres text;
begin
  perform pg_temp.hors();
  select string_agg(quote_ident(column_name), ', ') into cols_clubs from information_schema.columns
   where table_schema = 'public' and table_name = 'clubs' and column_name not in ('siret', 'stripe_customer_id', 'stripe_subscription_id');
  select string_agg(quote_ident(column_name), ', ') into cols_membres from information_schema.columns
   where table_schema = 'public' and table_name = 'club_members' and column_name <> 'telephone';

  for p in select k, v from ids where k in (select role from roles_club) or k = 'os_cm' order by k loop
    perform pg_temp.incarner(p.v);
    -- Club+ session.ts (buildClubActiveContext / buildDelegatedClubActiveContext), sans siret.
    r := pg_temp.valeur(format('select id::text from clubs where id = %L and (select count(*) from (select id, ville, discipline, plan, engagement, credits_balance, credits_monthly, credits_reserved, portail_client_id, logo_url, ecusson_url, adresse, instagram_handle, couleur_primaire, couleur_secondaire, club_plus_source from clubs where id = %L) s) = 1', c, c));
    insert into verdicts (controle, attendu, obtenu) values (format('[%s] écran : session Club+ (clubs, sans siret)', p.k), 'répond', case when r = c::text then 'répond' else r end);
    -- Club+ users.ts fetchClubMembers, sans téléphone (Coachs & dirigeants, Paramètres, équipes).
    r := pg_temp.valeur(format('select count(*)::text from (select id, user_id, prenom, nom, role, status, created_at, teams, fonction from club_members where club_id = %L) s', c));
    insert into verdicts (controle, attendu, obtenu) values (format('[%s] écran : membres du club (club_members, sans téléphone)', p.k), 'répond', case when r ~ '^[1-9][0-9]*$' then 'répond' else r end);
    -- Club+ LogoClub.tsx.
    r := pg_temp.valeur(format('select logo_url is null or true from clubs where id = %L', c));
    insert into verdicts (controle, attendu, obtenu) values (format('[%s] écran : logo du club', p.k), 'répond', case when r = 'true' then 'répond' else r end);
  end loop;

  -- Club+ subscription.ts (« Mon offre »), sans identifiant Stripe : Owner Club+ et Président.
  for p in select k, v from ids where k in ('admin', 'president') loop
    perform pg_temp.incarner(p.v);
    r := pg_temp.valeur(format('select plan from (select plan, engagement, pilot_mode, credits_monthly, credits_balance, subscription_status from clubs where id = %L) s', c));
    insert into verdicts (controle, attendu, obtenu) values (format('[%s] écran : Mon offre (clubs, sans Stripe)', p.k), 'répond', case when r not in ('REFUS', '∅') and r not like 'ERREUR%' then 'répond' else r end);
    r := pg_temp.valeur(format('select stripe_subscription_id from club_donnees_restreintes(%L)', c));
    insert into verdicts (controle, attendu, obtenu) values (format('[%s] écran : Mon offre lit l''abonnement Stripe', p.k), 'sub_ZZRESTREINT', r);
  end loop;

  -- OS, fiche Club+ > Utilisateurs (cfpLoadUsers), sans téléphone, puis le téléphone par la fonction.
  for p in select k, v from ids where k in ('os_admin', 'os_com', 'os_sec', 'os_cm') loop
    perform pg_temp.incarner(p.v);
    r := pg_temp.valeur(format('select count(*)::text from (select id, prenom, nom, role, status, created_at from club_members where club_id = %L) s', c));
    insert into verdicts (controle, attendu, obtenu) values (format('[%s] écran OS : utilisateurs Club+ du club', p.k), 'répond', case when r ~ '^[1-9][0-9]*$' then 'répond' else r end);
    r := pg_temp.valeur(format('select count(*)::text from club_membres_coordonnees(%L) where telephone is not null', c));
    insert into verdicts (controle, attendu, obtenu) values (format('[%s] écran OS : téléphones des utilisateurs Club+', p.k), 'lus', case when r ~ '^[1-9][0-9]*$' then 'lus' else r end);
  end loop;

  -- Écritures de l'Owner Club+ avec `select=id` (Paramètres, statut d'un membre) : inchangées.
  perform pg_temp.incarner((select v from ids where k = 'admin'));
  r := pg_temp.valeur(format('with m as (update clubs set instagram_handle = instagram_handle where id = %L returning id) select count(*)::text from m', c));
  insert into verdicts (controle, attendu, obtenu) values ('[admin] écriture : fiche du club, retour select=id', '1', r);
  r := pg_temp.valeur(format('with m as (update club_members set status = status where id = %L returning id) select count(*)::text from m', (select v from ids where k = '_cible')));
  insert into verdicts (controle, attendu, obtenu) values ('[admin] écriture : statut d''un membre, retour select=id', '1', r);
  -- Toutes les autres colonnes restent lisibles (une colonne oubliée casserait un écran).
  r := pg_temp.valeur(format('select count(*)::text from (select %s from clubs where id = %L) s', cols_clubs, c));
  insert into verdicts (controle, attendu, obtenu) values ('[admin] toutes les colonnes de clubs sauf les trois fermées', '1', r);
  r := pg_temp.valeur(format('select count(*)::text from (select %s from club_members where club_id = %L) s', cols_membres, c));
  insert into verdicts (controle, attendu, obtenu) values ('[admin] toutes les colonnes de club_members sauf le téléphone', 'répond', case when r ~ '^[1-9][0-9]*$' then 'répond' else r end);
  -- Le piège, documenté : `select=*` échoue désormais pour authenticated. Tout lecteur doit nommer ses colonnes.
  r := pg_temp.valeur(format('select count(*)::text from (select * from clubs where id = %L) s', c));
  insert into verdicts (controle, attendu, obtenu) values ('[admin] clubs?select=* est refusé (colonnes fermées)', 'REFUS', r);
  perform pg_temp.hors();
end $$;

-- ── Vitalité du décor ───────────────────────────────────────────────────────────────────────
insert into verdicts (controle, attendu, obtenu)
select 'décor : valeurs témoins posées sur le club', 'oui',
       case when siret = '999 999 999 00017' and stripe_customer_id = 'cus_ZZRESTREINT' then 'oui' else 'non' end
  from clubs where id = (select v from ids where k = '_club');
insert into verdicts (controle, attendu, obtenu)
select 'décor : identités mesurées', '23', count(*)::text from ids where k not like '\_%';

select case when attendu = split_part(obtenu, '  — ', 1) then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;

rollback;
