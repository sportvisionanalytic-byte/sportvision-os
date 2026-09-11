-- v163 : un mineur ne donne pas lui-même son accord de reconnaissance (12/09/2026).
--
-- Défaut introduit par v161 et corrigé ici avant tout usage réel. La fonction acceptait l'accord du
-- joueur dès qu'il était titulaire du compte (is_own_player), en le qualifiant de « joueur_majeur »
-- sans jamais regarder sa date de naissance. Or beaucoup de joueurs mineurs ont un compte Connect :
-- un enfant de 14 ans pouvait donc autoriser lui-même le traitement de son visage, ce que ni le
-- RGPD ni l'analyse d'impact n'admettent (l'accord appartient au titulaire de l'autorité parentale).
--
-- Règle posée : le joueur ne peut donner l'accord que s'il est majeur, et sa date de naissance doit
-- être connue. Sans date de naissance, on refuse : on ne devine pas l'âge d'un enfant.
-- Le retrait, lui, reste ouvert au joueur mineur : retirer un accord ne présente aucun risque, et
-- l'empêcher serait le piéger.
-- Test : tests/consentement-biometrie-connect.test.sql

create or replace function public.joueur_majeur(p_player_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from player_profiles p
                  where p.id = p_player_id and p.date_naissance is not null
                    and p.date_naissance <= (now() at time zone 'Europe/Paris')::date - interval '18 years');
$$;
revoke execute on function public.joueur_majeur(uuid) from public, anon;
grant execute on function public.joueur_majeur(uuid) to authenticated;

create or replace function public.donner_consentement_biometrie(p_player_id uuid, p_texte_version text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_qualite text; v_club uuid; v_saison uuid;
begin
  if coalesce(btrim(p_texte_version), '') = '' then
    raise exception 'La version du texte accepté est obligatoire : sans elle, on ne sait pas ce qui a été accepté.' using errcode = '22023';
  end if;
  if is_own_player(p_player_id) and joueur_majeur(p_player_id) then
    v_qualite := 'joueur_majeur';
  elsif is_confirmed_parent_of(p_player_id) then
    v_qualite := 'parent';
  elsif is_own_player(p_player_id) then
    raise exception 'Cet accord doit être donné par le titulaire de l''autorité parentale.' using errcode = '42501';
  else
    raise exception 'Seul le titulaire de l''autorité parentale confirmé, ou le joueur majeur, peut donner cet accord.' using errcode = '42501';
  end if;

  select id into v_id from consentements_biometrie
   where player_id = p_player_id and statut = 'accorde' order by accorde_le desc limit 1;
  if found then return v_id; end if;

  select club_id into v_club from player_profiles where id = p_player_id;
  select id into v_saison from saisons where active order by date_debut desc limit 1;
  insert into consentements_biometrie (player_id, club_id, saison_id, donne_par, qualite, texte_version)
  values (p_player_id, v_club, v_saison, auth.uid(), v_qualite, btrim(p_texte_version))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.donner_consentement_biometrie(uuid, text) from public, anon;
grant execute on function public.donner_consentement_biometrie(uuid, text) to authenticated;

-- Le dépôt de la photo suit la même règle : sans accord valablement donné, il n'y a rien à déposer.
-- La policy de stockage de v161 acceptait un mineur titulaire du compte : elle est resserrée.
drop policy if exists sv_media_prive_visages_insert on storage.objects;
create policy sv_media_prive_visages_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'visages'
    and (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
    and (is_confirmed_parent_of(((storage.foldername(name))[2])::uuid)
         or (is_own_player(((storage.foldername(name))[2])::uuid) and joueur_majeur(((storage.foldername(name))[2])::uuid)))
    and consentement_biometrie_actif(((storage.foldername(name))[2])::uuid));

create or replace function public.enregistrer_photo_reference(p_player_id uuid, p_storage_path text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_consent uuid; v_id uuid;
begin
  if not (is_confirmed_parent_of(p_player_id)
          or (is_own_player(p_player_id) and joueur_majeur(p_player_id))) then
    raise exception 'Seul le titulaire de l''autorité parentale, ou le joueur majeur, peut déposer cette photo.' using errcode = '42501';
  end if;
  if p_storage_path is null or p_storage_path not like 'visages/' || p_player_id::text || '/%' then
    raise exception 'Chemin de photo invalide.' using errcode = '22023';
  end if;
  select id into v_consent from consentements_biometrie
   where player_id = p_player_id and statut = 'accorde' order by accorde_le desc limit 1;
  if not found then
    raise exception 'Aucun accord actif : la photo ne peut pas être enregistrée.' using errcode = '42501';
  end if;
  insert into biometrie_a_purger (player_id, storage_bucket, storage_path, motif)
  select r.player_id, r.storage_bucket, r.storage_path, 'photo_remplacee'
    from player_face_refs r where r.consentement_id = v_consent and r.storage_path is not null
      and r.storage_path is distinct from p_storage_path;
  delete from player_face_refs where consentement_id = v_consent;
  insert into player_face_refs (player_id, consentement_id, moteur, storage_bucket, storage_path, created_by)
  values (p_player_id, v_consent, 'en_attente', 'sportvision-media-prive', p_storage_path, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.enregistrer_photo_reference(uuid, text) from public, anon;
grant execute on function public.enregistrer_photo_reference(uuid, text) to authenticated;

-- La table le refuse aussi, par sécurité : la policy d'insertion de v159 acceptait le joueur quel
-- que soit son âge.
drop policy if exists cb_donner on public.consentements_biometrie;
create policy cb_donner on public.consentements_biometrie for insert to authenticated
  with check (donne_par = auth.uid() and statut = 'accorde'
              and (is_confirmed_parent_of(player_id)
                   or (exists (select 1 from player_profiles p where p.id = player_id and p.user_id = auth.uid())
                       and joueur_majeur(player_id))));
