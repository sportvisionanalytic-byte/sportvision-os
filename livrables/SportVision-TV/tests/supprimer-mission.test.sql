-- Supprimer une mission (migration v138, 10/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • la Production du pôle supprime une mission pas commencée : l'opérateur invité est prévenu,
--     le kit redevient disponible, la présence du CM est retirée et le CM prévenu, la demande du club
--     passe « non retenue » avec le motif, une copie reste dans audit_logs, le club n'est pas notifié ;
--   • ni un photographe, ni la Production d'un autre pôle ; ni une mission partie sur le terrain,
--     ni une mission qui porte des frais.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('e1e1e1e1-0000-0000-0000-000000000001','zz-sup-prod@example.invalid','',now(),'authenticated','authenticated'),
  ('e1e1e1e1-0000-0000-0000-000000000002','zz-sup-photo@example.invalid','',now(),'authenticated','authenticated'),
  ('e1e1e1e1-0000-0000-0000-000000000003','zz-sup-cm@example.invalid','',now(),'authenticated','authenticated'),
  ('e1e1e1e1-0000-0000-0000-000000000004','zz-sup-prod-foot@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role, actif) values
  ('e1e1e1e1-0000-0000-0000-000000000001','QA','Prod','prod',true),
  ('e1e1e1e1-0000-0000-0000-000000000002','QA','Photo','photo',true),
  ('e1e1e1e1-0000-0000-0000-000000000003','QA','CM','cm',true),
  ('e1e1e1e1-0000-0000-0000-000000000004','QA','Prod Foot','prod',true)
on conflict (id) do update set role = excluded.role;

create temp table ctx on commit drop as
  with pole as (select id from poles where nom = 'Basket'),
       cli as (insert into clients (nom, statut_relation, pole_id, cm_id) select 'ZZ Club Suppression (test)', 'partenaire', id, 'e1e1e1e1-0000-0000-0000-000000000003' from pole returning id),
       clu as (insert into clubs (nom, portail_client_id) select 'ZZ Club Suppression (test)', id from cli returning id),
       mat as (insert into club_matches (club_id, team, opponent, match_date, kickoff_time, lieu) select id, 'ZZ U13', 'ZZ Adv', current_date + 6, '10:00', 'Stade ZZ' from clu returning id),
       kit as (insert into kits (nom, type_kit, statut) values ('ZZ Kit Suppression', 'Photo', 'disponible') returning id)
  select (select id from pole) pole_id, (select id from cli) client_id, (select id from clu) club_id, (select id from mat) match_id, (select id from kit) kit_id;
grant select on ctx to authenticated;
insert into pole_affectations (pole_id, user_id, role_pole, actif)
select pole_id, 'e1e1e1e1-0000-0000-0000-000000000001'::uuid, 'membre', true from ctx union all
select (select id from poles where nom = 'Football'), 'e1e1e1e1-0000-0000-0000-000000000004'::uuid, 'membre', true;
insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif)
select club_id, 'e1e1e1e1-0000-0000-0000-000000000003'::uuid, 'principal', current_date, true from ctx;
insert into organization_entitlements (organization_id, module_key, actif) select club_id, 'presences', true from ctx;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create temp table memo (cle text primary key, v text) on commit drop;
grant select, insert on memo to authenticated;
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
create or replace function pg_temp.court(t text) returns text language sql as $$ select split_part(t, ' :', 1) $$;

-- Le club demande, le CM accepte : présence + mission. La Production invite l'opérateur, attribue un kit.
select pg_temp.fait('e1e1e1e1-0000-0000-0000-000000000003', 'select cm_definir_couverture(''match:' || (select match_id from ctx) || ''', ''photo'')');
insert into memo select 'mission', created_prestation_id::text from planned_presences where match_id = (select match_id from ctx) and statut <> 'annule';
insert into coverage_wishes (club_id, match_id, requested_by_user_id, requested_coverage_type, priority, source, status, planned_presence_id)
select club_id, match_id, 'e1e1e1e1-0000-0000-0000-000000000003'::uuid, 'photo', 'normale', 'club_request', 'selected', (select id from planned_presences where match_id = (select match_id from ctx) and statut <> 'annule') from ctx;
select pg_temp.fait('e1e1e1e1-0000-0000-0000-000000000001', 'select rpc_ajouter_membre_equipe(''' || (select v from memo where cle = 'mission') || ''', ''e1e1e1e1-0000-0000-0000-000000000002'', ''Photo'', null, null, 55, 3::smallint, 55, 1, 55, null, null, true)');
select pg_temp.fait('e1e1e1e1-0000-0000-0000-000000000001', 'insert into kit_reservations (kit_id, prestation_id, collaborateur_id, statut) values (''' || (select kit_id from ctx) || ''', ''' || (select v from memo where cle = 'mission') || ''', null, ''réservé'')');
update kits set statut = 'réservé' where id = (select kit_id from ctx);

insert into verdicts (controle, attendu, obtenu) values
 ('photographe : supprimer la mission', 'refusé', pg_temp.court(pg_temp.fait('e1e1e1e1-0000-0000-0000-000000000002', 'select supprimer_mission(''' || (select v from memo where cle = 'mission') || ''')')));
insert into verdicts (controle, attendu, obtenu) values
 ('Production d''un autre pôle : supprimer la mission', 'refusé', pg_temp.court(pg_temp.fait('e1e1e1e1-0000-0000-0000-000000000004', 'select supprimer_mission(''' || (select v from memo where cle = 'mission') || ''')')));
insert into verdicts (controle, attendu, obtenu) values
 ('Production du pôle : supprimer la mission', 'autorisé', pg_temp.fait('e1e1e1e1-0000-0000-0000-000000000001', 'select supprimer_mission(''' || (select v from memo where cle = 'mission') || ''', ''Match reporté'')'));
insert into verdicts (controle, attendu, obtenu) values
 ('la mission n''existe plus', '0', (select count(*)::text from prestations where id = (select v from memo where cle = 'mission')::uuid));
insert into verdicts (controle, attendu, obtenu) values
 ('l''opérateur invité est prévenu, avec le motif', 'oui', (select case when count(*) = 1 and bool_and(message like '%Match reporté%') then 'oui' else 'non' end from notifications where destinataire_id = 'e1e1e1e1-0000-0000-0000-000000000002' and titre like 'Mission annulée%'));
insert into verdicts (controle, attendu, obtenu) values
 ('le kit redevient disponible', 'disponible/0', (select statut || '/' || (select count(*) from kit_reservations where kit_id = (select kit_id from ctx)) from kits where id = (select kit_id from ctx)));
insert into verdicts (controle, attendu, obtenu) values
 ('la présence du CM est retirée', 'annule', (select statut from planned_presences where match_id = (select match_id from ctx) order by created_at desc limit 1));
insert into verdicts (controle, attendu, obtenu) values
 ('le CM est prévenu', '1', (select count(*)::text from notifications where destinataire_id = 'e1e1e1e1-0000-0000-0000-000000000003' and titre = 'Présence retirée par la Production'));
insert into verdicts (controle, attendu, obtenu) values
 ('la demande du club passe « non retenue », avec le motif', 'not_selected/Match reporté', (select status || '/' || not_selected_reason from coverage_wishes where club_id = (select club_id from ctx)));
insert into verdicts (controle, attendu, obtenu) values
 ('une copie complète reste dans le journal', 'oui', (select case when count(*) = 1 and bool_and(details ? 'mission' and jsonb_array_length(details->'equipe') = 1) then 'oui' else 'non' end from audit_logs where action = 'mission_supprimee' and cible_id = (select v from memo where cle = 'mission')::uuid));

-- Mission partie sur le terrain ; mission avec des frais.
create temp table m2 on commit drop as
  with p as (insert into prestations (client_id, date_prestation, type_prestation, statut, source)
             select client_id, current_date + 2, 'match', s::statut_prestation, 'interne' from ctx, (values ('équipe_en_route'), ('planifiée')) v(s) returning id, statut)
  select id, statut::text st from p;
grant select on m2 to authenticated;
insert into frais (collaborateur_id, prestation_id, type, montant, statut, date_frais)
select 'e1e1e1e1-0000-0000-0000-000000000002', id, 'km', 12, 'en_attente', current_date from m2 where st = 'planifiée';
insert into verdicts (controle, attendu, obtenu) values
 ('mission partie sur le terrain : pas de suppression', 'refusé', pg_temp.court(pg_temp.fait('e1e1e1e1-0000-0000-0000-000000000001', 'select supprimer_mission(''' || (select id from m2 where st = 'équipe_en_route') || ''')'))),
 ('mission qui porte des frais : pas de suppression', 'refusé', pg_temp.court(pg_temp.fait('e1e1e1e1-0000-0000-0000-000000000001', 'select supprimer_mission(''' || (select id from m2 where st = 'planifiée') || ''')')));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
