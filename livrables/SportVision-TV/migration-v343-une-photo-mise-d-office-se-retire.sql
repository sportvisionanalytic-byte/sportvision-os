-- v343 — UNE PHOTO MISE D'OFFICE DOIT POUVOIR SE RETIRER (29/09/2026)
--
-- CE QUI CLOCHAIT. La v340 met les photos directement dans la galerie de la famille au lieu de les
-- proposer : c'est la demande de Fouka, et c'est juste. Mais `media_famille_marque` ne connaissait
-- que deux provenances — le marquage de la famille et la suggestion du moteur. Un marquage venu du
-- NUMÉRO tombait donc dans le dernier cas, celui du marquage posé par un humain du club, et la
-- famille lisait : « demandez-leur de le retirer. »
--
-- Autrement dit : on mettait une photo d'office dans sa galerie, et on lui refusait de l'enlever.
--
-- LE PRINCIPE, ET IL VAUT AU-DELÀ DE CE CAS. Plus on met de photos sans rien demander, plus le
-- geste de retrait doit être simple. Ce qu'une machine a posé, une famille le défait. Ce qu'un
-- humain du club a posé, elle en discute avec lui — ça, c'est inchangé.
--
-- Fouka, le 29/09 : « s'il propose trop de photos, un joueur peut cliquer sans faire exprès, et ça
-- peut retirer une photo à l'autre. » La crainte est juste dans son principe : un geste irréversible
-- au bout du doigt est dangereux. Un refus reste donc un `rejete` — jamais un effacement — et il ne
-- retire rien à personne d'autre : les marquages sont par sportif, la même photo appartient à tous
-- ceux qui y sont.
--
-- Idempotente.

begin;

create or replace function public.media_famille_marque(
  p_asset_id uuid, p_player_id uuid, p_cest_lui boolean)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare v_album uuid; v_existant uuid; v_source text;
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

  -- v309 : la famille répond partout où elle a le droit de LIRE, et nulle part ailleurs.
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

  -- Son propre marquage : elle le défait entièrement.
  if v_existant is not null and v_source = 'famille' then
    delete from media_player_tags where id = v_existant;
    return jsonb_build_object('marque', false);
  end if;

  -- CE QU'UNE MACHINE A POSÉ, UNE FAMILLE LE DÉFAIT. Une suggestion du moteur (v329) comme une
  -- photo entrée par le numéro de maillot (v340) : dans les deux cas, personne n'a regardé la photo
  -- avant de la mettre là. On marque `rejete` plutôt que d'effacer — le moteur rend la ligne
  -- existante sans la réécrire, donc le refus tient d'une passe à l'autre ; effacer ferait
  -- reproposer la même photo indéfiniment.
  if v_existant is not null and v_source in ('suggestion', 'numero') then
    update media_player_tags
       set statut = 'rejete', valide_par = auth.uid(), valide_le = now()
     where id = v_existant;
    return jsonb_build_object('marque', false, 'refuse', true);
  end if;

  -- Reste le marquage posé par un HUMAIN du club ou de SportVision : lui ne bouge pas.
  if v_existant is not null then
    raise exception 'Ce marquage a été posé par le club ou par SportVision : demandez-leur de le retirer.'
      using errcode = '42501';
  end if;
  return jsonb_build_object('marque', false);
end $f$;

comment on function public.media_famille_marque(uuid, uuid, boolean) is
  'v343 : la famille confirme ou retire. Ce qu''une machine a pose — suggestion du moteur ou numero de maillot — elle le defait ; ce qu''un humain du club a pose, elle en discute avec lui.';

commit;
