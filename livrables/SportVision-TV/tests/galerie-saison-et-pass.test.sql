-- Le Pass Photo ouvre les galeries du club, et une galerie sans saison ne peut plus exister
-- (v218, 14/09/2026).
--
-- POURQUOI CE FICHIER. En mettant le Pass en service, un piège silencieux est apparu :
-- `resolve_media_policy` cherche la politique du club POUR LA SAISON de la galerie, et
-- `can_access_media` compare la saison du droit acheté à celle de la galerie. Une galerie sans
-- saison ne correspond donc à rien : elle est invisible pour tout le monde, y compris pour la
-- famille qui vient de payer. Aucune erreur, aucun message — juste des photos qui ne s'ouvrent pas.
-- Or la saison n'était renseignée que si l'opérateur la saisissait à la main.
--
-- CE QU'ON MESURE :
--   1. Une galerie de club créée SANS saison en reçoit une automatiquement.
--   2. Sous politique `pass_saison`, une famille sans Pass n'accède pas.
--   3. Avec le Pass de la bonne saison, elle accède.
--   4. Avec un Pass d'une AUTRE saison, non — un Pass ne déborde pas sur la saison suivante.
--   5. Une galerie SANS club (tournoi, structure externe) n'est pas touchée : rien à résoudre.

begin;

create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $i$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p::text,'role','authenticated')::text, true);
end $i$;

do $$
declare
  v_club uuid; v_equipe uuid; v_saison uuid; v_saison2 uuid;
  v_album uuid; v_album_sans_club uuid;
  v_famille uuid; v_joueur uuid;
  e text[] := '{}'; v_saison_album uuid; v_politique text;
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);

  select id into v_saison from saisons where label = '2026-2027';
  select id into v_saison2 from saisons where label = '2027-2028';
  if v_saison is null or v_saison2 is null then raise exception 'DECOR : saisons introuvables'; end if;

  v_club := gen_random_uuid();
  insert into organizations (id, organization_type, nom, statut)
    values (v_club,'club','ZZ Club Pass','actif_standard');
  insert into clubs (id, nom, plan, saison_id) values (v_club,'ZZ Club Pass','performance', v_saison);
  insert into club_teams (club_id, name) values (v_club,'ZZ Pass U13') returning id into v_equipe;

  insert into media_club_policy (club_id, saison_id, default_policy, status)
    values (v_club, v_saison, 'pass_saison', 'active');

  -- ══ 1. LA SAISON SE COMPLÈTE TOUTE SEULE ═════════════════════════════════
  insert into media_albums (club_id, team_id, title, status, event_date)
    values (v_club, v_equipe, 'ZZ Galerie sans saison', 'published', current_date)
    returning id, saison_id into v_album, v_saison_album;
  if v_saison_album is distinct from v_saison then
    e := e || format('galerie de club : saison %s au lieu de celle du club', coalesce(v_saison_album::text,'(nulle)'));
  end if;

  -- La politique se résout donc, au lieu de tomber sur « aucune vente ».
  v_politique := resolve_media_policy(v_album);
  if v_politique is distinct from 'season_pass' then
    e := e || format('politique resolue : %s au lieu de season_pass', coalesce(v_politique,'(nulle)'));
  end if;

  -- ══ 2. SANS PASS, PAS D'ACCÈS ════════════════════════════════════════════
  v_famille := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (v_famille,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-pass-famille@example.invalid','',now(),now(),now());
  insert into player_profiles (user_id, prenom, nom, club_id, date_naissance)
    values (v_famille,'ZZ','PassJoueur', v_club, date '2012-02-02') returning id into v_joueur;
  insert into team_memberships (player_id, team_id, club_id, saison, saison_id, statut)
    values (v_joueur, v_equipe, v_club, '2026-2027', v_saison, 'active');

  perform pg_temp.incarner(v_famille);
  if can_access_media(v_album) then e := e || 'la famille accede SANS avoir paye le Pass'::text; end if;

  -- ══ 3. AVEC LE PASS DE LA BONNE SAISON, ACCÈS ════════════════════════════
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  insert into media_entitlements (club_id, saison_id, beneficiary_person_id, purchased_by_user_id,
                                  scope_type, scope_id, status)
    values (v_club, v_saison, v_joueur, v_famille, 'club', v_club, 'active');

  perform pg_temp.incarner(v_famille);
  if not can_access_media(v_album) then e := e || 'le Pass paye n ouvre pas la galerie'::text; end if;

  -- ══ 4. UN PASS D'UNE AUTRE SAISON N'OUVRE RIEN ═══════════════════════════
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  update media_entitlements set saison_id = v_saison2 where purchased_by_user_id = v_famille;
  perform pg_temp.incarner(v_famille);
  if can_access_media(v_album) then e := e || 'un Pass d une autre saison ouvre la galerie'::text; end if;

  -- ══ 5. UNE GALERIE SANS CLUB N'EST PAS TOUCHÉE ═══════════════════════════
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  insert into media_albums (title, status, event_date, structure_externe)
    values ('ZZ Galerie tournoi', 'published', current_date, 'ZZ Tournoi externe')
    returning id, saison_id into v_album_sans_club, v_saison_album;
  if v_saison_album is not null then
    e := e || 'une galerie sans club recoit une saison qu elle n a pas demandee'::text;
  end if;

  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — une galerie de club reçoit sa saison sans qu''on la saisisse ; sous Pass Saison, la famille n''accède qu''après paiement, et un Pass d''une autre saison n''ouvre rien ; une galerie sans club n''est pas touchée.' as verdict;

rollback;
