-- L'opérateur livre ce qu'il veut, et la Production redresse après coup (v240, 21/09/2026).
--
-- DEMANDE DE FOUKA : « c'est LUI qui met le nombre de liens à mettre, il ne faut pas lui imposer
-- un nombre de liens. Il met le lien, il envoie à faire vérifier, et le responsable production
-- vérifie uniquement à partir des liens. Il n'y a pas de lien obligatoire pour valider la
-- prestation. Et une fois la prestation validée, le responsable peut faire un redressement
-- financier : le contenu n'est pas bon ou pas celui attendu, il retire 20, 30, 40. »
--
-- CE QU'ON MESURE :
--   1. Une mission photo+vidéo se clôture avec UN SEUL lien, d'un type quelconque.
--   2. Aucun libellé de livrable imposé (« Photos traitées », « Montage final », « Rushs ») ne
--      revient dans ce qui manque.
--   3. Sans aucun lien, la clôture reste refusée : il n'y a rien à vérifier.
--   4. Chaque lien déposé doit être relu, quel que soit son type.
--   5. La règle des cartes tient toujours : fichiers sécurisés et transfert confirmé.
--   6. APRÈS validation du travail, la Production retient encore : c'est le redressement.

begin;

create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $i$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p::text,'role','authenticated')::text, true);
end $i$;
create or replace function pg_temp.serveur() returns void language plpgsql as $i$
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
end $i$;

do $$
declare
  v_prod uuid; v_ope uuid; v_pole uuid; v_client uuid; v_pres uuid; v_aff uuid; l1 uuid; l2 uuid;
  m text[]; n numeric; e text[] := '{}';
begin
  perform pg_temp.serveur();
  v_prod := gen_random_uuid(); v_ope := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) values
    (v_prod,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-libre-prod@example.invalid','',now(),now(),now()),
    (v_ope,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-libre-ope@example.invalid','',now(),now(),now());
  insert into profiles (id, prenom, nom, email, role, actif) values
    (v_prod,'ZZ','LibreProd','zz-libre-prod@example.invalid','prod',true),
    (v_ope,'ZZ','LibreOpe','zz-libre-ope@example.invalid','photo',true);
  select id into v_pole from poles order by nom limit 1;
  insert into pole_affectations (user_id, pole_id, actif) values (v_prod, v_pole, true);
  insert into clients (nom, statut, pole_id) values ('ZZ Client Libre','client', v_pole) returning id into v_client;
  -- Couverture « photo_video » : celle qui exigeait TROIS livrables avant la v240.
  insert into prestations (client_id, reference, date_prestation, statut, couverture)
    values (v_client,'ZZ-LIBRE-001', current_date - 1, 'production_terminée','photo_video') returning id into v_pres;
  insert into prestations_equipe (prestation_id, collaborateur_id, fonction, remuneration, statut, statut_paiement)
    values (v_pres, v_ope, 'Photo', 100, 'acceptée', 'en_attente') returning id into v_aff;
  insert into mission_suivi_operateur (prestation_id, collaborateur_id, prestation_terminee_at, fichiers_securises_at)
    values (v_pres, v_ope, now(), now());

  -- ══ 3. SANS AUCUN LIEN, RIEN A VERIFIER ══════════════════════════════════
  m := mission_cloture_manquant(v_pres);
  if not ('Aucun lien déposé par l''opérateur' = any(m)) then
    e := e || 'une mission sans aucun lien se cloture'::text;
  end if;

  -- ══ 1 & 2. UN SEUL LIEN, D'UN TYPE QUELCONQUE, SUFFIT ════════════════════
  -- Un drone : ni « Photos traitées », ni « Montage final », ni « Rushs vidéo ».
  insert into media_liens (prestation_id, nom, url, categorie, type_media, statut, transfert_confirme, ajouteur_id)
    values (v_pres,'Drone — survol','https://ex.invalid/d','livraison','drone','valide',true,v_ope) returning id into l1;
  m := mission_cloture_manquant(v_pres);
  if array_length(m,1) is not null then
    e := e || format('un seul lien ne suffit pas a clore : %s', array_to_string(m,' ; '));
  end if;
  if array_to_string(m,' ') ilike '%Photos traitées%' or array_to_string(m,' ') ilike '%Montage final%'
     or array_to_string(m,' ') ilike '%Rushs%' then
    e := e || 'un livrable impose par la couverture est encore exige'::text;
  end if;

  -- ══ 4. CHAQUE LIEN DEPOSE DOIT ETRE RELU ═════════════════════════════════
  insert into media_liens (prestation_id, nom, url, categorie, type_media, statut, ajouteur_id)
    values (v_pres,'Veo — match complet','https://ex.invalid/v','livraison','veo','a_verifier',v_ope) returning id into l2;
  m := mission_cloture_manquant(v_pres);
  if not ('Un lien n''a pas encore été vérifié par la Production' = any(m)) then
    e := e || 'un second lien non relu ne bloque pas la cloture'::text;
  end if;
  update media_liens set statut='correction_demandee', commentaire='Hors cadre' where id = l2;
  m := mission_cloture_manquant(v_pres);
  if not ('Un lien attend une correction demandée par la Production' = any(m)) then
    e := e || 'une correction demandee ne bloque pas'::text;
  end if;
  update media_liens set statut='valide' where id = l2;

  -- ══ 5. LA REGLE DES CARTES TIENT ═════════════════════════════════════════
  update mission_suivi_operateur set fichiers_securises_at = null where prestation_id = v_pres;
  m := mission_cloture_manquant(v_pres);
  if not ('Fichiers non sécurisés' = any(m)) then
    e := e || 'la regle des cartes a saute avec les livrables'::text;
  end if;
  update mission_suivi_operateur set fichiers_securises_at = now() where prestation_id = v_pres;

  -- ══ 6. LE REDRESSEMENT APRES VALIDATION ══════════════════════════════════
  perform pg_temp.incarner(v_prod);
  perform mission_valider_travail(v_aff, true, 'Travail livré.');
  begin
    perform mission_penaliser(v_aff, 30, 'Contenu non conforme à la commande', 'Cadrages hors sujet sur la seconde période.');
  exception when others then
    e := e || ('la Production ne peut pas redresser apres validation — '||left(sqlerrm,80))::text;
  end;
  perform pg_temp.serveur();
  select mission_net_a_payer(v_aff) into n;
  if n <> 70 then e := e || format('net attendu 70 apres redressement, obtenu %s', n); end if;
  if (select remuneration from prestations_equipe where id = v_aff) <> 100 then
    e := e || 'le redressement a reecrit la remuneration acceptee'::text;
  end if;
  if (select travail_valide from prestations_equipe where id = v_aff) is not true then
    e := e || 'le redressement a annule la validation du travail'::text;
  end if;

  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — une mission se clôture avec les liens que l''opérateur a choisi de déposer, sans aucun livrable imposé ; chaque lien est relu, la règle des cartes tient, et la Production peut redresser la rémunération après avoir validé le travail.' as verdict;

rollback;
