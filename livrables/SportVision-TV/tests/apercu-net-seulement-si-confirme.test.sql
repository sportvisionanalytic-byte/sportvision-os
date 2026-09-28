-- L'aperçu sans filigrane n'est servi que pour SES photos à soi (v330, 28/09/2026).
--
-- CE QUE FOUKA A VU. « Ça met "est-ce que c'est bien vous" à chaque fois. Et là, il y a des doutes,
-- mais il faut mettre le filigrane, parce que sinon il peut screen envoyer à ses potes. »
--
-- C'ÉTAIT PIRE QUE ÇA. `media_galerie_a_identifier` rendait `preview_clair_path` — l'aperçu SANS
-- filigrane — pour TOUTES les photos de la galerie, pas seulement pour celles proposées. Avec un
-- Pass à 19,90 €, une famille voyait donc les 110 photos en clair, dont celles où son enfant n'est
-- pas, dont celles des autres enfants. Le plafond de quatre aperçus, le filigrane, et toute la
-- logique de vente tombaient par cette seule fonction.
--
-- LA RÈGLE. Le Pass retire le filigrane SUR SES PHOTOS. Une photo que la machine propose n'est pas
-- encore la sienne : tant que personne n'a tranché, elle reste filigranée. C'est cohérent avec ce
-- que le Pass vend, et c'est ce qui empêche une capture d'écran de faire sortir la photo d'un
-- autre enfant.
--
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('ae110000-0000-0000-0000-000000000001','zz-net-joueur@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

insert into clubs (id, nom, ville, plan) values ('ae110000-0000-0000-0000-0000000000c1','ZZ Net Club','ZZ','performance');
insert into club_teams (id, club_id, name) values ('ae110000-0000-0000-0000-0000000000a1','ae110000-0000-0000-0000-0000000000c1','ZZ U16 Net');
insert into player_profiles (id, prenom, nom, date_naissance, user_id) values
  ('ae110000-0000-0000-0000-0000000000d1','ZZ','Net','2010-01-01','ae110000-0000-0000-0000-000000000001');
insert into team_memberships (player_id, team_id, club_id, saison, statut) values
  ('ae110000-0000-0000-0000-0000000000d1','ae110000-0000-0000-0000-0000000000a1','ae110000-0000-0000-0000-0000000000c1','2026-2027','active');

insert into media_albums (id, club_id, team_id, title, status) values
  ('ae110000-0000-0000-0000-0000000000b1','ae110000-0000-0000-0000-0000000000c1',
   'ae110000-0000-0000-0000-0000000000a1','ZZ Galerie Net','published');

-- Trois photos : une confirmee sienne, une seulement PROPOSEE, une qui ne le concerne pas.
insert into media_assets (id, album_id, original_path, preview_path, preview_clair_path, status, position) values
  ('ae110000-0000-0000-0000-0000000000f1','ae110000-0000-0000-0000-0000000000b1','zz/1.jpg','zz/1-p.webp','zz/1-pc.webp','ready',1),
  ('ae110000-0000-0000-0000-0000000000f2','ae110000-0000-0000-0000-0000000000b1','zz/2.jpg','zz/2-p.webp','zz/2-pc.webp','ready',2),
  ('ae110000-0000-0000-0000-0000000000f3','ae110000-0000-0000-0000-0000000000b1','zz/3.jpg','zz/3-p.webp','zz/3-pc.webp','ready',3);

insert into media_player_tags (media_ref_type, media_ref_id, player_id, source, statut, score, moteur) values
  ('media_asset','ae110000-0000-0000-0000-0000000000f1','ae110000-0000-0000-0000-0000000000d1','suggestion','valide',0.30,'zz'),
  ('media_asset','ae110000-0000-0000-0000-0000000000f2','ae110000-0000-0000-0000-0000000000d1','suggestion','propose',0.51,'zz');

-- Le Pass, reellement paye : c'est lui qui ouvre cet ecran.
insert into media_entitlements (club_id, saison_id, beneficiary_person_id, scope_type, scope_id, status, valid_from)
select 'ae110000-0000-0000-0000-0000000000c1',
       (select saison_id from media_albums where id='ae110000-0000-0000-0000-0000000000b1'),
       'ae110000-0000-0000-0000-0000000000d1','club',
       'ae110000-0000-0000-0000-0000000000c1','active', now();

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant insert, select on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

select set_config('request.jwt.claims',
  json_build_object('sub','ae110000-0000-0000-0000-000000000001','role','authenticated')::text, true);
set local role authenticated;

-- Ce que la fonction rend, photo par photo. `∅` = pas d'aperçu net, donc l'app affiche le
-- filigrané : c'est exactement ce qu'on veut vérifier.
select pg_temp.note('sa photo CONFIRMEE est servie sans filigrane', 'zz/1-pc.webp',
  (select coalesce(preview_clair_path,'∅') from media_galerie_a_identifier(
     'ae110000-0000-0000-0000-0000000000b1','ae110000-0000-0000-0000-0000000000d1')
    where asset_id = 'ae110000-0000-0000-0000-0000000000f1'));

select pg_temp.note('une photo seulement PROPOSEE reste filigranee', '∅',
  (select coalesce(preview_clair_path,'∅') from media_galerie_a_identifier(
     'ae110000-0000-0000-0000-0000000000b1','ae110000-0000-0000-0000-0000000000d1')
    where asset_id = 'ae110000-0000-0000-0000-0000000000f2'));

-- LE CONTROLE QUI COMPTE : une photo ou il n'est pas du tout. Elle etait servie en clair.
select pg_temp.note('une photo qui ne le concerne pas reste filigranee', '∅',
  (select coalesce(preview_clair_path,'∅') from media_galerie_a_identifier(
     'ae110000-0000-0000-0000-0000000000b1','ae110000-0000-0000-0000-0000000000d1')
    where asset_id = 'ae110000-0000-0000-0000-0000000000f3'));

-- Et l'ecran continue de MONTRER ces photos : on retire le net, pas la photo. Sans ca, plus rien
-- a confirmer, et la reconnaissance ne servirait plus a rien.
select pg_temp.note('les trois photos restent visibles, pour pouvoir trancher', '3',
  (select count(*)::text from media_galerie_a_identifier(
     'ae110000-0000-0000-0000-0000000000b1','ae110000-0000-0000-0000-0000000000d1')));

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
