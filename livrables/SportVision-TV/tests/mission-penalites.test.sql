-- La Production refuse une mission et retient une pénalité (v231/v232, 14/09/2026).
--
-- DEMANDE DE FOUKA : « le responsable production pouvoir dire mission pas validée, mettre des
-- pénalités et retirer sur la paye initiale ».
--
-- CE QUI EST EN JEU. Une retenue sur une rémunération acceptée est une sanction pécuniaire :
-- interdite sur un salaire (L1331-2), licite sur une prestation indépendante SI une clause le
-- prévoit. Le produit ne tranche pas ce point à la place de Fouka ; il rend la pratique
-- défendable. Ce test mesure exactement ça : chaque garde-fou qui protège l'opérateur est vérifié
-- au même titre que le pouvoir accordé à la Production. Un test qui ne vérifierait que le pouvoir
-- validerait une retenue silencieuse.
--
-- CE QU'ON MESURE :
--   1. La Production refuse un travail, avec motif, et l'opérateur est prévenu.
--   2. Un refus sans motif est impossible.
--   3. Une pénalité réduit le NET, sans jamais toucher la rémunération acceptée.
--   4. L'opérateur est notifié de la retenue, du motif et du net.
--   5. La retenue ne dépasse pas la rémunération : le net ne passe jamais sous zéro.
--   6. Une pénalité sans motif est refusée.
--   7. Personne ne se pénalise ni ne se valide soi-même.
--   8. Un opérateur ne se retire pas sa propre pénalité, et un tiers n'en pose pas.
--   9. L'opérateur conteste, et sa contestation remonte à qui a décidé.
--  10. Annuler restitue le net et laisse la trace ; rien ne s'efface.
--  11. Rien après paiement.
--  12. Un travail refusé empêche de clore la mission.
--  13. Tout mouvement est journalisé.

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
  v_admin uuid; v_prod uuid; v_ope uuid; v_tiers uuid;
  v_client uuid; v_pres uuid; v_aff uuid; v_aff_prod uuid;
  v_pen uuid; v_res jsonb; v_pole uuid;
  n int; msg text; num numeric; e text[] := '{}';
begin
  perform pg_temp.serveur();
  select id into v_admin from profiles where role='admin' and actif order by created_at limit 1;

  v_prod := gen_random_uuid(); v_ope := gen_random_uuid(); v_tiers := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values
      (v_prod,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-pen-prod@example.invalid','',now(),now(),now()),
      (v_ope,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-pen-ope@example.invalid','',now(),now(),now()),
      (v_tiers,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-pen-tiers@example.invalid','',now(),now(),now());
  insert into profiles (id, prenom, nom, email, role, actif) values
    (v_prod,'ZZ','PenProd','zz-pen-prod@example.invalid','prod',true),
    (v_ope,'ZZ','PenOperateur','zz-pen-ope@example.invalid','photo',true),
    (v_tiers,'ZZ','PenTiers','zz-pen-tiers@example.invalid','photo',true);

  -- Le pôle d'une prestation est déduit de son client par trigger (sync_prestation_pole_id) :
  -- le poser sur la prestation ne sert à rien, il se pose sur le client.
  select id into v_pole from poles order by nom limit 1;
  insert into clients (nom, statut, pole_id) values ('ZZ Client Penalite','client', v_pole) returning id into v_client;
  insert into prestations (client_id, reference, date_prestation, statut, couverture)
    values (v_client,'ZZ-PEN-001', current_date - 2, 'production_terminée','photo') returning id into v_pres;
  -- Sans cette affectation, prestation_pole_scope_ok répondrait non et on mesurerait un refus de
  -- périmètre au lieu des règles de pénalité elles-mêmes.
  insert into pole_affectations (user_id, pole_id, actif) values (v_prod, v_pole, true);

  insert into prestations_equipe (prestation_id, collaborateur_id, fonction, remuneration, statut, statut_paiement)
    values (v_pres, v_ope, 'Photo', 100, 'acceptée', 'en_attente') returning id into v_aff;
  insert into prestations_equipe (prestation_id, collaborateur_id, fonction, remuneration, statut, statut_paiement)
    values (v_pres, v_prod, 'Photo', 80, 'acceptée', 'en_attente') returning id into v_aff_prod;

  -- ══ 1. LA PRODUCTION REFUSE LE TRAVAIL ═══════════════════════════════════
  perform pg_temp.incarner(v_prod);
  begin
    v_res := mission_valider_travail(v_aff, false, 'Photos floues, cadrage hors sujet sur la seconde mi-temps.');
  exception when others then e := e || ('la Production ne peut pas refuser un travail — '||left(sqlerrm,90))::text;
  end;
  perform pg_temp.serveur();
  if (select travail_valide from prestations_equipe where id = v_aff) is not false then
    e := e || 'le refus n est pas enregistre'::text;
  end if;
  select count(*) into n from notifications
   where destinataire_id = v_ope and type = 'mission_verdict' and message like '%floues%';
  if n <> 1 then e := e || format('l operateur n est pas prevenu du refus (%s notification)', n); end if;

  -- ══ 2. UN REFUS SANS MOTIF EST IMPOSSIBLE ════════════════════════════════
  perform pg_temp.incarner(v_prod);
  msg := null;
  begin
    perform mission_valider_travail(v_aff, false, '   ');
    e := e || 'un travail a ete refuse sans motif'::text;
  exception when others then msg := sqlerrm;
  end;

  -- ══ 3. LA PÉNALITÉ RÉDUIT LE NET, PAS LA RÉMUNÉRATION ════════════════════
  begin
    v_res := mission_penaliser(v_aff, 30, 'Retard de livraison de 6 jours', 'Livraison attendue le 10, reçue le 16.');
  exception when others then e := e || ('la Production ne peut pas penaliser — '||left(sqlerrm,90))::text;
  end;
  perform pg_temp.serveur();
  select remuneration into num from prestations_equipe where id = v_aff;
  if num <> 100 then e := e || format('la remuneration acceptee a ete reecrite : %s', num); end if;
  if mission_net_a_payer(v_aff) <> 70 then
    e := e || format('net attendu 70, obtenu %s', mission_net_a_payer(v_aff));
  end if;
  -- Le statut de l'affectation ne bascule pas : une pénalité n'est pas une nouvelle proposition.
  if (select statut from prestations_equipe where id = v_aff) <> 'acceptée' then
    e := e || 'la penalite a renvoye l affectation en proposition'::text;
  end if;

  -- ══ 4. L'OPÉRATEUR EST PRÉVENU, AVEC LE MOTIF ET LE NET ══════════════════
  select count(*) into n from notifications
   where destinataire_id = v_ope and type = 'mission_penalite'
     and message like '%30%' and message like '%Retard de livraison%' and message like '%70%';
  if n <> 1 then e := e || format('retenue silencieuse : %s notification chiffree a l operateur', n); end if;

  -- ══ 5. LE NET NE PASSE JAMAIS SOUS ZÉRO ══════════════════════════════════
  perform pg_temp.incarner(v_prod);
  msg := null;
  begin
    perform mission_penaliser(v_aff, 90, 'Retenue excessive');
    e := e || 'une retenue a depasse la remuneration'::text;
  exception when others then msg := sqlerrm;
  end;
  if msg is null or msg not like '%retenables%' then
    e := e || ('le refus de retenue excessive n explique rien : '||coalesce(left(msg,70),'(aucun)'))::text;
  end if;

  -- ══ 6. UNE PÉNALITÉ SANS MOTIF EST REFUSÉE ═══════════════════════════════
  begin
    perform mission_penaliser(v_aff, 10, '  ');
    e := e || 'une penalite sans motif a ete acceptee'::text;
  exception when others then null;
  end;

  -- ══ 7. PERSONNE NE SE PÉNALISE NI NE SE VALIDE SOI-MÊME ══════════════════
  msg := null;
  begin
    perform mission_penaliser(v_aff_prod, 10, 'Sur ma propre ligne');
    e := e || 'un responsable s est penalise lui-meme'::text;
  exception when others then msg := sqlerrm;
  end;
  begin
    perform mission_valider_travail(v_aff_prod, true);
    e := e || 'un responsable a valide son propre travail'::text;
  exception when others then null;
  end;

  -- ══ 8. NI L'OPÉRATEUR NI UN TIERS N'ARBITRENT ════════════════════════════
  perform pg_temp.incarner(v_ope);
  begin
    perform mission_penalite_annuler((select id from mission_penalites where affectation_id = v_aff limit 1), 'Je la retire');
    e := e || 'l operateur a leve sa propre penalite'::text;
  exception when others then null;
  end;
  perform pg_temp.incarner(v_tiers);
  begin
    perform mission_penaliser(v_aff, 5, 'Je passais par la');
    e := e || 'un tiers a penalise une mission qui ne le regarde pas'::text;
  exception when others then null;
  end;
  -- Et il ne lit pas non plus la retenue d'un autre.
  select count(*) into n from mission_penalites where affectation_id = v_aff;
  if n <> 0 then e := e || format('un tiers lit %s penalite(s) d un autre', n); end if;

  -- ══ 9. L'OPÉRATEUR CONTESTE, ET ÇA REMONTE ═══════════════════════════════
  perform pg_temp.serveur();
  select id into v_pen from mission_penalites where affectation_id = v_aff and statut='appliquee' limit 1;
  perform pg_temp.incarner(v_ope);
  -- Il lit bien sa propre retenue : sans ça, contester serait impossible.
  select count(*) into n from mission_penalites where affectation_id = v_aff;
  if n <> 1 then e := e || format('l operateur ne lit pas sa propre retenue (%s ligne)', n); end if;
  begin
    perform mission_penalite_contester(v_pen, 'Le client a decale la remise des cartes, j ai la preuve par e-mail.');
  exception when others then e := e || ('l operateur ne peut pas contester — '||left(sqlerrm,80))::text;
  end;
  perform pg_temp.serveur();
  select count(*) into n from notifications
   where destinataire_id = v_prod and type = 'mission_penalite' and message like '%conteste%';
  if n <> 1 then e := e || format('la contestation ne remonte pas au decideur (%s notification)', n); end if;

  -- ══ 10. ANNULER RESTITUE LE NET, SANS EFFACER ════════════════════════════
  perform pg_temp.incarner(v_prod);
  begin
    perform mission_penalite_annuler(v_pen, 'Preuve fournie : le retard ne lui est pas imputable.');
  exception when others then e := e || ('la Production ne peut pas lever une penalite — '||left(sqlerrm,80))::text;
  end;
  perform pg_temp.serveur();
  if mission_net_a_payer(v_aff) <> 100 then
    e := e || format('apres annulation, net attendu 100, obtenu %s', mission_net_a_payer(v_aff));
  end if;
  select count(*) into n from mission_penalites where id = v_pen and statut = 'annulee' and annulation_motif is not null;
  if n <> 1 then e := e || 'la penalite annulee a disparu au lieu de rester tracee'::text; end if;

  -- ══ 11. RIEN APRÈS PAIEMENT ══════════════════════════════════════════════
  update prestations_equipe set statut_paiement = 'payé' where id = v_aff;
  perform pg_temp.incarner(v_prod);
  msg := null;
  begin
    perform mission_penaliser(v_aff, 10, 'Trop tard');
    e := e || 'une retenue a ete posee sur une mission deja payee'::text;
  exception when others then msg := sqlerrm;
  end;
  perform pg_temp.serveur();
  update prestations_equipe set statut_paiement = 'en_attente' where id = v_aff;

  -- ══ 12. UN TRAVAIL REFUSÉ EMPÊCHE DE CLORE ═══════════════════════════════
  if not ('Travail d''un opérateur non validé par la Production' = any (mission_cloture_manquant(v_pres))) then
    e := e || 'un travail refuse ne bloque pas la cloture de la mission'::text;
  end if;
  -- L'Admin lève le refus : la mission redevient clôturable de ce point de vue.
  perform pg_temp.incarner(v_admin);
  perform mission_valider_travail(v_aff, true, 'Reprise livree et conforme.');
  perform pg_temp.serveur();
  if 'Travail d''un opérateur non validé par la Production' = any (mission_cloture_manquant(v_pres)) then
    e := e || 'le refus leve bloque encore la cloture'::text;
  end if;

  -- ══ 13. TOUT EST JOURNALISÉ ══════════════════════════════════════════════
  select count(*) into n from financial_audit_log
   where ligne_id = v_aff and action in ('mission_travail_refuse','mission_travail_valide',
                                         'mission_penalite_appliquee','mission_penalite_annulee');
  if n < 4 then e := e || format('journal incomplet : %s ecriture(s) sur 4 attendues au moins', n); end if;

  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — la Production refuse un travail et retient une pénalité motivée ; la rémunération acceptée reste intacte, le net baisse, l''opérateur est prévenu et peut contester, rien ne dépasse la rémunération ni ne passe après paiement, et un travail refusé bloque la clôture.' as verdict;

rollback;
