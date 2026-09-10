-- La proposition part à la validation de la mission (migration v136, 10/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • la Production prévoit un opérateur (« à envoyer ») : lui ne voit ni la ligne, ni la mission,
--     ni notification, et ne peut rien accepter ;
--   • la Production valide : la proposition part, l'opérateur est notifié (date, lieu, montant),
--     voit la mission et accepte ;
--   • ni un photographe ni la Production d'un autre pôle n'envoient les propositions ;
--   • la Production enregistre brief et RDV ; le prix client lui reste interdit.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('d0d0d0d0-0000-0000-0000-000000000001','zz-prop-prod@example.invalid','',now(),'authenticated','authenticated'),
  ('d0d0d0d0-0000-0000-0000-000000000002','zz-prop-photo@example.invalid','',now(),'authenticated','authenticated'),
  ('d0d0d0d0-0000-0000-0000-000000000003','zz-prop-prod-foot@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role, actif) values
  ('d0d0d0d0-0000-0000-0000-000000000001','QA','Prod','prod',true),
  ('d0d0d0d0-0000-0000-0000-000000000002','QA','Photo','photo',true),
  ('d0d0d0d0-0000-0000-0000-000000000003','QA','Prod Foot','prod',true)
on conflict (id) do update set role = excluded.role;
create temp table ctx on commit drop as
  with pole as (select id from poles where nom = 'Basket'),
       cli as (insert into clients (nom, statut_relation, pole_id) select 'ZZ Club Proposition (test)', 'partenaire', id from pole returning id),
       pre as (insert into prestations (client_id, date_prestation, heure_debut, lieu, type_prestation, statut, source)
               select id, current_date + 4, '09:30', 'Stade ZZ', 'match', 'planifiée', 'interne' from cli returning id)
  select (select id from pole) pole_id, (select id from pre) mission;
grant select on ctx to authenticated;
insert into pole_affectations (pole_id, user_id, role_pole, actif)
select pole_id, 'd0d0d0d0-0000-0000-0000-000000000001'::uuid, 'membre', true from ctx union all
select (select id from poles where nom = 'Football'), 'd0d0d0d0-0000-0000-0000-000000000003'::uuid, 'membre', true;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.fait(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text := 'autorisé';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin execute p_sql; exception when others then v := 'refusé : ' || sqlerrm; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return v;
end $$;
create or replace function pg_temp.lu(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin execute p_sql into v; exception when others then v := 'erreur : ' || sqlerrm; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return coalesce(v, 'nul');
end $$;
create or replace function pg_temp.m() returns text language sql as $$ select mission::text from ctx $$;
create or replace function pg_temp.court(t text) returns text language sql as $$ select split_part(t, ' :', 1) $$;

insert into verdicts (controle, attendu, obtenu) values
 ('Production : prévoir l''opérateur, sans l''inviter', 'autorisé',
  pg_temp.fait('d0d0d0d0-0000-0000-0000-000000000001',
    'select rpc_ajouter_membre_equipe(''' || pg_temp.m() || ''', ''d0d0d0d0-0000-0000-0000-000000000002'', ''Photo'', null, null, 60, 3::smallint, 55, 1, 55, null, null, false)'));
insert into verdicts (controle, attendu, obtenu) values
 ('l''affectation est « à envoyer »', 'a_envoyer', (select statut::text from prestations_equipe where prestation_id = (select mission from ctx))),
 ('opérateur : ne voit pas la ligne', '0', pg_temp.lu('d0d0d0d0-0000-0000-0000-000000000002', 'select count(*)::text from prestations_equipe_display where prestation_id = ''' || pg_temp.m() || '''')),
 ('opérateur : ne voit pas la mission', '0', pg_temp.lu('d0d0d0d0-0000-0000-0000-000000000002', 'select count(*)::text from prestations where id = ''' || pg_temp.m() || '''')),
 ('opérateur : aucune notification', '0', (select count(*)::text from notifications where destinataire_id = 'd0d0d0d0-0000-0000-0000-000000000002'));
select pg_temp.fait('d0d0d0d0-0000-0000-0000-000000000002', 'update prestations_equipe set statut = ''acceptée'' where prestation_id = ''' || pg_temp.m() || '''');
insert into verdicts (controle, attendu, obtenu) values
 ('opérateur : accepter avant l''envoi n''a aucun effet', 'a_envoyer', (select statut::text from prestations_equipe where prestation_id = (select mission from ctx))),
 ('Production : enregistrer le brief et le RDV', 'autorisé',
  pg_temp.fait('d0d0d0d0-0000-0000-0000-000000000001', 'update prestations set livrables_demandes = ''Photos + vidéos'', heure_rdv = ''08:45'', statut_financier = coalesce(statut_financier, ''non_facturée'') where id = ''' || pg_temp.m() || '''')),
 ('Production : changer le prix client', 'refusé',
  pg_temp.court(pg_temp.fait('d0d0d0d0-0000-0000-0000-000000000001', 'update prestations set montant_ht = 200 where id = ''' || pg_temp.m() || ''''))),
 ('photographe : envoyer les propositions', 'refusé',
  pg_temp.court(pg_temp.fait('d0d0d0d0-0000-0000-0000-000000000002', 'select envoyer_propositions_mission(''' || pg_temp.m() || ''')'))),
 ('Production d''un autre pôle : envoyer les propositions', 'refusé',
  pg_temp.court(pg_temp.fait('d0d0d0d0-0000-0000-0000-000000000003', 'select envoyer_propositions_mission(''' || pg_temp.m() || ''')'))),
 ('Production du pôle : valider et envoyer', 'autorisé',
  pg_temp.fait('d0d0d0d0-0000-0000-0000-000000000001', 'select envoyer_propositions_mission(''' || pg_temp.m() || ''')'));
-- Chaque vérification dans sa propre instruction : elle doit lire l'état APRÈS l'envoi.
insert into verdicts (controle, attendu, obtenu) values
 ('la proposition est partie', 'invitation_envoyée', (select statut::text from prestations_equipe where prestation_id = (select mission from ctx))),
('l''opérateur est notifié, avec son montant', 'oui',
  (select case when count(*) = 1 and bool_and(message like '%60 €%' and message like '%Stade ZZ%') then 'oui' else 'non' end
     from notifications where destinataire_id = 'd0d0d0d0-0000-0000-0000-000000000002' and type = 'invitation')),
 ('opérateur : voit maintenant la mission et sa ligne', '1/1',
  pg_temp.lu('d0d0d0d0-0000-0000-0000-000000000002', 'select (select count(*) from prestations where id = ''' || pg_temp.m() || ''')::text || ''/'' || (select count(*) from prestations_equipe_display where prestation_id = ''' || pg_temp.m() || ''')::text')),
 ('opérateur : accepter', 'autorisé',
  pg_temp.fait('d0d0d0d0-0000-0000-0000-000000000002', 'update prestations_equipe set statut = ''acceptée'', date_reponse = now() where prestation_id = ''' || pg_temp.m() || ''''));
insert into verdicts (controle, attendu, obtenu) values
 ('l''acceptation est enregistrée', 'acceptée', (select statut::text from prestations_equipe where prestation_id = (select mission from ctx))),
 ('par défaut (autres écrans), l''ajout invite toujours directement', 'invitation_envoyée',
  (select case when exists (select 1 from pg_proc where proname = 'rpc_ajouter_membre_equipe' and pg_get_function_arguments(oid) like '%p_envoyer boolean DEFAULT true%') then 'invitation_envoyée' else 'non' end));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
