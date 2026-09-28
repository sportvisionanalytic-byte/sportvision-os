-- Une galerie multi-catégories doit reconnaître les joueurs de TOUTES ses équipes (28/09/2026).
--
-- La v280 a ouvert une galerie à plusieurs catégories : `media_albums.team_ids` porte les équipes
-- SUPPLÉMENTAIRES, `team_id` l'équipe principale. Mesuré ce soir sur les 49 galeries réelles : les
-- 5 qui ont des `team_ids` ne contiennent JAMAIS leur propre `team_id` dedans. L'ensemble des
-- équipes d'une galerie est donc l'UNION des deux, et lire l'un sans l'autre voit une galerie
-- incomplète.
--
-- Cinq fonctions faisaient exactement ça, chacune avec sa copie de la règle. Conséquences réelles
-- sur une galerie U14 + U16 :
--   reconnaissance_joueurs_prets   ne proposait AUCUN joueur U16 au marquage
--   visage_rapprocher_direct       ne comparait aucun visage U16, donc ne le trouvait jamais
--   marquer_par_reconnaissance     refusait un joueur U16 : « ne fait pas partie de l'équipe »
--   media_marquages_famille        cachait les marquages au coach de l'équipe U16
--
-- C'est incohérent avec la v309, qui autorise justement la famille d'un surclassé à voir et à
-- confirmer ses photos d'un match d'une autre catégorie : le côté famille était ouvert, le côté
-- staff fermé. Personne ne pouvait donc poser le marquage que la famille était censée confirmer.
--
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('dd110000-0000-0000-0000-000000000001','zz-multicat-staff@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, role, actif) values ('dd110000-0000-0000-0000-000000000001','admin',true)
on conflict (id) do update set role = 'admin', actif = true;

-- `plan` est necessaire, pas decoratif : un club naît en `free`, plafonne a UNE equipe, et
-- check_club_teams_limit refuse la seconde — le test ne pourrait pas meme poser son decor.
insert into clubs (id, nom, ville, plan) values ('dd110000-0000-0000-0000-0000000000c1','ZZ Multicat Club','ZZ Test','performance');
insert into club_teams (id, club_id, name) values
  ('dd110000-0000-0000-0000-0000000000a1','dd110000-0000-0000-0000-0000000000c1','ZZ U14'),
  ('dd110000-0000-0000-0000-0000000000a2','dd110000-0000-0000-0000-0000000000c1','ZZ U16');

-- Un joueur de la SEULE équipe supplémentaire : c'est lui que les fonctions ne voyaient pas.
insert into player_profiles (id, prenom, nom, date_naissance) values
  ('dd110000-0000-0000-0000-0000000000d1','ZZ','Surclasse','2011-01-01');
insert into team_memberships (player_id, team_id, club_id, saison, statut) values
  ('dd110000-0000-0000-0000-0000000000d1','dd110000-0000-0000-0000-0000000000a2','dd110000-0000-0000-0000-0000000000c1','2026-2027','active');
insert into consentements_biometrie (player_id, donne_par, qualite, texte_version, statut) values
  ('dd110000-0000-0000-0000-0000000000d1','dd110000-0000-0000-0000-000000000001','parent','zz-test','accorde');

-- La galerie : équipe principale U14, équipe supplémentaire U16.
insert into media_albums (id, club_id, team_id, team_ids, title, status) values
  ('dd110000-0000-0000-0000-0000000000b1','dd110000-0000-0000-0000-0000000000c1',
   'dd110000-0000-0000-0000-0000000000a1', array['dd110000-0000-0000-0000-0000000000a2']::uuid[],
   'ZZ Galerie U14 + U16','published');
insert into media_assets (id, album_id, original_path, status) values
  ('dd110000-0000-0000-0000-0000000000f1','dd110000-0000-0000-0000-0000000000b1','zz/test.jpg','ready');

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant insert, select on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.sous(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.stop() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '{"role":"service_role"}', true); end $$;

-- L'union des équipes de la galerie, la règle tenue à UN seul endroit.
select pg_temp.note('l''union des equipes de la galerie compte les deux equipes', '2',
  (select coalesce(cardinality(media_equipes_de_la_galerie('dd110000-0000-0000-0000-0000000000b1')),0)::text));

select pg_temp.sous('dd110000-0000-0000-0000-000000000001');

select pg_temp.note('le joueur de l''equipe supplementaire est propose au marquage', 'oui',
  (select case when exists (select 1 from reconnaissance_joueurs_prets('dd110000-0000-0000-0000-0000000000b1')
                             where player_id = 'dd110000-0000-0000-0000-0000000000d1') then 'oui' else 'NON' end));

-- Le cas refuse LEVE une exception : sans l'attraper, elle annulerait tout le test au lieu d'etre
-- mesuree. Cette enveloppe rend un mot, jamais une erreur.
create or replace function pg_temp.essai_marquage(p_asset uuid, p_player uuid) returns text
language plpgsql as $$
begin
  perform marquer_par_reconnaissance(p_asset, p_player, 0.42, 'zz-modele', true);
  return 'accepte';
exception when others then
  return 'refuse';
end $$;

select pg_temp.note('marquer ce joueur est accepte', 'accepte',
  pg_temp.essai_marquage('dd110000-0000-0000-0000-0000000000f1','dd110000-0000-0000-0000-0000000000d1'));

select pg_temp.stop();

-- Et la borne tient toujours : un joueur d'AUCUNE des deux équipes reste refusé. Sans ce
-- contrôle, « corriger » l'union pourrait tout ouvrir sans que rien ne le signale.
insert into club_teams (id, club_id, name) values
  ('dd110000-0000-0000-0000-0000000000a3','dd110000-0000-0000-0000-0000000000c1','ZZ U18 hors galerie');
insert into player_profiles (id, prenom, nom, date_naissance) values
  ('dd110000-0000-0000-0000-0000000000d2','ZZ','Etranger','2009-01-01');
insert into team_memberships (player_id, team_id, club_id, saison, statut) values
  ('dd110000-0000-0000-0000-0000000000d2','dd110000-0000-0000-0000-0000000000a3','dd110000-0000-0000-0000-0000000000c1','2026-2027','active');
insert into consentements_biometrie (player_id, donne_par, qualite, texte_version, statut) values
  ('dd110000-0000-0000-0000-0000000000d2','dd110000-0000-0000-0000-000000000001','parent','zz-test','accorde');

select pg_temp.sous('dd110000-0000-0000-0000-000000000001');

select pg_temp.note('un joueur d''aucune des deux equipes n''est pas propose', 'non',
  (select case when exists (select 1 from reconnaissance_joueurs_prets('dd110000-0000-0000-0000-0000000000b1')
                             where player_id = 'dd110000-0000-0000-0000-0000000000d2') then 'OUI' else 'non' end));

select pg_temp.note('et le marquer est refuse', 'refuse',
  pg_temp.essai_marquage('dd110000-0000-0000-0000-0000000000f1','dd110000-0000-0000-0000-0000000000d2'));

select pg_temp.stop();

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
