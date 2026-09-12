-- Le périmètre d'un opérateur terrain sur les galeries (v190, 12/09/2026).
--
-- Deux exigences qui doivent tenir ensemble :
--   • il travaille sur SES galeries : celles de ses missions, et celles qu'il a créées ;
--   • il ne touche pas à celles des autres.
--
-- Le cloisonnement posé en v164 ne connaissait que les missions. Or aucun album de production
-- n'est rattaché à une mission : le photographe qui crée sa galerie et y dépose ses photos, le
-- geste le plus courant, se voyait refuser sa propre galerie. Borner ne doit pas vouloir dire
-- bloquer. Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('ee66ee66-0000-0000-0000-000000000001','zz-photo-a@example.invalid','',now(),'authenticated','authenticated'),
  ('ee66ee66-0000-0000-0000-000000000002','zz-photo-b@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role, actif) values
  ('ee66ee66-0000-0000-0000-000000000001','ZZPhoto','A','photo',true),
  ('ee66ee66-0000-0000-0000-000000000002','ZZPhoto','B','photo',true)
on conflict (id) do update set role='photo', actif=true;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Photo (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Photo (test)', id, 'free' from cli returning id),
       alb_a as (insert into media_albums (club_id, title, event_date, status, created_by)
                 select id, 'ZZ Galerie de A', current_date, 'draft', 'ee66ee66-0000-0000-0000-000000000001' from clu returning id),
       alb_b as (insert into media_albums (club_id, title, event_date, status, created_by)
                 select id, 'ZZ Galerie de B', current_date, 'draft', 'ee66ee66-0000-0000-0000-000000000002' from clu returning id)
  select (select id from alb_a) album_a, (select id from alb_b) album_b;
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

select pg_temp.sous('ee66ee66-0000-0000-0000-000000000001');
select pg_temp.note('le photographe voit la galerie qu''il a creee', 'oui',
  case when photographe_voit_album((select album_a from ctx)) then 'oui' else 'NON' end);
select pg_temp.note('mais pas celle d''un autre photographe', 'non',
  case when photographe_voit_album((select album_b from ctx)) then 'OUI' else 'non' end);
select pg_temp.stop();

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
