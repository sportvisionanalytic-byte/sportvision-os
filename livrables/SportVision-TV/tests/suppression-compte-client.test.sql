-- Supprimer le compte d'un client qui a des commandes (décision de Fouka, 10/09/2026).
--
-- POURQUOI CE FICHIER. delete-account supprimait le compte AVANT la fiche client, et échouait net
-- pour un client qui avait une commande média (clé étrangère sans ON DELETE vers auth.users). La
-- décision : commandes et factures CONSERVÉES (10 ans), données personnelles anonymisées, compte
-- d'authentification supprimé EN DERNIER. Tout vit dans supprimer_compte_client
-- (migration-decisions-connect-v1-suppression-compte-client.sql), appelée par delete-account et
-- admin-delete-portal-account avec la clé de service.
--
-- CE QU'ON MESURE, dans une transaction annulée :
--   0. le défaut d'origine : sans détacher les commandes, supprimer le compte échoue ;
--   1. un client avec commandes, droits, facture et message : compte supprimé, commandes et droits
--      conservés et détachés, adresse d'une commande payée à expédier gardée, les autres effacées,
--      fiche anonymisée mais conservée avec sa facture ;
--      1 bis. une fiche avec facture et contrat mais sans message : les clés ne la protègent pas
--      (SET NULL, CASCADE), c'est la vérification des documents qui doit la garder ;
--   2. un client sans aucun document : fiche supprimée, et sa copie dans organizations anonymisée ;
--   3. une fiche partagée avec un autre compte : intacte, l'autre compte garde son accès ;
--   4. un compte de l'équipe SportVision : refusé, rien ne change ;
--   5. un compte qui porte l'activité d'un club : refusé, et RIEN n'a bougé (tout ou rien) ;
--   6. un profil « photo » posé par une invitation sur un compte client : pas pris pour un membre de
--      l'équipe, le client peut partir ;
--   7. les droits : ni anon ni authenticated ne peuvent appeler la fonction, service_role oui.
--
-- Exécution : tests/suppression-compte-client.test.mjs (enchaîne la migration et ce fichier dans
-- une même transaction annulée ; MIGRATION=0 une fois la migration exécutée en production).

begin;

do $$
declare
  club uuid := (select id from clubs where nom = 'Villeneuve 340 SC');
  saison uuid := (select id from saisons order by 1 limit 1);
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  staff uuid := gen_random_uuid(); g uuid := gen_random_uuid(); invite uuid := gen_random_uuid(); intrus uuid := gen_random_uuid();
  d uuid := gen_random_uuid(); fd uuid; factD uuid; contratD uuid;
  fa uuid; fb uuid; fc uuid; fi uuid; enfant uuid; cmdA1 uuid; cmdA2 uuid; cmdG uuid; droitA uuid; factA uuid;
  r jsonb; n int; ligne record; e text[] := '{}';
begin
  perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  if club is null or saison is null then raise exception 'Décor introuvable (club Villeneuve 340 SC ou saison).'; end if;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  select x, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'zz-cx-dec-suppr-' || x || '@example.invalid', '', now(), now(), now()
  from unnest(array[a, b, c1, c2, staff, g, intrus]) x;
  -- Un compte créé par inviteUserByEmail : handle_new_user lui pose un profil « photo ».
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, invited_at, created_at, updated_at)
  values (invite, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'zz-cx-dec-suppr-invite@example.invalid', '', now(), now(), now(), now());

  insert into player_profiles (club_id, prenom, nom, date_naissance) values (club, 'ZZ', 'ZZDecSupprEnfant', '2014-05-05') returning id into enfant;

  -- ── Client A : particulier, commandes, droit, facture, message ──
  insert into clients (nom, type_client, prenom_contact, nom_contact, email, telephone, adresse, ville, code_postal)
    values ('Zoé ZZDecSuppr', 'particulier', 'Zoé', 'ZZDecSuppr', 'zz-cx-dec-suppr-a@example.invalid', '0600000000', '1 rue Test', 'Villeneuve', '89340')
    returning id into fa;
  insert into connect_profile_settings (user_id, client_id, account_type) values (a, fa, 'particulier');
  insert into media_orders (club_id, purchased_by_user_id, amount_cents, currency, status, shipping_status, shipping_name, shipping_address_line, shipping_postal_code, shipping_city)
    values (club, a, 1500, 'eur', 'paid', 'non_requis', 'Zoé ZZDecSuppr', '1 rue Test', '89340', 'Villeneuve') returning id into cmdA1;
  insert into media_orders (club_id, purchased_by_user_id, amount_cents, currency, status, shipping_status, shipping_name, shipping_address_line, shipping_postal_code, shipping_city)
    values (club, a, 2900, 'eur', 'paid', 'a_preparer', 'Zoé ZZDecSuppr', '1 rue Test', '89340', 'Villeneuve') returning id into cmdA2;
  insert into media_entitlements (club_id, saison_id, beneficiary_person_id, purchased_by_user_id, scope_type, order_id, status, valid_from)
    values (club, saison, enfant, a, 'club', cmdA1, 'active', now()) returning id into droitA;
  insert into factures (numero, client_id, type_facture, montant_ttc, statut) values ('ZZ-DEC-SUPPR-1', fa, 'totalite', 15, 'payee') returning id into factA;
  insert into messages_client (client_id, auteur_type, contenu) values (fa, 'staff', 'ZZ message de test');

  -- ── 0. Le défaut d'origine ──
  begin
    delete from auth.users where id = a;
    e := e || 'DÉCOR : le compte A se supprime sans détacher ses commandes (le défaut d''origine n''est pas reproduit)'::text;
  exception when foreign_key_violation then null;
  end;

  -- ── 1. Suppression demandée par le client A ──
  perform set_config('role','service_role',true);
  r := supprimer_compte_client(a, true);
  perform set_config('role','postgres',true);
  if exists (select 1 from auth.users where id = a) then e := e || '1. le compte A existe encore'::text; end if;
  select count(*) into n from media_orders where id in (cmdA1, cmdA2) and purchased_by_user_id is null and acheteur_supprime_le is not null;
  if n <> 2 then e := e || ('1. commandes de A conservées et détachées : ' || n || '/2')::text; end if;
  select * into ligne from media_orders where id = cmdA1;
  if ligne.shipping_name is not null or ligne.shipping_address_line is not null then e := e || '1. l''adresse d''une commande sans expédition est restée'::text; end if;
  select * into ligne from media_orders where id = cmdA2;
  if ligne.shipping_address_line is distinct from '1 rue Test' then e := e || '1. l''adresse d''une commande PAYÉE à expédier a été effacée'::text; end if;
  if not exists (select 1 from media_entitlements where id = droitA and purchased_by_user_id is null and status = 'active') then
    e := e || '1. le droit d''accès de l''enfant n''a pas survécu'::text;
  end if;
  select * into ligne from clients where id = fa;
  if ligne.id is null then e := e || '1. la fiche de A (avec facture) a été supprimée'::text;
  -- Fiche avec facture : nom et adresse CONSERVÉS (mentions obligatoires de la facture), le reste effacé.
  elsif ligne.nom = 'Client supprimé' or ligne.adresse is null or ligne.email is not null or ligne.telephone is not null or ligne.prenom_contact is not null then
    e := e || ('1. fiche de A mal traitée (nom/adresse à garder, contact à effacer) : ' || ligne.nom || ' / ' || coalesce(ligne.adresse, '-') || ' / ' || coalesce(ligne.email, '-'))::text;
  end if;
  if not exists (select 1 from factures where id = factA and client_id = fa) then e := e || '1. la facture de A a perdu sa fiche'::text; end if;
  if exists (select 1 from connect_profile_settings where user_id = a) then e := e || '1. le profil Connect de A subsiste'::text; end if;
  if (r->>'commandes_detachees')::int <> 2 or (r->>'fiches_anonymisees')::int <> 1 then e := e || ('1. bilan inattendu : ' || r::text)::text; end if;

  -- ── 1 bis. Client D : une facture et un contrat, AUCUN message ──
  -- Sans message, rien ne bloque la suppression de la fiche au niveau des clés : factures passerait
  -- à NULL et contrats partirait en cascade. C'est la vérification explicite des documents qui
  -- doit garder la fiche.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-cx-dec-suppr-d@example.invalid', '', now(), now(), now());
  insert into clients (nom, type_client, email) values ('Léa ZZDecSuppr', 'particulier', 'zz-cx-dec-suppr-d@example.invalid') returning id into fd;
  insert into connect_profile_settings (user_id, client_id, account_type) values (d, fd, 'particulier');
  insert into factures (numero, client_id, type_facture, montant_ttc, statut) values ('ZZ-DEC-SUPPR-2', fd, 'totalite', 30, 'payee') returning id into factD;
  insert into contrats (client_id) values (fd) returning id into contratD;
  perform set_config('role','service_role',true);
  r := supprimer_compte_client(d, true);
  perform set_config('role','postgres',true);
  if not exists (select 1 from factures where id = factD and client_id = fd) then e := e || '1 bis. une facture a perdu sa fiche (fiche supprimée malgré ses documents)'::text; end if;
  if not exists (select 1 from contrats where id = contratD) then e := e || '1 bis. un contrat a disparu avec la fiche'::text; end if;
  -- Facture et contrat : nom conservé (mention obligatoire), contact effacé (arbitrage du 10/09).
  if not exists (select 1 from clients where id = fd and nom = 'Léa ZZDecSuppr' and email is null) then e := e || '1 bis. fiche de D : nom à garder (facture), e-mail à effacer'::text; end if;

  -- ── 2. Client B : aucun document ──
  insert into clients (nom, type_client, prenom_contact, nom_contact, email) values ('Marc ZZDecSuppr', 'particulier', 'Marc', 'ZZDecSuppr', 'zz-cx-dec-suppr-b@example.invalid') returning id into fb;
  insert into connect_profile_settings (user_id, client_id, account_type) values (b, fb, 'particulier');
  perform set_config('role','service_role',true);
  r := supprimer_compte_client(b, true);
  perform set_config('role','postgres',true);
  if exists (select 1 from clients where id = fb) then e := e || '2. la fiche vide de B n''a pas été supprimée'::text; end if;
  if exists (select 1 from organizations where id = fb and nom <> 'Client supprimé') then e := e || '2. le nom de B subsiste dans organizations'::text; end if;
  if exists (select 1 from auth.users where id = b) then e := e || '2. le compte B existe encore'::text; end if;

  -- ── 3. Fiche d'un club partagée par deux comptes ──
  insert into clients (nom, type_client) values ('ZZ Club DecSuppr', 'club') returning id into fc;
  insert into client_users (id, client_id, prenom) values (c1, fc, 'ZZ'), (c2, fc, 'ZZ');
  perform set_config('role','service_role',true);
  r := supprimer_compte_client(c1, false);
  perform set_config('role','postgres',true);
  if not exists (select 1 from clients where id = fc and nom = 'ZZ Club DecSuppr') then e := e || '3. la fiche partagée a été touchée'::text; end if;
  if not exists (select 1 from client_users where id = c2 and client_id = fc) then e := e || '3. l''autre compte a perdu son accès'::text; end if;
  if exists (select 1 from auth.users where id = c1) then e := e || '3. le compte C1 existe encore'::text; end if;

  -- ── 4. Compte de l'équipe SportVision ──
  insert into profiles (id, role, prenom, nom, email) values (staff, 'admin', 'ZZ', 'DecSuppr', 'zz-cx-dec-suppr-staff@example.invalid');
  begin
    perform set_config('role','service_role',true);
    perform supprimer_compte_client(staff, true);
    e := e || '4. un compte de l''équipe SportVision a été supprimé'::text;
  exception when raise_exception then null;
  end;
  perform set_config('role','postgres',true);
  if not exists (select 1 from auth.users where id = staff) then e := e || '4. le compte staff a disparu'::text; end if;

  -- ── 5. Compte qui porte l'activité d'un club : refus, et tout ou rien ──
  insert into media_orders (club_id, purchased_by_user_id, amount_cents, currency, status, shipping_status) values (club, g, 900, 'eur', 'paid', 'non_requis') returning id into cmdG;
  insert into coverage_wishes (club_id, requested_by_user_id, occurrence_ref, requested_coverage_type) values (club, g, 'zz-cx-dec-suppr', 'photo');
  begin
    perform set_config('role','service_role',true);
    perform supprimer_compte_client(g, true);
    e := e || '5. un compte lié à un souhait de couverture a été supprimé'::text;
  exception when raise_exception then null;
  end;
  perform set_config('role','postgres',true);
  if not exists (select 1 from media_orders where id = cmdG and purchased_by_user_id = g) then e := e || '5. refus, mais la commande a quand même été détachée (pas tout ou rien)'::text; end if;
  if not exists (select 1 from auth.users where id = g) then e := e || '5. le compte G a disparu'::text; end if;

  -- ── 6. Profil « photo » posé par une invitation sur un compte client ──
  -- Depuis migration-securite-handle-new-user-role-explicite (10/09) : un compte invité SANS rôle
  -- n'a plus de fiche staff « photo ». L'inverse serait la faille : is_staff() le prendrait pour
  -- un collaborateur interne.
  if exists (select 1 from profiles where id = invite) then e := e || '6. un compte invité sans rôle a reçu une fiche staff (handle_new_user)'::text; end if;
  insert into clients (nom, type_client) values ('Invité ZZDecSuppr', 'particulier') returning id into fi;
  insert into connect_profile_settings (user_id, client_id, account_type) values (invite, fi, 'particulier');
  begin
    perform set_config('role','service_role',true);
    perform supprimer_compte_client(invite, true);
  exception when others then e := e || ('6. un client invité (profil « photo » automatique) ne peut pas partir : ' || sqlerrm)::text;
  end;
  perform set_config('role','postgres',true);
  if exists (select 1 from auth.users where id = invite) or exists (select 1 from profiles where id = invite) then e := e || '6. le compte invité subsiste'::text; end if;

  -- ── 7. Les droits ──
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub', intrus::text, 'role', 'authenticated')::text, true);
  begin
    perform supprimer_compte_client(intrus, true);
    e := e || '7. un compte connecté (authenticated) peut appeler la fonction'::text;
  exception when insufficient_privilege then null;
  end;
  perform set_config('role','anon',true);
  begin
    perform supprimer_compte_client(intrus, true);
    e := e || '7. un visiteur (anon) peut appeler la fonction'::text;
  exception when insufficient_privilege then null;
  end;
  perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  if not exists (select 1 from auth.users where id = intrus) then e := e || '7. le compte visé par les appels refusés a disparu'::text; end if;

  if array_length(e, 1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — un client avec commandes se supprime : compte parti en dernier, commandes, droits et facture conservés, fiche anonymisée ; fiche vide supprimée ; fiche partagée, compte de l''équipe et compte de club intouchés (tout ou rien) ; fonction réservée à service_role.' as verdict;

rollback;
