-- La galerie suit la mission toute seule (v221, 14/09/2026).
--
-- LA DEMANDE DE FOUKA : « ce n'est pas nous qui devons créer la galerie à chaque fois. Quand le
-- photographe termine la prestation de Fontainebleau, automatiquement ça va dans leur espace
-- Connect avec leurs photos. »
--
-- CE QU'ON MESURE :
--   1. À l'affectation de l'équipe, les galeries de la mission existent, en brouillon, une par
--      équipe, avec le bon club, la bonne saison.
--   2. Rien n'est publié à ce moment-là : personne n'est prévenu tant que rien n'a été regardé.
--   3. À la validation de la Production (mission « livrée »), une galerie qui contient des photos
--      prêtes est publiée — donc les familles la reçoivent.
--   4. Une galerie VIDE n'est pas publiée : on n'envoie pas quinze familles sur une page blanche.
--   5. Rejouer le passage de statut ne crée pas de seconde galerie ni ne republie.
--   6. Une mission qui saute l'affectation reçoit quand même ses galeries à la livraison.

begin;

create or replace function pg_temp.jusqua(p_id uuid, p_statut text) returns void language plpgsql as $inner$
declare st text;
begin
  foreach st in array array['équipe_affectée','prête','équipe_en_route','arrivée_sur_place',
                            'production_démarrée','production_terminée','médias_à_transférer',
                            'médias_complets','à_monter','montage_en_cours','prêt_validation','livrée'] loop
    update prestations set statut = st::statut_prestation where id = p_id;
    exit when st = p_statut;
  end loop;
end $inner$;

do $$
declare
  v_club uuid; v_equipe uuid; v_equipe2 uuid; v_saison uuid; v_client uuid;
  v_admin uuid; v_presta uuid; v_presta2 uuid;
  v_album uuid; e text[] := '{}'; n int;
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);

  select id into v_saison from saisons where label = '2026-2027';
  select id into v_admin from profiles where role='admin' and actif order by created_at limit 1;

  v_club := gen_random_uuid();
  insert into organizations (id, organization_type, nom, statut) values (v_club,'club','ZZ Club Auto','actif_standard');
  insert into clients (nom, statut) values ('ZZ Client Auto','client') returning id into v_client;
  insert into clubs (id, nom, plan, saison_id, portail_client_id) values (v_club,'ZZ Club Auto','performance', v_saison, v_client);
  insert into club_teams (club_id, name) values (v_club,'ZZ Auto U13') returning id into v_equipe;
  insert into club_teams (club_id, name) values (v_club,'ZZ Auto U15') returning id into v_equipe2;

  -- Les équipes couvertes sont désignées sur la mission elle-même (`prestations.equipes`), le
  -- chemin d'une mission saisie à la main : `equipes_de_mission` les retrouve par leur nom.
  insert into prestations (reference, client_id, type_prestation, date_prestation, statut, created_by, equipes)
    values ('ZZ-AUTO-1', v_client, 'match', current_date, 'demande_reçue', v_admin,
            'ZZ Auto U13, ZZ Auto U15') returning id into v_presta;

  -- ══ 1. À L'AFFECTATION, LES GALERIES EXISTENT ════════════════════════════
  perform pg_temp.jusqua(v_presta, 'équipe_affectée');
  select count(*) into n from media_albums where mission_id = v_presta;
  if n < 1 then
    e := e || format('a l affectation : %s galerie(s), aucune creee automatiquement', n);
  end if;
  select count(*) into n from media_albums where mission_id = v_presta and club_id = v_club and saison_id = v_saison;
  if n < 1 then e := e || 'les galeries creees n ont pas le bon club ou la bonne saison'::text; end if;

  -- ══ 2. RIEN N'EST PUBLIÉ À CE STADE ══════════════════════════════════════
  select count(*) into n from media_albums where mission_id = v_presta and status = 'published';
  if n <> 0 then e := e || format('%s galerie(s) publiee(s) des l affectation', n); end if;

  -- ══ 3. UNE GALERIE AVEC DES PHOTOS EST PUBLIÉE À LA LIVRAISON ════════════
  select id into v_album from media_albums where mission_id = v_presta order by title limit 1;
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, status, position)
    values (v_album, v_club, 'photo','sportvision-media-prive','zz/auto1.jpg','ready',1);

  perform pg_temp.jusqua(v_presta, 'livrée');
  select status into n from (select case when status = 'published' then 1 else 0 end as status
                               from media_albums where id = v_album) z;
  if n <> 1 then e := e || 'la galerie avec des photos n a pas ete publiee a la livraison'::text; end if;

  -- ══ 4. UNE GALERIE VIDE RESTE EN BROUILLON ═══════════════════════════════
  select count(*) into n from media_albums
   where mission_id = v_presta and id <> v_album and status = 'published';
  if n <> 0 then e := e || format('%s galerie(s) vide(s) publiee(s)', n); end if;

  -- ══ 5. REJOUER NE DUPLIQUE RIEN ══════════════════════════════════════════
  update prestations set statut = 'prêt_validation' where id = v_presta;
  update prestations set statut = 'livrée' where id = v_presta;
  select count(*) into n from media_albums where mission_id = v_presta;
  if n > 2 then e := e || format('apres rejeu : %s galeries au lieu de 2', n); end if;

  -- ══ 6. UNE MISSION SANS AFFECTATION EST RATTRAPÉE ════════════════════════
  insert into prestations (reference, client_id, type_prestation, date_prestation, statut, created_by)
    values ('ZZ-AUTO-2', v_client, 'reportage', current_date, 'demande_reçue', v_admin) returning id into v_presta2;
  update prestations set statut = 'livrée' where id = v_presta2;
  select count(*) into n from media_albums where mission_id = v_presta2;
  if n < 1 then e := e || 'une mission livree sans affectation n a recu aucune galerie'::text; end if;

  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — les galeries naissent à l''affectation, en brouillon ; la validation de la Production publie celles qui contiennent des photos et laisse les vides ; rejouer ne duplique rien ; une mission sans affectation est rattrapée.' as verdict;

rollback;
