-- Une galerie totalement autonome : aucun club, aucune saison, aucune équipe.
--
-- C'est le scénario §31 du cahier des charges : « Tournoi U12 — Sens », structure externe
-- « FC Sens U12 », aucun club SportVision. Tout doit fonctionner — photos, offres, lien, devis.
--
-- Le test s'exécute dans une transaction annulée à la fin : il ne laisse aucune donnée.

begin;

do $$
declare
  v_album uuid; v_asset uuid; v_link uuid; v_offre1 uuid; v_offre2 uuid;
  v_slug text; v_token text;
  v_n integer; v_prix integer; v_type text; v_nom text; v_quota integer;
  v_echecs text[] := '{}';
  procedure_ok boolean;
begin
  -- ── 1. Créer la galerie sans le moindre rattachement ───────────────────────
  insert into media_albums (title, structure_externe, event_date, status, photo_count)
  values ('Tournoi U12 — Sens', 'FC Sens U12', current_date, 'draft', 0)
  returning id into v_album;

  if v_album is null then v_echecs := v_echecs || 'creation galerie sans club impossible'::text; end if;

  -- ── 2. Y verser une photo (le déclencheur ne doit plus crier « Album introuvable ») ──
  begin
    insert into media_assets (album_id, original_path, status, original_filename)
    values (v_album, 'media/'||v_album||'/test.jpg', 'ready', 'test.jpg')
    returning id into v_asset;
  exception when others then
    v_echecs := v_echecs || ('photo refusee : '||sqlerrm);
  end;

  if v_asset is not null then
    perform 1 from media_assets where id = v_asset and club_id is null;
    if not found then v_echecs := v_echecs || 'la photo a recu un club alors que la galerie n en a pas'::text; end if;
  end if;

  -- ── 3. Un lien de vente ────────────────────────────────────────────────────
  insert into media_album_links (album_id, slug, label, is_enabled)
  values (v_album, media_gallery_unique_slug('tournoi-u12-sens'), 'Lien principal', true)
  returning id, slug, token into v_link, v_slug, v_token;

  -- ── 4. Deux offres SANS produit de catalogue ───────────────────────────────
  begin
    insert into media_album_link_offers (link_id, offer_type, label, photos_allowance, price_override_cents, display_order, is_enabled)
    values (v_link, 'pack', '15 photos', 15, 1000, 1, true) returning id into v_offre1;
    insert into media_album_link_offers (link_id, offer_type, label, photos_allowance, price_override_cents, display_order, is_enabled)
    values (v_link, 'album_complet', 'Toutes les photos', null, 4000, 2, true) returning id into v_offre2;
  exception when others then
    v_echecs := v_echecs || ('offre sans produit refusee : '||sqlerrm);
  end;

  -- ── 5. Les offres se lisent-elles ? ────────────────────────────────────────
  select count(*)::integer into v_n from media_link_offers(v_link);
  if v_n <> 2 then v_echecs := v_echecs || ('media_link_offers renvoie '||v_n||' offre(s) au lieu de 2'); end if;

  select offer_name, offer_type, price_cents, photos_allowance
    into v_nom, v_type, v_prix, v_quota
  from media_link_offers(v_link) where offer_type = 'pack';
  if coalesce(v_prix,-1) <> 1000 then v_echecs := v_echecs || ('prix du pack = '||coalesce(v_prix,-1)||' au lieu de 1000'); end if;
  if coalesce(v_quota,-1) <> 15   then v_echecs := v_echecs || ('quota du pack = '||coalesce(v_quota,-1)||' au lieu de 15'); end if;
  if coalesce(v_nom,'')  <> '15 photos' then v_echecs := v_echecs || ('nom du pack = '||coalesce(v_nom,'(vide)')); end if;

  select photos_allowance into v_quota from media_link_offers(v_link) where offer_type = 'album_complet';
  if v_quota is not null then v_echecs := v_echecs || 'la galerie complete ne doit pas avoir de quota'::text; end if;

  -- ── 6. Brouillon : le lien ne doit RIEN donner ─────────────────────────────
  -- Contrairement a ce que j'avais d'abord conclu, le statut de l'album gouverne bien l'acces :
  -- _media_gallery_resolve refuse avec « non_publie ». La verification n'est pas dans
  -- media_gallery_open mais dans le resolveur qu'il appelle.
  -- media_gallery_open renvoie TOUJOURS une ligne : `valide` dit si l'acces est accorde, et
  -- `raison` explique le refus, pour que la page publique puisse l'annoncer au visiteur au lieu
  -- de rester blanche. On regarde donc `valide`, pas le nombre de lignes.
  select valide into procedure_ok from media_gallery_open(v_slug, v_token, null);
  if coalesce(procedure_ok, true) then
    v_echecs := v_echecs || 'une galerie en brouillon ne doit pas etre accessible au public'::text;
  end if;

  select raison into v_type from _media_gallery_resolve(v_slug, v_token, null);
  if coalesce(v_type,'') <> 'non_publie' then
    v_echecs := v_echecs || ('brouillon : raison = '||coalesce(v_type,'(aucune)')||' au lieu de non_publie');
  end if;

  -- ── 6b. En ligne : le lien repond ──────────────────────────────────────────
  update media_albums set status = 'published', published_at = now() where id = v_album;

  select valide into procedure_ok from media_gallery_open(v_slug, v_token, null);
  if not coalesce(procedure_ok, false) then
    v_echecs := v_echecs || 'la galerie mise en ligne devrait etre accessible'::text;
  end if;

  -- ── 6c. Lien desactive : plus d'acces, meme galerie en ligne ───────────────
  update media_album_links set is_enabled = false where id = v_link;
  select raison into v_type from _media_gallery_resolve(v_slug, v_token, null);
  if coalesce(v_type,'') <> 'desactive' then
    v_echecs := v_echecs || ('lien desactive : raison = '||coalesce(v_type,'(aucune)')||' au lieu de desactive');
  end if;
  update media_album_links set is_enabled = true where id = v_link;

  -- ── 7. Le devis se calcule-t-il sans club ? ────────────────────────────────
  -- Un pack se chiffre sur une SELECTION : passer une liste vide ne doit rien renvoyer, et c'est
  -- le comportement voulu (un acheteur qui n'a rien choisi n'a rien a payer). On envoie donc la
  -- photo de la galerie.
  begin
    select total_cents into v_prix
    from media_gallery_quote(v_slug, v_token, array[v_asset], null, v_offre1);
    if coalesce(v_prix,-1) <> 1000 then
      v_echecs := v_echecs || ('devis pack = '||coalesce(v_prix,-1)||' au lieu de 1000');
    end if;
  exception when others then
    v_echecs := v_echecs || ('devis pack impossible : '||sqlerrm);
  end;

  -- Une galerie complete ne demande aucune selection : elle donne tout.
  begin
    select total_cents into v_prix
    from media_gallery_quote(v_slug, v_token, null, null, v_offre2);
    if coalesce(v_prix,-1) <> 4000 then
      v_echecs := v_echecs || ('devis galerie complete = '||coalesce(v_prix,-1)||' au lieu de 4000');
    end if;
  exception when others then
    v_echecs := v_echecs || ('devis galerie complete impossible : '||sqlerrm);
  end;

  -- Et un pack sans selection ne doit RIEN renvoyer, pas une erreur.
  select count(*)::integer into v_n
  from media_gallery_quote(v_slug, v_token, null, null, v_offre1);
  if v_n <> 0 then v_echecs := v_echecs || 'un pack sans photo choisie ne doit rien chiffrer'::text; end if;

  -- ── Verdict ────────────────────────────────────────────────────────────────
  if array_length(v_echecs,1) is null then
    raise notice 'OK — galerie autonome : creation, photo, lien, offres sans produit, ouverture publique et devis fonctionnent sans club ni saison ni equipe.';
  else
    raise exception E'ECHECS :\n  - %', array_to_string(v_echecs, E'\n  - ');
  end if;
end $$;

-- Le bloc ci-dessus leve une exception au moindre echec. Arriver ici signifie que tout est passe,
-- et cette ligne le dit explicitement : l'API d'administration ne renvoie pas les notices.
select 'OK — galerie autonome : creation, photo, lien, offres sans produit, statuts brouillon/en ligne/lien desactive, devis pack et galerie complete. Aucun club, aucune saison, aucune equipe.' as verdict;

rollback;
