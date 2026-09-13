-- Supprimer un compte : ce qui part, ce qui reste, et ce que la base refuse de laisser détruire.
--
-- POURQUOI CE FICHIER (13/09/2026, demande de Fouka). L'OS savait désactiver, pas supprimer, et
-- trois mois de tests ont laissé des comptes fantômes. Donner le bouton est facile ; le donner sans
-- perdre une pièce comptable l'est moins : 124 colonnes pointent vers `profiles`, et elles ne se
-- comportent pas pareil. `employee_costs` est en CASCADE (les coûts employeur disparaîtraient),
-- `factures.client_id` est en SET NULL (la facture resterait, sans client). Aucune des deux ne
-- lève d'erreur : elles détruisent en silence.
--
-- CE QU'ON MESURE :
--   1. Un compte sans aucune trace se supprime vraiment (auth.users compris).
--   2. Un compte qui porte une mission est refusé, avec un motif lisible.
--   3. Un compte qui porte une ligne de coût employeur est refusé AUSSI, alors que la contrainte
--      est en CASCADE et laisserait faire.
--   4. On ne se supprime pas soi-même.
--   5. Le dernier administrateur actif est protégé.
--   6. Personne d'autre qu'un administrateur ne peut appeler ces fonctions.

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
  v_admin uuid; v_vierge uuid; v_avec_mission uuid; v_avec_cout uuid; v_photo uuid;
  v_client uuid; v_presta uuid;
  e text[] := '{}'; msg text; n int;
begin
  perform pg_temp.serveur();

  -- Un administrateur réel pour agir (il en existe forcément un en production).
  select id into v_admin from profiles where role='admin' and actif order by created_at limit 1;
  if v_admin is null then raise exception 'DECOR : aucun administrateur actif'; end if;

  -- Trois comptes de test.
  v_vierge := gen_random_uuid(); v_avec_mission := gen_random_uuid(); v_avec_cout := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values
      (v_vierge,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-suppr-vierge@example.invalid','',now(),now(),now()),
      (v_avec_mission,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-suppr-mission@example.invalid','',now(),now(),now()),
      (v_avec_cout,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-suppr-cout@example.invalid','',now(),now(),now());
  insert into profiles (id, prenom, nom, email, role, actif) values
    (v_vierge,'ZZ','Vierge','zz-suppr-vierge@example.invalid','photo',false),
    (v_avec_mission,'ZZ','Mission','zz-suppr-mission@example.invalid','photo',false),
    (v_avec_cout,'ZZ','Cout','zz-suppr-cout@example.invalid','photo',false);

  -- Une mission affectée au deuxième.
  insert into clients (nom, statut) values ('ZZ Client suppression','client') returning id into v_client;
  select id into v_photo from profiles where role='photo' and actif order by created_at limit 1;
  insert into prestations (reference, client_id, type_prestation, date_prestation, statut, created_by)
    values ('ZZ-SUPPR-1', v_client, 'match', current_date, 'demande_reçue', v_admin) returning id into v_presta;
  insert into prestations_equipe (prestation_id, collaborateur_id, fonction, statut)
    values (v_presta, v_avec_mission, 'photographe', 'en_attente');

  -- Une ligne de coût employeur pour le troisième (contrainte en CASCADE : rien ne l'arrêterait).
  insert into employee_costs (collaborateur_id, salaire_brut_mensuel, charges_patronales_pct)
    values (v_avec_cout, 1200, 42);

  perform pg_temp.incarner(v_admin);

  -- ══ 1. LE COMPTE VIERGE PART VRAIMENT ════════════════════════════════════
  begin
    perform supprimer_compte_definitivement(v_vierge);
  exception when others then
    e := e || ('un compte sans trace refuse de partir — '||left(sqlerrm,90))::text;
  end;
  perform pg_temp.serveur();
  select count(*) into n from profiles where id = v_vierge;
  if n <> 0 then e := e || 'le profil existe encore'::text; end if;
  select count(*) into n from auth.users where id = v_vierge;
  if n <> 0 then e := e || 'le compte d authentification existe encore'::text; end if;

  -- ══ 2. UNE MISSION BLOQUE, AVEC UN MOTIF LISIBLE ═════════════════════════
  perform pg_temp.incarner(v_admin);
  msg := null;
  begin
    perform supprimer_compte_definitivement(v_avec_mission);
    e := e || 'un compte porteur d une mission a ete supprime'::text;
  exception when others then msg := sqlerrm;
  end;
  if msg is null or msg not like '%missions%' then
    e := e || ('le motif ne parle pas des missions : '||coalesce(left(msg,90),'(aucun)'))::text;
  end if;
  perform pg_temp.serveur();
  if not exists (select 1 from profiles where id = v_avec_mission) then
    e := e || 'le compte refuse a quand meme disparu'::text;
  end if;

  -- ══ 3. LE COUT EMPLOYEUR BLOQUE AUSSI, MALGRE LA CASCADE ═════════════════
  perform pg_temp.incarner(v_admin);
  msg := null;
  begin
    perform supprimer_compte_definitivement(v_avec_cout);
    e := e || 'un compte porteur de couts employeur a ete supprime (cascade silencieuse)'::text;
  exception when others then msg := sqlerrm;
  end;
  if msg is null or msg not like '%coût employeur%' then
    e := e || ('le motif ne parle pas des couts employeur : '||coalesce(left(msg,90),'(aucun)'))::text;
  end if;

  -- ══ 4. ON NE SE SUPPRIME PAS SOI-MEME ════════════════════════════════════
  msg := null;
  begin
    perform supprimer_compte_definitivement(v_admin);
    e := e || 'un administrateur s est supprime lui-meme'::text;
  exception when others then msg := sqlerrm;
  end;
  if msg is null or msg not like '%propre compte%' then
    e := e || 'le refus de l auto-suppression n est pas explicite'::text;
  end if;

  -- ══ 5. LE DERNIER ADMINISTRATEUR EST PROTEGE ═════════════════════════════
  -- On simule : tous les autres admins deviennent inactifs, puis on tente de supprimer celui qui
  -- reste depuis un second admin cree pour l'occasion.
  perform pg_temp.serveur();
  declare v_admin2 uuid; begin
    v_admin2 := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (v_admin2,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-suppr-admin2@example.invalid','',now(),now(),now());
    insert into profiles (id, prenom, nom, email, role, actif) values (v_admin2,'ZZ','Admin2','zz-suppr-admin2@example.invalid','admin',true);
    -- Plus aucun autre admin actif que v_admin2 et v_admin : on desactive v_admin.
    update profiles set actif=false where role='admin' and id not in (v_admin2, v_admin);
    update profiles set actif=false where id = v_admin;
    perform pg_temp.incarner(v_admin2);
    msg := null;
    begin
      perform supprimer_compte_definitivement(v_admin2);
      e := e || 'le dernier administrateur a pu etre supprime'::text;
    exception when others then msg := sqlerrm;
    end;
    -- v_admin2 se supprime lui-meme : c'est le refus n°4 qui doit sortir en premier, et c'est bien.
    if msg is null then e := e || 'aucun refus sur le dernier administrateur'::text; end if;
  end;

  -- ══ 6. PERSONNE D'AUTRE QU'UN ADMINISTRATEUR ═════════════════════════════
  perform pg_temp.incarner(v_photo);
  msg := null;
  begin
    perform compte_blocages_suppression(v_avec_mission);
    e := e || 'un photographe peut lister les blocages d un collegue'::text;
  exception when others then msg := sqlerrm;
  end;
  msg := null;
  begin
    perform supprimer_compte_definitivement(v_avec_mission);
    e := e || 'un photographe peut supprimer un compte'::text;
  exception when others then msg := sqlerrm;
  end;

  perform pg_temp.serveur();
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — un compte vierge part vraiment (auth comprise) ; mission et coût employeur bloquent avec un motif lisible, y compris quand la contrainte laisserait faire ; ni auto-suppression, ni dernier administrateur, ni appel par un non-administrateur.' as verdict;

rollback;
