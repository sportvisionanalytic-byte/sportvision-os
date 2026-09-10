-- Le circuit complet d'une mission rémunérée, de la décision du CM au paiement (10/09/2026).
--
-- Chaque étape existe et est testée ailleurs, séparément. Ce test les enchaîne sur UNE mission,
-- chacune sous l'identité de celui qui la fait dans la vraie vie, par les mêmes appels que les
-- écrans (Club+ pour le CM, OS pour les autres) :
--   CM décide la présence → mission chez la Production du pôle → affectation avec rémunération
--   → l'opérateur voit son montant et accepte → terrain → Production valide et transmet
--   → comptabilité règle → l'opérateur voit « payé » → rentabilité du club.
--
-- Décor : un club et un client fictifs (« ZZ »), dans un pôle sans Production réelle, pour que
-- rien n'atteigne une vraie personne. Aucune ligne ne part vers la file d'e-mails : le client
-- fictif n'a aucun compte Connect. Tout est annulé, rien ne subsiste.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('e5e5e5e5-0000-0000-0000-000000000001','zz-circuit-cm@example.invalid','',now(),'authenticated','authenticated'),
  ('e5e5e5e5-0000-0000-0000-000000000002','zz-circuit-prod@example.invalid','',now(),'authenticated','authenticated'),
  ('e5e5e5e5-0000-0000-0000-000000000003','zz-circuit-photo@example.invalid','',now(),'authenticated','authenticated'),
  ('e5e5e5e5-0000-0000-0000-000000000004','zz-circuit-compta@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role) values
  ('e5e5e5e5-0000-0000-0000-000000000001','QA','CM','cm'),
  ('e5e5e5e5-0000-0000-0000-000000000002','QA','Production','prod'),
  ('e5e5e5e5-0000-0000-0000-000000000003','QA','Opérateur','photo'),
  ('e5e5e5e5-0000-0000-0000-000000000004','QA','Compta','compta')
on conflict (id) do update set role = excluded.role;

create temp table ctx on commit drop as
  with pole as (select id from poles where nom = 'Basket'),
       cli as (insert into clients (nom, statut_relation, pole_id) select 'ZZ Club Circuit (test)', 'partenaire', id from pole returning id),
       clu as (insert into clubs (nom, portail_client_id) select 'ZZ Club Circuit (test)', id from cli returning id),
       mat as (insert into club_matches (club_id, team, opponent, match_date)
               select id, 'ZZ U15', 'ZZ Adversaire', current_date + 3 from clu returning id, match_date)
  select (select id from pole) pole_id, (select id from cli) client_id, (select id from clu) club_id,
         (select id from mat) match_id, (select match_date from mat) match_date;
grant select on ctx to authenticated;

do $$ begin
  if exists (select 1 from pole_affectations pa join profiles p on p.id = pa.user_id
              where pa.pole_id = (select pole_id from ctx) and pa.actif and p.role = 'prod') then
    raise exception 'DÉCOR INVALIDE : le pôle Basket a une Production réelle, elle serait notifiée.';
  end if;
end $$;

insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif)
select club_id, 'e5e5e5e5-0000-0000-0000-000000000001'::uuid, 'secondaire', current_date, true from ctx;
insert into pole_affectations (pole_id, user_id, role_pole, actif)
select pole_id, 'e5e5e5e5-0000-0000-0000-000000000002'::uuid, 'membre', true from ctx;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
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
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
-- Une action sous une identité : 'autorisé', ou 'refusé : <message>'.
create or replace function pg_temp.fait(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text := 'autorisé';
begin
  perform pg_temp.en(p_uid);
  begin execute p_sql;
  exception when others then v := 'refusé : ' || sqlerrm; end;
  perform pg_temp.hors();
  return v;
end $$;
create or replace function pg_temp.lu(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.en(p_uid);
  begin execute p_sql into v;
  exception when others then v := 'erreur : ' || sqlerrm; end;
  perform pg_temp.hors();
  return coalesce(v, 'nul');
end $$;

-- ── 1. Le CM décide la présence (Club+ : « À couvrir » → Photo) ──
select pg_temp.note('1. CM : décider la présence', 'autorisé',
  pg_temp.fait('e5e5e5e5-0000-0000-0000-000000000001', 'select cm_definir_couverture(''match:' || (select match_id from ctx) || ''', ''photo'')'));
insert into memo select 'mission', created_prestation_id::text from planned_presences where match_id = (select match_id from ctx) and statut <> 'annule';
select pg_temp.note('1. la mission est créée, planifiée', 'planifiée', coalesce((select statut::text from prestations where id = (select v from memo where cle = 'mission')::uuid), 'absente'));
select pg_temp.note('1. elle est adressée à la Production du pôle', 'oui',
  (select case when responsable_prod_id = 'e5e5e5e5-0000-0000-0000-000000000002' then 'oui' else 'non' end from prestations where id = (select v from memo where cle = 'mission')::uuid));
select pg_temp.note('1. la Production est notifiée « nouvelle mission »', '1',
  (select count(*)::text from notifications where prestation_id = (select v from memo where cle = 'mission')::uuid and type = 'nouvelle_mission' and destinataire_id = 'e5e5e5e5-0000-0000-0000-000000000002'));
select pg_temp.note('1. personne d''autre n''est notifié', '0',
  (select count(*)::text from notifications where prestation_id = (select v from memo where cle = 'mission')::uuid and destinataire_id <> 'e5e5e5e5-0000-0000-0000-000000000002'));

-- ── 2. La Production voit la mission et affecte l'opérateur à 60 € (recommandé 55 €) ──
select pg_temp.note('2. Production : la mission est dans ses missions', '1',
  pg_temp.lu('e5e5e5e5-0000-0000-0000-000000000002', 'select count(*)::text from prestations where id = ''' || (select v from memo where cle = 'mission') || ''''));
select pg_temp.note('2. Production : affecter l''opérateur à 60 €', 'autorisé',
  pg_temp.fait('e5e5e5e5-0000-0000-0000-000000000002',
    'insert into memo select ''pe'', rpc_ajouter_membre_equipe(''' || (select v from memo where cle = 'mission') || ''', ''e5e5e5e5-0000-0000-0000-000000000003'', ''Photo'', null, null, 60, 3::smallint, 55, 1, 55, null, null)::text'));

-- ── 3. L'opérateur voit son montant avant d'accepter, et rien d'autre ──
select pg_temp.note('3. opérateur : voit sa rémunération avant d''accepter', '60',
  pg_temp.lu('e5e5e5e5-0000-0000-0000-000000000003', 'select trim_scale(remuneration)::text from prestations_equipe_display where id = ''' || (select v from memo where cle = 'pe') || ''''));
select pg_temp.note('3. opérateur : ne voit pas la rentabilité', '0',
  pg_temp.lu('e5e5e5e5-0000-0000-0000-000000000003', 'select count(*)::text from v_rentabilite_missions where prestation_id = ''' || (select v from memo where cle = 'mission') || ''''));
select pg_temp.note('3. opérateur : accepter (écran « Mes missions »)', 'autorisé',
  pg_temp.fait('e5e5e5e5-0000-0000-0000-000000000003',
    'update prestations_equipe set statut = ''acceptée'', date_reponse = now() where id = ''' || (select v from memo where cle = 'pe') || ''''));
select pg_temp.note('3. l''acceptation est enregistrée', 'acceptée', (select statut::text from prestations_equipe where id = (select v from memo where cle = 'pe')::uuid));
select pg_temp.note('3. la mission avance à « équipe affectée » (même appel que l''OS)', 'autorisé',
  pg_temp.fait('e5e5e5e5-0000-0000-0000-000000000003',
    'update prestations set statut = ''équipe_affectée'' where id = ''' || (select v from memo where cle = 'mission') || ''' and statut = ''planifiée'''));

-- ── 4. Le terrain ──
do $$
declare s text; r text;
begin
  foreach s in array array['équipe_en_route', 'arrivée_sur_place', 'production_démarrée', 'production_terminée'] loop
    r := pg_temp.fait('e5e5e5e5-0000-0000-0000-000000000003',
      'update prestations set statut = ''' || s || ''' where id = ''' || (select m.v from memo m where m.cle = 'mission') || '''');
    perform pg_temp.note('4. opérateur : passer la mission à « ' || s || ' »', 'autorisé', r);
  end loop;
end $$;
select pg_temp.note('4. la mission est « production terminée »', 'production_terminée', (select statut::text from prestations where id = (select v from memo where cle = 'mission')::uuid));

-- ── 5. La Production valide la rémunération et la transmet à la comptabilité ──
select pg_temp.note('5. Production : valider la rémunération', 'autorisé',
  pg_temp.fait('e5e5e5e5-0000-0000-0000-000000000002',
    'update prestations_equipe set statut_paiement = ''validé'' where id = ''' || (select v from memo where cle = 'pe') || ''''));
select pg_temp.note('5. Production : transmettre à la comptabilité', 'autorisé',
  pg_temp.fait('e5e5e5e5-0000-0000-0000-000000000002',
    'update prestations_equipe set statut_paiement = ''transmis_compta'' where id = ''' || (select v from memo where cle = 'pe') || ''''));
select pg_temp.note('5. le paiement est transmis', 'transmis_compta', coalesce((select statut_paiement from prestations_equipe where id = (select v from memo where cle = 'pe')::uuid), 'nul'));
select pg_temp.note('5. Production : marquer « payé » elle-même', 'refusé',
  split_part(pg_temp.fait('e5e5e5e5-0000-0000-0000-000000000002',
    'update prestations_equipe set statut_paiement = ''payé'', date_paiement = current_date where id = ''' || (select v from memo where cle = 'pe') || ''''), ' :', 1));
select pg_temp.note('5. opérateur : se marquer « payé »', 'refusé',
  split_part(pg_temp.fait('e5e5e5e5-0000-0000-0000-000000000003',
    'update prestations_equipe set statut_paiement = ''payé'' where id = ''' || (select v from memo where cle = 'pe') || ''''), ' :', 1));
select pg_temp.note('5. toujours transmis, pas payé', 'transmis_compta', coalesce((select statut_paiement from prestations_equipe where id = (select v from memo where cle = 'pe')::uuid), 'nul'));

-- ── 6. La comptabilité règle (écran « Rémunérations » de la compta) ──
select pg_temp.note('6. comptabilité : voit la rémunération à régler', '60',
  pg_temp.lu('e5e5e5e5-0000-0000-0000-000000000004', 'select trim_scale(remuneration)::text from prestations_equipe_display where id = ''' || (select v from memo where cle = 'pe') || ''''));
select pg_temp.note('6. comptabilité : marquer « payé »', 'autorisé',
  pg_temp.fait('e5e5e5e5-0000-0000-0000-000000000004',
    'update prestations_equipe set statut_paiement = ''payé'', date_paiement = current_date where id = ''' || (select v from memo where cle = 'pe') || ''''));
select pg_temp.note('6. le paiement est enregistré', 'payé', coalesce((select statut_paiement from prestations_equipe where id = (select v from memo where cle = 'pe')::uuid), 'nul'));
select pg_temp.note('6. comptabilité : changer le montant', 'refusé',
  split_part(pg_temp.fait('e5e5e5e5-0000-0000-0000-000000000004',
    'update prestations_equipe set remuneration = 99 where id = ''' || (select v from memo where cle = 'pe') || ''''), ' :', 1));

-- ── 7. L'opérateur voit qu'il est payé ; la rentabilité du club suit ──
select pg_temp.note('7. opérateur : voit « payé »', 'payé',
  pg_temp.lu('e5e5e5e5-0000-0000-0000-000000000003', 'select statut_paiement from prestations_equipe_display where id = ''' || (select v from memo where cle = 'pe') || ''''));
select pg_temp.note('7. rentabilité du club : la rémunération y figure', '60',
  pg_temp.lu('e5e5e5e5-0000-0000-0000-000000000002',
    'select trim_scale((rentabilite_club_mois(''' || (select club_id from ctx) || ''', ''' || (select match_date from ctx) || ''')->>''remunerations'')::numeric)::text'));
select pg_temp.note('7. marge négative (aucun abonnement) : signalée, et la mission a été payée quand même', '-60',
  pg_temp.lu('e5e5e5e5-0000-0000-0000-000000000002',
    'select trim_scale((rentabilite_club_mois(''' || (select club_id from ctx) || ''', ''' || (select match_date from ctx) || ''')->>''marge_estimee'')::numeric)::text'));
select pg_temp.note('7. historique des montants : la création y est', 'oui',
  pg_temp.lu('e5e5e5e5-0000-0000-0000-000000000002',
    'select case when count(*) >= 1 then ''oui'' else ''non'' end from historique_remuneration(''' || (select v from memo where cle = 'mission') || ''')'));
-- now() est l'heure de début de la transaction : tout ce que ce test a mis dans la file en porte.
select pg_temp.note('7. aucun e-mail mis en file par tout le circuit', '0',
  (select count(*)::text from notification_outbox where created_at >= now()));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;

rollback;
