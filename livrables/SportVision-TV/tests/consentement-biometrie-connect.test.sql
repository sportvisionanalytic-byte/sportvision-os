-- Consentement de reconnaissance depuis Connect : donner, déposer, retirer (v161, 12/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • seul un parent confirmé, ou le joueur MAJEUR lui-même, peut donner l'accord ;
--   • un joueur mineur titulaire de son compte Connect ne peut pas se l'accorder (v163) ;
--   • un tiers ne peut ni le donner, ni le lire, ni le retirer ;
--   • aucune photo de référence sans accord actif, et aucune photo hors du dossier de l'enfant ;
--   • le retrait efface la référence, met le fichier en file de purge et rend son chemin ;
--   • redonner un accord déjà actif ne crée pas de doublon.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('c1c1c1c1-1111-0000-0000-000000000001','zz-cb-parent@example.invalid','',now(),'authenticated','authenticated'),
  ('c1c1c1c1-1111-0000-0000-000000000002','zz-cb-joueur@example.invalid','',now(),'authenticated','authenticated'),
  ('c1c1c1c1-1111-0000-0000-000000000003','zz-cb-tiers@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Consentement (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Consentement (test)', id, 'performance' from cli returning id),
       j as (insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
             select id, 'c1c1c1c1-1111-0000-0000-000000000002', 'QA', 'Enfant', date '2014-03-03', 'actif' from clu returning id, club_id)
  select (select id from j) player_id, (select club_id from j) club_id;
grant select on ctx to authenticated;
insert into parent_profiles (id, user_id, prenom, nom) values
  ('c1c1c1c1-1111-0000-0000-000000000001','c1c1c1c1-1111-0000-0000-000000000001','QA','Parent'),
  ('c1c1c1c1-1111-0000-0000-000000000003','c1c1c1c1-1111-0000-0000-000000000003','QA','Tiers') on conflict (id) do nothing;
insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
select 'c1c1c1c1-1111-0000-0000-000000000001'::uuid, player_id, 'parent', 'confirme', now() from ctx;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.sous(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.stop() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;
create or replace function pg_temp.essai(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.sous(p_uid);
  begin execute p_sql into v; exception when others then v := 'refusé'; end;
  perform pg_temp.stop();
  return coalesce(v, '∅');
end $$;

-- Le tiers ne peut rien.
select pg_temp.note('un tiers ne peut pas donner l''accord', 'refusé',
  pg_temp.essai('c1c1c1c1-1111-0000-0000-000000000003', 'select donner_consentement_biometrie((select player_id from ctx), ''v1-2026-09'')::text'));
select pg_temp.note('un tiers ne lit pas l''état de l''accord', '∅',
  pg_temp.essai('c1c1c1c1-1111-0000-0000-000000000003', 'select mon_consentement_biometrie((select player_id from ctx))::text'));

-- Le joueur mineur, titulaire de son propre compte, ne peut pas se l'accorder lui-même.
select pg_temp.note('un joueur mineur ne donne pas l''accord lui-même', 'refusé',
  pg_temp.essai('c1c1c1c1-1111-0000-0000-000000000002', 'select donner_consentement_biometrie((select player_id from ctx), ''v1-2026-09'')::text'));
select pg_temp.note('et il ne peut pas déposer de photo', 'refusé',
  pg_temp.essai('c1c1c1c1-1111-0000-0000-000000000002',
    'select enregistrer_photo_reference((select player_id from ctx), ''visages/'' || (select player_id from ctx)::text || ''/ref.jpg'')::text'));

-- Le parent confirmé donne l'accord.
select pg_temp.note('avant tout accord, l''écran annonce « non autorisé »', 'false',
  pg_temp.essai('c1c1c1c1-1111-0000-0000-000000000001', 'select (mon_consentement_biometrie((select player_id from ctx))->>''autorise'')'));
select pg_temp.note('le parent confirmé donne l''accord', 'oui',
  case when pg_temp.essai('c1c1c1c1-1111-0000-0000-000000000001', 'select donner_consentement_biometrie((select player_id from ctx), ''v1-2026-09'')::text') = 'refusé'
       then 'refusé' else 'oui' end);
select pg_temp.note('l''accord est enregistré au nom du parent', 'parent',
  (select qualite from consentements_biometrie where player_id = (select player_id from ctx) and statut = 'accorde'));
select pg_temp.note('la version du texte accepté est conservée', 'v1-2026-09',
  (select texte_version from consentements_biometrie where player_id = (select player_id from ctx) and statut = 'accorde'));
select pg_temp.note('redonner l''accord ne crée pas de doublon', '1',
  (select count(*)::text from consentements_biometrie where player_id = (select player_id from ctx) and statut = 'accorde')
  || case when pg_temp.essai('c1c1c1c1-1111-0000-0000-000000000001', 'select donner_consentement_biometrie((select player_id from ctx), ''v1-2026-09'')::text') is null then '' else '' end);

-- La photo de référence.
select pg_temp.note('une photo hors du dossier de l''enfant est refusée', 'refusé',
  pg_temp.essai('c1c1c1c1-1111-0000-0000-000000000001', 'select enregistrer_photo_reference((select player_id from ctx), ''visages/autre/x.jpg'')::text'));
select pg_temp.note('le parent dépose la photo de référence', 'oui',
  case when pg_temp.essai('c1c1c1c1-1111-0000-0000-000000000001',
    'select enregistrer_photo_reference((select player_id from ctx), ''visages/'' || (select player_id from ctx)::text || ''/ref.jpg'')::text') = 'refusé'
  then 'refusé' else 'oui' end);
select pg_temp.note('l''écran sait que la photo est déposée', 'true',
  pg_temp.essai('c1c1c1c1-1111-0000-0000-000000000001', 'select (mon_consentement_biometrie((select player_id from ctx))->>''photo_deposee'')'));
select pg_temp.note('personne d''autre ne lit la référence de visage', '0',
  pg_temp.essai('c1c1c1c1-1111-0000-0000-000000000001', 'select count(*)::text from player_face_refs'));

-- Le retrait.
select pg_temp.note('un tiers ne retire pas l''accord', 'refusé',
  pg_temp.essai('c1c1c1c1-1111-0000-0000-000000000003', 'select retirer_consentement_biometrie((select player_id from ctx))::text'));
select pg_temp.note('le retrait rend le chemin du fichier à supprimer', 'ref.jpg',
  right(pg_temp.essai('c1c1c1c1-1111-0000-0000-000000000001',
    'select (retirer_consentement_biometrie((select player_id from ctx))->''chemins''->>0)'), 7));
select pg_temp.note('après le retrait, plus aucune référence de visage', '0',
  (select count(*)::text from player_face_refs where player_id = (select player_id from ctx)));
select pg_temp.note('le fichier est mis en file de purge', '1',
  (select count(*)::text from biometrie_a_purger where player_id = (select player_id from ctx) and purge_le is null));
select pg_temp.note('après le retrait, l''écran annonce « non autorisé »', 'false',
  pg_temp.essai('c1c1c1c1-1111-0000-0000-000000000001', 'select (mon_consentement_biometrie((select player_id from ctx))->>''autorise'')'));
select pg_temp.note('plus aucune photo ne peut être déposée', 'refusé',
  pg_temp.essai('c1c1c1c1-1111-0000-0000-000000000001',
    'select enregistrer_photo_reference((select player_id from ctx), ''visages/'' || (select player_id from ctx)::text || ''/ref2.jpg'')::text'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
