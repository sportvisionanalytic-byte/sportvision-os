-- Les notifications du module opérateur : une par événement réel, jamais deux.
--
-- L'anti-spam est le point que Fouka a désigné comme le plus important de la vague, et c'est
-- aussi celui qui ne se voit pas en relisant le code : il faut faire tourner le cron plusieurs
-- fois et compter ce qui sort. C'est ce que fait ce test.
--
-- Il vérifie aussi les conditions de sortie : un problème réglé arrête la relance. Une
-- notification qui continue après coup est pire qu'une notification absente, c'est elle qui
-- apprend aux gens à ne plus lire.
--
-- Tout s'exécute dans une transaction annulée.

begin;

create or replace function pg_temp.jusqua(p_id uuid, p_cible text) returns void language plpgsql as $inner$
declare st text;
begin
  foreach st in array array['équipe_affectée','prête','équipe_en_route','arrivée_sur_place',
                            'production_démarrée','production_terminée','médias_à_transférer',
                            'médias_complets','à_monter','montage_en_cours','prêt_validation','livrée'] loop
    update prestations set statut = st::statut_prestation where id = p_id;
    exit when st = p_cible;
  end loop;
end $inner$;

do $$
declare
  v_opA uuid; v_opB uuid; v_prod uuid; v_admin uuid; v_client uuid;
  v_m1 uuid; v_m2 uuid; v_lien uuid;
  n integer; n2 integer; e text[] := '{}';
begin
  perform set_config('role','postgres',true);
  select id into v_opA from profiles where role='photo' and actif order by created_at limit 1;
  select id into v_opB from profiles where role='photo' and actif and id<>v_opA order by created_at limit 1;
  select id into v_prod from profiles where role='prod' and actif limit 1;
  select id into v_admin from profiles where role='admin' and actif limit 1;
  insert into clients (nom,statut) values ('ZZ Client notifs','client') returning id into v_client;

  -- ══ 1. LE CRON RELANCÉ TROIS FOIS N'ENVOIE QU'UNE FOIS ════════════════════
  -- Mission demain, acceptée : le rappel doit partir, et une seule fois.
  insert into prestations (reference,statut,client_id,date_prestation,heure_rdv,heure_debut,couverture,responsable_prod_id)
  values ('ZZ-N1','planifiée',v_client,(current_date+1)::date,'14:15','15:00','photo',v_prod)
  returning id into v_m1;
  perform set_config('request.jwt.claims', json_build_object('sub',v_admin::text,'role','authenticated')::text, true);
  insert into prestations_equipe (prestation_id,collaborateur_id,statut) values (v_m1,v_opA,'invitation_envoyée');
  perform set_config('role','postgres',true);
  update prestations_equipe set statut='acceptée' where prestation_id=v_m1;

  perform send_prestation_reminders();
  perform send_prestation_reminders();
  perform send_prestation_reminders();

  select count(*) into n from notifications
   where type='rappel_prestation' and lien_prestation_id=v_m1 and destinataire_id=v_opA;
  if n <> 1 then e := e || format('cron joue 3 fois : %s rappels « mission demain » au lieu de 1', n); end if;

  -- ══ 2. MISSION ACCEPTÉE AVANT LE CRON → AUCUNE RELANCE D'ACCEPTATION ══════
  select count(*) into n from notifications
   where type='mission_non_acceptee' and lien_prestation_id=v_m1;
  if n <> 0 then e := e || 'une mission acceptee recoit encore une relance d acceptation'::text; end if;

  -- ══ 3. INVITATION SANS RÉPONSE → RELANCE + ESCALADE PRODUCTION ════════════
  insert into prestations (reference,statut,client_id,date_prestation,heure_debut,couverture,responsable_prod_id)
  values ('ZZ-N2','planifiée',v_client,(current_date+1)::date,'10:00','video',v_prod)
  returning id into v_m2;
  perform set_config('request.jwt.claims', json_build_object('sub',v_admin::text,'role','authenticated')::text, true);
  insert into prestations_equipe (prestation_id,collaborateur_id,statut) values (v_m2,v_opB,'invitation_envoyée');
  perform set_config('role','postgres',true);
  -- L'invitation doit avoir un peu vieilli : on ne relance pas dans l'heure qui suit l'envoi.
  update prestations_equipe set created_at = now() - interval '2 days' where prestation_id=v_m2;

  perform send_prestation_reminders();
  perform send_prestation_reminders();

  select count(*) into n from notifications where type='mission_non_acceptee' and lien_prestation_id=v_m2;
  if n <> 1 then e := e || format('relance d acceptation : %s au lieu de 1', n); end if;

  select count(*) into n from notifications where type='mission_non_acceptee_prod' and lien_prestation_id=v_m2;
  if n < 1 then e := e || 'la Production n est pas alertee d une mission non acceptee qui approche'::text; end if;

  -- ══ 4. AUCUNE ÉCHÉANCE → AUCUN FAUX RETARD ═══════════════════════════════
  perform pg_temp.jusqua(v_m1, 'montage_en_cours');
  perform send_prestation_reminders();
  select count(*) into n from notifications where type in ('livraison_en_retard','echeance_proche') and lien_prestation_id=v_m1;
  if n <> 0 then e := e || 'un retard est annonce alors qu aucune echeance n existe'::text; end if;

  -- ══ 5. ÉCHÉANCE FUTURE LOINTAINE → RIEN ══════════════════════════════════
  update prestations set deadline_photo_at = now() + interval '5 days' where id=v_m1;
  perform send_prestation_reminders();
  select count(*) into n from notifications where type in ('livraison_en_retard','echeance_proche') and lien_prestation_id=v_m1;
  if n <> 0 then e := e || 'une echeance dans 5 jours declenche deja un rappel'::text; end if;

  -- ══ 6. ÉCHÉANCE DÉPASSÉE → OPÉRATEUR ET PRODUCTION, UNE FOIS CHACUN ══════
  update prestations set deadline_photo_at = now() - interval '3 hours' where id=v_m1;
  perform send_prestation_reminders();
  perform send_prestation_reminders();
  select count(*) into n from notifications where type='livraison_en_retard' and lien_prestation_id=v_m1 and destinataire_id=v_opA;
  if n <> 1 then e := e || format('retard operateur : %s notifications au lieu de 1', n); end if;
  select count(*) into n from notifications where type='livraison_en_retard_prod' and lien_prestation_id=v_m1;
  if n <> 1 then e := e || format('retard Production : %s notifications au lieu de 1', n); end if;

  -- ══ 7. UNE LIVRAISON ARRIVE → PRODUCTION, ET L'OPÉRATEUR N'EST PAS NOTIFIÉ ═
  insert into media_liens (prestation_id,nom,url,categorie,type_media,statut,ajouteur_id,transfert_confirme)
  values (v_m1,'ZZ photos','https://x.test/n','final','photo','a_verifier',v_opA,true)
  returning id into v_lien;
  select count(*) into n from notifications where type='livraison_recue' and lien_prestation_id=v_m1 and destinataire_id=v_prod;
  if n <> 1 then e := e || format('livraison recue : %s notification Production au lieu de 1', n); end if;
  select count(*) into n from notifications where type='livraison_recue' and destinataire_id=v_opA;
  if n <> 0 then e := e || 'l operateur est notifie de sa propre livraison'::text; end if;

  -- Un second lien le même jour ne redouble pas l'alerte.
  insert into media_liens (prestation_id,nom,url,categorie,type_media,statut,ajouteur_id)
  values (v_m1,'ZZ rushs','https://x.test/n2','rushs','video','a_verifier',v_opA);
  select count(*) into n from notifications where type='livraison_recue' and lien_prestation_id=v_m1;
  if n <> 1 then e := e || format('deux depots le meme jour = %s alertes au lieu de 1', n); end if;

  -- ══ 8. CORRECTION → LE BON OPÉRATEUR, ET LUI SEUL ════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub',v_prod::text,'role','authenticated')::text, true);
  update media_liens set statut='correction_demandee', commentaire='Il manque les rushs vidéo.' where id=v_lien;
  perform set_config('role','postgres',true);
  select count(*) into n from notifications where type='correction_demandee' and destinataire_id=v_opA;
  if n <> 1 then e := e || format('correction : %s notification a l operateur au lieu de 1', n); end if;
  select count(*) into n from notifications where type='correction_demandee' and destinataire_id=v_opB;
  if n <> 0 then e := e || 'un autre operateur recoit la correction d un collegue'::text; end if;
  select count(*) into n from notifications where type='correction_demandee' and destinataire_id=v_opA and message like '%rushs vidéo%';
  if n <> 1 then e := e || 'le motif de la correction n est pas dans le message'::text; end if;

  -- ══ 9. VALIDATION → L'OPÉRATEUR, AVEC CE QUI RESTE ═══════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub',v_prod::text,'role','authenticated')::text, true);
  update media_liens set statut='valide' where id=v_lien;
  perform set_config('role','postgres',true);
  select count(*) into n from notifications where type='livraison_validee' and destinataire_id=v_opA;
  if n <> 1 then e := e || format('validation : %s notification au lieu de 1', n); end if;

  -- ══ 10. MISSION REFUSÉE → PRODUCTION IMMÉDIATEMENT ═══════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub',v_opB::text,'role','authenticated')::text, true);
  update prestations_equipe set statut='refusée', notes_refus='Indisponible ce week-end' where prestation_id=v_m2;
  perform set_config('role','postgres',true);
  select count(*) into n from notifications where type='mission_refusee' and lien_prestation_id=v_m2 and destinataire_id=v_prod;
  if n <> 1 then e := e || format('mission refusee : %s alerte Production au lieu de 1', n); end if;

  -- ══ 11. INCIDENT → PRODUCTION, EN PRIORITÉ HAUTE ═════════════════════════
  insert into incidents (prestation_id,declare_par,type_incident,niveau,description,date_incident,cloture)
  values (v_m1,v_opA,'batterie_hs','important','Matériel — batterie défectueuse sur le Kit Photo 02',now(),false);
  select count(*) into n from notifications
   where type='incident_signale' and lien_prestation_id=v_m1 and destinataire_id=v_prod and priorite='haute';
  if n <> 1 then e := e || format('incident : %s alerte Production en priorite haute au lieu de 1', n); end if;

  -- ══ 12. KIT CONSERVÉ → AUCUNE ALERTE DE RETOUR ═══════════════════════════
  declare v_kit uuid;
  begin
    select id into v_kit from kits limit 1;
    if v_kit is not null then
      insert into kit_reservations (kit_id,prestation_id,collaborateur_id,statut,date_retour_prevue)
      values (v_kit,v_m1,v_opA,'sorti', now() + interval '4 days');
      perform send_prestation_reminders();
      select count(*) into n from notifications where type in ('kit_a_restituer','kit_retour_attendu','kit_non_restitue') and lien_prestation_id=v_m1;
      if n <> 0 then e := e || format('kit conserve 4 jours : %s alertes de retour au lieu de 0', n); end if;

      -- ══ 13. KIT À RENDRE, ÉCHÉANCE DÉPASSÉE → OPÉRATEUR ET PRODUCTION ════
      update kit_reservations set date_retour_prevue = now() - interval '3 hours' where prestation_id=v_m1;
      perform send_prestation_reminders();
      perform send_prestation_reminders();
      select count(*) into n from notifications where type='kit_retour_attendu' and destinataire_id=v_opA;
      if n <> 1 then e := e || format('retour de kit : %s alertes operateur au lieu de 1', n); end if;
      select count(*) into n from notifications where type='kit_non_restitue' and destinataire_id=v_prod;
      if n <> 1 then e := e || format('kit non restitue : %s alertes Production au lieu de 1', n); end if;

      -- ══ 14. KIT RENDU → LA RELANCE S'ARRÊTE ══════════════════════════════
      select count(*) into n from notifications where type in ('kit_retour_attendu','kit_non_restitue');
      update kit_reservations set statut='retourné' where prestation_id=v_m1;
      perform send_prestation_reminders();
      select count(*) into n2 from notifications where type in ('kit_retour_attendu','kit_non_restitue');
      if n2 <> n then e := e || 'le kit est rendu et la relance continue'::text; end if;
    end if;
  end;

  -- ══ 15. JAMAIS LA MISSION D'UN AUTRE ═════════════════════════════════════
  select count(*) into n from notifications where destinataire_id=v_opB and lien_prestation_id=v_m1;
  if n <> 0 then e := e || format('l operateur B a recu %s notifications sur une mission qui n est pas la sienne', n); end if;

  -- ══ 16. CHAQUE NOTIFICATION POINTE VERS SA MISSION ═══════════════════════
  select count(*) into n from notifications
   where cle_occurrence is not null and lien_prestation_id is null;
  if n <> 0 then e := e || format('%s notifications sans lien vers une mission', n); end if;

  perform set_config('role','postgres',true);
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — cron rejoue n''envoie qu''une fois ; aucun faux retard sans echeance ; correction et validation au bon operateur ; kit conserve silencieux, kit echu alerte, kit rendu arrete la relance ; aucune notification croisee entre operateurs.' as verdict;

rollback;
