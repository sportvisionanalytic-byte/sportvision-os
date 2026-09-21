-- Le jeton de notification de quelqu'un n'appartient qu'à lui (v250, 22/09/2026).
--
-- POURQUOI CE TEST EXISTE. Un jeton de notification permet d'écrire sur l'écran d'un téléphone.
-- C'est peu de chose et c'est beaucoup : celui qui le détient peut adresser un message à
-- quelqu'un, en se faisant passer pour l'application. On vérifie donc qu'il ne circule pas.
--
-- CE QU'ON MESURE :
--   1. Chacun enregistre son appareil.
--   2. Personne ne lit le jeton d'un autre — pas même le staff SportVision.
--   3. Personne ne retire l'appareil d'un autre.
--   4. Un jeton qui change de main suit son nouveau propriétaire, et l'ancien cesse d'être joint :
--      un téléphone revendu ou un compte de famille ne doit pas continuer à sonner chez l'ancien.
--   5. Se réenregistrer ne crée pas de doublon — l'application appelle à chaque démarrage.

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
  v_a uuid; v_b uuid; v_staff uuid; n int; v_prop uuid; e text[] := '{}';
begin
  perform pg_temp.serveur();
  v_a := gen_random_uuid(); v_b := gen_random_uuid(); v_staff := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) values
    (v_a,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-appareil-a@example.invalid','',now(),now(),now()),
    (v_b,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-appareil-b@example.invalid','',now(),now(),now()),
    (v_staff,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-appareil-staff@example.invalid','',now(),now(),now());
  insert into profiles (id, prenom, nom, email, role, actif)
    values (v_staff,'ZZ','StaffAppareil','zz-appareil-staff@example.invalid','admin',true);

  -- ══ 1. CHACUN ENREGISTRE LE SIEN ═════════════════════════════════════════
  perform pg_temp.incarner(v_a);
  perform appareil_enregistrer('zz-jeton-de-A', 'ios', '1.0', 'iPhone 14');
  perform pg_temp.incarner(v_b);
  perform appareil_enregistrer('zz-jeton-de-B', 'android', '1.0', 'Pixel 7');

  -- ══ 5. SE RÉENREGISTRER NE DOUBLE PAS ════════════════════════════════════
  perform appareil_enregistrer('zz-jeton-de-B', 'android', '1.1', 'Pixel 7');
  perform pg_temp.serveur();
  select count(*) into n from appareils_notifications where jeton = 'zz-jeton-de-B';
  if n <> 1 then e := e || format('le reenregistrement a cree %s lignes', n); end if;

  -- ══ 2. PERSONNE NE LIT LE JETON D'UN AUTRE ═══════════════════════════════
  perform pg_temp.incarner(v_b);
  select count(*) into n from appareils_notifications where jeton = 'zz-jeton-de-A';
  if n <> 0 then e := e || 'un utilisateur lit le jeton d''un autre'::text; end if;

  perform pg_temp.incarner(v_staff);
  select count(*) into n from appareils_notifications;
  if n <> 0 then e := e || format('LE STAFF LIT %s jeton(s) : un envoi passe par le serveur, pas par un ecran', n); end if;

  -- ══ 3. PERSONNE NE RETIRE L'APPAREIL D'UN AUTRE ══════════════════════════
  perform pg_temp.incarner(v_b);
  if appareil_retirer('zz-jeton-de-A') then
    e := e || 'un utilisateur a desactive l''appareil d''un autre'::text;
  end if;
  perform pg_temp.serveur();
  select count(*) into n from appareils_notifications where jeton = 'zz-jeton-de-A' and actif;
  if n <> 1 then e := e || 'l''appareil de A n''est plus actif alors que personne d''autorise ne l''a touche'::text; end if;

  -- ══ 4. UN TÉLÉPHONE QUI CHANGE DE MAIN ═══════════════════════════════════
  perform pg_temp.incarner(v_b);
  perform appareil_enregistrer('zz-jeton-de-A', 'ios', '1.0', 'iPhone 14');
  perform pg_temp.serveur();
  select user_id into v_prop from appareils_notifications where jeton = 'zz-jeton-de-A';
  if v_prop is distinct from v_b then
    e := e || 'le jeton repris ne suit pas son nouveau proprietaire : l''ancien continuerait a recevoir'::text;
  end if;
  select count(*) into n from appareils_notifications where jeton = 'zz-jeton-de-A';
  if n <> 1 then e := e || 'la reprise a laisse deux lignes pour le meme telephone'::text; end if;

  -- Et chacun retire bien le sien.
  perform pg_temp.incarner(v_b);
  if not appareil_retirer('zz-jeton-de-B') then e := e || 'on ne peut pas retirer son propre appareil'::text; end if;

  perform pg_temp.serveur();
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — chacun n''a que ses appareils, le staff n''en voit aucun, et un téléphone qui change de main cesse de sonner chez l''ancien.' as verdict;
rollback;
