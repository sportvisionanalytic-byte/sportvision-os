-- v157 : la vidéo du match, par le lien du montage (12/09/2026).
--
-- Décision de Fouka : on ne téléverse pas la vidéo dans la galerie (fichiers lourds, lecture,
-- stockage) ; la galerie affiche le lien du MONTAGE FINAL déposé par le vidéaste sur la mission.
--
-- Les liens de livraison (media_liens) sont réservés au staff, et c'est très bien : ils portent
-- aussi les rushs et les originaux. Cette fonction est le seul chemin qui en rend un à un coach ou
-- à une famille, et elle ne rend QUE le montage final (categorie 'final', type 'video') de la
-- mission d'une galerie PUBLIÉE, à qui a le droit de voir cette galerie :
--   • le staff SportVision (media_upload_staff) et le CM du club ;
--   • le coach de l'équipe, et les autres rôles du club pour les galeries sans équipe ;
--   • dans Connect, le joueur affilié à l'équipe et son parent confirmé (is_family_of_team).
-- Test : tests/galerie-video-montage.test.sql

create or replace function public.media_galeries_video(p_album_ids uuid[])
returns table (album_id uuid, nom text, url text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select a.id, coalesce(nullif(btrim(l.nom), ''), 'Vidéo du match'), l.url
    from media_albums a
    join media_liens l on l.prestation_id = a.mission_id
   where a.id = any(p_album_ids)
     and a.status = 'published'
     and l.categorie = 'final' and l.type_media = 'video'
     and coalesce(l.statut, 'a_verifier') not in ('expire', 'inaccessible', 'remplace')
     and l.url ~ '^https?://'
     and auth.uid() is not null
     and (
       media_upload_staff()
       or (a.club_id is not null and a.club_id in (select cm_clubs_autorises()))
       or (a.team_id is not null and (is_team_educateur(a.team_id) or is_family_of_team(a.team_id)))
       or (a.team_id is null and a.club_id is not null and is_club_member(a.club_id))
     );
$$;
revoke execute on function public.media_galeries_video(uuid[]) from public, anon;
grant execute on function public.media_galeries_video(uuid[]) to authenticated;
