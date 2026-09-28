-- v330 — L'aperçu sans filigrane n'est servi que pour ses propres photos (28/09/2026).
--
-- Fouka : « il y a des doutes, mais il faut mettre le filigrane, parce que sinon il peut screen
-- envoyer à ses potes. » Il avait raison, et le trou était plus large que ce qu'il décrivait :
-- `media_galerie_a_identifier` rendait `preview_clair_path` pour TOUTES les photos de la galerie,
-- pas seulement pour celles proposées. Un Pass ouvrait donc les 110 photos en clair, y compris
-- celles où l'enfant n'apparaît pas.
--
-- La photo reste montrée — sinon il n'y aurait plus rien à confirmer — mais dans sa version
-- filigranée tant qu'elle n'est pas reconnue comme sienne.

CREATE OR REPLACE FUNCTION public.media_galerie_a_identifier(p_album_id uuid, p_player_id uuid)
 RETURNS TABLE(asset_id uuid, preview_path text, thumb_path text, preview_clair_path text, ordre integer, de_groupe boolean, mienne boolean, marquee_par_une_autre boolean, suggeree boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_net boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.' using errcode = '42501';
  end if;

  -- La famille de CE joueur, et seulement elle.
  if not (is_own_player(p_player_id) or is_confirmed_parent_of(p_player_id)) then
    raise exception 'Ce joueur n''est pas rattaché à votre compte.' using errcode = '42501';
  end if;

  -- L'enfant doit jouer dans une equipe de la galerie : on ne montre pas les photos d'une equipe ou
  -- il n'est pas. v304 : la regle vit dans media_galerie_concerne_le_joueur(), et elle traite deux
  -- cas que la version precedente laissait passer — une galerie SANS equipe (que plus aucune famille
  -- ne doit voir, v302) et les categories SUPPLEMENTAIRES de team_ids (v280), qu'elle ignorait.
  if not public.media_galerie_concerne_le_joueur(p_album_id, p_player_id) then
    return;
  end if;

  -- LE VERROU AJOUTÉ (v287). Sans lui, cette fonction servait les 110 photos d'une galerie à qui
  -- n'avait rien payé, et contournait le plafond de quatre de la v282.
  v_net := media_voit_sans_filigrane(p_album_id);
  if not v_net then
    return;
  end if;

  return query
  select a.id, a.preview_path, a.thumb_path,
         -- v330 — L'APERÇU SANS FILIGRANE N'EST SERVI QUE POUR SES PHOTOS À LUI.
         --
         -- Cette colonne était rendue pour TOUTES les photos de la galerie. Avec un Pass à
         -- 19,90 €, la famille voyait donc les 110 photos en clair — celles où son enfant n'est
         -- pas, et celles des autres enfants. Le plafond de quatre aperçus, le filigrane et toute
         -- la logique de vente tombaient par cette seule fonction.
         --
         -- Ce que le Pass retire, c'est le filigrane SUR SES PHOTOS. Une photo que la machine
         -- propose n'est pas encore la sienne : tant que personne n'a tranché, elle reste
         -- filigranée. La photo reste VISIBLE — on retire le net, pas la photo — sinon il n'y
         -- aurait plus rien à confirmer.
         case when exists (select 1 from media_player_tags t
                            where t.media_ref_type = 'media_asset' and t.media_ref_id = a.id
                              and t.player_id = p_player_id and t.statut = 'valide')
              then a.preview_clair_path end,
         a.position, a.photo_de_groupe,
         exists (select 1 from media_player_tags t
                  where t.media_ref_type = 'media_asset' and t.media_ref_id = a.id
                    and t.player_id = p_player_id and t.statut = 'valide'),
         exists (select 1 from media_player_tags t
                  where t.media_ref_type = 'media_asset' and t.media_ref_id = a.id
                    and t.player_id <> p_player_id and t.statut = 'valide'),
         -- Ce que la machine propose et que personne n'a encore tranché : le point de départ de
         -- l'écran.
         exists (select 1 from media_player_tags t
                  where t.media_ref_type = 'media_asset' and t.media_ref_id = a.id
                    and t.player_id = p_player_id and t.statut = 'propose')
    from media_assets a
    join media_albums al on al.id = a.album_id
   where a.album_id = p_album_id
     and a.status = 'ready'
     and al.status = 'published'
   order by
     -- Les suggestions d'abord : c'est ce qu'on demande de trancher.
     (exists (select 1 from media_player_tags t
               where t.media_ref_type = 'media_asset' and t.media_ref_id = a.id
                 and t.player_id = p_player_id and t.statut = 'propose')) desc,
     a.position, a.id;
end $function$
;
