-- La famille identifie son enfant, et ce marquage ouvre SES photos — pas celles des autres
-- (v220, 14/09/2026).
--
-- LE MODÈLE. Le marquage des joueurs conditionne la vente : une photo non marquée n'est vue par
-- personne, donc jamais achetée. Le faire porter au staff, c'est soixante photos et quinze joueurs
-- après chaque match. Décision de Fouka : ce sont les familles qui identifient, on leur montre les
-- photos et elles disent « c'est mon enfant ». Aucune donnée biométrique n'est traitée.
--
-- Effet immédiat, contrôle ensuite : le coach et SportVision voient qui a marqué quoi.
--
-- CE QU'ON MESURE :
--   1. La famille voit les aperçus de la galerie de l'équipe de SON enfant, pour pouvoir identifier.
--   2. Elle ne voit rien de la galerie d'une équipe où son enfant ne joue pas.
--   3. Elle marque son enfant : effet immédiat, source « famille », et la photo devient accessible
--      (avec le Pass).
--   4. Elle ne peut pas marquer l'enfant d'une autre famille.
--   5. Elle retire son propre marquage, mais PAS celui posé par SportVision.
--   6. Le coach voit les marquages faits par les familles, avec le compte par famille — de quoi
--      repérer celle qui se marque sur toutes les photos.
--   7. Une famille ne lit pas ce tableau de contrôle.

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
  v_club uuid; v_equipe uuid; v_autre_equipe uuid; v_saison uuid;
  v_album uuid; v_album_autre uuid;
  v_lina uuid; v_sacha uuid; v_cpt_lina uuid; v_cpt_sacha uuid; v_coach uuid;
  ph1 uuid; ph2 uuid; ph_staff uuid;
  e text[] := '{}'; n int; msg text; res jsonb;
begin
  perform pg_temp.serveur();
  select id into v_saison from saisons where label = '2026-2027';

  v_club := gen_random_uuid();
  insert into organizations (id, organization_type, nom, statut) values (v_club,'club','ZZ Club Identif','actif_standard');
  insert into clubs (id, nom, plan, saison_id) values (v_club,'ZZ Club Identif','performance', v_saison);
  insert into club_teams (club_id, name) values (v_club,'ZZ Id U13') returning id into v_equipe;
  insert into club_teams (club_id, name) values (v_club,'ZZ Id U15') returning id into v_autre_equipe;
  insert into media_club_policy (club_id, saison_id, default_policy, status) values (v_club, v_saison, 'pass_saison', 'active');

  v_cpt_lina := gen_random_uuid(); v_cpt_sacha := gen_random_uuid(); v_coach := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values
      (v_cpt_lina,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-id-lina@example.invalid','',now(),now(),now()),
      (v_cpt_sacha,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-id-sacha@example.invalid','',now(),now(),now()),
      (v_coach,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-id-coach@example.invalid','',now(),now(),now());
  insert into club_members (club_id, user_id, role, status, teams)
    values (v_club, v_coach, 'coach', 'actif', to_jsonb(array['ZZ Id U13']));

  insert into player_profiles (user_id, prenom, nom, club_id, date_naissance)
    values (v_cpt_lina,'ZZ','Lina', v_club, date '2013-01-01') returning id into v_lina;
  insert into player_profiles (user_id, prenom, nom, club_id, date_naissance)
    values (v_cpt_sacha,'ZZ','Sacha', v_club, date '2013-02-02') returning id into v_sacha;
  insert into team_memberships (player_id, team_id, club_id, saison, saison_id, statut) values
    (v_lina, v_equipe, v_club, '2026-2027', v_saison, 'active'),
    (v_sacha, v_equipe, v_club, '2026-2027', v_saison, 'active');

  insert into media_albums (club_id, team_id, saison_id, title, status, event_date)
    values (v_club, v_equipe, v_saison, 'ZZ Match Identif', 'published', current_date) returning id into v_album;
  insert into media_albums (club_id, team_id, saison_id, title, status, event_date)
    values (v_club, v_autre_equipe, v_saison, 'ZZ Match U15', 'published', current_date) returning id into v_album_autre;

  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, status, position)
    values (v_album, v_club, 'photo','sportvision-media-prive','zz/id1.jpg','ready',1) returning id into ph1;
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, status, position)
    values (v_album, v_club, 'photo','sportvision-media-prive','zz/id2.jpg','ready',2) returning id into ph2;
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path, status, position)
    values (v_album, v_club, 'photo','sportvision-media-prive','zz/id3.jpg','ready',3) returning id into ph_staff;
  -- Un marquage pose par SportVision, que la famille ne doit pas pouvoir defaire.
  insert into media_player_tags (media_ref_type, media_ref_id, player_id, source, statut)
    values ('media_asset', ph_staff, v_lina, 'humain', 'valide');

  -- ══ 1. ELLE VOIT LA GALERIE DE L'ÉQUIPE DE SON ENFANT ════════════════════
  perform pg_temp.incarner(v_cpt_lina);
  select count(*) into n from media_galerie_a_identifier(v_album, v_lina);
  if n <> 3 then e := e || format('galerie a identifier : %s photo(s) au lieu de 3', n); end if;

  -- ══ 2. RIEN DE L'ÉQUIPE OÙ IL NE JOUE PAS ════════════════════════════════
  select count(*) into n from media_galerie_a_identifier(v_album_autre, v_lina);
  if n <> 0 then e := e || format('galerie d une autre equipe : %s photo(s) visibles', n); end if;

  -- ══ 3. ELLE MARQUE, ET ÇA PREND TOUT DE SUITE ════════════════════════════
  res := media_famille_marque(ph1, v_lina, true);
  perform pg_temp.serveur();
  select count(*) into n from media_player_tags
   where media_ref_id = ph1 and player_id = v_lina and statut = 'valide' and source = 'famille';
  if n <> 1 then e := e || format('apres marquage : %s marquage famille au lieu de 1', n); end if;

  insert into media_entitlements (club_id, saison_id, beneficiary_person_id, purchased_by_user_id, scope_type, scope_id, status)
    values (v_club, v_saison, v_lina, v_cpt_lina, 'club', v_club, 'active');
  perform pg_temp.incarner(v_cpt_lina);
  if not can_access_asset(ph1) then e := e || 'la photo identifiee reste fermee malgre le Pass'::text; end if;
  if can_access_asset(ph2) then e := e || 'une photo NON identifiee est ouverte'::text; end if;

  -- ══ 4. PAS L'ENFANT D'UNE AUTRE FAMILLE ══════════════════════════════════
  msg := null;
  begin
    perform media_famille_marque(ph2, v_sacha, true);
    e := e || 'une famille a marque l enfant d une autre'::text;
  exception when others then msg := sqlerrm;
  end;
  if msg is null or msg not like '%votre propre sportif%' then
    e := e || ('le refus n est pas explicite : '||coalesce(left(msg,70),'(aucun)'))::text;
  end if;

  -- ══ 5. ELLE DÉFAIT SON MARQUAGE, PAS CELUI DU CLUB ═══════════════════════
  res := media_famille_marque(ph1, v_lina, false);
  perform pg_temp.serveur();
  select count(*) into n from media_player_tags where media_ref_id = ph1 and player_id = v_lina;
  if n <> 0 then e := e || 'la famille n a pas pu retirer son propre marquage'::text; end if;

  perform pg_temp.incarner(v_cpt_lina);
  msg := null;
  begin
    perform media_famille_marque(ph_staff, v_lina, false);
    e := e || 'la famille a efface un marquage pose par SportVision'::text;
  exception when others then msg := sqlerrm;
  end;
  if msg is null or msg not like '%club ou par SportVision%' then
    e := e || 'le refus d effacer un marquage du club n est pas explicite'::text;
  end if;

  -- ══ 6. LE COACH VOIT QUI A MARQUÉ QUOI ═══════════════════════════════════
  perform pg_temp.incarner(v_cpt_lina);
  perform media_famille_marque(ph2, v_lina, true);
  perform pg_temp.incarner(v_coach);
  select count(*) into n from media_marquages_famille(v_album);
  if n < 1 then e := e || 'le coach ne voit aucun marquage de famille'::text; end if;
  select photos_marquees_par_cette_famille into n from media_marquages_famille(v_album) limit 1;
  if n is null or n < 1 then e := e || 'le compte par famille n est pas renseigne'::text; end if;

  -- ══ 7. UNE FAMILLE NE LIT PAS CE TABLEAU ═════════════════════════════════
  perform pg_temp.incarner(v_cpt_sacha);
  select count(*) into n from media_marquages_famille(v_album);
  if n <> 0 then e := e || format('une famille lit le controle : %s ligne(s)', n); end if;

  perform pg_temp.serveur();
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — la famille voit la galerie de l''équipe de son enfant et nulle autre, l''identifie d''un geste qui prend effet aussitôt, ne peut ni marquer l''enfant d''une autre ni effacer un marquage du club ; le coach voit qui a marqué quoi et combien, pas les familles.' as verdict;

rollback;
