-- ═══════════════════════════════════════════════════════════════════════════════
-- LOT 1b — Lire et enregistrer une offre qui n'a pas de produit de catalogue
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- La v31 a rendu product_id facultatif. Deux fonctions le supposaient encore présent :
--
--   media_link_offers()  faisait un JOIN (et non un LEFT JOIN) sur media_products : une offre
--                        sans produit disparaissait purement et simplement de la galerie. Pire
--                        qu'une erreur : la galerie se serait affichée sans rien à vendre.
--
--   media_link_save()    refusait avec « album_introuvable » dès que l'album n'avait pas de club
--                        — un message faux — puis appelait media_link_type_product(club, type),
--                        qui crée une ligne de catalogue par club.
--
-- Aucune règle de prix ne change : l'offre prime, le catalogue sert de repli. C'est toujours
-- écrit ici et nulle part ailleurs.

-- ── Lecture des offres d'un lien ─────────────────────────────────────────────
create or replace function public.media_link_offers(p_link_id uuid)
returns table(offer_id uuid, link_id uuid, album_id uuid, product_id uuid, offer_type text,
              offer_name text, price_cents integer, currency text, photos_allowance integer,
              is_featured boolean, display_order integer, audience text)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  l record;
  v_n integer;
begin
  select * into l from media_album_links where id = p_link_id;
  if not found then return; end if;

  -- LEFT JOIN : une offre autonome (sans produit) compte autant qu'une offre adossée au
  -- catalogue. Un produit présent mais inactif disqualifie l'offre, comme avant.
  select count(*)::integer into v_n
  from media_album_link_offers o
  left join media_products p on p.id = o.product_id
  where o.link_id = p_link_id and o.is_enabled
    and (o.product_id is null or p.status = 'active');

  if v_n > 0 then
    return query
    select o.id, l.id, l.album_id, p.id,
           -- Le type vient de l'offre quand elle en porte un ; sinon du produit, comme avant.
           -- Dernier recours pour les offres anciennes : un quota vide décrit une galerie
           -- complète, un quota renseigné décrit un pack.
           coalesce(o.offer_type, p.type,
                    case when o.photos_allowance is null then 'album_complet' else 'pack' end),
           coalesce(o.label, p.name),
           -- LA règle de prix : l'offre prime, sinon le catalogue. Inchangée.
           coalesce(o.price_override_cents, p.price_cents),
           coalesce(p.currency, 'eur'),
           -- Une galerie complète n'a pas de quota : elle donne tout.
           case when coalesce(o.offer_type, p.type,
                              case when o.photos_allowance is null then 'album_complet' else 'pack' end)
                     = 'album_complet' then null
                else coalesce(o.photos_allowance, (p.metadata->>'photo_count')::integer) end,
           o.is_featured, o.display_order, l.audience
    from media_album_link_offers o
    left join media_products p on p.id = o.product_id
    where o.link_id = p_link_id and o.is_enabled
      and (o.product_id is null or p.status = 'active')
    order by o.display_order, coalesce(o.price_override_cents, p.price_cents);
    return;
  end if;

  -- ── Repli : lien d'avant ce lot, qui porte encore son produit en direct ──
  -- On ne le migre pas, on le présente. Aucun lien déjà envoyé à des familles ne cesse de
  -- fonctionner, et aucune donnée n'est réécrite.
  if l.product_id is null then return; end if;

  return query
  select null::uuid, l.id, l.album_id, p.id, p.type, p.name,
         coalesce(l.price_override_cents, p.price_cents),
         p.currency,
         case when p.type = 'album_complet' then null
              else (p.metadata->>'photo_count')::integer end,
         true, 0, l.audience
  from media_products p
  where p.id = l.product_id and p.status = 'active';
end;
$function$;
