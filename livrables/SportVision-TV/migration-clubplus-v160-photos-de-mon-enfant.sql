-- v160 : « les photos de mon enfant » dans une galerie (12/09/2026).
--
-- Fondation du Pass photo « mon enfant » : savoir, pour une galerie donnée, quelles photos sont
-- celles d'un joueur précis, et ne montrer cette liste qu'à sa famille (le joueur lui-même, son
-- parent confirmé) ou au staff. Elle sert à trois écrans à venir : l'aperçu réservé à la famille
-- dans Connect, la sélection à l'achat, et l'écran de rattachement côté Production.
--
-- Elle ne change aucun accès existant : elle ne rend que des aperçus (jamais l'original, jamais un
-- lien HD), et seulement des photos dont le rattachement a été VALIDÉ (une suggestion de machine
-- non validée ne montre rien à personne).
-- Test : tests/photos-de-mon-enfant.test.sql

create or replace function public.media_photos_du_joueur(p_album_id uuid, p_player_id uuid)
returns table (asset_id uuid, preview_path text, thumb_path text, ordre integer, marque_par text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select a.id, a.preview_path, a.thumb_path, a.position, t.source
    from media_assets a
    join media_albums al on al.id = a.album_id
    join media_player_tags t
      on t.media_ref_type = 'media_asset' and t.media_ref_id = a.id
     and t.player_id = p_player_id and t.statut = 'valide'
   where a.album_id = p_album_id
     and a.status = 'ready'
     and al.status = 'published'
     and auth.uid() is not null
     and (
       -- La famille de l'enfant : lui-même, ou son parent confirmé.
       is_own_player(p_player_id) or is_confirmed_parent_of(p_player_id)
       -- Le staff SportVision, dans son périmètre habituel.
       or (media_upload_staff() and (not est_operateur_terrain() or photographe_voit_album(p_album_id)))
     )
   order by a.position, a.id;
$$;
revoke execute on function public.media_photos_du_joueur(uuid, uuid) from public, anon;
grant execute on function public.media_photos_du_joueur(uuid, uuid) to authenticated;

-- Combien de photos de mon enfant dans cette galerie : ce que l'écran annonce avant l'achat
-- (« 23 photos de Lucas dans cette galerie »), sans révéler les photos elles-mêmes.
create or replace function public.media_compte_photos_du_joueur(p_album_id uuid, p_player_id uuid)
returns integer
language sql stable security definer
set search_path = public, pg_temp
as $$
  select count(*)::int from media_photos_du_joueur(p_album_id, p_player_id);
$$;
revoke execute on function public.media_compte_photos_du_joueur(uuid, uuid) from public, anon;
grant execute on function public.media_compte_photos_du_joueur(uuid, uuid) to authenticated;
