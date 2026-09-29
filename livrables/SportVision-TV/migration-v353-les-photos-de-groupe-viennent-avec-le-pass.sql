-- v353 — LES PHOTOS DE GROUPE ONT TUÉ L'APERÇU QUI VEND (29/09/2026)
--
-- DEUX DÉCISIONS JUSTES QUI SE SONT ANNULÉES.
--
-- v299, le 27/09, part d'une mesure en production : 3 399 photos prêtes, 26 galeries publiées,
-- 0 marquage, 0 Pass vendu. Une famille ouvrait l'application et voyait une page blanche. D'où
-- l'aperçu : sans Pass et sans marquage, quatre photos de la galerie, filigranées, et LE VRAI TOTAL
-- à côté — « 4 sur 10 » —, pour qu'elle sache ce qu'elle achète.
--
-- v340, aujourd'hui, applique une demande de Fouka : « Photos de groupe, tu les mets aussi ». Les
-- photos d'équipe entrent dans la galerie de l'enfant sans qu'on lui demande rien.
--
-- LE DÉFAUT. v340 a fait entrer les photos de groupe dans « ses photos » SANS CONDITION DE PAIEMENT.
-- Or l'aperçu ne se déclenche que si elle n'a AUCUNE photo. Résultat mesuré sur le décor du test :
-- une galerie de 10 photos dont 2 de groupe affichait « 2 photos, total 2 » à une famille qui n'a
-- pas payé, au lieu de « 4 photos, total 10 ». Elle croyait que la galerie contenait deux photos.
-- On a remis la page blanche, en pire : une page qui MENT sur ce qu'il y a à acheter. Et ça sur le
-- seul écran qui convertit, alors que 97,6 % des visiteurs sont perdus avant le panier.
--
-- LA RÈGLE, ET ELLE REND LES DEUX DÉCISIONS COMPATIBLES : les photos de groupe font partie de ce
-- que le Pass DONNE. Elles arrivent donc avec lui, pas avant.
--   - sans Pass, sans marquage  → 4 photos de la galerie, filigranées, vrai total, drapeau d'aperçu
--   - sans Pass, avec marquage  → SES photos à elle, et rien d'autre (un aperçu personnel convertit
--                                 mieux qu'un aperçu générique : on ne l'écrase jamais)
--   - avec le Pass              → ses photos ET les photos de groupe, sans filigrane, sans limite
--
-- C'est aussi ce que le texte de vente promet depuis le 14/09 : « ses photos plus les photos de
-- groupe » pour 39,90 €. Les donner avant, c'était vendre ce qu'on offrait déjà.

create or replace function public.media_photos_du_joueur(p_album_id uuid, p_player_id uuid)
-- LES NOMS DE COLONNES SONT CEUX DE L'EXISTANTE, AU CARACTERE PRES. Premier essai refuse :
-- « cannot change return type of existing function ». J'avais ecrit `id` et `source` la ou la
-- fonction rend `asset_id` et `marque_par`. Renommer aurait oblige a la supprimer, donc a casser
-- tout ce qui l'appelle, pour une correction de trois lignes.
returns table (asset_id uuid, preview_path text, thumb_path text, preview_clair_path text,
               ordre integer, marque_par text, total integer, apercu_galerie boolean)
language sql
stable
security definer
set search_path = public
as $$
  with droit as (
    select media_voit_sans_filigrane(p_album_id) as clair
  ), autorise as (
    select 1
     where auth.uid() is not null
       and (
         ((is_own_player(p_player_id) or is_confirmed_parent_of(p_player_id))
          and public.media_galerie_concerne_le_joueur(p_album_id, p_player_id))
         or (media_upload_staff() and (not est_operateur_terrain() or photographe_voit_album(p_album_id)))
       )
  ), siennes as (
    select a.id, a.preview_path, a.thumb_path, a.preview_clair_path, a.position,
           coalesce(t.source, 'groupe') as source, a.photo_de_groupe,
           -- Ce qui la met dans sa galerie : un marquage à lui, ou le fait que ce soit une photo
           -- d'équipe. Le premier passe devant.
           (t.id is not null) as identifie
      from media_assets a
      join media_albums al on al.id = a.album_id
      left join media_player_tags t
        on t.media_ref_type = 'media_asset' and t.media_ref_id = a.id
       and t.player_id = p_player_id and t.statut = 'valide'
     where a.album_id = p_album_id
       and a.status = 'ready'
       and al.status = 'published'
       and exists (select 1 from autorise)
       and (
         t.id is not null
         -- LA CONDITION AJOUTÉE PAR v353, et c'est toute la correction : une photo de groupe est
         -- une photo que le Pass DONNE. Sans lui, elle ne compte pas comme « sienne », sinon elle
         -- empêche l'aperçu de quatre photos de se déclencher et la famille croit la galerie vide.
         or ((select clair from droit)
             and a.photo_de_groupe and not exists (
               select 1 from media_player_tags r
                where r.media_ref_type = 'media_asset' and r.media_ref_id = a.id
                  and r.player_id = p_player_id and r.statut = 'rejete'))
       )
  ), toute_la_galerie as (
    select a.id, a.preview_path, a.thumb_path, a.preview_clair_path, a.position,
           null::text as source, a.photo_de_groupe, false as identifie
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
         case when (select clair from droit) then l.preview_clair_path else null end,
         l.position, l.source,
         (select n from compte),
         l.repli
    from lignes l
   -- Ce qu'une famille vient chercher, c'est son enfant : les photos où il est identifié d'abord,
   -- les photos d'équipe ensuite.
   order by l.repli, l.identifie desc, l.photo_de_groupe desc, l.position, l.id
   limit case when (select clair from droit) then null else 4 end;
$$;

comment on function public.media_photos_du_joueur(uuid, uuid) is
  'Les photos d''une galerie pour un sportif. Sans Pass : ses marquages, ou à défaut quatre photos '
  'de la galerie filigranées avec le VRAI total (apercu_galerie levé). Avec le Pass : ses photos ET '
  'les photos de groupe, sans limite. NE JAMAIS faire entrer les photos de groupe sans la condition '
  'de Pass : elles rempliraient `siennes`, l''aperçu ne se déclencherait plus, et la famille verrait '
  '« 2 photos » dans une galerie de 10. C''est arrivé avec v340, le 29/09/2026.';

notify pgrst, 'reload schema';
