-- v432 — « LA GALERIE À IDENTIFIER » N'EST PAS LA GALERIE (01/10/2026)
--
-- Fouka : « les joueurs, parents, ils doivent voir uniquement leurs photos via l'achat du pass. Ils
-- ne peuvent pas voir les galeries ni en acheter. »
--
-- MESURÉ, par le chemin réel, avec le jeton de demo.joueur.fontainebleau (Pass payé) :
--
--     POST /rest/v1/rpc/media_galerie_a_identifier   →  200, 110 lignes
--     dont 96 qui ne sont NI les siennes NI des propositions à trancher.
--
-- La fonction servait toute la galerie. L'écran de l'application n'en montrait que les propositions
-- (`aTrancher = t.filter(x => x.suggeree && !x.mienne)`), donc le défaut ne se voyait pas : un
-- filtre posé dans l'écran n'est pas un contrôle d'accès, et la même leçon est déjà écrite deux fois
-- (v282 sur le plafond d'aperçus, v304 sur la liste bornée).
--
-- CE QUE ÇA COÛTAIT. Chaque ligne portait le `preview_path` de la photo, qui est public. L'aperçu
-- SANS filigrane se déduit de ce chemin sans rien deviner (`<album>/<id>-p.webp` devient
-- `apercus-clairs/<album>/<id>-pc.webp`) : cette liste était donc l'annuaire complet des photos d'un
-- match, celles des autres enfants comprises. La v430 ferme la serrure du stockage ; celle-ci retire
-- l'annuaire.
--
-- CE QUI RESTE SERVI, et c'est tout ce dont l'écran a besoin :
--
--     ce que la reconnaissance ou le numéro de maillot ont PROPOSÉ pour ce sportif  (statut propose)
--     ce qui est DÉJÀ le sien                                                       (statut valide)
--
-- Une photo qu'on ne lui a pas proposée ne lui est plus nommée — et depuis la v431 elle ne peut plus
-- se la revendiquer non plus. Les deux vont ensemble.
--
-- ROUGE AVANT / VERT APRÈS : livrables/SportVision-TV/tests/apercu-net-photo-par-photo.test.mjs

begin;

create or replace function public.media_galerie_a_identifier(p_album_id uuid, p_player_id uuid)
returns table(asset_id uuid, preview_path text, thumb_path text, preview_clair_path text,
              ordre integer, de_groupe boolean, mienne boolean, marquee_par_une_autre boolean,
              suggeree boolean)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
  with mes_marquages as (
    -- v432 — LE POINT DE DÉPART N'EST PLUS LA GALERIE, CE SONT SES MARQUAGES À LUI. Une photo dont
    -- personne n'a jamais dit qu'elle pouvait être la sienne n'a rien à faire dans cette liste : ni
    -- son image, ni même son identifiant.
    select t.media_ref_id as asset_id, t.statut
      from media_player_tags t
     where t.media_ref_type = 'media_asset'
       and t.player_id = p_player_id
       and t.statut in ('propose', 'valide')
  )
  select a.id, a.preview_path, a.thumb_path,
         -- v330 — L'APERÇU SANS FILIGRANE N'EST SERVI QUE POUR SES PHOTOS À LUI.
         --
         -- Ce que le Pass retire, c'est le filigrane SUR SES PHOTOS. Une photo que la machine
         -- propose n'est pas encore la sienne : tant que personne n'a tranché, elle reste
         -- filigranée. La photo reste VISIBLE — on retire le net, pas la photo — sinon il n'y
         -- aurait plus rien à confirmer.
         case when m.statut = 'valide' then a.preview_clair_path end,
         a.position, a.photo_de_groupe,
         (m.statut = 'valide'),
         exists (select 1 from media_player_tags t
                  where t.media_ref_type = 'media_asset' and t.media_ref_id = a.id
                    and t.player_id <> p_player_id and t.statut = 'valide'),
         -- Ce que la machine propose et que personne n'a encore tranché : le point de départ de
         -- l'écran.
         (m.statut = 'propose')
    from mes_marquages m
    join media_assets a on a.id = m.asset_id
    join media_albums al on al.id = a.album_id
   where a.album_id = p_album_id
     and a.status = 'ready'
     and al.status = 'published'
   order by
     -- Les suggestions d'abord : c'est ce qu'on demande de trancher.
     (m.statut = 'propose') desc,
     a.position, a.id;
end $function$;

commit;
