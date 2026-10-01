-- UNE GALERIE D'ENTRAÎNEMENT NE DEMANDE AUCUN NUMÉRO DE MAILLOT (v390/v391, 01/10/2026)
--
-- Fouka : « comme ça les parents voient que c'est un entraînement, il n'y a pas de numéro à
-- renseigner, avec la reconnaissance par visage toujours. »
--
-- CE QUE CE TEST PROTÈGE, et pourquoi chaque ligne y est :
--
--   1. LE TYPE EST ÉCRIT, PUIS RELU. On relit la VALEUR, pas le nombre de lignes modifiées : un
--      déclencheur qui recopie une colonne ailleurs l'effacerait, et « 1 ligne modifiée » le
--      cacherait. C'est le piège trouvé le 01/10.
--   2. `galerie_numero_utile()` répond faux pour un entraînement et un stage, vrai pour un match, un
--      plateau, un tournoi — et VRAI QUAND LE TYPE N'EST PAS PRÉCISÉ. Ce dernier cas est le plus
--      important : les 57 galeries d'avant la v390 ne doivent rien changer de leur comportement.
--   3. LA FAMILLE LE REÇOIT. Pas la colonne de la table — `media_albums` n'est lisible que par le
--      staff — mais les deux colonnes que `media_gallery_open` rend au visiteur d'un lien, SANS
--      compte. C'est le seul chemin qui compte pour un parent.
--   4. UN TYPE INVENTÉ EST REFUSÉ PAR LA BASE. Sans la contrainte, une faute de frappe dans une
--      application écrirait 'entrainment', le numéro reviendrait, et personne ne le verrait.
--
-- N'ÉCRIT RIEN : le `raise` final annule toute la transaction, décor compris.

do $$
declare
  v_album uuid; v_slug text; v_jeton text;
  v_relu text; v_utile boolean; v_type_famille text; v_utile_famille boolean;
  -- Un contrôle, une ligne de rapport. Pas de « ok » global qu'on lirait de travers.
  rapport text := ''; echecs integer := 0;
begin
  insert into media_albums (title, status, published_at, event_date)
  values ('TEST v390 type de galerie', 'published', now(), current_date)
  returning id into v_album;

  v_slug := 'test-v390-' || replace(v_album::text, '-', '');
  insert into media_album_links (album_id, slug, label, audience, is_enabled)
  values (v_album, v_slug, 'Test v390', 'public', true)
  returning token into v_jeton;

  -- ── 1 et 2. LE TYPE, RELU, ET LA RÈGLE DU NUMÉRO ──────────────────────────────────────────────
  -- Le cas « non précisé » d'abord : c'est l'état des 57 galeries existantes.
  v_utile := public.galerie_numero_utile(v_album);
  if v_utile is not true then
    echecs := echecs + 1;
    rapport := rapport || format(E'ROUGE  type non précisé : numéro attendu utile, obtenu %s\n', v_utile);
  else
    rapport := rapport || E'ok     type non précisé : on demande le numéro, comme avant la v390\n';
  end if;

  for v_relu, v_utile in
    select * from (values ('match', true), ('plateau', true), ('tournoi', true), ('autre', true),
                          ('entrainement', false), ('stage', false)) as x(t, attendu)
  loop
    update media_albums set type_evenement = v_relu where id = v_album;
    -- ON RELIT LA VALEUR, pas le compte de lignes.
    declare v_en_base text; v_reponse boolean; begin
      select type_evenement into v_en_base from media_albums where id = v_album;
      v_reponse := public.galerie_numero_utile(v_album);
      if v_en_base is distinct from v_relu then
        echecs := echecs + 1;
        rapport := rapport || format(E'ROUGE  %s : écrit mais relu « %s »\n', v_relu, v_en_base);
      elsif v_reponse is distinct from v_utile then
        echecs := echecs + 1;
        rapport := rapport || format(E'ROUGE  %s : numéro utile attendu %s, obtenu %s\n', v_relu, v_utile, v_reponse);
      else
        rapport := rapport || format(E'ok     %s : relu juste, numéro utile = %s, libellé « %s »\n',
                                     v_relu, v_reponse, public.galerie_type_libelle(v_relu));
      end if;
    end;
  end loop;

  -- ── 3. CE QUE LA FAMILLE REÇOIT, SANS COMPTE, PAR LE LIEN ─────────────────────────────────────
  update media_albums set type_evenement = 'entrainement' where id = v_album;
  select type_evenement, numero_utile into v_type_famille, v_utile_famille
    from public.media_gallery_open(v_slug, v_jeton);
  if v_type_famille is distinct from 'entrainement' or v_utile_famille is not false then
    echecs := echecs + 1;
    rapport := rapport || format(E'ROUGE  media_gallery_open : type « %s », numéro utile %s\n',
                                 v_type_famille, v_utile_famille);
  else
    rapport := rapport || E'ok     media_gallery_open : la famille lit « entrainement » et aucun numéro à donner\n';
  end if;

  update media_albums set type_evenement = 'match' where id = v_album;
  select numero_utile into v_utile_famille from public.media_gallery_open(v_slug, v_jeton);
  if v_utile_famille is not true then
    echecs := echecs + 1;
    rapport := rapport || format(E'ROUGE  media_gallery_open sur un match : numéro utile %s\n', v_utile_famille);
  else
    rapport := rapport || E'ok     media_gallery_open sur un match : le numéro reste demandé\n';
  end if;

  -- ── 4. UN TYPE INVENTÉ EST REFUSÉ ─────────────────────────────────────────────────────────────
  declare refuse boolean := false; begin
    begin
      update media_albums set type_evenement = 'entrainment' where id = v_album;
    exception when check_violation then refuse := true;
    end;
    if refuse then
      rapport := rapport || E'ok     un type inventé est refusé par la contrainte\n';
    else
      echecs := echecs + 1;
      rapport := rapport || E'ROUGE  un type inventé a été accepté : la contrainte ne tient pas\n';
    end if;
  end;

  if echecs > 0 then
    raise exception E'ROUGE — galerie d''entraînement sans numéro\n%', rapport;
  end if;
  raise exception E'RAPPORT VERT — galerie d''entraînement sans numéro\n%', rapport;
end $$;
