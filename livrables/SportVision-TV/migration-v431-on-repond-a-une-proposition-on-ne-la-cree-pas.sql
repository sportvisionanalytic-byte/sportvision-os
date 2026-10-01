-- v431 — ON RÉPOND À UNE PROPOSITION, ON NE LA CRÉE PAS (01/10/2026)
--
-- Deux défauts du même geste : « c'est moi » / « ce n'est pas moi », sur une photo de galerie.
--
-- ═══ 1. LA FAMILLE POUVAIT SE MARQUER SUR N'IMPORTE QUELLE PHOTO DE LA GALERIE ════════════════
--
-- MESURÉ, par le chemin réel, avec le jeton de demo.joueur.fontainebleau (Pass payé) :
--
--     POST /rest/v1/rpc/media_famille_marque
--          { asset: une photo de la galerie qui ne lui a JAMAIS été proposée, cest_lui: true }
--     →  200 {"marque": true}
--
-- Et à partir de là, `media_photos_du_joueur` rend l'aperçu SANS FILIGRANE de cette photo : mesuré
-- 0 avant, 1 après, dans la même transaction. Une famille s'affirmait sur les 110 photos d'un match
-- et obtenait les 110 en clair — dont celles des autres enfants.
--
-- La règle, elle, était déjà écrite, dans `media_galerie_concerne_le_joueur` :
--
--     « La famille ne peut pas l'affirmer elle-même [...]. Elle répond à une proposition, elle ne
--       la crée pas. »
--
-- Le code faisait l'inverse : `if v_existant is null then insert`. Un commentaire n'est pas un
-- verrou. Désormais « c'est moi » ne fait que TRANCHER une ligne qui existe déjà — posée par la
-- reconnaissance (`suggestion`), par le numéro de maillot (`numero`), ou par un humain du club.
-- Rien à inventer, donc rien à revendiquer.
--
-- CE QUE ÇA NE CASSE PAS : l'écran de l'application ne propose à trancher que ce que la machine a
-- suggéré (`aTrancher = t.filter(x => x.suggeree && !x.mienne)`). Il n'a jamais envoyé « c'est
-- moi » sur autre chose. Ce chemin n'était ouvert qu'à qui appelle la base directement.
--
-- ═══ 2. « CE N'EST PAS MOI » NE RETIRAIT RIEN SUR UNE PHOTO DE GROUPE ═════════════════════════
--
-- Fouka : « le retrait doit être simple. »
--
-- Une photo de groupe entre dans les photos de la famille SANS marquage : c'est la v353, et c'est
-- voulu — le Pass donne les photos d'équipe. Pour l'en retirer, `media_photos_du_joueur` cherche un
-- marquage `rejete`. Or, sur une photo sans aucun marquage, cette fonction-ci ne faisait RIEN et
-- répondait `{"marque": false}` sans erreur. L'application affichait alors « Photo retirée de vos
-- photos »… et la photo revenait au rechargement suivant.
--
-- C'est un faux succès, exactement ce que la règle du 10/09 interdit : aucune action n'affiche
-- « succès » si la ligne n'a pas changé. Un refus sans marquage GRAVE désormais un `rejete`.
--
-- ROUGE AVANT / VERT APRÈS : livrables/SportVision-TV/tests/apercu-net-photo-par-photo.test.mjs

begin;

create or replace function public.media_famille_marque(
  p_asset_id uuid, p_player_id uuid, p_cest_lui boolean
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_album uuid; v_groupe boolean; v_existant uuid; v_source text; v_statut text;
begin
  if not (is_own_player(p_player_id) or is_confirmed_parent_of(p_player_id)) then
    raise exception 'Vous ne pouvez identifier que votre propre sportif.' using errcode = '42501';
  end if;

  select a.album_id, coalesce(a.photo_de_groupe, false) into v_album, v_groupe
    from media_assets a join media_albums al on al.id = a.album_id
   where a.id = p_asset_id and a.status = 'ready' and al.status = 'published';
  if v_album is null then
    raise exception 'Photo introuvable.' using errcode = '22023';
  end if;

  -- v309 : la famille répond partout où elle a le droit de LIRE, et nulle part ailleurs.
  if not public.media_galerie_concerne_le_joueur(v_album, p_player_id) then
    raise exception 'Cette galerie ne concerne pas votre sportif.' using errcode = '42501';
  end if;

  select id, source, statut into v_existant, v_source, v_statut from media_player_tags
   where media_ref_type = 'media_asset' and media_ref_id = p_asset_id and player_id = p_player_id;

  if p_cest_lui then
    -- v431 — ON RÉPOND À UNE PROPOSITION, ON NE LA CRÉE PAS.
    --
    -- Sans ce refus, une famille se marquait sur les 110 photos d'un match et obtenait les 110
    -- aperçus sans filigrane, dont ceux des autres enfants. Mesuré le 01/10/2026.
    --
    -- Ce qui autorise la réponse, c'est qu'une ligne existe déjà : la reconnaissance l'a proposée,
    -- le numéro de maillot l'a fait entrer, ou un humain l'a posée. Quelqu'un, ou quelque chose, a
    -- regardé la photo avant elle.
    if v_existant is null then
      raise exception 'Cette photo ne vous a pas été proposée : vous ne pouvez pas vous y identifier.'
        using errcode = '42501';
    end if;
    -- ET ON NE REVIENT PAS SUR SON PROPRE REFUS POUR EN FAIRE UNE REVENDICATION. Le seul marquage
    -- qu'une famille pose elle-même est le `rejete` d'une photo de GROUPE, ci-dessous. S'il porte
    -- sur autre chose, c'est que la ligne a été fabriquée pour contourner le refus d'au-dessus :
    -- la valider rouvrirait exactement le trou que cette migration ferme.
    if v_source = 'famille' and v_statut = 'rejete' and not v_groupe then
      raise exception 'Cette photo ne vous a pas été proposée : vous ne pouvez pas vous y identifier.'
        using errcode = '42501';
    end if;
    update media_player_tags
       set statut = 'valide', valide_par = auth.uid(), valide_le = now()
     where id = v_existant;
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

  -- v431 — AUCUN MARQUAGE, ET POURTANT LA PHOTO EST BIEN LÀ : C'EST UNE PHOTO DE GROUPE.
  --
  -- Le Pass donne les photos d'équipe sans marquage (v353). Pour en retirer une, la fonction de
  -- lecture cherche un `rejete` ; il n'y en avait aucun à poser, donc le retrait ne retirait rien
  -- et l'écran annonçait quand même « Photo retirée de vos photos ». Le refus se grave.
  --
  -- UNE PHOTO QUI N'EST NI MARQUÉE NI DE GROUPE N'EST PAS DANS SES PHOTOS : il n'y a rien à
  -- retirer, et on le DIT. Répondre « c'est fait » sur une ligne qu'on n'a pas touchée est
  -- exactement le faux succès interdit depuis le 10/09 — et graver un refus là-dessus donnerait à
  -- la famille une ligne à son nom sur une photo qu'on ne lui a jamais proposée.
  if not v_groupe then
    raise exception 'Cette photo n''est pas dans vos photos : il n''y a rien à en retirer.'
      using errcode = '42501';
  end if;

  insert into media_player_tags
    (media_ref_type, media_ref_id, player_id, tagged_by, source, statut, valide_par, valide_le)
  values ('media_asset', p_asset_id, p_player_id, auth.uid(), 'famille', 'rejete', auth.uid(), now());
  return jsonb_build_object('marque', false, 'refuse', true);
end $function$;

commit;
