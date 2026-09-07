-- Migration : Galeries SportVision — chaîne d'upload réelle (Lot 1)
-- À exécuter APRÈS migration-galeries-v1-socle.sql.
--
-- ── Ce que l'audit du stockage a montré, et ce qu'on en fait ──
--
-- L'OS sait déjà envoyer un fichier (`sbUpload`), signer une URL privée (`sbSignedUrl`) et
-- redimensionner une image dans le navigateur (`handleAvatarUpload`, canvas). Et surtout, une
-- convention existe déjà en base pour les médias d'album :
--
--   bucket sportvision-media-prive, chemin  media/<album_id>/...
--     SELECT  policy sv_media_prive_media_select  → can_access_media(album_id)
--     INSERT  policy sv_media_prive_media_write   → is_staff()
--
-- C'est exactement ce qu'il faut pour les ORIGINAUX : le droit d'accès au fichier vendu est déjà
-- adossé à la fonction d'entitlement, sans une ligne de plus. On la réutilise telle quelle, on ne
-- la remplace pas. Seule la taille maximale change (15 → 50 Mo) : un JPEG plein format de boîtier
-- moderne dépasse régulièrement 15 Mo, et 50 Mo est déjà la valeur du bucket clubplus-media.
--
-- ── Pourquoi un deuxième bucket, PUBLIC, pour les previews ──
--
-- La policy ci-dessus impose `can_access_media()`, qui commence par `if auth.uid() is null then
-- return false`. Un visiteur anonyme ne peut donc rien lire dans ce bucket — c'est le but pour un
-- original, c'est rédhibitoire pour une vignette : une galerie publique de 500 photos doit
-- s'afficher sans compte et vite.
--
-- Deux options, et le choix se défend :
--   (a) tout en privé, chaque vignette servie par une URL signée. Il faudrait signer 500 URL à
--       chaque ouverture de page, via une route serveur, sans cache CDN possible. Sur un mobile
--       en 4G au bord d'un terrain, c'est la mauvaise réponse.
--   (b) un bucket public réservé aux dérivés. Ce sont des images basse résolution et filigranées :
--       leur diffusion est précisément ce qu'on cherche. Les chemins sont des UUID, donc non
--       énumérables — une galerie non listée ne se devine pas.
--
-- (b) est retenu, et il respecte l'exigence du §11 : détenir l'URL d'une preview ne donne aucun
-- accès à l'original, qui vit dans l'autre bucket derrière l'entitlement. C'est aussi ce que fait
-- toute plateforme de vente de photo. Le filigrane est la protection de la preview, pas l'obscurité
-- de son URL.

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. QUI A LE DROIT DE DÉPOSER DES PHOTOS
-- ═══════════════════════════════════════════════════════════════════════════
-- `media_staff_write()` (admin, sec) est trop étroit : ce sont les photographes qui déposent, et
-- il y en a 7 en base avec le rôle 'photo'. `is_staff()` est trop large dans l'autre sens : il
-- inclut compta, com et rh, qui n'ont rien à faire dans une galerie.
create or replace function media_upload_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.role in ('admin','sec','prod','photo')
  );
$$;

comment on function media_upload_staff is
  'Peut déposer, réordonner et supprimer les médias d''une galerie : admin, secrétariat, production, photographes. Volontairement plus large que media_staff_write() (ce sont les photographes qui déposent) et plus étroit que is_staff() (ni compta, ni com, ni rh).';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. CE QU'IL MANQUAIT SUR media_assets
-- ═══════════════════════════════════════════════════════════════════════════

-- Nom d'origine : le seul repère de l'utilisateur pour retrouver une photo dans son dossier quand
-- un traitement échoue. Sans lui, un message d'erreur ne désigne rien de reconnaissable.
alter table media_assets add column if not exists original_filename text;
alter table media_assets add column if not exists mime_type text;
-- Cause de l'échec, conservée pour pouvoir relancer un fichier en connaissance de cause (§1).
alter table media_assets add column if not exists processing_error text;

-- Le cycle de vie demandé au §7 : uploading → processing → ready → failed. 'processing' et
-- 'failed' manquaient au socle. 'hidden' et 'removed' sont conservés : masquer une photo à la
-- demande d'un parent (media_reports existe déjà pour ça) n'est pas un échec de traitement.
do $$
begin
  alter table media_assets drop constraint if exists media_assets_status_check;
  alter table media_assets add constraint media_assets_status_check
    check (status in ('uploading','processing','ready','failed','hidden','removed'));
end $$;

comment on column media_assets.status is
  'uploading (fichier en cours d''envoi) → processing (dérivés en cours) → ready (visible). failed = traitement en échec, relançable. hidden = retirée de la galerie sans être supprimée. Seul ''ready'' est publiable.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. FILIGRANE ET COUVERTURE, AU NIVEAU DE L'ALBUM
-- ═══════════════════════════════════════════════════════════════════════════

-- §5 : la protection des previews est un réglage d'album, pas une constante du code. Un media day
-- de communication offert au club n'a aucune raison d'être filigrané, un tournoi vendu à l'unité
-- si. Défaut à true : la valeur sûre est celle qui protège.
alter table media_albums add column if not exists watermark_previews boolean not null default true;

-- §10 : la couverture devient une VRAIE photo de l'album. `cover_preview_url` (texte libre saisi
-- dans l'OS) est conservée et reste la source d'affichage pour tout l'existant — media_album_list()
-- la renvoie déjà à Connect. Le trigger ci-dessous la maintient en accord avec la photo choisie,
-- ce qui rend le nouveau mécanisme rétrocompatible sans toucher une ligne côté Connect ou Club+.
alter table media_albums add column if not exists cover_asset_id uuid references media_assets(id) on delete set null;

create or replace function media_album_sync_cover()
returns trigger
language plpgsql
as $$
declare
  v_url text;
begin
  if new.cover_asset_id is null then
    return new;
  end if;
  select case
           when a.preview_path is null then null
           else current_setting('app.settings.storage_public_base', true) || '/' || a.preview_path
         end
    into v_url
  from media_assets a
  where a.id = new.cover_asset_id and a.album_id = new.id;

  -- L'URL publique complète est construite côté client (il connaît l'URL du projet Supabase) :
  -- la base ne la fabrique que si elle a été configurée, et ne l'écrase jamais par NULL. Une
  -- couverture saisie à la main reste valable tant qu'aucune photo n'a été désignée.
  if v_url is not null then
    new.cover_preview_url := v_url;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_media_album_cover on media_albums;
create trigger trg_media_album_cover
  before update of cover_asset_id on media_albums
  for each row execute function media_album_sync_cover();

-- Une photo supprimée ne doit pas laisser l'album avec une couverture morte.
create or replace function media_album_clear_cover()
returns trigger
language plpgsql
as $$
begin
  update media_albums set cover_asset_id = null
  where cover_asset_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_media_assets_clear_cover on media_assets;
create trigger trg_media_assets_clear_cover
  before delete on media_assets
  for each row execute function media_album_clear_cover();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. RLS : le photographe doit pouvoir déposer
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists massets_staff_all on media_assets;
create policy massets_staff_all on media_assets
  for all using (media_upload_staff()) with check (media_upload_staff());

-- Les liens publics restent une décision de diffusion, pas de production : ils restent réservés à
-- admin/secrétariat. Un photographe dépose des photos, il ne décide pas de les publier sur
-- Internet.
-- (policy malinks_staff_all inchangée, media_staff_write())

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. STOCKAGE
-- ═══════════════════════════════════════════════════════════════════════════

-- Originaux : on reste dans sportvision-media-prive/media/<album_id>/, dont les policies existent
-- déjà et adossent la lecture à can_access_media(). 50 Mo parce qu'un JPEG plein format dépasse
-- régulièrement 15 Mo, et que 50 Mo est déjà la valeur retenue pour clubplus-media.
update storage.buckets
set file_size_limit = 52428800
where id = 'sportvision-media-prive' and coalesce(file_size_limit, 0) < 52428800;

-- Dérivés : bucket public dédié. Rien d'autre n'y est déposé, donc aucune policy existante n'est
-- affaiblie. 10 Mo suffisent très largement pour une preview 1600px.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('galerie-previews', 'galerie-previews', true, 10485760,
        array['image/jpeg','image/webp','image/png'])
on conflict (id) do update
  set public = true,
      file_size_limit = greatest(coalesce(storage.buckets.file_size_limit, 0), 10485760);

drop policy if exists galerie_previews_public_read on storage.objects;
create policy galerie_previews_public_read on storage.objects
  for select using (bucket_id = 'galerie-previews');

drop policy if exists galerie_previews_staff_insert on storage.objects;
create policy galerie_previews_staff_insert on storage.objects
  for insert with check (bucket_id = 'galerie-previews' and media_upload_staff());

drop policy if exists galerie_previews_staff_update on storage.objects;
create policy galerie_previews_staff_update on storage.objects
  for update using (bucket_id = 'galerie-previews' and media_upload_staff());

drop policy if exists galerie_previews_staff_delete on storage.objects;
create policy galerie_previews_staff_delete on storage.objects
  for delete using (bucket_id = 'galerie-previews' and media_upload_staff());

-- Suppression d'un original : la policy d'écriture existante ne couvre que l'INSERT, il n'y avait
-- donc aucun moyen de supprimer le fichier d'une photo retirée (§8). Sans elle, supprimer une
-- photo aurait laissé l'original payant dans le bucket, indéfiniment.
drop policy if exists sv_media_prive_media_delete on storage.objects;
create policy sv_media_prive_media_delete on storage.objects
  for delete using (
    bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'media'
    and media_upload_staff()
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. LECTURE DE LA GRILLE — une seule requête, quel que soit le volume
-- ═══════════════════════════════════════════════════════════════════════════
-- §12 : « éviter les requêtes DB individuelles inutiles ». L'écran de l'OS pagine sur cette
-- fonction plutôt que de charger 1 000 lignes puis de compter côté navigateur. `total` est renvoyé
-- sur chaque ligne pour que l'appelant sache où il en est sans une deuxième requête.
create or replace function media_album_assets(
  p_album_id uuid,
  p_limit integer default 100,
  p_offset integer default 0,
  p_include_hidden boolean default true
)
returns table (
  id uuid,
  original_filename text,
  mime_type text,
  original_path text,
  preview_path text,
  thumb_path text,
  width integer,
  height integer,
  bytes bigint,
  -- Guillemets obligatoires : `position` est un mot réservé SQL, et une colonne de sortie de
  -- RETURNS TABLE qui le porte sans être citée fait échouer la création de la fonction.
  "position" integer,
  status text,
  processing_error text,
  created_at timestamptz,
  is_cover boolean,
  total bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.original_filename, a.mime_type, a.original_path, a.preview_path, a.thumb_path,
         a.width, a.height, a.bytes, a.position, a.status, a.processing_error, a.created_at,
         (al.cover_asset_id = a.id) as is_cover,
         count(*) over () as total
  from media_assets a
  join media_albums al on al.id = a.album_id
  where a.album_id = p_album_id
    and media_upload_staff()
    and a.status <> 'removed'
    and (p_include_hidden or a.status = 'ready')
  order by a.position, a.created_at, a.id
  limit greatest(1, least(coalesce(p_limit, 100), 500))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- SECURITY DEFINER mais `media_upload_staff()` est dans le WHERE : un appelant sans droit reçoit
-- zéro ligne, jamais une erreur qui révélerait l'existence de l'album.
revoke all on function media_album_assets(uuid, integer, integer, boolean) from public;
grant execute on function media_album_assets(uuid, integer, integer, boolean) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. RÉORDONNANCEMENT (§9)
-- ═══════════════════════════════════════════════════════════════════════════
-- Une seule requête pour tout l'album, au lieu d'un UPDATE par photo : réordonner 300 vignettes
-- ne doit pas produire 300 allers-retours.
create or replace function media_assets_reorder(p_album_id uuid, p_asset_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not media_upload_staff() then
    raise exception 'Réordonnancement refusé.' using errcode = '42501';
  end if;

  update media_assets a
  set position = ord.rn, updated_at = now()
  from (select unnest(p_asset_ids) as id, generate_subscripts(p_asset_ids, 1) as rn) ord
  where a.id = ord.id and a.album_id = p_album_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function media_assets_reorder(uuid, uuid[]) from public;
grant execute on function media_assets_reorder(uuid, uuid[]) to authenticated;

commit;
