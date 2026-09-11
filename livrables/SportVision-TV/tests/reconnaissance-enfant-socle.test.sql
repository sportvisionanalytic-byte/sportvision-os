-- Le socle de la reconnaissance de l'enfant : le consentement commande tout (v159, 12/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • un parent confirmé donne le consentement pour SON enfant ; un inconnu ne le peut pas ;
--   • sans consentement accordé, aucune référence de visage ne peut être enregistrée ;
--   • retirer le consentement efface la référence et les suggestions non validées, tout de suite ;
--   • un marquage validé par un humain survit au retrait (c'est une étiquette, pas de la biométrie) ;
--   • personne, hors Administration, ne lit les références de visage ;
--   • les photos d'un joueur ne comptent que les marquages validés.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('f1f1f1f1-1111-0000-0000-000000000001','zz-rec-parent@example.invalid','',now(),'authenticated','authenticated'),
  ('f1f1f1f1-1111-0000-0000-000000000002','zz-rec-inconnu@example.invalid','',now(),'authenticated','authenticated'),
  ('f1f1f1f1-1111-0000-0000-000000000003','zz-rec-admin@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role, actif) values ('f1f1f1f1-1111-0000-0000-000000000003','QA','Admin','admin',true)
on conflict (id) do update set role = excluded.role;
create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Reco (test)', 'partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Reco (test)', id, 'performance' from cli returning id),
       j as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
             select id, 'QA', 'Enfant', date '2014-03-02', 'sans_compte' from clu returning id),
       al as (insert into media_albums (title, club_id, status, event_date) select 'ZZ Galerie Reco', id, 'published', current_date from clu returning id)
  select (select id from clu) club_id, (select id from j) player_id, (select id from al) album_id;
grant select on ctx to authenticated;
insert into parent_profiles (id, user_id, prenom, nom) values
  ('f1f1f1f1-1111-0000-0000-000000000001', 'f1f1f1f1-1111-0000-0000-000000000001', 'QA', 'Parent') on conflict (id) do nothing;
insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
select 'f1f1f1f1-1111-0000-0000-000000000001'::uuid, player_id, 'parent', 'confirme', now() from ctx;
insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, status)
select album_id, club_id, 'photo', 'sportvision-media-prive', 'zz/photo1.jpg', 'ready' from ctx union all
select album_id, club_id, 'photo', 'sportvision-media-prive', 'zz/photo2.jpg', 'ready' from ctx;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.fait(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text := 'autorisé'; n int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql;
    get diagnostics n = row_count;
    if n = 0 then v := 'aucune ligne'; end if;
  exception when others then v := 'refusé : ' || sqlerrm; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return v;
end $$;
create or replace function pg_temp.consentir(p_uid uuid) returns text language sql as $$
  select pg_temp.fait(p_uid, format(
    'insert into consentements_biometrie (player_id, club_id, donne_par, qualite, texte_version) values (%L, %L, %L, ''parent'', ''v1-2026-09'')',
    (select player_id from ctx), (select club_id from ctx), p_uid)); $$;

select pg_temp.note('un inconnu ne consent pas pour l''enfant d''un autre', 'refusé', left(pg_temp.consentir('f1f1f1f1-1111-0000-0000-000000000002'), 6));
select pg_temp.note('sans consentement, aucune référence de visage', 'refusé',
  left(pg_temp.fait('f1f1f1f1-1111-0000-0000-000000000003', format(
    'insert into player_face_refs (player_id, consentement_id, moteur) values (%L, gen_random_uuid(), ''a_choisir'')', (select player_id from ctx))), 6));
select pg_temp.note('le parent confirmé donne le consentement', 'autorisé', pg_temp.consentir('f1f1f1f1-1111-0000-0000-000000000001'));
select pg_temp.note('le consentement est actif', 'oui',
  case when consentement_biometrie_actif((select player_id from ctx)) then 'oui' else 'non' end);
-- La référence de visage, posée par l'Administration sous ce consentement.
insert into player_face_refs (player_id, consentement_id, moteur, reference_externe)
select ctx.player_id, c.id, 'a_choisir', 'ref-externe-zz' from ctx join consentements_biometrie c on c.player_id = ctx.player_id;
select pg_temp.note('la référence existe', '1', (select count(*)::text from player_face_refs where player_id = (select player_id from ctx)));
select pg_temp.note('le parent ne lit pas les références de visage', 'aucune ligne',
  pg_temp.fait('f1f1f1f1-1111-0000-0000-000000000001', 'select 1 from player_face_refs where player_id = ''' || (select player_id from ctx) || ''''));
-- Une suggestion de machine et un marquage validé par un humain.
insert into media_player_tags (media_ref_type, media_ref_id, player_id, source, statut, score, moteur)
select 'media_asset', a.id, ctx.player_id, 'suggestion', 'propose', 0.91, 'a_choisir'
  from ctx join media_assets a on a.album_id = ctx.album_id and a.original_path = 'zz/photo1.jpg';
insert into media_player_tags (media_ref_type, media_ref_id, player_id, source, statut, valide_par, valide_le)
select 'media_asset', a.id, ctx.player_id, 'humain', 'valide', 'f1f1f1f1-1111-0000-0000-000000000003', now()
  from ctx join media_assets a on a.album_id = ctx.album_id and a.original_path = 'zz/photo2.jpg';
select pg_temp.note('seuls les marquages validés comptent comme photos du joueur', '1',
  (select count(*)::text from photos_taggees_du_joueur((select player_id from ctx))));
-- Le retrait du consentement.
select pg_temp.note('le parent retire son consentement', 'autorisé',
  pg_temp.fait('f1f1f1f1-1111-0000-0000-000000000001', 'update consentements_biometrie set statut = ''retire'' where player_id = ''' || (select player_id from ctx) || ''''));
select pg_temp.note('la référence de visage est effacée', '0', (select count(*)::text from player_face_refs where player_id = (select player_id from ctx)));
select pg_temp.note('les suggestions non validées aussi', '0',
  (select count(*)::text from media_player_tags where player_id = (select player_id from ctx) and statut = 'propose'));
select pg_temp.note('le marquage validé par un humain survit', '1',
  (select count(*)::text from photos_taggees_du_joueur((select player_id from ctx))));
select pg_temp.note('le consentement n''est plus actif', 'non',
  case when consentement_biometrie_actif((select player_id from ctx)) then 'oui' else 'non' end);

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
