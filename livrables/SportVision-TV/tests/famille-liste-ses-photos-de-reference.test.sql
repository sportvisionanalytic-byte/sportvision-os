-- La famille voit ses photos de référence, et personne d'autre (v333, 28/09/2026).
--
-- Tant qu'il n'y en avait qu'une, un booléen suffisait. La v332 en autorise plusieurs : l'écran
-- doit pouvoir les montrer et proposer d'en retirer une. Mais `player_face_refs` n'est lisible que
-- par un administrateur — une famille ne pouvait pas lister ses propres photos.
--
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('b3110000-0000-0000-0000-000000000001','zz-liste-joueur@example.invalid','',now(),'authenticated','authenticated'),
  ('b3110000-0000-0000-0000-000000000002','zz-liste-autre@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

insert into clubs (id, nom, ville, plan) values ('b3110000-0000-0000-0000-0000000000c1','ZZ Liste Club','ZZ','performance');
insert into player_profiles (id, club_id, prenom, nom, date_naissance, account_status, user_id) values
  ('b3110000-0000-0000-0000-0000000000d1','b3110000-0000-0000-0000-0000000000c1','ZZ','Liste',
   (current_date - interval '16 years')::date,'actif','b3110000-0000-0000-0000-000000000001');
insert into consentements_biometrie (id, player_id, donne_par, qualite, texte_version, statut) values
  ('b3110000-0000-0000-0000-0000000000cc','b3110000-0000-0000-0000-0000000000d1',
   'b3110000-0000-0000-0000-000000000001','joueur_15_17','zz-test','accorde');
insert into player_face_refs (id, player_id, consentement_id, moteur, storage_bucket, storage_path) values
  ('b3110000-0000-0000-0000-0000000000e1','b3110000-0000-0000-0000-0000000000d1','b3110000-0000-0000-0000-0000000000cc','en_attente','sportvision-media-prive','visages/b3110000-0000-0000-0000-0000000000d1/face.jpg'),
  ('b3110000-0000-0000-0000-0000000000e2','b3110000-0000-0000-0000-0000000000d1','b3110000-0000-0000-0000-0000000000cc','en_attente','sportvision-media-prive','visages/b3110000-0000-0000-0000-0000000000d1/profil.jpg');

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant insert, select on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.combien(p_uid uuid) returns text language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from photos_de_reference_du_sportif('b3110000-0000-0000-0000-0000000000d1');
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return n::text;
exception when others then
  begin execute 'reset role'; exception when others then null; end;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return 'refuse';
end $$;

select pg_temp.note('le sportif voit ses DEUX photos', '2',
  pg_temp.combien('b3110000-0000-0000-0000-000000000001'));

-- LA BORNE : ce sont des donnees biometriques, personne d'autre ne les liste.
select pg_temp.note('un autre compte n''en voit aucune', '0',
  pg_temp.combien('b3110000-0000-0000-0000-000000000002'));

-- Retirer une photo est un geste volontaire, et il doit marcher pour la famille.
create or replace function pg_temp.retirer(p_uid uuid, p_ref uuid) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
  perform retirer_photo_reference(p_ref);
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return 'retire';
exception when others then
  begin execute 'reset role'; exception when others then null; end;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return 'refuse';
end $$;

select pg_temp.note('un autre compte ne retire pas sa photo', 'refuse',
  pg_temp.retirer('b3110000-0000-0000-0000-000000000002','b3110000-0000-0000-0000-0000000000e1'));

select pg_temp.note('le sportif retire lui-meme une photo ratee', 'retire',
  pg_temp.retirer('b3110000-0000-0000-0000-000000000001','b3110000-0000-0000-0000-0000000000e1'));

select pg_temp.note('il ne lui en reste qu''une', '1',
  pg_temp.combien('b3110000-0000-0000-0000-000000000001'));

-- La photo retiree part a la purge : le fichier ne reste pas dans le stockage.
select pg_temp.note('la photo retiree est mise a purger', '1',
  (select count(*)::text from biometrie_a_purger where player_id = 'b3110000-0000-0000-0000-0000000000d1'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
