-- Un livrable livré devient un média du club (v196, 12/09/2026).
--
-- La bibliothèque du club voyait bien les livrables de production (vue `club_media_livrables`),
-- mais cette vue exige `is_club_member` : une famille n'en est jamais membre. Et la seule table
-- qu'une famille peut lire, `club_media`, n'avait AUCUN écrivain — ni applicatif, ni SQL. L'écran
-- « Mes contenus » de l'espace joueur était donc vide par construction, et le serait resté.
--
-- Ce test tient pour vrai qu'une livraison crée le média côté club, avec son lien et son équipe,
-- et qu'une deuxième livraison du même livrable ne le duplique pas.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('eeaaeeaa-0000-0000-0000-000000000001','zz-dirigeant-livrable@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Client Livrable (test)','client') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Livrable (test)', id, 'free' from cli returning id),
       pres as (insert into prestations (client_id, type_prestation, statut, equipes)
                select (select id from cli), 'match_photo', 'production_terminée', 'ZZ U15' returning id),
       lien as (insert into media_liens (prestation_id, nom, url, categorie)
                select (select id from pres), 'ZZ lien livraison', 'https://exemple.invalid/livraison', 'livraison' returning id),
       livr as (insert into media_livrables (prestation_id, nom, type_livrable, lien_id, statut)
                select (select id from pres), 'ZZ Photos du match', 'photos_finales', (select id from lien), 'a_valider'
                returning id)
  select (select id from clu) club, (select id from livr) livrable;

insert into club_members (club_id, user_id, role, status)
select club, 'eeaaeeaa-0000-0000-0000-000000000001', 'admin', 'actif' from ctx;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

-- La livraison.
update media_livrables set statut = 'livre' where id = (select livrable from ctx);

select pg_temp.note('le livrable arrive dans la bibliotheque du club', '1',
  (select count(*)::text from club_media m, ctx where m.club_id = ctx.club and m.title = 'ZZ Photos du match'));
select pg_temp.note('avec son lien de telechargement', 'https://exemple.invalid/livraison',
  coalesce((select m.link from club_media m, ctx where m.club_id = ctx.club and m.title = 'ZZ Photos du match'), 'RIEN'));
select pg_temp.note('et son equipe', 'ZZ U15',
  coalesce((select m.team from club_media m, ctx where m.club_id = ctx.club and m.title = 'ZZ Photos du match'), 'RIEN'));
select pg_temp.note('marque comme venant de SportVision', 'sportvision',
  coalesce((select m.source from club_media m, ctx where m.club_id = ctx.club and m.title = 'ZZ Photos du match'), 'RIEN'));

-- Le staff consulte : le statut rebouge, rien ne doit se dupliquer.
update media_livrables set statut = 'consulte' where id = (select livrable from ctx);
select pg_temp.note('une seconde livraison ne duplique rien', '1',
  (select count(*)::text from club_media m, ctx where m.club_id = ctx.club and m.title = 'ZZ Photos du match'));

select pg_temp.note('le club est prevenu de la livraison', 'oui',
  (select case when exists (
     select 1 from member_notifications n
      where n.title = 'Nouveau contenu livré' and n.body ilike '%ZZ Photos du match%'
   ) then 'oui' else 'NON' end));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
