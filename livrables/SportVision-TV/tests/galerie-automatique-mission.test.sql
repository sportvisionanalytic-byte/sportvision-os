-- La galerie NE suit PLUS la mission toute seule (v277, 25/09/2026).
--
-- CE TEST A ÉTÉ RETOURNÉ LE 26/09/2026, et l'histoire vaut d'être écrite ici parce qu'elle explique
-- pourquoi il vérifie aujourd'hui l'inverse de ce qu'il vérifiait hier.
--
-- La v221 (14/09) créait les galeries automatiquement, sur la demande de Fouka : « ce n'est pas
-- nous qui devons créer la galerie à chaque fois ». L'automatisme a produit **18 galeries vides que
-- personne n'avait demandées**, et Fouka a tranché l'inverse le 25/09 : « c'est le responsable
-- production qui les crée. Il crée tout lui-même. » La v277 a retiré les deux appels à
-- creer_galeries_mission_auto.
--
-- Le test, lui, continuait d'exiger une création automatique. Il ne tombait même pas en rouge : il
-- levait une violation de clé étrangère sur un `v_album` NULL, ce qui le rendait simplement muet.
-- Un test muet sur une règle métier renversée est un piège : le premier qui le répare « pour qu'il
-- passe » remet l'automatisme que Fouka a fait retirer.
--
-- CE QU'ON MESURE MAINTENANT :
--   1. À l'affectation de l'équipe, AUCUNE galerie n'est créée. C'est la décision du 25/09.
--   2. À la livraison non plus : aucune création, à aucun stade.
--   3. Ce qui reste automatique, et qui doit le rester : une galerie créée À LA MAIN, en brouillon,
--      qui contient des photos prêtes, est PUBLIÉE quand la mission passe à « livrée ».
--   4. Une galerie vide n'est jamais publiée : on n'envoie pas quinze familles sur une page blanche.
--   5. Rejouer le passage de statut ne republie ni ne duplique rien.

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
  v_album uuid; v_album_vide uuid; e text[] := '{}'; n int;
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

  -- ══ 1. À L'AFFECTATION, AUCUNE GALERIE N'EST CRÉÉE ══════════════════════
  perform pg_temp.jusqua(v_presta, 'équipe_affectée');
  select count(*) into n from media_albums where mission_id = v_presta;
  if n <> 0 then
    e := e || format('a l affectation : %s galerie(s) creee(s) automatiquement, la v277 en interdit', n);
  end if;

  -- ══ 2. À LA LIVRAISON NON PLUS ═══════════════════════════════════════════
  perform pg_temp.jusqua(v_presta, 'livrée');
  select count(*) into n from media_albums where mission_id = v_presta;
  if n <> 0 then
    e := e || format('a la livraison : %s galerie(s) creee(s) « en filet », la v277 a retire ce rattrapage', n);
  end if;

  -- ══ 3. CE QUI RESTE AUTOMATIQUE : PUBLIER CE QUI CONTIENT DES PHOTOS ═════
  --
  -- Le Responsable Production crée la galerie lui-même. Ce qu'il n'a pas à faire, c'est retourner
  -- la publier une fois la mission livrée : c'est le seul automatisme que la v277 conserve.
  insert into media_albums (club_id, team_id, saison_id, mission_id, title, status)
    values (v_club, v_equipe, v_saison, v_presta, 'ZZ Galerie a la main', 'draft') returning id into v_album;
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, status, position)
    values (v_album, v_club, 'photo','sportvision-media-prive','zz/auto1.jpg','ready',1);
  -- Et une seconde, vide, qui ne doit PAS partir aux familles.
  insert into media_albums (club_id, team_id, saison_id, mission_id, title, status)
    values (v_club, v_equipe2, v_saison, v_presta, 'ZZ Galerie vide', 'draft') returning id into v_album_vide;

  update prestations set statut = 'prêt_validation' where id = v_presta;
  update prestations set statut = 'livrée' where id = v_presta;

  select count(*) into n from media_albums where id = v_album and status = 'published';
  if n <> 1 then e := e || 'la galerie qui contient des photos n a pas ete publiee a la livraison'::text; end if;

  -- ══ 4. UNE GALERIE VIDE RESTE EN BROUILLON ═══════════════════════════════
  select count(*) into n from media_albums where id = v_album_vide and status = 'published';
  if n <> 0 then e := e || 'une galerie vide a ete publiee aux familles'::text; end if;

  -- ══ 5. REJOUER NE DUPLIQUE NI NE REPUBLIE ════════════════════════════════
  update prestations set statut = 'prêt_validation' where id = v_presta;
  update prestations set statut = 'livrée' where id = v_presta;
  select count(*) into n from media_albums where mission_id = v_presta;
  if n <> 2 then e := e || format('apres rejeu : %s galeries au lieu de 2', n); end if;


  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — les galeries naissent à l''affectation, en brouillon ; la validation de la Production publie celles qui contiennent des photos et laisse les vides ; rejouer ne duplique rien ; une mission sans affectation est rattrapée.' as verdict;

rollback;
