-- v161 : donner, retirer et prouver le consentement depuis Connect (12/09/2026).
--
-- v159 a posé les tables. Celle-ci pose les trois gestes que la famille fait réellement dans
-- Connect : j'autorise, je dépose la photo de mon enfant, je retire mon accord. Chaque geste passe
-- par une fonction, jamais par une écriture libre : la qualité (parent ou joueur majeur), la
-- version du texte accepté et la date sont posées par le serveur, pas par l'écran.
--
-- L'EFFACEMENT EST LE POINT DÉLICAT, et il est traité franchement. Retirer son accord supprime la
-- référence en base tout de suite (trigger v159), mais un fichier déposé dans le stockage ne
-- disparaît pas d'une suppression de ligne. Donc :
--   • la famille a le droit de supprimer elle-même ses fichiers (policy storage ci-dessous), et
--     l'écran de retrait le fait dans la foulée ;
--   • tout chemin concerné est mis en file d'attente dans biometrie_a_purger, pour qu'un fichier
--     oublié se voie et se purge, au lieu de rester silencieusement.
-- Test : tests/consentement-biometrie-connect.test.sql

-- ── 1. Le stockage : un dossier par enfant, écrit par sa famille, lu par personne ──
-- Chemin : visages/<player_id>/<fichier>. Aucun accès en lecture pour la famille non plus : la
-- photo sert au moteur, pas à l'affichage.
drop policy if exists sv_media_prive_visages_insert on storage.objects;
create policy sv_media_prive_visages_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'visages'
    and (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
    and (is_confirmed_parent_of(((storage.foldername(name))[2])::uuid)
         or is_own_player(((storage.foldername(name))[2])::uuid))
    and consentement_biometrie_actif(((storage.foldername(name))[2])::uuid));

drop policy if exists sv_media_prive_visages_delete on storage.objects;
create policy sv_media_prive_visages_delete on storage.objects for delete to authenticated
  using (bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'visages'
    and (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
    and (is_confirmed_parent_of(((storage.foldername(name))[2])::uuid)
         or is_own_player(((storage.foldername(name))[2])::uuid)
         or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin')));

-- Lecture : l'Administration SportVision seule, pour répondre à une demande d'accès ou vérifier une
-- purge. Ni le club, ni le coach, ni la Production, ni la famille.
drop policy if exists sv_media_prive_visages_select on storage.objects;
create policy sv_media_prive_visages_select on storage.objects for select to authenticated
  using (bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'visages'
    and exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin'));

-- ── 2. La file d'attente de purge : ce qui doit disparaître du stockage ──
create table if not exists public.biometrie_a_purger (
  id uuid primary key default gen_random_uuid(),
  player_id uuid,
  storage_bucket text not null,
  storage_path text not null,
  motif text not null default 'retrait_consentement',
  demande_le timestamptz not null default now(),
  purge_le timestamptz,
  purge_par uuid
);
create index if not exists biometrie_a_purger_ouvert_idx on public.biometrie_a_purger (demande_le) where purge_le is null;
alter table public.biometrie_a_purger enable row level security;
drop policy if exists bap_admin on public.biometrie_a_purger;
create policy bap_admin on public.biometrie_a_purger for all to authenticated
  using (exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin'))
  with check (exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin'));
revoke all on public.biometrie_a_purger from anon;

-- Le trigger de v159 est repris : il efface la référence, et note désormais le fichier à purger.
create or replace function public.effacer_biometrie_au_retrait()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.statut = 'retire' and coalesce(old.statut, '') <> 'retire' then
    new.retire_le := coalesce(new.retire_le, now());
    new.retire_par := coalesce(new.retire_par, auth.uid());
    insert into biometrie_a_purger (player_id, storage_bucket, storage_path)
    select r.player_id, r.storage_bucket, r.storage_path
      from player_face_refs r
     where r.consentement_id = new.id and r.storage_path is not null;
    delete from player_face_refs r where r.consentement_id = new.id;
    delete from media_player_tags t where t.player_id = new.player_id and t.statut = 'propose';
  end if;
  return new;
end $$;

-- ── 3. Les trois gestes de la famille ──
-- Où j'en suis : l'écran de Connect n'a besoin que de cette réponse pour tout afficher.
create or replace function public.mon_consentement_biometrie(p_player_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb; v_c consentements_biometrie%rowtype;
begin
  if not (is_confirmed_parent_of(p_player_id) or is_own_player(p_player_id)) then
    return null;
  end if;
  select * into v_c from consentements_biometrie
   where player_id = p_player_id and statut = 'accorde' order by accorde_le desc limit 1;
  if not found then
    select jsonb_build_object('autorise', false, 'statut', 'aucun',
      'retire_le', (select max(retire_le) from consentements_biometrie where player_id = p_player_id))
      into v;
    return v;
  end if;
  return jsonb_build_object(
    'autorise', true, 'statut', 'accorde', 'consentement_id', v_c.id,
    'accorde_le', v_c.accorde_le, 'qualite', v_c.qualite, 'texte_version', v_c.texte_version,
    'photo_deposee', exists (select 1 from player_face_refs r where r.consentement_id = v_c.id));
end $$;
revoke execute on function public.mon_consentement_biometrie(uuid) from public, anon;
grant execute on function public.mon_consentement_biometrie(uuid) to authenticated;

create or replace function public.donner_consentement_biometrie(p_player_id uuid, p_texte_version text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_qualite text; v_club uuid; v_saison uuid;
begin
  if coalesce(btrim(p_texte_version), '') = '' then
    raise exception 'La version du texte accepté est obligatoire : sans elle, on ne sait pas ce qui a été accepté.' using errcode = '22023';
  end if;
  if is_own_player(p_player_id) then
    v_qualite := 'joueur_majeur';
  elsif is_confirmed_parent_of(p_player_id) then
    v_qualite := 'parent';
  else
    raise exception 'Seul le titulaire de l''autorité parentale confirmé, ou le joueur lui-même, peut donner cet accord.' using errcode = '42501';
  end if;
  -- Un accord déjà actif ne se redonne pas : on rend celui qui existe.
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

-- Déposer la photo : le fichier est déjà dans le stockage, cette fonction le rattache à l'accord.
-- Une seule photo de référence par accord : déposer à nouveau remplace la précédente et met
-- l'ancienne en file de purge.
create or replace function public.enregistrer_photo_reference(p_player_id uuid, p_storage_path text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_consent uuid; v_id uuid;
begin
  if not (is_confirmed_parent_of(p_player_id) or is_own_player(p_player_id)) then
    raise exception 'Cet enfant n''est pas le vôtre.' using errcode = '42501';
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

-- Retirer : rend les chemins à supprimer pour que l'écran efface les fichiers dans la foulée.
create or replace function public.retirer_consentement_biometrie(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_chemins text[]; v_n integer;
begin
  if not (is_confirmed_parent_of(p_player_id) or is_own_player(p_player_id)
          or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin')) then
    raise exception 'Cet enfant n''est pas le vôtre.' using errcode = '42501';
  end if;
  select array_agg(r.storage_path) into v_chemins
    from player_face_refs r
    join consentements_biometrie c on c.id = r.consentement_id
   where c.player_id = p_player_id and c.statut = 'accorde' and r.storage_path is not null;
  update consentements_biometrie set statut = 'retire'
   where player_id = p_player_id and statut = 'accorde';
  get diagnostics v_n = row_count;
  return jsonb_build_object('retires', v_n, 'chemins', coalesce(v_chemins, array[]::text[]));
end $$;
revoke execute on function public.retirer_consentement_biometrie(uuid) from public, anon;
grant execute on function public.retirer_consentement_biometrie(uuid) to authenticated;
