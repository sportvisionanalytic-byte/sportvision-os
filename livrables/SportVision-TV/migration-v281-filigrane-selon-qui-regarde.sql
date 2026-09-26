-- v281 — 26/09/2026 : le filigrane dépend de qui regarde, pas de la galerie
--
-- Demande de Fouka : « il faut laisser le filigrane pour ceux qui n'ont pas payé le pass photo, et
-- le retirer pour ceux qui ont payé. Et pas mettre de filigrane pour les coachs, le community
-- manager. »
--
-- CE QUI RENDAIT ÇA IMPOSSIBLE
--
-- Le filigrane est CUIT dans le fichier au moment du dépôt, dessiné dans le navigateur. Il n'y a
-- qu'UN aperçu par photo, dans un bucket public. Décocher le réglage après coup ne change rien aux
-- fichiers déjà produits — mesuré ce matin sur la galerie RCPF vs PSG : réglage à « false », et les
-- 110 aperçus marqués quand même. On ne décuit pas un filigrane.
--
-- Il faut donc DEUX aperçus : le marqué, public, pour tout le monde ; le clair, privé, servi à qui
-- y a droit. Cette migration pose le second et la règle qui le garde.
--
-- LA RÈGLE, ET POURQUOI CE N'EST PAS `can_access_media`
--
-- `can_access_media` rend `true` aux familles d'une galerie `free_members` — et en Full
-- Communication, les galeries naissent `free_members` (v272). La réutiliser aurait donné l'aperçu
-- clair à TOUTES les familles du club sans qu'aucune ne paie, c'est-à-dire l'inverse de ce qui est
-- demandé.
--
-- La frontière est donc ailleurs, et elle se dit en une phrase : **Full Communication donne le
-- droit de VOIR, le Pass donne le droit de voir SANS FILIGRANE.**
--
--   staff SportVision            → clair (un opérateur terrain : seulement ses prestations)
--   coach, président, CM du club → clair (ils travaillent avec ces photos)
--   famille avec un Pass payé    → clair
--   famille sans Pass            → filigrane, même en Full Communication
--   tout le reste                → filigrane
--
-- Le fichier clair vit dans le bucket PRIVÉ, sous `apercus-clairs/<galerie>/…`, gardé par une
-- politique de stockage. Le mettre dans le bucket public l'aurait rendu lisible par quiconque
-- devine son adresse : le filigrane n'aurait plus protégé personne.
--
-- Idempotent.

alter table media_assets add column if not exists preview_clair_path text;

comment on column media_assets.preview_clair_path is
  'Aperçu SANS filigrane, dans sportvision-media-prive sous apercus-clairs/<album_id>/. '
  'NULL = pas encore fabriqué : on sert alors l''aperçu public, marqué.';

-- ── Qui a droit à l'aperçu clair ─────────────────────────────────────────────────────────────
create or replace function public.media_voit_sans_filigrane(p_album_id uuid)
returns boolean
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_album record;
  v_equipes uuid[];
begin
  if auth.uid() is null then
    return false;
  end if;

  select * into v_album from media_albums where id = p_album_id;
  if not found then
    return false;
  end if;

  -- 1. Le staff SportVision. Même nuance que can_access_media : un opérateur terrain n'est staff
  -- que pour SES prestations, sinon il récupérerait n'importe quelle galerie par son identifiant.
  if is_staff() then
    return not est_operateur_terrain() or photographe_voit_album(p_album_id);
  end if;

  -- Les catégories de la galerie, principale et supplémentaires (v280).
  v_equipes := array(
    select distinct e from unnest(
      coalesce(v_album.team_ids, '{}'::uuid[])
      || case when v_album.team_id is null then '{}'::uuid[] else array[v_album.team_id] end
    ) as e where e is not null
  );

  -- 2. Le club lui-même : coach de l'équipe concernée, président, secrétaire, CM affilié. Ce sont
  -- eux qui publient et commentent ces photos — leur servir du filigrane serait absurde.
  -- Le cloisonnement du coach de la v155 est conservé : il ne voit sans filigrane que SES équipes,
  -- plus les galeries du club qui n'appartiennent à aucune catégorie.
  if v_album.club_id is not null
     and (is_club_member(v_album.club_id) or v_album.club_id in (select cm_clubs_autorises()))
  then
    -- Le cloisonnement du coach, RECOPIÉ MOT POUR MOT depuis media_club_galleries (v155) : un
    -- coach, un responsable d'équipe ou un directeur sportif ne voit que SES équipes, plus les
    -- galeries du club rattachées à aucune catégorie. Les autres rôles du club voient tout.
    --
    -- Recopié, et non réinventé : une seconde écriture de la même règle finirait par divergér, et
    -- la divergence se verrait ici sous la forme d'un coach qui voit sans filigrane une catégorie
    -- que Club+ lui cache.
    if cardinality(v_equipes) = 0
       or exists (select 1 from unnest(v_equipes) as e where is_team_educateur(e))
       or not exists (
            select 1 from club_members cm
             where cm.club_id = v_album.club_id and cm.user_id = auth.uid()
               and cm.status = 'actif'
               and cm.role in ('coach', 'resp_equipe', 'directeur_sportif'))
    then
      return true;
    end if;
  end if;

  -- 3. Le Pass RÉELLEMENT PAYÉ. `free_members` ne suffit PAS ici, et c'est tout l'objet de cette
  -- migration : en Full Communication la famille voit déjà les photos, ce qu'elle achète avec le
  -- Pass c'est de les voir sans filigrane.
  return exists (
    select 1 from media_entitlements me
    where me.status = 'active'
      and (me.valid_until is null or me.valid_until > now())
      and (me.saison_id is null or me.saison_id = v_album.saison_id)
      and (
        (me.scope_type = 'club' and me.club_id = v_album.club_id)
        or (me.scope_type = 'team' and me.scope_id = any(v_equipes))
        or (me.scope_type = 'album' and me.scope_id = v_album.id)
        or (me.scope_type = 'event' and v_album.event_id is not null and me.scope_id = v_album.event_id)
      )
      and (
        me.purchased_by_user_id = auth.uid()
        or is_own_player(me.beneficiary_person_id)
        or is_confirmed_parent_of(me.beneficiary_person_id)
      )
  );
end $function$;

revoke all on function public.media_voit_sans_filigrane(uuid) from public;
grant execute on function public.media_voit_sans_filigrane(uuid) to authenticated, anon;

-- ── Le fichier clair, et qui peut le lire ────────────────────────────────────────────────────
-- Chemin : apercus-clairs/<album_id>/<asset>-pc.webp, dans le bucket PRIVÉ. L'identifiant de
-- galerie est le 2e segment, exactement comme les originaux sous media/<album_id>/ dont la
-- politique du même bucket sert de modèle.
--
-- La garde est posée par le STOCKAGE et pas seulement par une RPC : une adresse d'aperçu finit
-- toujours par circuler (copier-coller, inspecteur du navigateur, capture). Si seule l'application
-- décidait, il suffirait de connaître le chemin.
drop policy if exists sv_media_prive_apercus_clairs_select on storage.objects;
create policy sv_media_prive_apercus_clairs_select on storage.objects
  for select using (
    bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'apercus-clairs'
    and media_voit_sans_filigrane(((storage.foldername(name))[2])::uuid)
  );

drop policy if exists sv_media_prive_apercus_clairs_write on storage.objects;
create policy sv_media_prive_apercus_clairs_write on storage.objects
  for insert with check (
    bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'apercus-clairs'
    and media_upload_staff()
  );

drop policy if exists sv_media_prive_apercus_clairs_update on storage.objects;
create policy sv_media_prive_apercus_clairs_update on storage.objects
  for update using (
    bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'apercus-clairs'
    and media_upload_staff()
  );

drop policy if exists sv_media_prive_apercus_clairs_delete on storage.objects;
create policy sv_media_prive_apercus_clairs_delete on storage.objects
  for delete using (
    bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'apercus-clairs'
    and media_upload_staff()
  );
