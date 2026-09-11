-- L'espace du CM dans l'OS et le SIRET des fiches clients (11/09/2026).
--
-- DEUX QUESTIONS, MESURÉES COMME SOUS POSTGREST (role authenticated + sub du jeton) :
--   1. Qui lit `clients.siret` ? Décision de Fouka : jamais le CM. Les autres lecteurs de la fiche
--      qui en ont l'usage le gardent, par client_siret() (migration-os-cm-siret-client-1/-2).
--      « Lit » = au moins un chemin rend la valeur témoin : la table, ou la fonction.
--   2. Un CM au palier `niveau_cm` NUL, à qui la direction a confié un club, voit-il ce club dans
--      « Mes structures » (clients) et « Planning » (contrats) ? Audit Review : non, espace vide.
--      Le test prouve que le palier nul n'y est pour rien (un CM au palier nul AVEC pôle voit le
--      club) et que la cause est la condition de pôle (migration-os-cm-perimetre-clients).
--
-- Rouge sans les migrations, vert avec :
--   TEST=os-cm-espace-et-siret.test.sql node livrables/SportVision-TV/tests/clubplus-roles-ecritures.run.mjs
--   TEST=os-cm-espace-et-siret.test.sql AVEC_MIGRATION=1 \
--     MIGRATION=migration-os-cm-siret-client-1-lecture.sql,migration-os-cm-siret-client-2-colonne.sql,migration-os-cm-perimetre-clients.sql \
--     node livrables/SportVision-TV/tests/clubplus-roles-ecritures.run.mjs
--
-- DÉCOR. Club de test « Villeneuve 340 SC » et sa fiche client uniquement. Identités fabriquées
-- dans la transaction, SIRET témoin posé dans la transaction : tout est annulé par le rollback
-- final. Contrôles de vitalité : l'Admin SportVision DOIT lire le témoin, et le CM DOIT voir la
-- fiche ; sinon chaque « ne lit pas » passerait pour de mauvaises raisons.

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
-- droit (42501) et une fonction absente (42883, avant la migration 1) sont des réponses valables.
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
grant all on ids, verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(c text, a text, o text) returns void language sql as $n$
  insert into verdicts (controle, attendu, obtenu) values (c, a, o); $n$;
create or replace function pg_temp.id(k text) returns uuid language sql as $n$ select v from ids where k = $1; $n$;

-- ── Décor ────────────────────────────────────────────────────────────────────────────────────
select pg_temp.hors();
insert into ids select 'club', c.id from clubs c where c.nom = 'Villeneuve 340 SC';
insert into ids select 'client', c.portail_client_id from clubs c where c.nom = 'Villeneuve 340 SC';
-- Un club qui n'est confié à aucun des CM fabriqués : la frontière du périmètre.
insert into ids select 'client_autre', c.portail_client_id from clubs c
 where c.nom <> 'Villeneuve 340 SC' and c.portail_client_id is not null order by c.nom limit 1;
insert into ids select 'pole', id from poles where nom = 'Football';

update clients set siret = '999 111 222 33333' where id = pg_temp.id('client');

-- Une personne par rôle de l'OS, au palier CM nul. `pole` : affectée au pôle Football (celui du
-- club de test), ou non.
create temp table personnes (k text, role text, pole boolean, cm_affecte boolean, lit_siret boolean) on commit drop;
insert into personnes values
  ('admin',            'admin',            false, false, true),
  ('compta',           'compta',           true,  false, true),
  ('sec',              'sec',              true,  false, true),
  ('com',              'com',              true,  false, true),
  ('prod',             'prod',             true,  false, true),
  ('rh',               'rh',               true,  false, true),
  ('expert_comptable', 'expert_comptable', false, false, true),
  ('auditeur',         'auditeur',         false, false, true),
  ('photo',            'photo',            true,  false, false),
  -- L'opérateur d'une mission du client lit la fiche (clients_collaborateur_missions_select) :
  -- il en lisait aussi le SIRET, sans en avoir l'usage.
  ('photo_mission',    'photo',            true,  false, false),
  ('cm_pole',         'cm',               true,  true,  false),
  ('cm_sans_pole',     'cm',               false, true,  false),
  -- Témoin de non-élargissement : une secrétaire sans pôle ne doit pas gagner la fiche.
  ('sec_sans_pole',    'sec',              false, false, false);

insert into ids select 'p_' || k, gen_random_uuid() from personnes;
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
select pg_temp.id('p_' || k), 'zz-os-cm-sql-' || k || '@example.invalid', '', now(), 'authenticated', 'authenticated'
  from personnes;
insert into profiles (id, prenom, nom, role, actif, niveau_cm)
select pg_temp.id('p_' || k), 'ZZ', 'OS CM ' || k, role, true, null from personnes
on conflict (id) do update set role = excluded.role, actif = true, niveau_cm = null;
insert into pole_affectations (pole_id, user_id, role_pole, actif)
select pg_temp.id('pole'), pg_temp.id('p_' || k), 'membre', true from personnes where pole;
insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif)
select pg_temp.id('club'), pg_temp.id('p_' || k), 'secondaire', current_date - 1, true from personnes where cm_affecte;
with m as (
  insert into prestations (client_id, date_prestation, heure_debut, lieu, type_prestation, statut, source, description_besoin)
  values (pg_temp.id('client'), current_date + 3, '10:00', 'ZZ Stade', 'match', 'planifiée', 'interne', 'ZZ os-cm-espace-et-siret')
  returning id)
insert into prestations_equipe (prestation_id, collaborateur_id, statut)
select m.id, pg_temp.id('p_photo_mission'), 'acceptée' from m;
-- Le CM invité par le club dans Club+ (club_members.role = 'cm_externe'), sans profil OS.
insert into ids values ('p_cm_externe', gen_random_uuid());
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
values (pg_temp.id('p_cm_externe'), 'zz-os-cm-sql-cmexterne@example.invalid', '', now(), 'authenticated', 'authenticated');
delete from profiles where id = pg_temp.id('p_cm_externe');
insert into club_members (user_id, club_id, role, status, prenom, nom)
values (pg_temp.id('p_cm_externe'), pg_temp.id('club'), 'cm_externe', 'actif', 'ZZ', 'OS CM externe');
insert into personnes values ('cm_externe', null, false, false, false);

-- ── Vitalité du décor ────────────────────────────────────────────────────────────────────────
select pg_temp.note('décor : club de test, sa fiche client, un autre club, le pôle Football', '4',
  (select count(*)::text from ids where k in ('club', 'client', 'client_autre', 'pole') and v is not null));

-- ── 1. SIRET ─────────────────────────────────────────────────────────────────────────────────
create temp table lectures (k text, voit_fiche text, par_table text, par_fonction text) on commit drop;
grant all on lectures to authenticated;
do $m$
declare p record; c uuid := pg_temp.id('client');
begin
  for p in select * from personnes loop
    perform pg_temp.incarner(pg_temp.id('p_' || p.k));
    insert into lectures values (p.k,
      pg_temp.valeur(format('select count(*)::text from clients where id = %L', c)),
      pg_temp.valeur(format('select siret from clients where id = %L', c)),
      pg_temp.valeur(format('select client_siret(%L)', c)));
    perform pg_temp.hors();
  end loop;
end $m$;

select pg_temp.note('vitalité : l''Admin SportVision lit le SIRET témoin', '999 111 222 33333',
  (select case when par_fonction = '999 111 222 33333' or par_table = '999 111 222 33333' then '999 111 222 33333' else par_table || ' / ' || par_fonction end
     from lectures where k = 'admin'));
select pg_temp.note('vitalité : le CM (avec pôle) voit bien la fiche du client', '1',
  (select voit_fiche from lectures where k = 'cm_pole'));
select pg_temp.note('vitalité : l''opérateur de la mission voit bien la fiche du client', '1',
  (select voit_fiche from lectures where k = 'photo_mission'));

select pg_temp.note(format('%s %s le SIRET (table : %s, fonction : %s)', l.k,
                           case when p.lit_siret then 'lit' else 'ne lit pas' end, l.par_table, l.par_fonction),
                    case when p.lit_siret then 'lit' else 'ne lit pas' end,
                    case when '999 111 222 33333' in (l.par_table, l.par_fonction) then 'lit' else 'ne lit pas' end)
  from lectures l join personnes p using (k)
 order by p.lit_siret desc, l.k;

-- Toute autre colonne reste lisible : une colonne oubliée dans le « grant » casserait les écrans
-- qui la lisent. Se lit dans le catalogue, pour authenticated ET anon.
select pg_temp.note('toute colonne de clients autre que siret reste lisible par authenticated et anon', '∅',
  coalesce((select string_agg(column_name, ', ') from information_schema.columns
             where table_schema = 'public' and table_name = 'clients' and column_name <> 'siret'
               and not (has_column_privilege('authenticated', 'public.clients', column_name, 'select')
                    and has_column_privilege('anon', 'public.clients', column_name, 'select'))), '∅'));
-- Les écritures de l'OS restent possibles, avec une liste de colonnes en retour (select=id).
select pg_temp.incarner(pg_temp.id('p_admin'));
select pg_temp.note('l''Admin SportVision modifie une fiche, retour limité à id (PATCH …&select=id)', 'ok',
  pg_temp.valeur(format('with m as (update clients set statut = statut where id = %L returning id) select case when count(*) = 1 then ''ok'' else ''aucune ligne'' end from m', pg_temp.id('client'))));
select pg_temp.note('l''Admin SportVision écrit le SIRET à la création ou la modification d''une fiche', 'ok',
  pg_temp.valeur(format('with m as (update clients set siret = ''999 111 222 33333'' where id = %L returning id) select case when count(*) = 1 then ''ok'' else ''aucune ligne'' end from m', pg_temp.id('client'))));
select pg_temp.hors();

-- ── 2. L'espace du CM au palier nul ───────────────────────────────────────────────────────────
create temp table espace (k text, clubs text, fiche text, contrats text, fiche_autre text, plan_fc text) on commit drop;
grant all on espace to authenticated;
do $m$
declare p record; c uuid := pg_temp.id('client'); a uuid := pg_temp.id('client_autre');
begin
  for p in select * from personnes where k in ('cm_pole', 'cm_sans_pole', 'sec_sans_pole', 'photo') loop
    perform pg_temp.incarner(pg_temp.id('p_' || p.k));
    insert into espace values (p.k,
      pg_temp.valeur(format('select count(*)::text from cm_clubs_autorises() x where x = %L', pg_temp.id('club'))),
      -- « Mes structures » : _cmVisibleClients(true), la requête exacte de l'écran.
      pg_temp.valeur(format('select count(*)::text from (select id, nom, statut, type_client, sport, ville, email, telephone, prenom_contact, nom_contact from clients where id = %L) s', c)),
      -- « Planning » : contrats Full Communication actifs, avec le nom du client.
      pg_temp.valeur(format('select count(*)::text from contrats k join clients cl on cl.id = k.client_id where k.client_id = %L', c)),
      pg_temp.valeur(format('select count(*)::text from clients where id = %L', a)),
      pg_temp.valeur(format('select count(*)::text from contrats where client_id = %L and type_contrat = ''full_communication'' and statut = ''actif''', c)));
    perform pg_temp.hors();
  end loop;
end $m$;

select pg_temp.note('vitalité : le club de test a un contrat Full Communication actif', '1',
  (select count(*)::text from contrats where client_id = pg_temp.id('client') and type_contrat = 'full_communication' and statut = 'actif'));
select pg_temp.note('vitalité : cm_clubs_autorises() confie le club au CM sans pôle', '1', (select clubs from espace where k = 'cm_sans_pole'));
select pg_temp.note('le palier nul n''y est pour rien : CM au palier nul AVEC pôle voit la fiche', '1', (select fiche from espace where k = 'cm_pole'));
select pg_temp.note('CM au palier nul SANS pôle : « Mes structures » montre le club confié', '1', (select fiche from espace where k = 'cm_sans_pole'));
select pg_temp.note('CM au palier nul SANS pôle : « Planning » montre le contrat Full Communication', '1', (select plan_fc from espace where k = 'cm_sans_pole'));
select pg_temp.note('CM au palier nul SANS pôle : contrats du club lisibles avec le nom du client', '1', (select contrats from espace where k = 'cm_sans_pole'));
select pg_temp.note('frontière : aucun CM ne voit la fiche d''un club qui ne lui est pas confié', '0',
  (select coalesce(sum(fiche_autre::int), 0)::text from espace where k in ('cm_pole', 'cm_sans_pole')));
select pg_temp.note('non-élargissement : une secrétaire sans pôle ne gagne pas la fiche', '0', (select fiche from espace where k = 'sec_sans_pole'));
select pg_temp.note('non-élargissement : un opérateur sans mission ne gagne pas la fiche', '0', (select fiche from espace where k = 'photo'));
select pg_temp.note('le CM au palier nul ne lit toujours pas le SIRET du club qu''on lui ouvre', 'ne lit pas',
  (select case when '999 111 222 33333' in (par_table, par_fonction) then 'lit' else 'ne lit pas' end from lectures where k = 'cm_sans_pole'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
