-- v329 — « Non, ce n'est pas moi » était refusé (28/09/2026).
--
-- CE QUE FOUKA A VU. « Ça a mis : est-ce que c'est bien vous ? Et j'ai mis : non, c'est pas moi.
-- Ça a mis : votre réponse n'a pas pu être enregistrée. »
--
-- LE DÉFAUT. `media_famille_marque` ne laissait la famille retirer QUE ses propres marquages
-- (`source = 'famille'`). Face à une suggestion de la machine — `source = 'suggestion'`, la seule
-- chose que cet écran affiche ! — elle tombait dans la branche « ce marquage a été posé par le
-- club ou par SportVision : demandez-leur de le retirer », et l'app n'avait plus qu'à dire que ça
-- n'avait pas marché.
--
-- Autrement dit : l'écran demandait « est-ce bien vous ? » en n'acceptant qu'une seule des deux
-- réponses. La moitié du geste était impossible, et c'est la moitié qui protège — celle qui dit à
-- la machine qu'elle s'est trompée.
--
-- LA RÈGLE, MAINTENANT. Une famille tranche sur ce que la MACHINE propose, dans les deux sens. Elle
-- ne défait toujours pas le travail d'un HUMAIN : un marquage posé par le club ou par SportVision
-- (`source = 'humain'`) reste, et le message d'alors garde tout son sens.
--
-- ON NE SUPPRIME PAS, ON REFUSE. La ligne passe en `statut = 'rejete'` au lieu d'être effacée, et
-- c'est essentiel : `marquer_par_reconnaissance` rend la ligne existante sans rien réécrire, donc
-- un refus tient. Supprimer aurait laissé le moteur reproposer la même photo à la passe suivante,
-- la famille aurait redit non, et ainsi de suite. Un refus est une information, pas un vide.

create or replace function public.media_famille_marque(
  p_asset_id uuid, p_player_id uuid, p_cest_lui boolean)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_album uuid;
  v_existant uuid;
  v_source text;
begin
  if not (is_own_player(p_player_id) or is_confirmed_parent_of(p_player_id)) then
    raise exception 'Vous ne pouvez identifier que votre propre sportif.' using errcode = '42501';
  end if;

  select a.album_id into v_album
    from media_assets a join media_albums al on al.id = a.album_id
   where a.id = p_asset_id and a.status = 'ready' and al.status = 'published';
  if v_album is null then
    raise exception 'Photo introuvable.' using errcode = '22023';
  end if;

  -- v309 : la famille peut repondre partout ou elle a le droit de LIRE, et nulle part ailleurs. La
  -- meme regle que sa liste et que ses photos, donc une seule ecriture (media_galerie_concerne_le_joueur) :
  -- son equipe, ou une galerie ou sa presence a deja ete constatee par un humain ou par la
  -- reconnaissance. Un enfant surclasse peut ainsi confirmer ses photos d'un match U16.
  if not public.media_galerie_concerne_le_joueur(v_album, p_player_id) then
    raise exception 'Cette galerie ne concerne pas votre sportif.' using errcode = '42501';
  end if;

  select id, source into v_existant, v_source from media_player_tags
   where media_ref_type = 'media_asset' and media_ref_id = p_asset_id and player_id = p_player_id;

  if p_cest_lui then
    if v_existant is null then
      insert into media_player_tags (media_ref_type, media_ref_id, player_id, tagged_by, source, statut, valide_par, valide_le)
      values ('media_asset', p_asset_id, p_player_id, auth.uid(), 'famille', 'valide', auth.uid(), now());
    else
      update media_player_tags
         set statut = 'valide', valide_par = auth.uid(), valide_le = now()
       where id = v_existant;
    end if;
    return jsonb_build_object('marque', true);
  end if;

  -- Son propre marquage : elle le défait entièrement, comme avant.
  if v_existant is not null and v_source = 'famille' then
    delete from media_player_tags where id = v_existant;
    return jsonb_build_object('marque', false);
  end if;

  -- v329 — UNE SUGGESTION DE LA MACHINE SE REFUSE. C'est tout l'objet de l'écran. On la marque
  -- `rejete` plutôt que de l'effacer : le moteur rend la ligne existante sans la réécrire, donc le
  -- refus tient d'une passe à l'autre. Effacer aurait fait reproposer la même photo indéfiniment.
  if v_existant is not null and v_source = 'suggestion' then
    update media_player_tags
       set statut = 'rejete', valide_par = auth.uid(), valide_le = now()
     where id = v_existant;
    return jsonb_build_object('marque', false, 'refuse', true);
  end if;

  -- Reste le marquage pose par un HUMAIN du club ou de SportVision : lui ne bouge pas.
  if v_existant is not null then
    raise exception 'Ce marquage a été posé par le club ou par SportVision : demandez-leur de le retirer.'
      using errcode = '42501';
  end if;
  return jsonb_build_object('marque', false);
end $function$;
