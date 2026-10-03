-- v493 — Le staff relit ses aperçus pendant qu'il les dépose (03/10/2026)
--
-- RÉGRESSION QUE J'AI INTRODUITE CE MATIN AVEC LA v430. Fouka importe la galerie « Detection pro
-- evolution session 2 » : 126 photos sur 129 finissent en `status = 'failed'` avec
-- `processing_error = 'new row violates row-level security policy'`. L'original part sur R2, les
-- deux aperçus filigranés partent dans `galerie-previews`, et le TROISIÈME dépôt — l'aperçu net
-- dans `sportvision-media-prive/apercus-clairs/` — est refusé à chaque photo. Dernier dépôt réussi
-- dans ce dossier : le 29/09 à 12 h 59, avant la v430.
--
-- Le dépôt passe par `x-upsert: true`, donc storage-api doit pouvoir RELIRE l'objet, et la lecture
-- est désormais `media_apercu_clair_lisible(name)`. Cette fonction répondait non au staff, pour
-- deux raisons dont chacune suffisait :
--
--   1. `al.status = 'published'`. Or une galerie est en BROUILLON pendant tout l'import et tout le
--      tri : c'est précisément le moment où le staff a besoin des aperçus nets. J'avais recopié
--      cette condition de la règle des familles, pour qui elle est juste, sans voir qu'elle
--      enfermait ceux qui fabriquent les photos.
--
--   2. `a.preview_clair_path = p_nom`. Cette colonne n'est écrite qu'au PATCH FINAL, APRÈS les
--      trois dépôts (§ « 'ready' en dernier » dans l'OS). Au moment où la policy s'évalue, aucune
--      ligne ne porte ce chemin : la réponse était donc non pour TOUTE galerie, publiée ou pas.
--      Une policy qui interroge une donnée écrite plus tard ne peut jamais dire oui.
--
-- L'ancienne policy posait la question à la GALERIE, par le 2e segment du chemin, et n'avait ni
-- l'un ni l'autre défaut. La v430 avait raison de poser la question à la PHOTO — la fuite venait
-- de là, 2 467 objets signés pour 8 photos — mais cette finesse ne concerne QUE les familles.
--
-- CE QUE CELLE-CI RÉTABLIT, ET CE QU'ELLE NE ROUVRE PAS. Staff et club répondent sur la galerie,
-- comme avant la v430, donc sans dépendre d'une colonne pas encore remplie ni du statut. La
-- branche FAMILLE est recopiée mot pour mot : le Pass, la photo de groupe ou un marquage VALIDE,
-- sur la ligne de CETTE photo. La fuite reste fermée, et les deux sondes de la migration le
-- prouvent dans les deux sens.
--
-- À VÉRIFIER APRÈS COUP, car le même refus les touche : l'écran de tri des photos et la relecture
-- des aperçus nets d'une galerie en brouillon étaient cassés depuis ce matin, pas seulement
-- l'import.

begin;

create or replace function public.media_apercu_clair_lisible(p_nom text)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  with chemin as (
    -- `apercus-clairs/<galerie>/<photo>-pc.webp`. Le 2e segment n'est casté que s'il a la forme
    -- d'un uuid : un nom d'objet est une chaîne venue de l'extérieur, et un cast qui échoue ferait
    -- remonter une erreur 22P02 là où la policy doit simplement répondre non.
    select case
             when split_part(p_nom, '/', 2) ~ '^[0-9a-fA-F-]{36}$'
               then split_part(p_nom, '/', 2)::uuid
           end as album_id
  )
  select
    -- 1. LE STAFF SPORTVISION, SUR LA GALERIE. Un opérateur terrain reste borné à SES prestations,
    --    sinon il récupérerait n'importe quelle galerie. Aucune condition de statut : il dépose et
    --    il trie avant publication.
    coalesce((
      select (is_staff() and (not est_operateur_terrain() or photographe_voit_album(c.album_id)))
             or public.media_club_voit_la_galerie(c.album_id)
        from chemin c
       where c.album_id is not null
    ), false)

    -- 2. LA FAMILLE, SUR LA PHOTO. Repris tel quel de la v430 : c'est cette branche qui a fermé la
    --    fuite, elle ne change pas d'un caractère.
    or exists (
      select 1
        from media_assets a
        join media_albums al on al.id = a.album_id
       where a.preview_clair_path = p_nom
         and al.status = 'published'
         and public.media_voit_sans_filigrane(a.album_id)
         and (
           -- Une photo de groupe est une photo que le Pass DONNE (v353).
           a.photo_de_groupe
           -- Ou un marquage VALIDE pour un sportif dont ce compte a la charge. Une suggestion que
           -- personne n'a tranchée ne suffit pas : tant que c'est une proposition, la photo reste
           -- filigranée. Règle de la v330.
           or exists (
             select 1 from media_player_tags t
              where t.media_ref_type = 'media_asset'
                and t.media_ref_id = a.id
                and t.statut = 'valide'
                and (is_own_player(t.player_id) or is_confirmed_parent_of(t.player_id))
           )
         )
    );
$function$;

commit;
