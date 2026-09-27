-- v314b — 27/09/2026 : le barème doit pouvoir s'appliquer quand personne n'est connecté
--
-- DÉFAUT TROUVÉ EN ÉPROUVANT LA v314, avant toute mise en service. `media_appliquer_bareme` exige
-- `media_pricing_staff()` — c'est juste pour un geste humain, ça ne l'est pas pour le déclenchement
-- automatique à la publication : une galerie publiée par une tâche serveur n'a pas d'`auth.uid()`,
-- donc le garde refuse et la galerie sort SANS AUCUNE OFFRE. Exactement le défaut que le barème
-- devait supprimer.
--
-- Le cas n'est pas théorique : `galeries_suivent_la_mission` (v277) publie les galeries d'une mission
-- au passage en « livrée », et ce passage peut venir d'un automate.
--
-- DEUX CHEMINS, DEUX RÈGLES, et c'est la bonne façon de le dire :
--   media_appliquer_bareme()          le geste HUMAIN, réservé à qui fixe les tarifs
--   bareme_poser_offres()             le geste SYSTÈME, sans garde, appelé par le seul trigger
--
-- La seconde n'est donnée à personne (aucun grant) : elle n'est atteignable que depuis le trigger,
-- qui s'exécute avec les droits du propriétaire. Un garde retiré doit toujours s'accompagner d'une
-- porte fermée ailleurs, sinon on a juste ouvert un trou.
--
-- Idempotent.

create or replace function public.bareme_poser_offres(p_album_id uuid, p_acteur uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare
  v_album media_albums; v_b media_bareme_galerie; v_lien record; v_poses integer := 0; v_sautes integer := 0;
begin
  select * into v_album from media_albums where id = p_album_id;
  if v_album.id is null then return jsonb_build_object('applique', false, 'raison', 'galerie introuvable'); end if;

  select * into v_b from media_bareme_pour(v_album.photo_count);
  if v_b.id is null then
    return jsonb_build_object('applique', false, 'raison', 'aucune tranche pour ' || coalesce(v_album.photo_count,0) || ' photos');
  end if;
  if v_b.prix_galerie_cents = 0 then
    return jsonb_build_object('applique', false, 'raison', 'galerie gratuite (' || coalesce(v_album.photo_count,0) || ' photos)',
                              'tranche', v_b.photos_min || '-' || coalesce(v_b.photos_max::text,'+'));
  end if;

  for v_lien in select l.id from media_album_links l where l.album_id = p_album_id loop
    if exists (select 1 from media_album_link_offers o where o.link_id = v_lien.id) then
      v_sautes := v_sautes + 1;
      continue;
    end if;
    insert into media_album_link_offers (link_id, offer_type, price_override_cents, photos_allowance,
                                         label, display_order, is_featured, created_by)
    values (v_lien.id, 'album_complet', v_b.prix_galerie_cents, null, 'Toute la galerie', 1, true, p_acteur);
    if v_b.pack_photos is not null then
      insert into media_album_link_offers (link_id, offer_type, price_override_cents, photos_allowance,
                                           label, display_order, is_featured, created_by)
      values (v_lien.id, 'pack', v_b.pack_prix_cents, v_b.pack_photos,
              v_b.pack_photos || ' photos', 0, false, p_acteur);
    end if;
    v_poses := v_poses + 1;
  end loop;

  return jsonb_build_object('applique', v_poses > 0, 'liens_servis', v_poses, 'liens_sautes', v_sautes,
    'photos', v_album.photo_count,
    'tranche', v_b.photos_min || '-' || coalesce(v_b.photos_max::text,'+'),
    'prix_galerie', v_b.prix_galerie_cents / 100.0,
    'pack', case when v_b.pack_photos is null then null
                 else v_b.pack_photos || ' photos pour ' || (v_b.pack_prix_cents/100.0) || ' EUR' end);
end $f$;

-- Le geste humain garde son controle et delegue le travail.
create or replace function public.media_appliquer_bareme(p_album_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $f$
begin
  if not media_pricing_staff() then
    raise exception 'Les tarifs d''une galerie se posent par SportVision.' using errcode = '42501';
  end if;
  return public.bareme_poser_offres(p_album_id, auth.uid());
end $f$;

create or replace function public.bareme_a_la_publication()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $f$
begin
  if new.status = 'published' and coalesce(old.status,'') <> 'published' then
    -- Jamais bloquant : une galerie se publie meme si le bareme echoue.
    begin
      perform public.bareme_poser_offres(new.id, auth.uid());
    exception when others then null;
    end;
  end if;
  return new;
end $f$;

-- Le geste systeme n'est donne a personne : il n'est atteignable que par le trigger.
revoke all on function public.bareme_poser_offres(uuid, uuid) from public, anon, authenticated;
