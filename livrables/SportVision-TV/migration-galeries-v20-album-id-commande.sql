-- Migration : la page de commande doit pouvoir renvoyer vers LA galerie achetée
-- À exécuter APRÈS migration-galeries-v19-lien-clubplus.sql.
--
-- Un acheteur déjà connecté voit « Voir mes photos » plutôt que « Créer mon compte ». Pour
-- l'envoyer sur sa galerie et non sur la liste, il faut l'identifiant de l'album — que cette
-- fonction ne renvoyait pas.
--
-- La définition est reprise TELLE QU'ELLE EST DÉPLOYÉE, avec une seule colonne ajoutée : la
-- réécrire de mémoire risquerait de perdre des corrections déjà faites dessus (référence
-- `order_id` qualifiée, sous-requêtes qui survivent à un album supprimé).

begin;

drop function if exists media_gallery_order_summary(text);

CREATE OR REPLACE FUNCTION public.media_gallery_order_summary(p_token text)
 RETURNS TABLE(order_id uuid, album_id uuid, album_titre text, club_nom text, email text, total_cents integer, currency text, expires_at timestamp with time zone, expiree boolean, deja_rattachee boolean, photos_allowance integer, selection_faite boolean, photos jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  g record;
  o record;
  v_items integer;
begin
  select * into g from media_download_grants where token = p_token;
  if not found then return; end if;

  select * into o from media_orders where media_orders.id = g.order_id;
  if not found or o.status <> 'paid' then return; end if;

  -- `media_order_items.order_id` qualifie : `order_id` est aussi une colonne de sortie de cette
  -- fonction (RETURNS TABLE), et PL/pgSQL refuse la référence ambiguë.
  select count(*)::integer into v_items
  from media_order_items where media_order_items.order_id = o.id;

  -- Sous-requêtes plutôt qu'une jointure : l'album ou le club peuvent avoir été supprimés depuis
  -- l'achat, et une commande payée doit rester consultable dans tous les cas.
  return query
  select o.id,
         o.album_id,
         (select a.title from media_albums a where a.id = o.album_id),
         (select c.nom from clubs c where c.id = o.club_id),
         g.email, o.amount_cents, o.currency, g.expires_at,
         (g.expires_at < now() and g.claimed_by_user_id is null),
         (g.claimed_by_user_id is not null),
         o.photos_allowance,
         -- Une formule « N photos » non encore choisie : l'écran doit proposer de sélectionner
         -- plutôt que d'afficher une liste vide.
         (o.photos_allowance is null or v_items > 0),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', m.id, 'thumb_path', m.thumb_path, 'preview_path', m.preview_path,
                    'filename', coalesce(m.original_filename, 'photo.jpg')
                  ) order by m.position)
           from media_order_items oi join media_assets m on m.id = oi.asset_id
           where oi.order_id = o.id
         ), '[]'::jsonb);
end;
$function$;

grant execute on function media_gallery_order_summary(text) to anon, authenticated;

commit;
