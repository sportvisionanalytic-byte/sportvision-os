-- v219 — Le Pass Photo donne accès à SES photos, plus les photos de groupe (14/09/2026).
--
-- LE MODÈLE, décidé par Fouka : « le Pass photo saison est payé par les parents ou les joueurs sur
-- Connect. À chaque prestation, le joueur reçoit ses propres photos dans sa galerie. Il voit
-- d'abord un aperçu filigrané de ses photos, il paie son Pass, et après il a les photos toute la
-- saison. » Avec le Pass, il accède à SES photos marquées ET aux photos de groupe. Une photo où
-- personne n'est marqué reste réservée à SportVision et à l'encadrement du club.
--
-- CE QUI EXISTAIT DÉJÀ : le marquage par joueur (`media_player_tags`, décision du 12/09 — pas de
-- reconnaissance faciale, un marquage humain), `media_photos_du_joueur` qui rend les photos d'un
-- joueur à sa famille, le Pass lui-même (`media_entitlements`) et son achat.
--
-- CE QUI MANQUAIT, et que cette migration ajoute :
--   1. La notion de PHOTO DE GROUPE. Rien ne distinguait une photo d'équipe d'un portrait : sans
--      elle, « ses photos plus les photos de groupe » n'est pas exprimable.
--   2. Une lecture unique de ce qu'une famille peut voir dans une galerie — ses photos marquées et
--      les photos de groupe — pour que l'écran, le téléchargement et les tests disent la même
--      chose. Deux lectures séparées finiraient par diverger, et l'une des deux serait trop large.
--   3. Un contrôle d'accès PAR PHOTO. Jusqu'ici tout se décidait par album : un droit ouvrait
--      l'album entier, donc les photos des autres enfants.
--
-- CE QUI NE CHANGE PAS : `can_access_media` reste la règle de l'album (sert à savoir si la galerie
-- est déverrouillée, et garde la lecture du bucket privé). Le parcours de vente par lien public,
-- avec ses offres et ses commandes photo par photo, n'est pas touché — c'est l'autre porte.
--
-- Idempotente.

-- ── 1. La photo de groupe ────────────────────────────────────────────────────
alter table media_assets
  add column if not exists photo_de_groupe boolean not null default false;

comment on column media_assets.photo_de_groupe is
  'v219 — Photo d''équipe ou d''ambiance : accessible à toutes les familles de l''équipe qui ont le Pass, sans marquage individuel.';

-- ── 2. Ce qu'une famille voit dans une galerie ───────────────────────────────
create or replace function public.media_photos_pour_famille(p_album_id uuid, p_player_id uuid)
returns table(asset_id uuid, preview_path text, thumb_path text, ordre integer, de_groupe boolean, marque boolean)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select a.id, a.preview_path, a.thumb_path, a.position,
         a.photo_de_groupe,
         exists (
           select 1 from media_player_tags t
            where t.media_ref_type = 'media_asset' and t.media_ref_id = a.id
              and t.player_id = p_player_id and t.statut = 'valide'
         )
    from media_assets a
    join media_albums al on al.id = a.album_id
   where a.album_id = p_album_id
     and a.status = 'ready'
     and al.status = 'published'
     and auth.uid() is not null
     -- Qui a le droit de poser cette question : la famille de CE joueur, ou le staff dans son
     -- périmètre. Jamais une famille sur l'enfant d'une autre.
     and (
       is_own_player(p_player_id) or is_confirmed_parent_of(p_player_id)
       or (media_upload_staff() and (not est_operateur_terrain() or photographe_voit_album(p_album_id)))
     )
     -- Ses photos, plus les photos de groupe. Une photo sans marquage et sans groupe n'est pas ici.
     and (
       a.photo_de_groupe
       or exists (
         select 1 from media_player_tags t
          where t.media_ref_type = 'media_asset' and t.media_ref_id = a.id
            and t.player_id = p_player_id and t.statut = 'valide'
       )
     )
   order by a.position, a.id;
$$;

comment on function public.media_photos_pour_famille(uuid, uuid) is
  'v219 — Les photos d''une galerie qu''une famille peut voir : celles où son joueur est marqué, plus les photos de groupe.';

-- ── 3. Le droit de télécharger UNE photo ─────────────────────────────────────
create or replace function public.can_access_asset(p_asset_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_asset record;
begin
  if auth.uid() is null then
    return false;
  end if;

  select a.id, a.album_id, a.photo_de_groupe, al.club_id, al.team_id, al.saison_id
    into v_asset
    from media_assets a join media_albums al on al.id = a.album_id
   where a.id = p_asset_id;
  if not found then
    return false;
  end if;

  -- Le staff garde son périmètre habituel, décidé par la règle de l'album.
  if is_staff() then
    return can_access_media(v_asset.album_id);
  end if;

  -- La règle de l'album doit d'abord être satisfaite : galerie gratuite pour les membres, ou droit
  -- payé (le Pass) valable pour cette saison. C'est elle qui porte la borne de saison et la
  -- vérification du bénéficiaire.
  if not can_access_media(v_asset.album_id) then
    return false;
  end if;

  -- Une photo de groupe est ouverte à qui a franchi cette porte.
  if v_asset.photo_de_groupe then
    return true;
  end if;

  -- Sinon, il faut que la photo porte le marquage d'un joueur de SA famille : c'est tout l'objet du
  -- modèle « mes photos ». Sans ce filtre, un Pass ouvrirait les photos des autres enfants.
  return exists (
    select 1 from media_player_tags t
     where t.media_ref_type = 'media_asset' and t.media_ref_id = p_asset_id
       and t.statut = 'valide'
       and (is_own_player(t.player_id) or is_confirmed_parent_of(t.player_id))
  );
end $$;

comment on function public.can_access_asset(uuid) is
  'v219 — Le droit de télécharger UNE photo : la règle de l''album, puis le marquage du joueur ou la photo de groupe.';

revoke all on function public.media_photos_pour_famille(uuid, uuid) from public;
revoke all on function public.can_access_asset(uuid) from public;
grant execute on function public.media_photos_pour_famille(uuid, uuid) to authenticated;
grant execute on function public.can_access_asset(uuid) to authenticated;
