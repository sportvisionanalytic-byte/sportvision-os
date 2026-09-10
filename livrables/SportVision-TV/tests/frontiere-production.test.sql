-- La frontière de la Production (migration v129, 10/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • la Production voit et fixe les montants des missions de SON pôle ; celle d'un autre pôle ne
--     voit ni montant, ni rentabilité, et ne touche à rien ;
--   • le Secrétariat, cloisonné de même ; la Comptabilité garde la vue globale ;
--   • la Production voit les frais des missions de son pôle et les frais hors mission des
--     opérateurs terrain, pas ceux du secrétariat ou des CM, et ne peut pas les valider ;
--   • le barème de rémunération des responsables de pôle : ni photographe, ni CM, ni Production.
--
--   Exécution : coller dans l'éditeur SQL, ou POSTer sur /v1/projects/<ref>/database/query.
--   Tout est annulé, rien ne subsiste.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('b2b2b2b2-0000-0000-0000-000000000001','zz-front-prod-foot@example.invalid','',now(),'authenticated','authenticated'),
  ('b2b2b2b2-0000-0000-0000-000000000002','zz-front-prod-basket@example.invalid','',now(),'authenticated','authenticated'),
  ('b2b2b2b2-0000-0000-0000-000000000003','zz-front-sec-basket@example.invalid','',now(),'authenticated','authenticated'),
  ('b2b2b2b2-0000-0000-0000-000000000004','zz-front-photo@example.invalid','',now(),'authenticated','authenticated'),
  ('b2b2b2b2-0000-0000-0000-000000000005','zz-front-sec-foot@example.invalid','',now(),'authenticated','authenticated'),
  ('b2b2b2b2-0000-0000-0000-000000000006','zz-front-compta@example.invalid','',now(),'authenticated','authenticated'),
  ('b2b2b2b2-0000-0000-0000-000000000007','zz-front-cm@example.invalid','',now(),'authenticated','authenticated'),
  ('b2b2b2b2-0000-0000-0000-000000000008','zz-front-admin@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role) values
  ('b2b2b2b2-0000-0000-0000-000000000001','QA','Prod Football','prod'),
  ('b2b2b2b2-0000-0000-0000-000000000002','QA','Prod Basket','prod'),
  ('b2b2b2b2-0000-0000-0000-000000000003','QA','Sec Basket','sec'),
  ('b2b2b2b2-0000-0000-0000-000000000004','QA','Photo','photo'),
  ('b2b2b2b2-0000-0000-0000-000000000005','QA','Sec Football','sec'),
  ('b2b2b2b2-0000-0000-0000-000000000006','QA','Compta','compta'),
  ('b2b2b2b2-0000-0000-0000-000000000007','QA','CM','cm'),
  ('b2b2b2b2-0000-0000-0000-000000000008','QA','Admin','admin')
on conflict (id) do update set role = excluded.role;

create temp table ctx on commit drop as
  select 'f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid as club_id,
         (select portail_client_id from clubs where id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54') as client_id,
         (select cl.pole_id from clubs c join clients cl on cl.id = c.portail_client_id
           where c.id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54') as pole_club,
         (select id from poles where nom = 'Basket') as pole_autre;
grant select on ctx to authenticated;

do $$ begin
  if (select pole_autre from ctx) is null or (select pole_autre from ctx) = (select pole_club from ctx) then
    raise exception 'DÉCOR INVALIDE : il faut un second pôle, distinct de celui du club.';
  end if;
end $$;

insert into pole_affectations (pole_id, user_id, role_pole, actif)
select pole_club, 'b2b2b2b2-0000-0000-0000-000000000001'::uuid, 'membre', true from ctx union all
select pole_club, 'b2b2b2b2-0000-0000-0000-000000000005'::uuid, 'membre', true from ctx union all
select pole_autre, 'b2b2b2b2-0000-0000-0000-000000000002'::uuid, 'membre', true from ctx union all
select pole_autre, 'b2b2b2b2-0000-0000-0000-000000000003'::uuid, 'membre', true from ctx;

-- Une mission du club, vendue 120 €.
create temp table m on commit drop as
  with ins as (
    insert into prestations (client_id, date_prestation, type_prestation, statut, source, montant_ht, couverture)
    select client_id, current_date + 5, 'match', 'planifiée', 'interne', 120, 'photo' from ctx returning id)
  select id from ins;
grant select on m to authenticated;

-- Trois notes de frais : une de mission, une hors mission d'un opérateur, une du secrétariat.
create temp table fr on commit drop as
  with ins as (
    insert into frais (collaborateur_id, prestation_id, type, montant, statut, date_frais, description)
    values ('b2b2b2b2-0000-0000-0000-000000000004', (select id from m), 'km', 15, 'en_attente', current_date, 'zz-front mission'),
           ('b2b2b2b2-0000-0000-0000-000000000004', null, 'km', 20, 'en_attente', current_date, 'zz-front operateur hors mission'),
           ('b2b2b2b2-0000-0000-0000-000000000005', null, 'repas', 30, 'en_attente', current_date, 'zz-front secretariat')
    returning id, description)
  select id, description from ins;
grant select on fr to authenticated;

create temp table verdicts (controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
create temp table memo (cle text primary key, v text) on commit drop;
grant select, insert, update on memo to authenticated;

create or replace function pg_temp.en(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.hors() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts values (p_c, p_a, p_o); $$;
create or replace function pg_temp.essai(p_qui text, p_uid uuid, p_sql text, p_attendu text) returns void language plpgsql as $$
declare v_ok text;
begin
  perform pg_temp.en(p_uid);
  begin execute p_sql; v_ok := 'autorisé';
  exception when others then v_ok := 'refusé'; end;
  perform pg_temp.hors();
  perform pg_temp.note(p_qui, p_attendu, v_ok);
end $$;
-- Ce que voit une personne : le résultat d'une requête scalaire, lu sous son identité.
create or replace function pg_temp.lu(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.en(p_uid);
  begin execute p_sql into v;
  exception when others then v := 'erreur'; end;
  perform pg_temp.hors();
  return coalesce(v, 'nul');
end $$;

-- ── La Production du pôle affecte, à 60 € (recommandé 55 €) ──
select pg_temp.essai('affecter sur une mission de son pôle — production du pôle', 'b2b2b2b2-0000-0000-0000-000000000001',
  'insert into memo select ''pe'', rpc_ajouter_membre_equipe((select id from m), ''b2b2b2b2-0000-0000-0000-000000000004'', ''Photo'', null, null, 60, 3::smallint, 55, 1, 55, null, null)::text',
  'autorisé');
select pg_temp.essai('affecter sur une mission d''un autre pôle — production d''un autre pôle', 'b2b2b2b2-0000-0000-0000-000000000002',
  'select rpc_ajouter_membre_equipe((select id from m), ''b2b2b2b2-0000-0000-0000-000000000004'', ''Photo'', null, null, 60, 3::smallint, 55, 1, 55, null, null)',
  'refusé');

-- ── Les montants de la mission ──
select pg_temp.note('production du pôle : voit la rémunération', '60',
  pg_temp.lu('b2b2b2b2-0000-0000-0000-000000000001', 'select trim_scale(remuneration)::text from prestations_equipe_display where prestation_id = (select id from m)'));
select pg_temp.note('production d''un autre pôle : ne voit pas l''affectation', '0',
  pg_temp.lu('b2b2b2b2-0000-0000-0000-000000000002', 'select count(*)::text from prestations_equipe_display where prestation_id = (select id from m)'));
select pg_temp.note('secrétariat d''un autre pôle : ne voit pas l''affectation', '0',
  pg_temp.lu('b2b2b2b2-0000-0000-0000-000000000003', 'select count(*)::text from prestations_equipe_display where prestation_id = (select id from m)'));
select pg_temp.note('production du pôle : rentabilité de la mission', '1',
  pg_temp.lu('b2b2b2b2-0000-0000-0000-000000000001', 'select count(*)::text from v_rentabilite_missions where prestation_id = (select id from m)'));
select pg_temp.note('production d''un autre pôle : pas de rentabilité', '0',
  pg_temp.lu('b2b2b2b2-0000-0000-0000-000000000002', 'select count(*)::text from v_rentabilite_missions where prestation_id = (select id from m)'));
select pg_temp.note('comptabilité : rentabilité, tous pôles', '1',
  pg_temp.lu('b2b2b2b2-0000-0000-0000-000000000006', 'select count(*)::text from v_rentabilite_missions where prestation_id = (select id from m)'));
select pg_temp.essai('historique des montants — production d''un autre pôle', 'b2b2b2b2-0000-0000-0000-000000000002',
  'select * from historique_remuneration((select id from m))', 'refusé');

-- ── Modifier le montant ──
select pg_temp.essai('modifier le montant — production d''un autre pôle', 'b2b2b2b2-0000-0000-0000-000000000002',
  'select modifier_remuneration_mission((select v from memo where cle = ''pe'')::uuid, 62, 55, null, null)', 'refusé');
select pg_temp.note('le montant est intact après l''essai de l''autre pôle', '60',
  (select trim_scale(remuneration)::text from prestations_equipe where id = (select v from memo where cle = 'pe')::uuid));
select pg_temp.essai('modifier le montant — production du pôle', 'b2b2b2b2-0000-0000-0000-000000000001',
  'select modifier_remuneration_mission((select v from memo where cle = ''pe'')::uuid, 62, 55, null, null)', 'autorisé');
select pg_temp.note('le montant a changé par la production du pôle', '62',
  (select trim_scale(remuneration)::text from prestations_equipe where id = (select v from memo where cle = 'pe')::uuid));

-- ── Rentabilité du club ──
select pg_temp.essai('rentabilité du club — production du pôle', 'b2b2b2b2-0000-0000-0000-000000000001',
  'select rentabilite_club_mois((select club_id from ctx), current_date)', 'autorisé');
select pg_temp.essai('rentabilité du club — production d''un autre pôle', 'b2b2b2b2-0000-0000-0000-000000000002',
  'select rentabilite_club_mois((select club_id from ctx), current_date)', 'refusé');
select pg_temp.note('tableau des clubs — production du pôle : le club y est', '1',
  pg_temp.lu('b2b2b2b2-0000-0000-0000-000000000001', 'select count(*)::text from rentabilite_clubs_mois(current_date) where club_id = (select club_id from ctx)'));
select pg_temp.note('tableau des clubs — production d''un autre pôle : le club n''y est pas', '0',
  pg_temp.lu('b2b2b2b2-0000-0000-0000-000000000002', 'select count(*)::text from rentabilite_clubs_mois(current_date) where club_id = (select club_id from ctx)'));

-- ── Les frais ──
select pg_temp.note('frais — production du pôle : frais de mission', '1',
  pg_temp.lu('b2b2b2b2-0000-0000-0000-000000000001', 'select count(*)::text from frais where description = ''zz-front mission'''));
select pg_temp.note('frais — production du pôle : frais hors mission d''un opérateur', '1',
  pg_temp.lu('b2b2b2b2-0000-0000-0000-000000000001', 'select count(*)::text from frais where description = ''zz-front operateur hors mission'''));
select pg_temp.note('frais — production : pas ceux du secrétariat', '0',
  pg_temp.lu('b2b2b2b2-0000-0000-0000-000000000001', 'select count(*)::text from frais where description = ''zz-front secretariat'''));
select pg_temp.note('frais — production d''un autre pôle : pas les frais de cette mission', '0',
  pg_temp.lu('b2b2b2b2-0000-0000-0000-000000000002', 'select count(*)::text from frais where description = ''zz-front mission'''));
select pg_temp.note('frais — comptabilité : tous', '3',
  pg_temp.lu('b2b2b2b2-0000-0000-0000-000000000006', 'select count(*)::text from frais where description like ''zz-front%'''));
select pg_temp.note('frais — le déclarant voit les siens', '1',
  pg_temp.lu('b2b2b2b2-0000-0000-0000-000000000005', 'select count(*)::text from frais where description = ''zz-front secretariat'''));
do $$ begin
  perform pg_temp.en('b2b2b2b2-0000-0000-0000-000000000001');
  update frais set statut = 'validé' where description = 'zz-front secretariat';
  update frais set statut = 'validé' where description = 'zz-front mission';
  perform pg_temp.hors();
end $$;
select pg_temp.note('valider les frais du secrétariat — production : sans effet', 'en_attente',
  (select statut from frais where description = 'zz-front secretariat'));
select pg_temp.note('valider les frais de mission — production du pôle', 'validé',
  (select statut from frais where description = 'zz-front mission'));

-- ── Le barème des responsables de pôle ──
create temp table total_paliers on commit drop as select count(*)::text n from pole_remuneration_paliers;
do $$ begin
  if (select n from total_paliers) = '0' then raise exception 'DÉCOR INVALIDE : aucun palier, le test ne prouverait rien.'; end if;
end $$;
select pg_temp.note('barème des responsables — photographe', '0',
  pg_temp.lu('b2b2b2b2-0000-0000-0000-000000000004', 'select count(*)::text from pole_remuneration_paliers'));
select pg_temp.note('barème des responsables — CM', '0',
  pg_temp.lu('b2b2b2b2-0000-0000-0000-000000000007', 'select count(*)::text from pole_remuneration_paliers'));
select pg_temp.note('barème des responsables — production', '0',
  pg_temp.lu('b2b2b2b2-0000-0000-0000-000000000001', 'select count(*)::text from pole_remuneration_paliers'));
select pg_temp.note('barème des responsables — admin', (select n from total_paliers),
  pg_temp.lu('b2b2b2b2-0000-0000-0000-000000000008', 'select count(*)::text from pole_remuneration_paliers'));
update pole_affectations set role_pole = 'responsable'
 where user_id = 'b2b2b2b2-0000-0000-0000-000000000002';
select pg_temp.note('barème des responsables — un responsable de pôle', (select n from total_paliers),
  pg_temp.lu('b2b2b2b2-0000-0000-0000-000000000002', 'select count(*)::text from pole_remuneration_paliers'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts;

rollback;
