-- La reconnaissance fait apparaître la galerie dans la liste de la famille (28/09/2026).
--
-- CE QUI MANQUAIT. Le CONTENU d'une galerie s'ouvrait déjà à une famille dès qu'un marquage
-- existait pour son enfant, humain ou machine — c'est la règle de la v309, pour l'enfant surclassé.
-- Mais la LISTE, elle, restait bornée à l'équipe de l'enfant. Deux portes sur la même pièce, une
-- seule ouverte : la famille pouvait entrer si on lui donnait l'adresse, jamais la trouver seule.
--
-- Mesure du 28/09 : sur 45 galeries publiées, 35 n'ont AUCUNE équipe et 31 aucun club. Ce sont
-- exactement celles que SportVision vend par lien à l'équipe adverse. Aucune ne pouvait donc
-- remonter chez une famille, puisque la liste filtre sur le club.
--
-- Fouka : « une galerie de club en Full Communication reste, mais elle est forcément rattachée à
-- une équipe ou à une journée d'entraînement ; donc là il faudra utiliser la reconnaissance pour
-- que les familles voient aussi les galeries pas en Full Communication qu'on crée. »
--
-- LA BORNE QUI COMPTE, et que ce test vérifie autant que l'ouverture : on ne peut demander la liste
-- qu'au nom d'un enfant dont on est le sportif ou le parent confirmé. Sans ça, passer un
-- identifiant au hasard permettrait d'énumérer les galeries des autres.
--
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('ba110000-0000-0000-0000-000000000001','zz-parent-reco@example.invalid','',now(),'authenticated','authenticated'),
  ('ba110000-0000-0000-0000-000000000002','zz-parent-autre@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Reco (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Reco (test)', id, 'performance' from cli returning id),
       eq as (insert into club_teams (club_id, name) select id, 'ZZ U13 Reco' from clu returning id, club_id),
       -- LA SAISON ACTIVE, et non la plus recente par date : il existe une saison 2027-2028 qui
       -- commence plus tard sans etre active, et le trigger `completer_saison_galerie` pose
       -- l'ACTIVE sur la galerie. Prendre la mauvaise fait echouer le filtre de saison, et le test
       -- accuse alors la fonction d'un defaut qui est dans son propre decor.
       sa as (select id from saisons where active order by label desc limit 1),
       -- L'enfant de la famille, et un autre enfant du meme club : c'est lui qui prouve que la
       -- porte ne s'ouvre pas pour tout le monde.
       j1 as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
              select club_id, 'ZZ', 'Mon enfant', date '2013-02-02', 'actif' from eq returning id, club_id),
       j2 as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
              select club_id, 'ZZ', 'Enfant d''un autre', date '2013-03-03', 'actif' from eq returning id),
       tm as (insert into team_memberships (team_id, player_id, club_id, saison_id, saison, statut)
              select eq.id, j1.id, eq.club_id, (select id from sa), '2026-2027', 'active' from eq, j1 returning player_id),
       -- 1. La galerie de son equipe : elle doit remonter, comme avant.
       alA as (insert into media_albums (title, club_id, team_id, status, event_date, published_at)
               select 'ZZ Galerie de son equipe', club_id, id, 'published', current_date, now() from eq returning id),
       -- 2. Une galerie vendue par lien, SANS CLUB : invisible aujourd'hui, c'est tout le sujet.
       alB as (insert into media_albums (title, club_id, team_id, status, event_date, published_at)
               values ('ZZ Galerie vendue par lien', null, null, 'published', current_date, now()) returning id),
       -- 3. Une autre galerie sans club, ou son enfant n'est PAS reconnu.
       alC as (insert into media_albums (title, club_id, team_id, status, event_date, published_at)
               values ('ZZ Galerie d''un autre match', null, null, 'published', current_date, now()) returning id),
       phB as (insert into media_assets (album_id, kind, storage_bucket, original_path, preview_path, thumb_path, status, position, preview_watermarked)
               select id, 'photo', 'sportvision-media-prive', 'zz/b1.jpg', 'zz/b1-p.webp', 'zz/b1-t.webp', 'ready', 1, true from alB returning id, album_id),
       phC as (insert into media_assets (album_id, kind, storage_bucket, original_path, preview_path, thumb_path, status, position, preview_watermarked)
               select id, 'photo', 'sportvision-media-prive', 'zz/c1.jpg', 'zz/c1-p.webp', 'zz/c1-t.webp', 'ready', 1, true from alC returning id, album_id),
       -- SON enfant est reconnu sur la galerie B, et l'AUTRE enfant sur la galerie C.
       tg1 as (insert into media_player_tags (media_ref_type, media_ref_id, player_id, source, statut)
               select 'media_asset', phB.id, j1.id, 'suggestion', 'valide' from phB, j1 returning id),
       tg2 as (insert into media_player_tags (media_ref_type, media_ref_id, player_id, source, statut)
               select 'media_asset', phC.id, j2.id, 'suggestion', 'valide' from phC, j2 returning id)
  select (select club_id from eq) club, (select id from eq) equipe, (select id from j1) enfant,
         (select id from j2) autre_enfant, (select id from alA) gal_equipe,
         (select id from alB) gal_lien, (select id from alC) gal_autre, (select id from sa) saison;
grant select on ctx to authenticated;

-- Le parent confirme de SON enfant, et un parent qui n'a rien a voir avec lui.
insert into parent_profiles (id, user_id, prenom, nom) values
  ('ba110000-0000-0000-0000-000000000001','ba110000-0000-0000-0000-000000000001','ZZ','Parent'),
  ('ba110000-0000-0000-0000-000000000002','ba110000-0000-0000-0000-000000000002','ZZ','Autre parent')
on conflict (id) do nothing;
insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
select 'ba110000-0000-0000-0000-000000000001'::uuid, enfant, 'parent', 'confirme', now() from ctx;
insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
select 'ba110000-0000-0000-0000-000000000002'::uuid, autre_enfant, 'parent', 'confirme', now() from ctx;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant all on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(c text, a text, o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (c, a, o); $$;
create or replace function pg_temp.sous(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.stop() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '{"role":"service_role"}', true); end $$;
-- Une liste demandee au nom d'un enfant peut etre REFUSEE : on veut lire le refus, pas le subir.
create or replace function pg_temp.liste(p_enfant uuid) returns text language plpgsql as $$
declare v text;
begin
  select coalesce(string_agg(title, ' | ' order by title), '∅') into v
    from media_album_list((select club from ctx), (select equipe from ctx), (select saison from ctx), p_enfant);
  return v;
exception when insufficient_privilege then return 'REFUS';
          when undefined_function then return 'SIGNATURE ABSENTE';
          when others then return 'ERREUR ' || sqlstate;
end $$;

select pg_temp.sous('ba110000-0000-0000-0000-000000000001');

select pg_temp.note('la galerie de son equipe remonte toujours', 'oui',
  case when pg_temp.liste((select enfant from ctx)) like '%ZZ Galerie de son equipe%' then 'oui' else 'NON' end);

select pg_temp.note('la galerie vendue par lien, ou il est reconnu, remonte aussi', 'oui',
  case when pg_temp.liste((select enfant from ctx)) like '%ZZ Galerie vendue par lien%' then 'oui' else 'NON' end);

select pg_temp.note('la galerie ou il n''est PAS reconnu ne remonte pas', 'non',
  case when pg_temp.liste((select enfant from ctx)) like '%ZZ Galerie d''un autre match%' then 'OUI' else 'non' end);

-- LA BORNE : demander la liste au nom de l'enfant de quelqu'un d'autre ne doit rien rendre de plus.
select pg_temp.note('au nom d''un enfant qui n''est pas le sien : rien de plus', 'non',
  case when pg_temp.liste((select autre_enfant from ctx)) like '%ZZ Galerie d''un autre match%' then 'OUI' else 'non' end);

select pg_temp.stop();

-- Et sans enfant precise, la liste reste ce qu'elle etait : le perimetre du club.
select pg_temp.sous('ba110000-0000-0000-0000-000000000001');
select pg_temp.note('sans enfant precise, la galerie par lien ne remonte pas', 'non',
  case when pg_temp.liste(null) like '%ZZ Galerie vendue par lien%' then 'OUI' else 'non' end);
select pg_temp.stop();

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
