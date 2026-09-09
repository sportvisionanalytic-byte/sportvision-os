-- Un operateur terrain voit les galeries de SES prestations, et rien d'autre.
--
-- Regle precisee par Fouka le 09/09/2026 : « il ne faut pas que le photographe/videaste puisse
-- creer des galeries, mais il voit les galeries attachees a sa presta et il a le lien pour
-- envoyer. »
--
-- Quatre choses a verifier ensemble, car chacune sans les autres laisse une porte ouverte :
-- il voit la sienne, il ne voit pas celle des autres, il obtient le LIEN de la sienne, et il
-- ne peut ni creer ni modifier. Le lien merite son propre controle : `can_access_media()`
-- renvoyait vrai pour tout is_staff(), ce qui rendait le cloisonnement de la table sans effet.
--
-- Tout s'execute dans une transaction annulee.

begin;

do $$
declare
  v_opA uuid; v_opB uuid; v_admin uuid; v_cl uuid; v_pres uuid; v_alb uuid; v_autre uuid;
  n int; e text[] := '{}';
begin
  perform set_config('role','postgres',true);
  select id into v_opA from profiles where role='photo' and actif order by created_at limit 1;
  select id into v_opB from profiles where role='photo' and actif and id<>v_opA order by created_at limit 1;
  select id into v_admin from profiles where role='admin' and actif limit 1;
  if v_opA is null or v_opB is null or v_admin is null then
    raise exception 'Il faut deux photographes actifs et un admin pour jouer ce test';
  end if;

  insert into clients (nom,statut) values ('ZZ galerie perimetre','client') returning id into v_cl;
  insert into prestations (reference,statut,client_id,date_prestation,couverture)
  values ('ZZ-GAL','planifiée',v_cl,current_date,'photo') returning id into v_pres;

  perform set_config('request.jwt.claims', json_build_object('sub',v_admin::text,'role','authenticated')::text, true);
  insert into prestations_equipe (prestation_id,collaborateur_id,statut) values (v_pres,v_opA,'invitation_envoyée');
  perform set_config('role','postgres',true);
  update prestations_equipe set statut='acceptée' where prestation_id=v_pres;

  insert into media_albums (title,mission_id,status,created_by)
  values ('ZZ Galerie de la presta',v_pres,'published',v_admin) returning id into v_alb;
  insert into media_albums (title,status,created_by)
  values ('ZZ Galerie sans rapport','published',v_admin) returning id into v_autre;

  -- ══ L'OPERATEUR AFFECTE ═══════════════════════════════════════════════════
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',v_opA::text,'role','authenticated')::text, true);

  select count(*) into n from media_albums where id=v_alb;
  if n <> 1 then e := e || 'il ne voit PAS la galerie de sa prestation'::text; end if;

  select count(*) into n from media_albums where id=v_autre;
  if n <> 0 then e := e || 'il voit une galerie qui n est pas la sienne'::text; end if;

  -- Le lien de partage : c'est ce qu'il doit pouvoir envoyer au club.
  if not can_access_media(v_alb) then e := e || 'il n a pas acces au LIEN de sa galerie'::text; end if;
  if can_access_media(v_autre) then e := e || 'il a acces au lien d une galerie d un autre'::text; end if;

  -- Et il ne cree rien.
  begin
    insert into media_albums (title,status,created_by) values ('ZZ interdite','published',v_opA);
    e := e || 'il a pu CREER une galerie'::text;
  exception when others then null; end;

  update media_albums set title='ZZ modifie' where id=v_alb;
  get diagnostics n = row_count;
  if n <> 0 then e := e || 'il a pu MODIFIER une galerie'::text; end if;

  -- ══ UN COLLEGUE NON AFFECTE ═══════════════════════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub',v_opB::text,'role','authenticated')::text, true);
  select count(*) into n from media_albums where id=v_alb;
  if n <> 0 then e := e || 'un collegue non affecte voit la galerie'::text; end if;
  if can_access_media(v_alb) then e := e || 'un collegue non affecte obtient le lien'::text; end if;

  -- ══ L'ADMIN GARDE SA VUE ══════════════════════════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub',v_admin::text,'role','authenticated')::text, true);
  select count(*) into n from media_albums where id in (v_alb,v_autre);
  if n <> 2 then e := e || format('l admin ne voit plus que %s/2 galeries', n); end if;

  perform set_config('role','postgres',true);
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — l operateur voit la galerie de sa prestation et son lien de partage, ne voit pas celles des autres, ne peut ni creer ni modifier ; l admin conserve sa vue.' as verdict;

rollback;
