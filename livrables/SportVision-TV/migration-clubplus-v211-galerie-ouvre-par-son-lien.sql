-- v211 — Une galerie s'ouvre par son lien de partage, plus par une référence jamais remplie
-- (13/09/2026).
--
-- CE QUI N'ALLAIT PAS. `media_album_get_link` vérifie correctement le droit d'accès, puis rend
-- `media_albums.secure_collection_ref`. Or cette colonne est NULL sur les TROIS albums de
-- production, et aucun écran de l'OS ne permet de la renseigner : une seule occurrence dans tout
-- le fichier, en lecture. Côté Connect, « pas de lien » est traité comme « pas de droit » : le
-- joueur lit « Accès indisponible pour le moment, contactez SportVision » — sur une galerie
-- publiée, à laquelle il a parfaitement droit.
--
-- Or le lien existe déjà, ailleurs : `media_album_links` porte le slug et le jeton du partage
-- public, et la galerie U9 du RCP en a un, actif. C'est ce lien qu'on sert.
--
-- L'ordre compte : une référence saisie à la main reste prioritaire, si elle existe un jour. Le
-- lien de partage est le repli, et il ne sert QUE si le droit a été accordé juste au-dessus — le
-- contrôle d'accès est inchangé.
-- Idempotente.

create or replace function public.media_album_get_link(p_album_id uuid)
returns text
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ref text;
  v_ok boolean;
  v_slug text;
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  v_ok := can_access_media(p_album_id);

  -- Journalise systématiquement, refus inclus (raise exception ferait rollback de cet
  -- insert avec le reste de l'appel — un accès refusé, notamment potentiellement abusif,
  -- doit rester tracé). NULL est le signal de refus pour l'appelant, jamais une exception.
  insert into media_link_access_log (album_id, user_id)
  values (p_album_id, auth.uid());

  if not v_ok then
    return null;
  end if;

  select secure_collection_ref into v_ref from media_albums where id = p_album_id;
  if v_ref is not null and btrim(v_ref) <> '' then
    return v_ref;
  end if;

  -- Repli : le lien de partage de la galerie, celui que le club envoie déjà aux familles.
  select l.slug, l.token into v_slug, v_token
    from media_album_links l
   where l.album_id = p_album_id and l.is_enabled
     and (l.expires_at is null or l.expires_at > now())
   order by l.created_at desc
   limit 1;

  if v_slug is null then
    return null;
  end if;

  return 'https://connect.sportvision-an.fr/gallery/' || v_slug || '?k=' || v_token;
end;
$function$;
