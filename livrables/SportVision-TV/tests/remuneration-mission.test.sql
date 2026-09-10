-- La rémunération mission : qui la fixe, le motif, l'historique, le verrou après acceptation, et
-- qui voit quoi (migration v127, 10/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • la Production fixe une rémunération ; le secrétariat et l'opérateur, non ;
--   • au-delà de 15 % d'écart avec le montant recommandé, il faut un motif ;
--   • chaque changement est historisé, motif et auteur compris ;
--   • une fois acceptée, la rémunération peut monter, pas descendre — sauf nouvelle proposition,
--     qui renvoie l'affectation en invitation ;
--   • la Production ne change plus le prix client ;
--   • la rentabilité et les montants : ni l'opérateur (hors le sien), ni le CM ; la Production, oui.
--
--   Exécution : coller dans l'éditeur SQL, ou POSTer sur /v1/projects/<ref>/database/query.
--   Tout est annulé, rien ne subsiste.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('a1a1a1a1-0000-0000-0000-000000000001','zz-remu-prod@example.invalid','',now(),'authenticated','authenticated'),
  ('a1a1a1a1-0000-0000-0000-000000000002','zz-remu-sec@example.invalid','',now(),'authenticated','authenticated'),
  ('a1a1a1a1-0000-0000-0000-000000000003','zz-remu-photo@example.invalid','',now(),'authenticated','authenticated'),
  ('a1a1a1a1-0000-0000-0000-000000000004','zz-remu-cm@example.invalid','',now(),'authenticated','authenticated'),
  ('a1a1a1a1-0000-0000-0000-000000000005','zz-remu-photo2@example.invalid','',now(),'authenticated','authenticated'),
  ('a1a1a1a1-0000-0000-0000-000000000006','zz-remu-admin@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role) values
  ('a1a1a1a1-0000-0000-0000-000000000001','QA','Prod','prod'),
  ('a1a1a1a1-0000-0000-0000-000000000002','QA','Sec','sec'),
  ('a1a1a1a1-0000-0000-0000-000000000003','Lincoln','QA','photo'),
  ('a1a1a1a1-0000-0000-0000-000000000004','QA','CM','cm'),
  ('a1a1a1a1-0000-0000-0000-000000000005','Autre','Photo','photo'),
  ('a1a1a1a1-0000-0000-0000-000000000006','QA','Admin','admin')
on conflict (id) do update set role = excluded.role, prenom = excluded.prenom;
-- La Production de test appartient au pôle du club : sans ce périmètre, ses écritures ne
-- toucheraient aucune ligne, et le test prendrait une absence d'effet pour un refus.
insert into pole_affectations (pole_id, user_id, role_pole, actif)
select cl.pole_id, 'a1a1a1a1-0000-0000-0000-000000000001', 'membre', true
  from clubs c join clients cl on cl.id = c.portail_client_id where c.id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54';

create temp table ctx on commit drop as
  select (select portail_client_id from clubs where id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54') as client_id;
grant select on ctx to authenticated;

-- Une mission vendue 120 €.
create temp table m on commit drop as
  with ins as (
    insert into prestations (client_id, date_prestation, type_prestation, statut, source, montant_ht, couverture)
    select client_id, current_date + 5, 'match', 'planifiée', 'interne', 120, 'photo' from ctx returning id)
  select id from ins;
grant select on m to authenticated;

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

-- ── Affecter : la Production fixe, avec la grille en référence ──
select pg_temp.essai('affecter avec 70 € sans motif (reco 55 €, +27 %) — production',
  'a1a1a1a1-0000-0000-0000-000000000001',
  'select rpc_ajouter_membre_equipe((select id from m), ''a1a1a1a1-0000-0000-0000-000000000003'', ''Photo'', null, null, 70, 3::smallint, 55, 1, 55, null, null)',
  'refusé');
select pg_temp.essai('affecter avec 70 €, motif « grande amplitude » — production',
  'a1a1a1a1-0000-0000-0000-000000000001',
  'insert into memo select ''pe'', rpc_ajouter_membre_equipe((select id from m), ''a1a1a1a1-0000-0000-0000-000000000003'', ''Photo'', null, null, 70, 3::smallint, 55, 1, 55, ''grande_amplitude'', ''Match à 60 km, départ 12h'')::text',
  'autorisé');
select pg_temp.essai('affecter avec une rémunération — secrétariat',
  'a1a1a1a1-0000-0000-0000-000000000002',
  'select rpc_ajouter_membre_equipe((select id from m), ''a1a1a1a1-0000-0000-0000-000000000005'', ''Photo'', null, null, 50, null, null, null, 55, null, null)',
  'refusé');

-- ── L'opérateur voit SON montant, pas celui des autres, ni la rentabilité ──
do $$
declare v_mien numeric; v_rentab int;
begin
  perform pg_temp.en('a1a1a1a1-0000-0000-0000-000000000003');
  select remuneration into v_mien from prestations_equipe_display where id = (select v from memo where cle = 'pe')::uuid;
  select count(*) into v_rentab from v_rentabilite_missions where prestation_id = (select id from m);
  perform pg_temp.hors();
  perform pg_temp.note('opérateur : voit sa rémunération avant d''accepter', '70', coalesce(trim_scale(v_mien)::text, 'masquée'));
  perform pg_temp.note('opérateur : ne voit pas la rentabilité de la mission', '0', v_rentab::text);
end $$;

-- ── Le CM ne voit ni montant ni rentabilité ; la Production voit tout ──
do $$
declare v_cm_remu numeric; v_cm_rentab int; v_prod_remu numeric; v_prod_rentab int; v_prod_reco numeric;
begin
  perform pg_temp.en('a1a1a1a1-0000-0000-0000-000000000004');
  select remuneration into v_cm_remu from prestations_equipe_display where id = (select v from memo where cle = 'pe')::uuid;
  select count(*) into v_cm_rentab from v_rentabilite_missions where prestation_id = (select id from m);
  perform pg_temp.hors();
  perform pg_temp.en('a1a1a1a1-0000-0000-0000-000000000001');
  select remuneration, montant_recommande into v_prod_remu, v_prod_reco from prestations_equipe_display where id = (select v from memo where cle = 'pe')::uuid;
  select count(*) into v_prod_rentab from v_rentabilite_missions where prestation_id = (select id from m);
  perform pg_temp.hors();
  perform pg_temp.note('CM : aucun montant d''opérateur', 'masquée', coalesce(v_cm_remu::text, 'masquée'));
  perform pg_temp.note('CM : pas de rentabilité', '0', v_cm_rentab::text);
  perform pg_temp.note('production : voit rémunération et recommandé', '70/55', coalesce(trim_scale(v_prod_remu)::text, '?') || '/' || coalesce(trim_scale(v_prod_reco)::text, '?'));
  perform pg_temp.note('production : voit la rentabilité (prix vendu, coût, marge)', '1', v_prod_rentab::text);
end $$;

-- ── Avant acceptation : la Production modifie librement ──
-- Le seuil de 15 % (validé par Fouka le 10/09) : dans les deux sens, strict, sans validation Admin.
select pg_temp.essai('passer à 65 € sans motif (reco 55 €, +18 %) — production', 'a1a1a1a1-0000-0000-0000-000000000001',
  'select modifier_remuneration_mission((select v from memo where cle = ''pe'')::uuid, 65, 55, null, null)', 'refusé');
select pg_temp.essai('passer à 45 € sans motif (reco 55 €, −18 %) — production', 'a1a1a1a1-0000-0000-0000-000000000001',
  'select modifier_remuneration_mission((select v from memo where cle = ''pe'')::uuid, 45, 55, null, null)', 'refusé');
select pg_temp.essai('baisser à 60 € avant acceptation — production', 'a1a1a1a1-0000-0000-0000-000000000001',
  'select modifier_remuneration_mission((select v from memo where cle = ''pe'')::uuid, 60, 55, null, null)', 'autorisé');
select pg_temp.essai('modifier la rémunération — secrétariat', 'a1a1a1a1-0000-0000-0000-000000000002',
  'select modifier_remuneration_mission((select v from memo where cle = ''pe'')::uuid, 80, 55, ''urgence'', null)', 'refusé');
select pg_temp.essai('modifier sa propre rémunération — opérateur', 'a1a1a1a1-0000-0000-0000-000000000003',
  'update prestations_equipe set remuneration = 200 where id = (select v from memo where cle = ''pe'')::uuid', 'refusé');

-- ── L'opérateur accepte à 60 € : le montant est engagé ──
select pg_temp.essai('accepter sa mission — opérateur', 'a1a1a1a1-0000-0000-0000-000000000003',
  'update prestations_equipe set statut = ''acceptée'' where id = (select v from memo where cle = ''pe'')::uuid', 'autorisé');
-- Écriture directe, par un admin (qui lit la ligne) : le verrou est en base, pas dans l'écran.
select pg_temp.essai('baisser en douce après acceptation (écriture directe) — admin', 'a1a1a1a1-0000-0000-0000-000000000006',
  'update prestations_equipe set remuneration = 50 where id = (select v from memo where cle = ''pe'')::uuid', 'refusé');
do $$ begin
  perform pg_temp.note('le montant accepté est intact', '60',
    (select trim_scale(remuneration)::text from prestations_equipe where id = (select v from memo where cle = 'pe')::uuid));
end $$;
select pg_temp.essai('augmenter à 62 € après acceptation — production', 'a1a1a1a1-0000-0000-0000-000000000001',
  'select modifier_remuneration_mission((select v from memo where cle = ''pe'')::uuid, 62, 55, null, null)', 'autorisé');
do $$
declare v_statut text;
begin
  select statut into v_statut from prestations_equipe where id = (select v from memo where cle = 'pe')::uuid;
  perform pg_temp.note('une hausse ne réouvre pas la mission', 'acceptée', v_statut);
end $$;
select pg_temp.essai('baisser à 55 € par nouvelle proposition — production', 'a1a1a1a1-0000-0000-0000-000000000001',
  'select modifier_remuneration_mission((select v from memo where cle = ''pe'')::uuid, 55, 55, null, null)', 'autorisé');
do $$
declare v_statut text; v_notif int;
begin
  select statut into v_statut from prestations_equipe where id = (select v from memo where cle = 'pe')::uuid;
  select count(*) into v_notif from notifications where destinataire_id = 'a1a1a1a1-0000-0000-0000-000000000003' and titre like 'Nouvelle proposition%';
  perform pg_temp.note('une baisse repart en proposition, à ré-accepter', 'invitation_envoyée', v_statut);
  perform pg_temp.note('l''opérateur est prévenu de la nouvelle proposition', 'oui', case when v_notif > 0 then 'oui' else 'non' end);
end $$;

-- ── L'historique ──
do $$
declare v_n int; v_motif text; v_role text;
begin
  perform pg_temp.en('a1a1a1a1-0000-0000-0000-000000000001');
  select count(*) into v_n from historique_remuneration((select id from m));
  select motif, role_par into v_motif, v_role from historique_remuneration((select id from m)) h where h.motif is not null limit 1;
  perform pg_temp.hors();
  perform pg_temp.note('historique : création + 3 changements de montant', '4', v_n::text);
  perform pg_temp.note('historique : motif et rôle de l''auteur', 'grande_amplitude/prod', coalesce(v_motif, '?') || '/' || coalesce(v_role, '?'));
end $$;
select pg_temp.essai('lire l''historique — opérateur', 'a1a1a1a1-0000-0000-0000-000000000003',
  'select count(*) from historique_remuneration((select id from m))', 'refusé');

-- ── Le prix client ──
select pg_temp.essai('changer le prix client — production', 'a1a1a1a1-0000-0000-0000-000000000001',
  'update prestations set montant_ht = 90 where id = (select id from m)', 'refusé');
do $$ begin
  perform pg_temp.note('le prix client est intact après l''essai de la production', '120',
    (select trim_scale(montant_ht)::text from prestations where id = (select id from m)));
end $$;
select pg_temp.essai('changer le prix client — admin', 'a1a1a1a1-0000-0000-0000-000000000006',
  'update prestations set montant_ht = 130 where id = (select id from m)', 'autorisé');
do $$ begin
  perform pg_temp.note('le prix client a changé par l''admin', '130',
    (select trim_scale(montant_ht)::text from prestations where id = (select id from m)));
end $$;

-- ── La rentabilité du club ──
select pg_temp.essai('rentabilité du club — production', 'a1a1a1a1-0000-0000-0000-000000000001',
  'select rentabilite_club_mois(''f0d3bafa-3004-4831-bd85-249aa9af5c54'', current_date)', 'autorisé');
select pg_temp.essai('rentabilité du club — CM', 'a1a1a1a1-0000-0000-0000-000000000004',
  'select rentabilite_club_mois(''f0d3bafa-3004-4831-bd85-249aa9af5c54'', current_date)', 'refusé');

select pg_temp.essai('rentabilité de tous les clubs du mois — production', 'a1a1a1a1-0000-0000-0000-000000000001',
  'select count(*) from rentabilite_clubs_mois(current_date)', 'autorisé');
select pg_temp.essai('rentabilité de tous les clubs du mois — opérateur', 'a1a1a1a1-0000-0000-0000-000000000003',
  'select count(*) from rentabilite_clubs_mois(current_date)', 'refusé');

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts;

rollback;
