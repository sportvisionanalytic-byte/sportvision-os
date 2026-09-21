-- « Mission terminée » ne s'affiche que quand tout ce qui a été livré a été relu (§K, §L).
--
-- 21/09/2026 (v240) — LA RÈGLE A CHANGÉ, sur décision de Fouka : « c'est LUI qui met le nombre de
-- liens à mettre, il ne faut pas lui imposer un nombre de liens. Le responsable production vérifie
-- uniquement à partir des liens. Il n'y a pas de lien obligatoire pour valider la prestation. »
--
-- Ce test vérifiait l'inverse : que la COUVERTURE imposait ses livrables (photos traitées, montage,
-- rushs), et qu'il en manquait un suffisait à bloquer. Il est réécrit sur la règle d'aujourd'hui,
-- qui ne demande plus CE QUI a été livré mais que ce qui a été livré ait été RELU — et qui est,
-- sur ce point, plus exigeante qu'avant : AUCUN lien ne passe sans vérification, quel que soit son
-- type, là où seuls les livrables « finaux » comptaient.
--
-- Le test attaque la base directement : il ne clique sur aucun bouton.
--
-- Tout s'exécute dans une transaction annulée.

begin;

create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $inner$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p::text,'role','authenticated')::text, true);
end $inner$;

-- Monte une mission complète jusqu'au point où seule la couverture décide de la suite.
create or replace function pg_temp.mission(p_cov text, p_op uuid, p_admin uuid, p_client uuid)
returns uuid language plpgsql as $inner$
declare v_id uuid;
begin
  insert into prestations (reference, statut, client_id, date_prestation, couverture)
  values ('ZZ-'||p_cov||'-'||substr(gen_random_uuid()::text,1,6), 'planifiée', p_client, current_date, p_cov)
  returning id into v_id;
  perform set_config('request.jwt.claims', json_build_object('sub',p_admin::text,'role','authenticated')::text, true);
  insert into prestations_equipe (prestation_id, collaborateur_id, statut)
  values (v_id, p_op, 'invitation_envoyée');
  perform set_config('role','postgres',true);
  insert into mission_suivi_operateur (prestation_id, collaborateur_id, prestation_terminee_at, fichiers_securises_at)
  values (v_id, p_op, now(), now());
  return v_id;
end $inner$;

-- Le chemin légal complet, tel que validate_prestation_statut_transition l'autorise.
create or replace function pg_temp.jusqua_livree(p_id uuid) returns void language plpgsql as $inner$
declare st text;
begin
  foreach st in array array['équipe_affectée','prête','équipe_en_route','arrivée_sur_place',
                            'production_démarrée','production_terminée','médias_à_transférer',
                            'médias_complets','à_monter','montage_en_cours','prêt_validation','livrée'] loop
    update prestations set statut = st::statut_prestation where id = p_id;
  end loop;
end $inner$;

do $$
declare
  v_op uuid; v_admin uuid; v_client uuid; v_kit uuid;
  v_photo uuid; v_video uuid; v_deux uuid; v_kitmiss uuid;
  m text[]; e text[] := '{}';
begin
  perform set_config('role','postgres',true);
  select id into v_op from profiles where role='photo' and actif order by created_at limit 1;
  select id into v_admin from profiles where role='admin' and actif limit 1;
  insert into clients (nom, statut) values ('ZZ Client cloture','client') returning id into v_client;

  -- ══ 1. MISSION PHOTO ══════════════════════════════════════════════════════
  v_photo := pg_temp.mission('photo', v_op, v_admin, v_client);

  m := mission_cloture_manquant(v_photo);
  -- 13/09/2026 — Libellé repris côté fonction : « Aucun transfert confirmé » ne disait ni ce qui
  -- manquait ni qui devait agir. Le test suit le nouveau texte, sinon il protège une phrase morte.
  if not (m @> array['Sauvegarde non confirmée par l''opérateur (il doit cocher « fichiers copiés et vérifiés »)'])
    then e := e || 'photo : la sauvegarde non confirmée n''est pas signalée'::text; end if;
  if not (m @> array['Aucun lien déposé par l''opérateur']) then e := e || 'photo : l''absence totale de lien n''est pas signalée'::text; end if;
  -- Plus aucun livrable nommé n'est exigé : ni photos, ni montage, ni rushs.
  if array_to_string(m,' ') ilike '%Photos traitées non livrées%' or array_to_string(m,' ') ilike '%Montage final non livré%'
     or array_to_string(m,' ') ilike '%Rushs vidéo non transmis%' then
    e := e || 'photo : un livrable impose par la couverture est encore exige'::text;
  end if;

  insert into media_liens (prestation_id, nom, url, categorie, type_media, statut, transfert_confirme)
  values (v_photo,'ZZ photos','https://x.test/p','final','photo','a_verifier',true);

  m := mission_cloture_manquant(v_photo);
  if not (m @> array['Un lien n''a pas encore été vérifié par la Production']) then e := e || 'photo : livrée mais non relue, et rien ne le dit'::text; end if;

  update media_liens set statut='valide' where prestation_id=v_photo;
  m := mission_cloture_manquant(v_photo);
  if array_length(m,1) is not null then e := e || format('photo : tout est fait mais il reste %s', array_to_string(m,' / ')); end if;

  -- ══ 2. MISSION VIDÉO : montage ET rushs ═══════════════════════════════════
  v_video := pg_temp.mission('video', v_op, v_admin, v_client);
  insert into media_liens (prestation_id, nom, url, categorie, type_media, statut, transfert_confirme)
  values (v_video,'ZZ montage','https://x.test/v','final','video','valide',true);

  -- v240 : un montage seul, relu, suffit. C'est l'operateur qui decide de deposer des rushs ou non.
  m := mission_cloture_manquant(v_video);
  if array_length(m,1) is not null then e := e || format('vidéo : un montage relu ne suffit pas, il reste %s', array_to_string(m,' / ')); end if;

  -- Mais s'il depose des rushs, ils sont relus comme le reste.
  insert into media_liens (prestation_id, nom, url, categorie, type_media, statut)
  values (v_video,'ZZ rushs','https://x.test/r','rushs','video','a_verifier');
  m := mission_cloture_manquant(v_video);
  if not (m @> array['Un lien n''a pas encore été vérifié par la Production']) then
    e := e || 'vidéo : des rushs deposes mais non relus ne bloquent pas'::text;
  end if;
  update media_liens set statut='valide' where prestation_id=v_video and categorie='rushs';
  m := mission_cloture_manquant(v_video);
  if array_length(m,1) is not null then e := e || format('vidéo : tout est relu mais il reste %s', array_to_string(m,' / ')); end if;

  -- ══ 3. PHOTO + VIDÉO : les photos seules ne suffisent pas ═════════════════
  v_deux := pg_temp.mission('photo_video', v_op, v_admin, v_client);
  insert into media_liens (prestation_id, nom, url, categorie, type_media, statut, transfert_confirme)
  values (v_deux,'ZZ photos','https://x.test/p2','final','photo','valide',true);

  -- v240 : la couverture n'exige plus rien. Des photos relues suffisent, meme sur photo_video —
  -- c'est l'operateur qui sait ce qu'il a produit, et la Production qui juge le contenu (et qui
  -- peut redresser la remuneration si ce n'est pas ce qui etait attendu).
  m := mission_cloture_manquant(v_deux);
  if array_length(m,1) is not null then
    e := e || format('photo+vidéo : des photos relues ne suffisent pas, il reste %s', array_to_string(m,' / '));
  end if;

  -- §M : la partie photo reste acquise pendant que la vidéo est en correction.
  insert into media_liens (prestation_id, nom, url, categorie, type_media, statut)
  values (v_deux,'ZZ montage','https://x.test/v2','final','video','correction_demandee');
  insert into media_liens (prestation_id, nom, url, categorie, type_media, statut)
  values (v_deux,'ZZ rushs','https://x.test/r2','rushs','video','a_verifier');

  m := mission_cloture_manquant(v_deux);
  if not (m @> array['Un lien attend une correction demandée par la Production']) then
    e := e || 'photo+vidéo : un montage en correction ne bloque pas la clôture'::text;
  end if;

  update media_liens set statut='valide' where prestation_id=v_deux and type_media='video';
  m := mission_cloture_manquant(v_deux);
  if array_length(m,1) is not null then e := e || format('photo+vidéo : tout est relu mais il reste %s', array_to_string(m,' / ')); end if;

  -- ══ 4. KIT À RENDRE : ne bloque PLUS (décision Fouka, 13/09/2026) ═════════
  --
  -- Un kit sorti et non rendu bloquait la clôture. En vrai : on court après le matériel, on ne
  -- retient pas la livraison du client ni la paie de l'opérateur pour ça. La relance existe
  -- ailleurs, toutes les heures (kit_a_restituer, kit_retour_attendu, kit_non_restitue).
  select id into v_kit from kits limit 1;
  if v_kit is not null then
    v_kitmiss := pg_temp.mission('photo', v_op, v_admin, v_client);
    insert into media_liens (prestation_id, nom, url, categorie, type_media, statut, transfert_confirme)
    values (v_kitmiss,'ZZ photos','https://x.test/pk','final','photo','valide',true);

    insert into kit_reservations (kit_id, prestation_id, collaborateur_id, statut, date_retour_prevue)
    values (v_kit, v_kitmiss, v_op, 'sorti', now() - interval '1 hour');
    m := mission_cloture_manquant(v_kitmiss);
    if m @> array['Kit non restitué'] then e := e || 'kit : un kit non rendu bloque encore la clôture'::text; end if;
    if array_length(m,1) is not null then
      e := e || format('kit : mission complète bloquée par %s', array_to_string(m,' / '));
    end if;

    -- ══ 5. KIT CONSERVÉ : ne bloque pas non plus ═══════════════════════════
    update kit_reservations set date_retour_prevue = now() + interval '3 days' where prestation_id = v_kitmiss;
    m := mission_cloture_manquant(v_kitmiss);
    if m @> array['Kit non restitué'] then e := e || 'kit conservé : la mission reste bloquée alors que le retour est prévu plus tard'::text; end if;

    -- Et une fois réellement rendu.
    update kit_reservations set statut='retourné', date_retour_prevue = now() - interval '1 hour' where prestation_id = v_kitmiss;
    m := mission_cloture_manquant(v_kitmiss);
    if m @> array['Kit non restitué'] then e := e || 'kit rendu : toujours compté comme non restitué'::text; end if;
  end if;

  -- ══ 6. LE VERROU EN BASE, pas seulement un bouton grisé ═══════════════════
  --
  -- On amène les missions jusqu'à 'livrée' par le chemin légal :
  -- validate_prestation_statut_transition refuse les sauts, et c'est très bien — ce test-ci
  -- porte sur la CLÔTURE, pas sur l'enchaînement, qui a sa propre couverture.
  perform set_config('role','postgres',true);
  perform pg_temp.jusqua_livree(v_deux);

  -- Celle-là est complète : elle doit passer.
  begin
    update prestations set statut='clôturée' where id=v_deux;
  exception when others then
    e := e || format('mission complète refusée à la clôture : %s', sqlerrm);
  end;

  -- Celle-ci ne l'est pas : un des liens deposes n'a pas encore ete relu par la Production.
  -- C'est le seul manque qui compte desormais, et il doit bloquer meme en appel direct.
  perform pg_temp.jusqua_livree(v_video);
  update media_liens set statut='a_verifier' where prestation_id=v_video and categorie='rushs';
  begin
    update prestations set statut='clôturée' where id=v_video;
    e := e || 'une mission avec un lien non relu a été clôturée'::text;
  exception when others then null; end;

  perform set_config('role','postgres',true);
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — v240 : aucun livrable imposé par la couverture, mais tout lien déposé doit être relu ; une correction en attente bloque ; le kit ne bloque plus (relance seule) ; refus valable en appel direct.' as verdict;

rollback;
