-- Un aperçu qui ne porte pas le filigrane ne sort jamais en pleine taille.
--
-- SIGNALÉ PAR LE RESPONSABLE PRODUCTION (27/09/2026) : « le filigrane ne se met pas bien sur toutes
-- les photos des galeries ». Mesure : 31 photos sur 5 646 avaient `preview_watermarked = false`,
-- toutes du 14/09, dans deux galeries vendues par lien. Qui détenait le lien pouvait donc enregistrer
-- une photo PROPRE en pleine taille au lieu de l'acheter. Les photos sont le produit.
--
-- CE QUE CE TEST TIENT POUR VRAI :
--   1. Sans filigrane et sans droit : la galerie publique sert la VIGNETTE, jamais l'aperçu.
--   2. Avec filigrane : rien ne change, l'aperçu pleine taille sort normalement.
--   3. Le correctif s'effacera de lui-même : il suffit que le drapeau repasse à `true`.
--   4. Et il ne prive personne : l'acheteur reçoit l'ORIGINAL, pas l'aperçu.
--
-- N'ÉCRIT RIEN : le RAISE final annule la transaction.

do $$
declare
  v_club uuid; v_saison uuid; v_album uuid; v_lien uuid; v_slug text; v_token text;
  ph_marquee uuid; ph_nue uuid;
  e text[] := '{}'; v_preview text; v_thumb text; n int;
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  select id into v_saison from saisons where current_date between date_debut and date_fin;

  insert into clubs (nom, plan) values ('ZZ Club Filigrane','performance') returning id into v_club;
  insert into media_albums (club_id, saison_id, title, status, event_date, published_at)
    values (v_club, v_saison, 'ZZ Galerie Filigrane', 'published', current_date, now()) returning id into v_album;

  -- Une photo correctement marquee, une qui ne l'est pas.
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path,
                            preview_path, thumb_path, status, position, preview_watermarked)
    values (v_album, v_club,'photo','sportvision-media-prive','zz/f1.jpg','ap/f1-p.webp','ap/f1-t.webp','ready',1, true)
    returning id into ph_marquee;
  insert into media_assets (album_id, club_id, kind, storage_bucket, original_path,
                            preview_path, thumb_path, status, position, preview_watermarked)
    values (v_album, v_club,'photo','sportvision-media-prive','zz/f2.jpg','ap/f2-p.webp','ap/f2-t.webp','ready',2, false)
    returning id into ph_nue;

  insert into media_album_links (album_id, label, audience, is_enabled, slug, token)
    values (v_album, 'ZZ Lien', 'public', true, media_gallery_unique_slug('zz-galerie-filigrane'),
            encode(gen_random_bytes(16),'hex'))
    returning id, slug, token into v_lien, v_slug, v_token;

  -- ══ 1. SANS FILIGRANE : LA VIGNETTE, PAS L'APERÇU ════════════════════════
  perform set_config('role','anon',true);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  select x.preview_path, x.thumb_path into v_preview, v_thumb
    from media_gallery_photos(v_slug, v_token, null, 50, 0) x
   where x.id = ph_nue;
  if v_preview is null then
    e := e || 'la photo non filigranee ne sort plus du tout : la galerie afficherait une case vide'::text;
  elsif v_preview <> v_thumb then
    e := e || format('APERCU PLEINE TAILLE SERVI SANS FILIGRANE : %s', v_preview);
  end if;

  -- ══ 2. AVEC FILIGRANE : RIEN NE CHANGE ═══════════════════════════════════
  select x.preview_path, x.thumb_path into v_preview, v_thumb
    from media_gallery_photos(v_slug, v_token, null, 50, 0) x
   where x.id = ph_marquee;
  if v_preview = v_thumb then
    e := e || 'une photo correctement filigranee est degradee en vignette'::text;
  end if;
  if v_preview is distinct from 'ap/f1-p.webp' then
    e := e || format('l apercu marque n est pas servi tel quel : %s', coalesce(v_preview,'(null)')); end if;

  -- ══ 3. LE CORRECTIF S'EFFACE DE LUI-MÊME ═════════════════════════════════
  --
  -- Une fois l'apercu regenere depuis l'OS, le drapeau repasse a `true` et la pleine taille revient
  -- sans qu'on touche au code. C'est ce qui permet de poser ce garde-fou sans dette.
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  update media_assets set preview_watermarked = true where id = ph_nue;
  perform set_config('role','anon',true);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  select x.preview_path, x.thumb_path into v_preview, v_thumb
    from media_gallery_photos(v_slug, v_token, null, 50, 0) x
   where x.id = ph_nue;
  if v_preview = v_thumb then
    e := e || 'apres regeneration, la pleine taille ne revient pas'::text;
  end if;

  -- ══ 4. ET LA PRODUCTION NE DOIT PLUS AVOIR DE FUITE OUVERTE ══════════════
  perform set_config('role','postgres',true);
  select count(*) into n from media_assets x join media_albums a on a.id=x.album_id
   where x.status='ready' and a.status='published' and x.preview_watermarked is not true
     and a.id <> v_album;
  raise notice 'INFORMATIF : % photo(s) publiees attendent encore une regeneration de leur apercu', n;

  if cardinality(e) > 0 then
    raise exception 'ROUGE : %', array_to_string(e, ' | ');
  end if;
  raise exception 'VERT : sans filigrane on sert la vignette, avec filigrane rien ne change, et le garde-fou s efface apres regeneration';
end $$;
