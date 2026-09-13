-- Un opérateur peut corriger le lien qu'il a déposé (13/09/2026).
--
-- Signalé par Fouka : Antoine ne pouvait ni modifier, ni remplacer, ni ajouter un lien. La base
-- l'autorisait pourtant depuis toujours (`operateur_perim_media_liens`) : c'est l'écran qui
-- n'affichait que le nom du lien, sans aucune action. Un mauvais lien collé était définitif.
--
-- Ce test verrouille les deux côtés de la règle : il corrige les siens, et pas ceux des autres.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('ee55dd00-0000-0000-0000-000000000001','zz-antoine@example.invalid','',now(),'authenticated','authenticated'),
  ('ee55dd00-0000-0000-0000-000000000002','zz-autre-operateur@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role, actif) values
  ('ee55dd00-0000-0000-0000-000000000001','ZZAntoine','Test','photo',true),
  ('ee55dd00-0000-0000-0000-000000000002','ZZAutre','Operateur','photo',true)
on conflict (id) do update set role='photo', actif=true;

-- Le perimetre de pole fait partie de la regle : sans affectation, la base refuse l'ecriture,
-- et ce n'est pas le sujet de ce test. En production, Antoine est bien affecte a son pole.
insert into pole_affectations (user_id, pole_id, role_pole)
select u, (select id from poles order by created_at limit 1), 'membre'
  from (values ('ee55dd00-0000-0000-0000-000000000001'::uuid),('ee55dd00-0000-0000-0000-000000000002'::uuid)) v(u)
on conflict do nothing;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Client Lien (test)','client') returning id),
       p1 as (insert into prestations (client_id, type_prestation, statut, couverture, date_prestation, pole_id)
              select id, 'match_photo', 'médias_complets', 'photo', current_date,
                     (select id from poles order by created_at limit 1) from cli returning id),
       p2 as (insert into prestations (client_id, type_prestation, statut, couverture, date_prestation, pole_id)
              select id, 'match_photo', 'médias_complets', 'photo', current_date,
                     (select id from poles order by created_at limit 1) from cli returning id),
       eq as (insert into prestations_equipe (prestation_id, collaborateur_id, statut)
              select (select id from p1), 'ee55dd00-0000-0000-0000-000000000001', 'acceptée' returning id),
       eq2 as (insert into prestations_equipe (prestation_id, collaborateur_id, statut)
               select (select id from p2), 'ee55dd00-0000-0000-0000-000000000002', 'acceptée' returning id),
       l1 as (insert into media_liens (prestation_id, nom, url, categorie, type_media, statut)
              select (select id from p1), 'ZZ Photos', 'https://exemple.invalid/mauvais', 'final', 'photo', 'valide'
              returning id),
       l2 as (insert into media_liens (prestation_id, nom, url, categorie, type_media, statut)
              select (select id from p2), 'ZZ Photos autres', 'https://exemple.invalid/autre', 'final', 'photo', 'a_verifier'
              returning id)
  select (select id from p1) presta_sienne, (select id from l1) lien_sien, (select id from l2) lien_autre;
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

select pg_temp.sous('ee55dd00-0000-0000-0000-000000000001');

update media_liens set url = 'https://exemple.invalid/le-bon', statut = 'a_verifier'
 where id = (select lien_sien from ctx);
select pg_temp.note('il corrige le lien de sa mission', 'https://exemple.invalid/le-bon',
  coalesce((select url from media_liens l, ctx where l.id = ctx.lien_sien), 'RIEN'));

insert into media_liens (prestation_id, nom, url, categorie, type_media, statut)
select presta_sienne, 'ZZ Galerie', 'https://exemple.invalid/galerie', 'livraison', 'photo', 'a_verifier' from ctx;
select pg_temp.note('il ajoute un second lien a la meme mission', '2',
  (select count(*)::text from media_liens l, ctx where l.prestation_id = ctx.presta_sienne));

-- Tentative sur la mission d'un autre : elle ne doit rien changer. On la verifie APRES, avec les
-- droits du service : sous l'identite de l'operateur, cette ligne ne lui est meme pas lisible, et
-- relire « rien » ne prouverait rien.
update media_liens set url = 'https://exemple.invalid/pirate' where id = (select lien_autre from ctx);

delete from media_liens where id = (select lien_sien from ctx);
select pg_temp.note('il peut retirer le sien', '0',
  (select count(*)::text from media_liens l, ctx where l.id = ctx.lien_sien));

select pg_temp.stop();

select pg_temp.note('mais il n''a pas touche au lien d''un autre', 'https://exemple.invalid/autre',
  coalesce((select url from media_liens l, ctx where l.id = ctx.lien_autre), 'RIEN'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
