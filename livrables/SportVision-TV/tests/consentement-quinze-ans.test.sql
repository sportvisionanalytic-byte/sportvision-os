-- Qui peut accorder la reconnaissance de son visage, et à partir de quel âge (v226, 14/09/2026).
--
-- POURQUOI CE FICHIER. Ici, le consentement n'est pas une formalité : c'est la BASE LÉGALE du
-- traitement biométrique. S'il n'est pas valable, tout le dispositif devient illicite. Le seuil
-- retenu par Fouka est celui du droit français pour qu'un mineur consente seul à un service en
-- ligne : quinze ans (article 8 du RGPD, article 45 de la loi Informatique et Libertés).
--
-- Une règle d'âge se défait sans bruit à la première réécriture de fonction. Elle se teste.
--
-- CE QU'ON MESURE :
--   1. Un joueur de 16 ans accorde seul, et c'est tracé comme tel (`joueur_15_17`).
--   2. Un joueur majeur aussi, sous son propre titre.
--   3. Un joueur de 12 ans ne peut pas, et le message lui dit quoi faire.
--   4. Son parent confirmé, lui, le peut.
--   5. Le dépôt de la photo suit la même règle : accorder sans pouvoir déposer ne servirait à rien.
--   6. Le RETRAIT reste ouvert au joueur à tout âge : on ne met jamais d'obstacle devant quelqu'un
--      qui veut faire effacer ses données.
--   7. Personne ne consent pour l'enfant d'un autre.

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
  v_club uuid; v_saison uuid;
  v_seize uuid; v_douze uuid; v_majeur uuid;
  v_c_seize uuid; v_c_douze uuid; v_c_majeur uuid; v_c_parent uuid; v_parent uuid;
  e text[] := '{}'; q text; msg text; n int;
begin
  perform pg_temp.serveur();
  select id into v_saison from saisons where label = '2026-2027';

  v_club := gen_random_uuid();
  insert into organizations (id, organization_type, nom, statut) values (v_club,'club','ZZ Club Age','actif_standard');
  insert into clubs (id, nom, plan, saison_id) values (v_club,'ZZ Club Age','performance', v_saison);

  v_c_seize := gen_random_uuid(); v_c_douze := gen_random_uuid();
  v_c_majeur := gen_random_uuid(); v_c_parent := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values
      (v_c_seize,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-age-16@example.invalid','',now(),now(),now()),
      (v_c_douze,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-age-12@example.invalid','',now(),now(),now()),
      (v_c_majeur,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-age-18@example.invalid','',now(),now(),now()),
      (v_c_parent,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-age-parent@example.invalid','',now(),now(),now());

  insert into player_profiles (user_id, prenom, nom, club_id, date_naissance)
    values (v_c_seize,'ZZ','Seize', v_club, (current_date - interval '16 years')::date) returning id into v_seize;
  insert into player_profiles (user_id, prenom, nom, club_id, date_naissance)
    values (v_c_douze,'ZZ','Douze', v_club, (current_date - interval '12 years')::date) returning id into v_douze;
  insert into player_profiles (user_id, prenom, nom, club_id, date_naissance)
    values (v_c_majeur,'ZZ','Majeur', v_club, (current_date - interval '20 years')::date) returning id into v_majeur;

  insert into parent_profiles (user_id, prenom, nom) values (v_c_parent,'ZZ','ParentAge') returning id into v_parent;
  insert into parent_player_relationships (parent_id, player_id, statut, confirmed_at)
    values (v_parent, v_douze, 'confirme', now());

  -- ══ 1. SEIZE ANS : IL ACCORDE SEUL ═══════════════════════════════════════
  perform pg_temp.incarner(v_c_seize);
  begin
    perform donner_consentement_biometrie(v_seize, 'texte-v1');
  exception when others then
    e := e || ('un joueur de 16 ans ne peut pas accorder — '||left(sqlerrm,80))::text;
  end;
  perform pg_temp.serveur();
  select qualite into q from consentements_biometrie where player_id = v_seize and statut = 'accorde';
  if q is distinct from 'joueur_15_17' then
    e := e || format('16 ans : qualite %s au lieu de joueur_15_17', coalesce(q,'(aucune)'));
  end if;

  -- ══ 2. MAJEUR : SOUS SON PROPRE TITRE ════════════════════════════════════
  perform pg_temp.incarner(v_c_majeur);
  perform donner_consentement_biometrie(v_majeur, 'texte-v1');
  perform pg_temp.serveur();
  select qualite into q from consentements_biometrie where player_id = v_majeur and statut = 'accorde';
  if q is distinct from 'joueur_majeur' then
    e := e || format('majeur : qualite %s au lieu de joueur_majeur', coalesce(q,'(aucune)'));
  end if;

  -- ══ 3. DOUZE ANS : REFUS, ET ON LUI DIT QUOI FAIRE ═══════════════════════
  perform pg_temp.incarner(v_c_douze);
  msg := null;
  begin
    perform donner_consentement_biometrie(v_douze, 'texte-v1');
    e := e || 'un joueur de 12 ans a accorde seul'::text;
  exception when others then msg := sqlerrm;
  end;
  if msg is null or msg not like '%Avant 15 ans%' then
    e := e || ('le refus avant 15 ans n est pas explicite : '||coalesce(left(msg,70),'(aucun)'))::text;
  end if;
  if msg is not null and msg not like '%Invitez%' then
    e := e || 'le message ne dit pas comment s en sortir'::text;
  end if;

  -- ══ 4. SON PARENT CONFIRMÉ, LUI, LE PEUT ═════════════════════════════════
  perform pg_temp.incarner(v_c_parent);
  begin
    perform donner_consentement_biometrie(v_douze, 'texte-v1');
  exception when others then
    e := e || ('le parent confirme ne peut pas accorder — '||left(sqlerrm,80))::text;
  end;
  perform pg_temp.serveur();
  select qualite into q from consentements_biometrie where player_id = v_douze and statut = 'accorde';
  if q is distinct from 'parent' then
    e := e || format('parent : qualite %s au lieu de parent', coalesce(q,'(aucune)'));
  end if;

  -- ══ 5. LE DÉPÔT DE LA PHOTO SUIT LA MÊME RÈGLE ═══════════════════════════
  perform pg_temp.incarner(v_c_seize);
  begin
    perform enregistrer_photo_reference(v_seize, 'visages/'||v_seize::text||'/ref.jpg');
  exception when others then
    e := e || ('un joueur de 16 ans ne peut pas deposer sa photo — '||left(sqlerrm,70))::text;
  end;

  perform pg_temp.incarner(v_c_douze);
  msg := null;
  begin
    perform enregistrer_photo_reference(v_douze, 'visages/'||v_douze::text||'/ref.jpg');
    e := e || 'un joueur de 12 ans a depose sa photo de reference'::text;
  exception when others then msg := sqlerrm;
  end;

  -- ══ 6. LE RETRAIT RESTE OUVERT À TOUT ÂGE ════════════════════════════════
  -- On ne met jamais d'obstacle devant quelqu'un qui veut faire effacer ses données.
  perform pg_temp.incarner(v_c_douze);
  begin
    perform retirer_consentement_biometrie(v_douze);
  exception when others then
    e := e || ('un joueur de 12 ans ne peut pas retirer son accord — '||left(sqlerrm,70))::text;
  end;
  perform pg_temp.serveur();
  select count(*) into n from consentements_biometrie where player_id = v_douze and statut = 'accorde';
  if n <> 0 then e := e || 'le retrait par le joueur mineur n a pas pris effet'::text; end if;

  -- ══ 7. JAMAIS POUR L'ENFANT D'UN AUTRE ═══════════════════════════════════
  perform pg_temp.incarner(v_c_seize);
  msg := null;
  begin
    perform donner_consentement_biometrie(v_douze, 'texte-v1');
    e := e || 'un joueur a accorde pour un autre enfant'::text;
  exception when others then msg := sqlerrm;
  end;

  perform pg_temp.serveur();
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — un joueur accorde seul à partir de 15 ans, tracé sous son propre titre ; avant 15 ans un parent confirmé le fait, et le message dit comment ; le dépôt de la photo suit la même règle ; le retrait reste ouvert à tout âge ; personne ne consent pour l''enfant d''un autre.' as verdict;

rollback;
