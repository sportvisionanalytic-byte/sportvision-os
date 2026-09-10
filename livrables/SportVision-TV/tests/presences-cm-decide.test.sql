-- Présences : le club demande, le CM décide, la Production organise (migration v132, 10/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • seul le CM du club (ou l'administration) décide d'une présence : ni le président, ni un
--     photographe, ni le secrétariat ;
--   • le club demande : un souhait, le CM notifié, ni présence ni mission ;
--   • le CM accepte : présence ET mission, Production du pôle notifiée ; il peut refuser avec un
--     motif que le club lit ; le président ne peut ni accepter ni refuser, un anonyme non plus ;
--   • un souhait et une présence visent UNE séance d'entraînement, pas le créneau entier.
--
-- Décor fictif (« ZZ »), pôle sans Production réelle : aucune vraie personne n'est notifiée.
-- Tout est annulé, rien ne subsiste.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('f6f6f6f6-0000-0000-0000-000000000001','zz-pres-cm@example.invalid','',now(),'authenticated','authenticated'),
  ('f6f6f6f6-0000-0000-0000-000000000002','zz-pres-president@example.invalid','',now(),'authenticated','authenticated'),
  ('f6f6f6f6-0000-0000-0000-000000000003','zz-pres-prod@example.invalid','',now(),'authenticated','authenticated'),
  ('f6f6f6f6-0000-0000-0000-000000000004','zz-pres-photo@example.invalid','',now(),'authenticated','authenticated'),
  ('f6f6f6f6-0000-0000-0000-000000000005','zz-pres-sec@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role) values
  ('f6f6f6f6-0000-0000-0000-000000000001','QA','CM','cm'),
  ('f6f6f6f6-0000-0000-0000-000000000003','QA','Production','prod'),
  ('f6f6f6f6-0000-0000-0000-000000000004','QA','Photo','photo'),
  ('f6f6f6f6-0000-0000-0000-000000000005','QA','Sec','sec')
on conflict (id) do update set role = excluded.role;

-- Le prochain mardi (au moins 2 jours devant) : le créneau d'entraînement tombe ce jour-là.
create temp table ctx on commit drop as
  with pole as (select id from poles where nom = 'Basket'),
       j as (select (current_date + 2 + ((2 - extract(dow from current_date + 2)::int + 7) % 7))::date as mardi),
       cli as (insert into clients (nom, statut_relation, pole_id, cm_id)
               select 'ZZ Club Présences (test)', 'partenaire', id, 'f6f6f6f6-0000-0000-0000-000000000001' from pole returning id),
       clu as (insert into clubs (nom, portail_client_id) select 'ZZ Club Présences (test)', id from cli returning id),
       mat as (insert into club_matches (club_id, team, opponent, match_date) select id, 'ZZ Seniors', 'ZZ Adversaire', current_date + 4 from clu returning id),
       tea as (insert into club_teams (club_id, name) select id, 'ZZ Seniors R2' from clu returning id)
  select (select id from pole) pole_id, (select id from cli) client_id, (select id from clu) club_id,
         (select id from mat) match_id, (select id from tea) team_id, (select mardi from j) mardi;
insert into club_team_training_slots (team_id, jour, heure_debut, heure_fin)
select team_id, 'mardi', '20:00', '21:30' from ctx;
alter table ctx add column slot_id uuid;
update ctx set slot_id = (select id from club_team_training_slots where team_id = ctx.team_id);
grant select on ctx to authenticated, anon;

do $$ begin
  if exists (select 1 from pole_affectations pa join profiles p on p.id = pa.user_id
              where pa.pole_id = (select pole_id from ctx) and pa.actif and p.role = 'prod') then
    raise exception 'DÉCOR INVALIDE : le pôle Basket a une Production réelle, elle serait notifiée.';
  end if;
end $$;

insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif)
select club_id, 'f6f6f6f6-0000-0000-0000-000000000001'::uuid, 'principal', current_date, true from ctx;
insert into club_members (user_id, club_id, role, status)
select 'f6f6f6f6-0000-0000-0000-000000000002'::uuid, club_id, 'president', 'actif' from ctx;
insert into pole_affectations (pole_id, user_id, role_pole, actif)
select pole_id, 'f6f6f6f6-0000-0000-0000-000000000003'::uuid, 'membre', true from ctx union all
select pole_id, 'f6f6f6f6-0000-0000-0000-000000000005'::uuid, 'membre', true from ctx;
insert into organization_entitlements (organization_id, module_key, actif)
select club_id, 'presences', true from ctx;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated, anon;
grant usage on sequence verdicts_n_seq to authenticated, anon;
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
create or replace function pg_temp.fait(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text := 'autorisé';
begin
  perform pg_temp.en(p_uid);
  begin execute p_sql;
  exception when others then v := 'refusé'; end;
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

-- ── 1. Qui décide directement ──
select pg_temp.note('décider une présence — président', 'refusé',
  pg_temp.fait('f6f6f6f6-0000-0000-0000-000000000002', 'select cm_definir_couverture(''match:' || (select match_id from ctx) || ''', ''photo'')'));
select pg_temp.note('décider une présence — photographe', 'refusé',
  pg_temp.fait('f6f6f6f6-0000-0000-0000-000000000004', 'select cm_definir_couverture(''match:' || (select match_id from ctx) || ''', ''photo'')'));
select pg_temp.note('décider une présence — secrétariat', 'refusé',
  pg_temp.fait('f6f6f6f6-0000-0000-0000-000000000005', 'select cm_definir_couverture(''match:' || (select match_id from ctx) || ''', ''photo'')'));
select pg_temp.note('aucune présence créée par ces essais', '0',
  (select count(*)::text from planned_presences where match_id = (select match_id from ctx)));

-- ── 2. Le club demande : un souhait, rien d'autre ──
select pg_temp.note('demander une présence sur le match — président', 'autorisé',
  pg_temp.fait('f6f6f6f6-0000-0000-0000-000000000002',
    'insert into memo select ''wish_match'', id::text from create_coverage_wishes(''' || (select club_id from ctx) || ''', jsonb_build_array(jsonb_build_object(''match_id'', ''' || (select match_id from ctx) || ''', ''coverage_type'', ''video'', ''priority'', ''forte'')))'));
select pg_temp.note('le souhait est une demande du club', 'club_request/wished',
  (select source || '/' || status from coverage_wishes where id = (select v from memo where cle = 'wish_match')::uuid));
select pg_temp.note('ni présence ni mission tant que le CM n''a pas accepté', '0/0',
  (select count(*)::text from planned_presences where match_id = (select match_id from ctx)) || '/' ||
  (select count(*)::text from prestations where client_id = (select client_id from ctx)));
select pg_temp.note('le CM du club est notifié', '1',
  (select count(*)::text from notifications where destinataire_id = 'f6f6f6f6-0000-0000-0000-000000000001' and titre = 'Nouveau souhait de présence'));

-- ── 3. Accepter : le CM seul ──
select pg_temp.note('accepter la demande — président', 'refusé',
  pg_temp.fait('f6f6f6f6-0000-0000-0000-000000000002', 'select cm_select_coverage_wish(''' || (select v from memo where cle = 'wish_match') || ''')'));
select pg_temp.note('accepter une demande — sans compte (droit d''exécution)', 'non',
  case when exists (select 1 from pg_proc where proname = 'cm_select_coverage_wish' and pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')) then 'oui' else 'non' end);
select pg_temp.note('refuser une demande — sans compte (droit d''exécution)', 'non',
  case when exists (select 1 from pg_proc where proname = 'cm_reject_coverage_wish' and pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')) then 'oui' else 'non' end);
select pg_temp.note('accepter la demande — CM du club', 'autorisé',
  pg_temp.fait('f6f6f6f6-0000-0000-0000-000000000001', 'select cm_select_coverage_wish(''' || (select v from memo where cle = 'wish_match') || ''')'));
select pg_temp.note('la présence est créée, tracée « demande du club », en vidéo', 'club_request/video',
  coalesce((select source || '/' || type_couverture from planned_presences where match_id = (select match_id from ctx) and statut <> 'annule'), 'absente'));
select pg_temp.note('la mission est créée et adressée à la Production du pôle', 'oui',
  coalesce((select case when p.responsable_prod_id = 'f6f6f6f6-0000-0000-0000-000000000003' then 'oui' else 'non' end
              from planned_presences pp join prestations p on p.id = pp.created_prestation_id
             where pp.match_id = (select match_id from ctx) and pp.statut <> 'annule'), 'absente'));
select pg_temp.note('la Production du pôle est notifiée « nouvelle mission »', '1',
  (select count(*)::text from notifications where destinataire_id = 'f6f6f6f6-0000-0000-0000-000000000003' and type = 'nouvelle_mission'));
select pg_temp.note('le souhait passe « retenu », relié à sa présence', 'selected/oui',
  (select status || '/' || case when planned_presence_id is not null then 'oui' else 'non' end from coverage_wishes where id = (select v from memo where cle = 'wish_match')::uuid));

-- ── 4. Une séance d'entraînement précise ──
select pg_temp.note('demander la séance du mardi — président', 'autorisé',
  pg_temp.fait('f6f6f6f6-0000-0000-0000-000000000002',
    'insert into memo select ''wish_occ'', id::text from create_coverage_wishes(''' || (select club_id from ctx) || ''', jsonb_build_array(jsonb_build_object(''occurrence_ref'', ''entrainement:' || (select slot_id from ctx) || ':' || (select mardi from ctx) || ''', ''coverage_type'', ''photo'')))'));
select pg_temp.note('le souhait vise cette séance', 'entrainement:' || (select slot_id from ctx) || ':' || (select mardi from ctx),
  coalesce((select to_jsonb(w)->>'occurrence_ref' from coverage_wishes w where w.id = (select v from memo where cle = 'wish_occ')::uuid), 'absent'));
select pg_temp.note('demander un mercredi sur un créneau du mardi — président', 'refusé',
  pg_temp.fait('f6f6f6f6-0000-0000-0000-000000000002',
    'select create_coverage_wishes(''' || (select club_id from ctx) || ''', jsonb_build_array(jsonb_build_object(''occurrence_ref'', ''entrainement:' || (select slot_id from ctx) || ':' || ((select mardi from ctx) + 1) || ''')))'));
select pg_temp.note('le club lit sa demande : « ZZ Seniors R2 — Entraînement », à sa date', 'ZZ Seniors R2 — Entraînement/' || (select mardi from ctx),
  pg_temp.lu('f6f6f6f6-0000-0000-0000-000000000002',
    'select evenement_libelle || ''/'' || evenement_date from club_souhaits_couverture(''' || (select club_id from ctx) || ''') where id = ''' || (select v from memo where cle = 'wish_occ') || ''''));
select pg_temp.note('refuser la séance — président', 'refusé',
  pg_temp.fait('f6f6f6f6-0000-0000-0000-000000000002', 'select cm_reject_coverage_wish(''' || (select v from memo where cle = 'wish_occ') || ''', ''test'')'));
select pg_temp.note('refuser la séance avec un motif — CM du club', 'autorisé',
  pg_temp.fait('f6f6f6f6-0000-0000-0000-000000000001', 'select cm_reject_coverage_wish(''' || (select v from memo where cle = 'wish_occ') || ''', ''Opérateur indisponible ce soir-là'')'));
select pg_temp.note('le club lit le refus et son motif', 'not_selected/Opérateur indisponible ce soir-là',
  pg_temp.lu('f6f6f6f6-0000-0000-0000-000000000002',
    'select status || ''/'' || not_selected_reason from club_souhaits_couverture(''' || (select club_id from ctx) || ''') where id = ''' || (select v from memo where cle = 'wish_occ') || ''''));
select pg_temp.note('le CM prévoit directement la séance du mardi suivant', 'autorisé',
  pg_temp.fait('f6f6f6f6-0000-0000-0000-000000000001',
    'select cm_definir_couverture(''entrainement:' || (select slot_id from ctx) || ':' || ((select mardi from ctx) + 7) || ''', ''photo_video'')'));
select pg_temp.note('une présence et une mission pour CETTE séance seulement', '1/1',
  (select count(*)::text from planned_presences where occurrence_ref like 'entrainement:' || (select slot_id from ctx) || ':%' and statut <> 'annule') || '/' ||
  (select count(*)::text from planned_presences where occurrence_ref = 'entrainement:' || (select slot_id from ctx) || ':' || ((select mardi from ctx) + 7) and created_prestation_id is not null));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;

rollback;
