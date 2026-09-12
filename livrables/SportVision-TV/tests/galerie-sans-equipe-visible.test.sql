-- Une galerie de club, sans équipe, reste visible des familles (v195, 12/09/2026).
--
-- `media_album_list` filtrait `p_team_id is null or a.team_id = p_team_id`. Connect passe
-- TOUJOURS l'équipe du joueur : une galerie sans équipe ne remontait donc jamais, sans le
-- moindre message. Or une galerie sans équipe, c'est exactement le cas d'un tournoi, d'un
-- plateau, d'un gala ou d'une journée club — et c'est ce qu'on vend le plus.
-- Même piège sur la saison : l'OS laisse créer une galerie sans saison, Connect en passe une.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('ee99ee99-0000-0000-0000-000000000001','zz-famille-galerie@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Galerie (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Galerie (test)', id, 'free' from cli returning id),
       eq as (insert into club_teams (club_id, name) select id, 'ZZ U13 galerie' from clu returning id, club_id),
       sais as (select id from saisons where label = '2026-2027' limit 1),
       enfant as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status, user_id)
                  select club_id, 'Lou', 'ZZGalerie', date '2014-02-02', 'actif', 'ee99ee99-0000-0000-0000-000000000001' from eq returning id, club_id),
       tm as (insert into team_memberships (team_id, club_id, player_id, saison)
              select (select id from eq), (select club_id from eq), (select id from enfant), '2026-2027' returning team_id),
       gal_eq as (insert into media_albums (club_id, team_id, saison_id, title, event_date, status, published_at)
                  select (select club_id from eq), (select id from eq), (select id from sais),
                         'ZZ Galerie de l''equipe', current_date, 'published', now() returning id),
       gal_club as (insert into media_albums (club_id, team_id, saison_id, title, event_date, status, published_at)
                    select (select club_id from eq), null, (select id from sais),
                           'ZZ Tournoi du club', current_date, 'published', now() returning id)
  select (select club_id from eq) club, (select id from eq) equipe, (select id from sais) saison,
         (select id from gal_eq) gal_eq, (select id from gal_club) gal_club;
grant select on ctx to authenticated;

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

select pg_temp.sous('ee99ee99-0000-0000-0000-000000000001');
select pg_temp.note('la galerie de son equipe est visible', 'oui',
  (select case when exists (
     select 1 from media_album_list((select club from ctx), (select equipe from ctx), (select saison from ctx)) l
      where l.id = (select gal_eq from ctx)) then 'oui' else 'NON' end));
select pg_temp.note('la galerie du club, sans equipe, l''est aussi', 'oui',
  (select case when exists (
     select 1 from media_album_list((select club from ctx), (select equipe from ctx), (select saison from ctx)) l
      where l.id = (select gal_club from ctx)) then 'oui' else 'NON' end));
select pg_temp.stop();

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
