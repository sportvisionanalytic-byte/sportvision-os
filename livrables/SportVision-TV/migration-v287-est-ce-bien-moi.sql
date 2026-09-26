-- v287 — 26/09/2026 : « oui c'est bien moi », la dernière marche
--
-- Fouka décrit le parcours complet : « acheter le pass, une fois que tu as acheté le pass il dépose
-- sa photo de référence pour le retrouver, et après s'il y a des photos il peut mettre oui c'est
-- bien moi ».
--
-- Les quatre premières marches existaient. La cinquième, non : `media_galerie_a_identifier` et
-- `media_famille_marque` sont en base depuis le 12/09 et N'ÉTAIENT APPELÉES PAR AUCUNE INTERFACE —
-- vérifié dans l'app, dans Connect, dans Club+ et dans l'OS. Le mécanisme existait, personne ne
-- pouvait s'en servir.
--
-- ET UNE BRÈCHE, TROUVÉE EN ALLANT LA BRANCHER
--
-- `media_galerie_a_identifier` rend TOUTES les photos de la galerie à la famille, sans rien exiger
-- d'autre que le lien parent-enfant. Elle contournait donc le plafond de quatre photos de la v282 :
-- il suffisait d'appeler cette fonction pour parcourir les 110 photos filigranées sans avoir pris le
-- Pass. Personne ne l'appelait, donc personne n'en a profité — mais la porte était ouverte.
--
-- Elle exige désormais le même droit que l'aperçu net : le Pass payé (ou le staff). C'est cohérent
-- avec l'ordre voulu — on identifie APRÈS avoir acheté, pas avant.
--
-- Le résultat gagne `suggeree` : les photos où la reconnaissance a proposé ce joueur sans que la
-- famille ait tranché. C'est par elles que l'écran commence — proposer trois photos à confirmer vaut
-- mieux que d'en faire défiler cent dont on ne dit rien.
--
-- Idempotent.

drop function if exists public.media_galerie_a_identifier(uuid, uuid);

create or replace function public.media_galerie_a_identifier(p_album_id uuid, p_player_id uuid)
returns table (
  asset_id uuid, preview_path text, thumb_path text, preview_clair_path text,
  ordre integer, de_groupe boolean, mienne boolean, marquee_par_une_autre boolean,
  suggeree boolean
)
language plpgsql stable security definer
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

  -- L'enfant doit jouer dans l'équipe de la galerie : on ne montre pas les photos d'une équipe où
  -- il n'est pas.
  if not exists (
    select 1 from media_albums al
     where al.id = p_album_id
       and (al.team_id is null
            or exists (select 1 from team_memberships tm
                        where tm.team_id = al.team_id and tm.player_id = p_player_id
                          and tm.statut = 'active'))
  ) then
    return;
  end if;

  -- LE VERROU AJOUTÉ (v287). Sans lui, cette fonction servait les 110 photos d'une galerie à qui
  -- n'avait rien payé, et contournait le plafond de quatre de la v282.
  v_net := media_voit_sans_filigrane(p_album_id);
  if not v_net then
    return;
  end if;

  return query
  select a.id, a.preview_path, a.thumb_path, a.preview_clair_path,
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
end $function$;

revoke all on function public.media_galerie_a_identifier(uuid, uuid) from public;
grant execute on function public.media_galerie_a_identifier(uuid, uuid) to authenticated;
