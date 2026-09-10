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

-- Les identifiants ne sont plus codes en dur. Au 10/09/2026, trois des six UUID inscrits ici
-- ne correspondaient plus a aucun profil (comptes Production, Secretariat et CM supprimes) :
-- quand le `sub` d'un jeton pointe vers un profil inexistant, get_my_role() rend NULL, donc ces
-- trois lignes mesuraient un utilisateur sans role au lieu du role annonce. Le fichier se
-- contentant d'AFFICHER des comptages, personne ne pouvait s'en apercevoir.
--
-- Les comptes sont donc resolus par leur role, ICI, tant qu'on est encore `postgres` : une fois
-- passe en `authenticated` sans jeton, la RLS interdit de lire profiles et la resolution
-- echouerait. Et si un role n'a aucun compte actif, on s'arrete au lieu de mesurer le vide.
create temp table _who(libelle text, role text, id uuid) on commit drop;
grant all on _who to authenticated;

do $$
declare r record; v uuid;
begin
  for r in select * from (values
      ('Fondateur','admin'),('Production','prod'),('Secretariat','sec'),
      ('Comptabilite','compta'),('Photographe','photo'),('CM','cm')
    ) as x(libelle, role)
  loop
    select p.id into v from profiles p
     where p.role = r.role and coalesce(p.actif,true) order by p.created_at limit 1;
    if v is null then
      raise exception 'Aucun compte actif de role % : la matrice ne peut pas mesurer %.', r.role, r.libelle;
    end if;
    insert into _who values (r.libelle, r.role, v);
  end loop;
end $$;

set local role authenticated;

do $$
declare r record;
begin
  for r in select libelle, id from _who order by id loop
    perform set_config('request.jwt.claims', json_build_object('sub',r.id::text,'role','authenticated')::text, true);
    perform pg_temp.sonde(r.libelle);
  end loop;
end $$;

reset role;

select role, capacite, obtenu from _res order by
  case role when 'Fondateur' then 1 when 'Production' then 2 when 'Secretariat' then 3
            when 'Comptabilite' then 4 when 'Photographe' then 5 else 6 end,
  capacite;

rollback;
