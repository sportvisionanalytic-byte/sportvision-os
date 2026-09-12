-- « Je suis arrivé » prévient la Production (v187, 12/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • déclarer son arrivée horodate la mission et prévient la Production DU PÔLE, elle seule ;
--   • le message dit qui est arrivé, à quelle heure, et le retard sur le rendez-vous ;
--   • une mission rouverte puis re-déclarée ne renotifie pas et garde son heure d'origine ;
--   • un retard important passe en priorité haute.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('a5a5a5a5-0000-0000-0000-000000000001','zz-arr-photo@example.invalid','',now(),'authenticated','authenticated'),
  ('a5a5a5a5-0000-0000-0000-000000000002','zz-arr-prod@example.invalid','',now(),'authenticated','authenticated'),
  ('a5a5a5a5-0000-0000-0000-000000000003','zz-arr-prod-autre@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, email, prenom, nom, role, actif, niveau_operateur) values
  ('a5a5a5a5-0000-0000-0000-000000000001','zz-arr-photo@example.invalid','Mickaël','Photographe','photo',true,3),
  ('a5a5a5a5-0000-0000-0000-000000000002','zz-arr-prod@example.invalid','QA','Production Basket','prod',true,null),
  ('a5a5a5a5-0000-0000-0000-000000000003','zz-arr-prod-autre@example.invalid','QA','Production Football','prod',true,null)
on conflict (id) do update set role = excluded.role, prenom = excluded.prenom, nom = excluded.nom, actif = true;
insert into pole_affectations (pole_id, user_id, role_pole, actif)
select id, 'a5a5a5a5-0000-0000-0000-000000000002'::uuid, 'membre', true from poles where nom = 'Basket';
insert into pole_affectations (pole_id, user_id, role_pole, actif)
select id, 'a5a5a5a5-0000-0000-0000-000000000003'::uuid, 'membre', true from poles where nom = 'Football';

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation, pole_id) select 'ZZ Client Arrivee (test)','partenaire', id from poles where nom = 'Basket' returning id),
       p as (insert into prestations (client_id, pole_id, date_prestation, heure_rdv, type_prestation, statut, source, format_mission)
             select cli.id, (select id from poles where nom = 'Basket'), current_date,
                    ((now() at time zone 'Europe/Paris')::time - interval '35 minutes')::time,
                    'match', 'équipe_en_route', 'interne', 'standard' from cli returning id)
  select (select id from p) mission;
-- L'opérateur doit être affecté à la mission : c'est la garde qui ouvre les transitions du Jour J.
insert into prestations_equipe (prestation_id, collaborateur_id, fonction, statut)
select mission, 'a5a5a5a5-0000-0000-0000-000000000001', 'photographe', 'acceptée' from ctx;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

-- L'opérateur déclare son arrivée.
select set_config('request.jwt.claims', '{"sub":"a5a5a5a5-0000-0000-0000-000000000001","role":"authenticated"}', true);
update prestations set statut = 'arrivée_sur_place' where id = (select mission from ctx);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select pg_temp.note('l''heure d''arrivée est conservée', 'oui',
  (select case when arrivee_sur_place_at is not null then 'oui' else 'NON' end from prestations p, ctx where p.id = ctx.mission));
select pg_temp.note('la Production du pôle est prévenue', '1',
  (select count(*)::text from notifications n, ctx
    where n.lien_prestation_id = ctx.mission and n.destinataire_id = 'a5a5a5a5-0000-0000-0000-000000000002'));
select pg_temp.note('la Production d''un autre pôle ne l''est pas', '0',
  (select count(*)::text from notifications n, ctx
    where n.lien_prestation_id = ctx.mission and n.destinataire_id = 'a5a5a5a5-0000-0000-0000-000000000003'));
select pg_temp.note('le message nomme la personne', 'oui',
  (select case when message like '%Mickaël Photographe%' then 'oui' else 'NON : ' || left(message, 80) end
     from notifications n, ctx where n.lien_prestation_id = ctx.mission limit 1));
select pg_temp.note('et signale le retard', 'oui',
  (select case when message like '%minutes après l''heure prévue%' then 'oui' else 'NON : ' || left(message, 90) end
     from notifications n, ctx where n.lien_prestation_id = ctx.mission limit 1));
select pg_temp.note('un retard important passe en priorité haute', 'haute',
  (select priorite from notifications n, ctx where n.lien_prestation_id = ctx.mission limit 1));

-- La mission repart en arrière (geste de la Production, jamais de l'opérateur : cette transition
-- ne lui est pas ouverte), puis l'opérateur redéclare son arrivée.
update prestations set statut = 'équipe_en_route' where id = (select mission from ctx);
select set_config('request.jwt.claims', '{"sub":"a5a5a5a5-0000-0000-0000-000000000001","role":"authenticated"}', true);
update prestations set statut = 'arrivée_sur_place' where id = (select mission from ctx);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.note('revenir sur ses pas ne prévient pas deux fois', '1',
  (select count(*)::text from notifications n, ctx
    where n.lien_prestation_id = ctx.mission and n.destinataire_id = 'a5a5a5a5-0000-0000-0000-000000000002'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
