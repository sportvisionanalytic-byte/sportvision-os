-- v299 — 27/09/2026 : quatre photos filigranées, pour qu'il y ait une raison d'acheter
--
-- MESURE QUI A DÉCLENCHÉ LA DÉCISION. En production : 3 399 photos prêtes, 26 galeries publiées,
-- **0 marquage**, **0 Pass vendu**. L'aperçu censé donner envie d'acheter le Pass ne rendait que des
-- photos DÉJÀ MARQUÉES — et le marquage vient soit du staff, soit de l'identification par la
-- famille, laquelle exige le Pass payé. Une famille qui ouvrait l'app voyait donc zéro photo, et
-- n'avait aucune raison de payer. Le tunnel de vente commençait par une page blanche.
--
-- L'IMPASSE ÉTAIT RÉELLE, pas un oubli. La reconnaissance faciale aurait rempli l'aperçu, mais elle
-- part de la photo de référence de l'enfant, qu'on ne demande QU'APRÈS paiement — c'est une donnée
-- biométrique, et l'ordre a été corrigé exprès le 26/09. On ne pouvait donc pas remplir l'aperçu
-- avant la vente avec ce mécanisme-là.
--
-- DÉCISION DE FOUKA (27/09) : l'aperçu montre quatre photos DE LA GALERIE, filigranées, sans
-- aucune identification. « Voilà les photos du match, prends le Pass pour retrouver ton enfant
-- dedans. » Aucune biométrie avant paiement, aucun marquage préalable, et l'aperçu existe dès
-- qu'une galerie est publiée.
--
-- CE QUI EST CONSERVÉ, ET QUI COMPTE : si la famille a DÉJÀ des photos marquées, ce sont les
-- siennes qu'elle voit en aperçu. Un aperçu de son propre enfant convertit mieux qu'un aperçu
-- d'ambiance, et le remplacer par des photos génériques aurait été une régression. Les quatre
-- photos de la galerie sont un REPLI, pas un remplacement.
--
-- `apercu_galerie` dit à l'écran lequel des deux cas il affiche, pour qu'il ne prétende jamais
-- « voici les photos de votre enfant » devant des photos d'ambiance. C'est aussi pour ça que la
-- colonne existe plutôt qu'une déduction côté app : l'écran ne peut pas devinerid.
--
-- CE QUI NE CHANGE PAS : le plafond de quatre reste appliqué EN BASE (v282) — une limite posée dans
-- l'écran se contourne en rejouant la requête. Et le chemin de l'aperçu NET ne sort toujours que
-- pour qui y a droit (v281) : ces quatre photos sont les dérivés filigranés du bucket public, ceux
-- que n'importe quel visiteur d'un lien voit déjà.
--
-- Les photos de groupe passent en premier dans le repli : elles montrent l'équipe, c'est ce qu'une
-- famille cherche, et c'est le choix le moins intrusif pour les enfants des autres.
--
-- `media_photos_pour_famille` n'est PAS touchée : vérifié, aucun client ne l'appelle (seuls deux
-- tests), elle reste la vue stricte « ses photos et rien d'autre ».
--
-- La signature gagne une colonne, donc la fonction est supprimée puis recréée : les droits
-- d'exécution sont reposés explicitement à la fin, sinon la suppression les emporte et l'app reçoit
-- un refus.

drop function if exists public.media_photos_du_joueur(uuid, uuid);

create function public.media_photos_du_joueur(p_album_id uuid, p_player_id uuid)
returns table(asset_id uuid, preview_path text, thumb_path text, preview_clair_path text,
              ordre integer, marque_par text, total integer, apercu_galerie boolean)
language sql stable security definer set search_path to 'public','pg_temp' as $function$
  with droit as (
    select media_voit_sans_filigrane(p_album_id) as clair
  ), autorise as (
    select 1
     where auth.uid() is not null
       and (
         is_own_player(p_player_id) or is_confirmed_parent_of(p_player_id)
         or (media_upload_staff() and (not est_operateur_terrain() or photographe_voit_album(p_album_id)))
       )
  ), siennes as (
    select a.id, a.preview_path, a.thumb_path, a.preview_clair_path, a.position, t.source,
           a.photo_de_groupe
      from media_assets a
      join media_albums al on al.id = a.album_id
      join media_player_tags t
        on t.media_ref_type = 'media_asset' and t.media_ref_id = a.id
       and t.player_id = p_player_id and t.statut = 'valide'
     where a.album_id = p_album_id
       and a.status = 'ready'
       and al.status = 'published'
       and exists (select 1 from autorise)
  ), toute_la_galerie as (
    -- Le repli. Il ne sert QUE si la famille n'a aucune photo marquee ET n'a pas encore paye :
    -- celle qui a paye veut ses photos, pas une vitrine.
    select a.id, a.preview_path, a.thumb_path, a.preview_clair_path, a.position, null::text as source,
           a.photo_de_groupe
      from media_assets a
      join media_albums al on al.id = a.album_id
     where a.album_id = p_album_id
       and a.status = 'ready'
       and al.status = 'published'
       and exists (select 1 from autorise)
       and not (select clair from droit)
       and not exists (select 1 from siennes)
  ), lignes as (
    select *, false as repli from siennes
    union all
    select *, true  as repli from toute_la_galerie
  ), compte as (
    select count(*)::integer as n from lignes
  )
  select l.id, l.preview_path, l.thumb_path,
         -- Le chemin clair ne sort QUE pour qui y a droit. La politique de stockage refuserait de
         -- toute facon le fichier, mais rendre un chemin qu'on sait inutilisable ferait afficher des
         -- images cassees au lieu d'apercus marques.
         case when (select clair from droit) then l.preview_clair_path else null end,
         l.position, l.source,
         (select n from compte),
         l.repli
    from lignes l
   order by l.repli, l.photo_de_groupe desc, l.position, l.id
   limit case when (select clair from droit) then null else 4 end;
$function$;

comment on function public.media_photos_du_joueur(uuid, uuid) is
  'v299 : ses photos marquees si elle en a ; sinon, et seulement sans Pass, quatre photos filigranees de la galerie pour donner une raison d''acheter. apercu_galerie dit lequel des deux cas est rendu.';

grant execute on function public.media_photos_du_joueur(uuid, uuid) to anon, authenticated, service_role;
