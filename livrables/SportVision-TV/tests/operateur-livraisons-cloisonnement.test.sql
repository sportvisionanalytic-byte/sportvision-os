-- Un photographe ne doit pouvoir toucher que les livraisons de SES missions.
--
-- Trou trouve a l'audit du module « Procedure terrain » (09/09/2026) : media_liens etait ouvert
-- en ecriture a tout is_staff() dans le perimetre du pole. Deux photographes du meme pole
-- pouvaient donc se modifier mutuellement leurs liens de livraison, alors que les prestations
-- elles-memes sont deja correctement cloisonnees (prestations_acces exige une ligne dans
-- prestations_equipe).
--
-- Ce test est ecrit AVANT la migration : c'est lui qui dit si le cloisonnement fonctionne, pas
-- la lecture du code. Il doit etre rouge sans le correctif et vert avec.
--
-- Methode : deux photographes reels, deux prestations, chacun affecte a la sienne. On se met
-- REELLEMENT dans la peau de chacun (set local role authenticated + request.jwt.claims) et on
-- mesure ce que la base rend. Aucune supposition sur les policies.
--
-- Tout s'execute dans une transaction annulee.

begin;

create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $inner$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p::text,'role','authenticated')::text, true);
end $inner$;

do $$
declare
  v_opA uuid; v_opB uuid; v_prod uuid; v_admin uuid;
  v_presA uuid; v_presB uuid; v_client uuid; v_pole uuid;
  v_lienA uuid; v_lienB uuid; v_lienLibre uuid;
  n integer; e text[] := '{}';
begin
  perform set_config('role','postgres',true);

  -- ── Les acteurs : deux photographes REELS du meme pole ─────────────────────
  -- Des personnes qui utilisent vraiment l'OS, pas des profils fabriques : c'est le meme pole
  -- qui rendait la fuite possible, il faut donc que le decor le reproduise.
  select id into v_opA from profiles where role = 'photo' and actif order by created_at limit 1;
  select id into v_opB from profiles where role = 'photo' and actif and id <> v_opA order by created_at limit 1;
  select id into v_prod from profiles where role = 'prod' and actif limit 1;
  select id into v_admin from profiles where role = 'admin' and actif limit 1;

  if v_opA is null or v_opB is null then
    raise exception 'Il faut deux profils photo actifs pour jouer ce test';
  end if;
  if v_admin is null then
    raise exception 'Il faut un profil admin actif pour monter le decor';
  end if;

  select id into v_pole from poles limit 1;

  -- ── Le decor : deux missions, une par operateur ────────────────────────────
  insert into clients (nom, statut) values ('ZZ Client test livraisons','client') returning id into v_client;

  insert into prestations (reference, statut, type_prestation, client_id, date_prestation, lieu, pole_id)
  values ('ZZ-OPA', 'planifiée', 'match', v_client, current_date + 1, 'ZZ Stade A', v_pole)
  returning id into v_presA;
  insert into prestations (reference, statut, type_prestation, client_id, date_prestation, lieu, pole_id)
  values ('ZZ-OPB', 'planifiée', 'match', v_client, current_date + 1, 'ZZ Stade B', v_pole)
  returning id into v_presB;

  -- L'affectation passe par le vrai chemin metier : protect_sensitive_affectation_fields()
  -- n'autorise l'insertion qu'en 'invitation_envoyée', et seule la personne invitee peut
  -- ensuite accepter. On monte donc le decor sous l'identite de l'admin, puis chaque operateur
  -- accepte lui-meme sa mission. Le test exerce ainsi la regle d'acceptation au passage.
  perform set_config('request.jwt.claims', json_build_object('sub',v_admin::text,'role','authenticated')::text, true);
  insert into prestations_equipe (prestation_id, collaborateur_id, statut)
  values (v_presA, v_opA, 'invitation_envoyée');
  insert into prestations_equipe (prestation_id, collaborateur_id, statut)
  values (v_presB, v_opB, 'invitation_envoyée');

  perform pg_temp.incarner(v_opA);
  update prestations_equipe set statut = 'acceptée' where prestation_id = v_presA and collaborateur_id = v_opA;
  get diagnostics n = row_count;
  if n <> 1 then e := e || 'L operateur A ne peut pas accepter sa propre mission'::text; end if;

  perform pg_temp.incarner(v_opB);
  update prestations_equipe set statut = 'acceptée' where prestation_id = v_presB and collaborateur_id = v_opB;
  get diagnostics n = row_count;
  if n <> 1 then e := e || 'L operateur B ne peut pas accepter sa propre mission'::text; end if;

  -- Et personne d'autre : A ne doit pas pouvoir repondre a la place de B.
  perform pg_temp.incarner(v_opA);
  begin
    update prestations_equipe set statut = 'refusée' where prestation_id = v_presB and collaborateur_id = v_opB;
    get diagnostics n = row_count;
    if n <> 0 then e := e || 'L operateur A a repondu a l invitation de l operateur B'::text; end if;
  exception when others then null; end;

  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims', json_build_object('sub',v_admin::text,'role','authenticated')::text, true);

  -- Une livraison sur chaque mission, plus un lien sans prestation (banque media partagee).
  insert into media_liens (prestation_id, nom, url, categorie, type_media, statut, ajouteur_id)
  values (v_presA, 'ZZ photos A', 'https://exemple.test/a', 'final', 'photo', 'a_verifier', v_opA)
  returning id into v_lienA;
  insert into media_liens (prestation_id, nom, url, categorie, type_media, statut, ajouteur_id)
  values (v_presB, 'ZZ photos B', 'https://exemple.test/b', 'final', 'photo', 'a_verifier', v_opB)
  returning id into v_lienB;
  insert into media_liens (prestation_id, nom, url, categorie, type_media, statut, ajouteur_id)
  values (null, 'ZZ banque partagee', 'https://exemple.test/bank', 'bibliotheque', 'photo', 'valide', v_opA)
  returning id into v_lienLibre;

  -- ══ OPERATEUR A ═══════════════════════════════════════════════════════════
  perform pg_temp.incarner(v_opA);

  -- Ce qu'il DOIT pouvoir faire : gerer la livraison de sa propre mission.
  select count(*) into n from media_liens where id = v_lienA;
  if n <> 1 then e := e || 'L operateur A ne lit pas la livraison de sa propre mission'::text; end if;

  begin
    update media_liens set nombre_fichiers = 120, transfert_confirme = true where id = v_lienA;
    get diagnostics n = row_count;
    if n <> 1 then e := e || 'L operateur A ne peut pas modifier la livraison de sa propre mission'::text; end if;
  exception when others then
    e := e || 'L operateur A ne peut pas modifier la livraison de sa propre mission (exception)'::text;
  end;

  begin
    insert into media_liens (prestation_id, nom, url, categorie, type_media, statut, ajouteur_id)
    values (v_presA, 'ZZ rushs A', 'https://exemple.test/a-rushs', 'rushs', 'video', 'a_verifier', v_opA);
  exception when others then
    e := e || 'L operateur A ne peut pas deposer un lien sur sa propre mission'::text;
  end;

  -- Ce qu'il ne doit PAS pouvoir faire : toucher la livraison du collegue.
  select count(*) into n from media_liens where id = v_lienB;
  if n <> 0 then e := e || 'L operateur A LIT la livraison de la mission de l operateur B'::text; end if;

  update media_liens set url = 'https://vole.test' where id = v_lienB;
  get diagnostics n = row_count;
  if n <> 0 then e := e || 'L operateur A MODIFIE la livraison de la mission de l operateur B'::text; end if;

  -- L'ecriture directe en base doit etre refusee elle aussi, pas seulement le bouton de l'ecran.
  begin
    insert into media_liens (prestation_id, nom, url, categorie, type_media, statut, ajouteur_id)
    values (v_presB, 'ZZ intrusion', 'https://vole.test/2', 'final', 'photo', 'a_verifier', v_opA);
    e := e || 'L operateur A a INSERE un lien sur la mission de l operateur B'::text;
  exception when others then null; end;

  -- Sonde destructrice : isolee dans un point de sauvegarde. Sans cela, une suppression qui
  -- REUSSIT (l'etat d'avant correctif) effacerait la ligne et toutes les assertions suivantes
  -- mesureraient un lien qui n'existe plus — le test se mettrait a signaler des faux echecs
  -- en cascade au lieu du seul vrai probleme.
  begin
    delete from media_liens where id = v_lienB;
    get diagnostics n = row_count;
    if n <> 0 then
      e := e || 'L operateur A a SUPPRIME la livraison de l operateur B'::text;
      raise exception 'rollback_sonde';
    end if;
  exception when others then
    -- Deux chemins arrivent ici, et les deux sont bons : soit la base a REFUSE la suppression
    -- (comportement attendu), soit elle l'a acceptee et on vient de la defaire volontairement
    -- apres avoir enregistre l'echec dans `e`. Un bloc PL/pgSQL annule ses ecritures a la
    -- sortie par exception, mais conserve les variables : le constat survit, pas la suppression.
    null;
  end;

  -- La banque media partagee n'est pas une livraison de mission : elle reste accessible.
  select count(*) into n from media_liens where id = v_lienLibre;
  if n <> 1 then e := e || 'L operateur A a perdu l acces a la banque media partagee'::text; end if;

  -- ══ OPERATEUR B, symetrique ═══════════════════════════════════════════════
  perform pg_temp.incarner(v_opB);

  select count(*) into n from media_liens where id = v_lienB;
  if n <> 1 then e := e || 'L operateur B ne lit pas la livraison de sa propre mission'::text; end if;

  select count(*) into n from media_liens where id = v_lienA;
  if n <> 0 then e := e || 'L operateur B LIT la livraison de la mission de l operateur A'::text; end if;

  update media_liens set url = 'https://vole.test/3' where id = v_lienA;
  get diagnostics n = row_count;
  if n <> 0 then e := e || 'L operateur B MODIFIE la livraison de la mission de l operateur A'::text; end if;

  -- ══ PRODUCTION ET ADMIN GARDENT LEUR VUE ══════════════════════════════════
  -- Le correctif ne doit RETIRER de l acces qu aux operateurs terrain.
  if v_prod is not null then
    perform pg_temp.incarner(v_prod);
    select count(*) into n from media_liens where id in (v_lienA, v_lienB);
    if n <> 2 then
      e := e || format('La Production ne voit plus les deux livraisons de son perimetre (%s/2)', n)::text;
    end if;
    update media_liens set statut = 'valide' where id = v_lienA;
    get diagnostics n = row_count;
    if n <> 1 then e := e || 'La Production ne peut plus valider une livraison'::text; end if;
  end if;

  if v_admin is not null then
    perform pg_temp.incarner(v_admin);
    select count(*) into n from media_liens where id in (v_lienA, v_lienB, v_lienLibre);
    if n <> 3 then
      e := e || format('L admin ne voit plus tous les liens (%s/3)', n)::text;
    end if;
  end if;

  perform set_config('role','postgres',true);
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — un operateur terrain ne lit et ne modifie que les livraisons des missions ou il figure dans prestations_equipe ; la banque media partagee reste accessible ; Production et admin conservent leur perimetre.' as verdict;

rollback;
