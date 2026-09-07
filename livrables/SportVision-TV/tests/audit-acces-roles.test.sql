-- Matrice d'acces reelle, jouee en RLS avec de vrais comptes. Transaction annulée.
--
-- On ne verifie PAS si un bouton est cache : on demande a la base ce que chaque role peut
-- reellement lire et ecrire. Un bouton cache n'est pas une securite.
begin;

create temp table _res(role text, capacite text, attendu text, obtenu text, ok boolean) on commit drop;
grant all on _res to authenticated;

do $$
declare
  v_album uuid; v_lien uuid; v_club uuid := '8be55101-0d61-4b27-8d7b-a4761547d88b';
begin
  select a.id into v_album from media_albums a where a.club_id=v_club order by a.created_at desc limit 1;
  select l.id into v_lien from media_album_links l where l.album_id=v_album limit 1;
  create temp table _ctx(album uuid, lien uuid) on commit drop;
  grant all on _ctx to authenticated;
  insert into _ctx values (v_album, v_lien);
end $$;

-- Chaque bloc rejoue les MEMES questions pour un role different.
create or replace function pg_temp.sonde(p_role text) returns void language plpgsql as $$
declare n integer;
begin
  insert into _res select p_role, 'lire les albums',        'selon role', count(*)::text, true from media_albums;
  insert into _res select p_role, 'lire les commandes',     'selon role', count(*)::text, true from media_orders;
  insert into _res select p_role, 'lire les droits',        'selon role', count(*)::text, true from media_download_grants;
  insert into _res select p_role, 'lire les liens',         'selon role', count(*)::text, true from media_album_links;
  insert into _res select p_role, 'lire les offres',        'selon role', count(*)::text, true from media_album_link_offers;
  insert into _res select p_role, 'fixer un prix',          '-', media_pricing_staff()::text, true;
  insert into _res select p_role, 'deposer des medias',     '-', media_upload_staff()::text, true;
  insert into _res select p_role, 'voir les statistiques',  '-', media_stats_access()::text, true;
  insert into _res select p_role, 'albums dans son perimetre stats', '-', count(*)::text, true from _media_stats_albums(false);
end $$;

set local role authenticated;

set local request.jwt.claims = '{"sub":"b4ff9a0e-9ae6-43a5-bddf-412fdf7d2cca","role":"authenticated"}';
select pg_temp.sonde('Fondateur');
set local request.jwt.claims = '{"sub":"97a7f67a-baa0-41e8-a891-7751aec9fd76","role":"authenticated"}';
select pg_temp.sonde('Production');
set local request.jwt.claims = '{"sub":"b4eab475-3293-4804-8bf6-8b27a15d410c","role":"authenticated"}';
select pg_temp.sonde('Secretariat');
set local request.jwt.claims = '{"sub":"b2d5b116-ab57-47fe-987e-22eb9dc41e83","role":"authenticated"}';
select pg_temp.sonde('Comptabilite');
set local request.jwt.claims = '{"sub":"0831e5ee-2ad9-4efd-95ea-3d88f16dd1b2","role":"authenticated"}';
select pg_temp.sonde('Photographe');
set local request.jwt.claims = '{"sub":"2b0b7fae-33eb-45be-b393-707725ad9e7e","role":"authenticated"}';
select pg_temp.sonde('CM');

reset role;

select role, capacite, obtenu from _res order by
  case role when 'Fondateur' then 1 when 'Production' then 2 when 'Secretariat' then 3
            when 'Comptabilite' then 4 when 'Photographe' then 5 else 6 end,
  capacite;

rollback;
