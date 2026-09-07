-- Migration : Galeries — devis sur une offre choisie, et sélection AVANT paiement
-- À exécuter APRÈS migration-galeries-v14-offres-multiples.sql.
--
-- ── Le renversement du 07/09 au soir ──
-- La v6 faisait choisir les photos APRÈS le paiement. Sur un tournoi de 500 photos, c'est
-- intenable : un parent ne paie pas 10 € sans avoir vérifié qu'il y a bien 15 photos de SON
-- enfant. Il choisit donc AVANT, et le prix ne bouge pas pendant qu'il choisit — c'est ça, une
-- formule.
--
-- media_gallery_order_select() n'est pas supprimée : les commandes déjà passées en pack
-- attendent encore leur sélection, et les casser pour faire propre serait leur faire perdre ce
-- qu'elles ont payé.
--
-- ── Ce que le serveur doit revérifier, quoi qu'envoie le navigateur ──
--   * l'offre appartient bien à CE lien (et pas à un autre, moins cher) ;
--   * elle est active, et son produit aussi ;
--   * le prix vient de la base, jamais de la requête ;
--   * le nombre de photos ne dépasse pas le quota ;
--   * chaque photo appartient bien à l'album et est publiable.
-- Un client qui poste sa propre requête ne doit pas pouvoir payer un pack de 15 et repartir
-- avec 200 originaux.

begin;

-- ── 1. Le devis, sur une offre précise ─────────────────────────────────────────────────────
drop function if exists media_gallery_quote(text, text, uuid[], text);

create function media_gallery_quote(
  p_slug text,
  p_token text,
  p_asset_ids uuid[] default null,
  p_password text default null,
  p_offer_id uuid default null
)
returns table (
  album_id uuid,
  club_id uuid,
  saison_id uuid,
  link_id uuid,
  offer_id uuid,
  product_id uuid,
  offer_type text,
  offer_name text,
  valid_asset_ids uuid[],
  photos_allowance integer,
  total_cents integer,
  currency text,
  lines jsonb,
  whole_album boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  o record;
  v_album media_albums;
  v_valid uuid[];
  v_count integer;
  b record;
  v_currency text;
begin
  select * into r from _media_gallery_resolve(p_slug, p_token, p_password);
  if r.raison is not null then return; end if;
  select * into v_album from media_albums where media_albums.id = r.album_id;

  -- L'offre demandée doit appartenir À CE LIEN. Sans cette jointure, il suffirait d'envoyer
  -- l'identifiant de l'offre à 10 € d'un autre lien pour obtenir la galerie au tarif du voisin.
  if p_offer_id is not null then
    select * into o from media_link_offers(r.link_id) where media_link_offers.offer_id = p_offer_id;
    if not found then return; end if;
  else
    -- Aucune offre demandée : lien à offre unique, ou lien hérité. On prend la seule qu'il y a.
    -- S'il y en a plusieurs, on ne devine pas laquelle il voulait.
    select count(*)::integer into v_count from media_link_offers(r.link_id);
    if v_count = 1 then
      select * into o from media_link_offers(r.link_id);
    elsif v_count > 1 then
      return;
    end if;
  end if;

  -- ── Modèle « formule » ────────────────────────────────────────────────────────────────
  if o.product_id is not null then
    if o.offer_type = 'album_complet' then
      -- Toutes les photos publiables AU MOMENT DE L'ACHAT. Une photo ajoutée après coup n'entre
      -- pas dans une commande déjà payée : sinon un album complété pendant des mois
      -- transformerait un achat de 50 € en abonnement à vie, que personne n'a vendu.
      select coalesce(array_agg(m.id), '{}') into v_valid
      from media_assets m where m.album_id = r.album_id and m.status = 'ready';
    else
      -- Pack : la sélection vient du visiteur, mais on ne garde que des photos réellement
      -- publiables de CET album. Une liste envoyée par le navigateur ne prouve rien.
      select coalesce(array_agg(m.id), '{}') into v_valid
      from media_assets m
      where m.album_id = r.album_id and m.status = 'ready'
        and m.id = any (coalesce(p_asset_ids, '{}'));

      v_count := coalesce(array_length(v_valid, 1), 0);
      -- Au-delà du quota, on ne rogne pas la sélection en silence : le visiteur croirait avoir
      -- acheté 20 photos et n'en recevrait que 15. On refuse, et l'écran le dit.
      if o.photos_allowance is not null and v_count > o.photos_allowance then return; end if;
      -- En dessous du quota, c'est permis : un parent qui ne trouve que 11 photos de son enfant
      -- sur un pack de 15 doit pouvoir acheter quand même. Le prix ne change pas.
      if v_count = 0 then return; end if;
    end if;

    return query select r.album_id, v_album.club_id, v_album.saison_id, r.link_id,
                        o.offer_id, o.product_id, o.offer_type, o.offer_name,
                        v_valid, o.photos_allowance, o.price_cents, o.currency,
                        jsonb_build_array(jsonb_build_object(
                          'product_id', o.product_id, 'name', o.offer_name, 'type', o.offer_type,
                          'quantity', 1, 'unit_price_cents', o.price_cents,
                          'covers_photos', coalesce(array_length(v_valid, 1), 0))),
                        (o.offer_type = 'album_complet');
    return;
  end if;

  -- ── Modèle historique : prix par combinaison sur une sélection ─────────────────────────
  -- Conservé tel quel pour les liens qui ne vendent aucune formule : ils existent encore.
  select coalesce(array_agg(m.id), '{}') into v_valid
  from media_assets m
  where m.album_id = r.album_id and m.status = 'ready' and m.id = any (coalesce(p_asset_ids, '{}'));

  v_count := coalesce(array_length(v_valid, 1), 0);
  if v_count = 0 then return; end if;

  select * into b from _media_gallery_best_price(r.album_id, v_count);
  if b.total_cents is null then return; end if;

  select p.currency into v_currency from media_products p
  where p.club_id = v_album.club_id and p.status = 'active' limit 1;

  return query select r.album_id, v_album.club_id, v_album.saison_id, r.link_id, null::uuid,
                      null::uuid, null::text, null::text, v_valid, null::integer, b.total_cents,
                      coalesce(v_currency, 'eur'), b.lines, b.whole_album;
end;
$$;

comment on function media_gallery_quote is
  'Prix d''une offre sur un lien. L''offre doit appartenir à ce lien, le prix vient de la base, le quota est revérifié. Le montant envoyé par le client, s''il y en a un, est ignoré : il n''est jamais lu.';

grant execute on function media_gallery_quote(text, text, uuid[], text, uuid) to anon, authenticated;

-- ── 2. L'aperçu : tout montrer par défaut ──────────────────────────────────────────────────
-- Renversement assumé de la v12. Sur un tournoi, le parent DOIT pouvoir parcourir les 500 photos
-- pour retrouver son enfant, sinon il n'achète rien. La colonne preview_limit reste utile pour un
-- lien qu'on ne veut pas exposer entièrement, mais null signifie désormais « tout ».
create or replace function _media_gallery_preview_limit(p_link_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (select l.preview_limit from media_album_links l where l.id = p_link_id);
$$;

comment on function _media_gallery_preview_limit is
  'Photos visibles avant achat sur ce lien. null = toutes. C''est le filigrane, cuit dans l''aperçu, qui protège — pas le fait d''en cacher.';

create or replace function media_gallery_photos(
  p_slug text,
  p_token text,
  p_password text default null,
  p_limit integer default 60,
  p_offset integer default 0
)
returns table (
  id uuid,
  thumb_path text,
  preview_path text,
  width integer,
  height integer,
  total bigint,
  visibles integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_max integer;
  v_debut integer;
  v_page integer;
begin
  select * into r from _media_gallery_resolve(p_slug, p_token, p_password);
  if r.raison is not null then return; end if;

  v_max := _media_gallery_preview_limit(r.link_id);
  v_debut := greatest(0, coalesce(p_offset, 0));
  v_page := greatest(1, least(coalesce(p_limit, 60), 200));

  -- Lien plafonné : on ne sert jamais au-delà, et une page qui commence après le plafond ne
  -- renvoie rien plutôt que de re-servir les premières.
  if v_max is not null then
    if v_debut >= v_max then return; end if;
    v_page := least(v_page, v_max - v_debut);
  end if;

  return query
  select m.id, m.thumb_path, m.preview_path, m.width, m.height,
         count(*) over () as total,
         v_max as visibles
  from media_assets m
  where m.album_id = r.album_id
    and m.status = 'ready'
    and m.thumb_path is not null
  order by m.position, m.created_at, m.id
  limit v_page
  offset v_debut;
end;
$$;

grant execute on function media_gallery_photos(text, text, text, integer, integer) to anon, authenticated;

-- ── 3. L'ouverture annonce TOUTES les offres ───────────────────────────────────────────────
drop function if exists media_gallery_open(text, text, text);

create function media_gallery_open(p_slug text, p_token text, p_password text default null)
returns table (
  valide boolean,
  raison text,
  album_id uuid,
  titre text,
  event_date date,
  club_nom text,
  equipe text,
  cover_url text,
  photo_count integer,
  mot_de_passe_requis boolean,
  livraison_externe boolean,
  watermark boolean,
  offres jsonb,
  apercu_limite integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_offres jsonb;
begin
  select * into r from _media_gallery_resolve(p_slug, p_token, p_password);

  if r.raison is not null then
    return query select false, r.raison, null::uuid, null::text, null::date, null::text, null::text,
                        null::text, null::integer, (r.raison = 'mot_de_passe'), null::boolean,
                        null::boolean, null::jsonb, null::integer;
    return;
  end if;

  -- Un tableau, éventuellement vide : la page distingue « ce lien ne vend rien » (galerie de
  -- consultation) de « ce lien vend trois formules », sans second appel.
  select coalesce(jsonb_agg(jsonb_build_object(
           'offer_id', x.offer_id,
           'product_id', x.product_id,
           'type', x.offer_type,
           'name', x.offer_name,
           'price_cents', x.price_cents,
           'currency', x.currency,
           'photos_allowance', x.photos_allowance,
           'featured', x.is_featured
         ) order by x.display_order, x.price_cents), '[]'::jsonb)
  into v_offres
  from media_link_offers(r.link_id) x;

  return query
  select true, null::text, a.id, a.title, a.event_date, c.nom, t.name, a.cover_preview_url,
         (select count(*)::integer from media_assets m where m.album_id = a.id and m.status = 'ready'),
         false,
         (a.secure_collection_ref is not null
          and not exists (select 1 from media_assets m where m.album_id = a.id and m.status = 'ready')),
         a.watermark_previews,
         v_offres,
         _media_gallery_preview_limit(r.link_id)
  from media_albums a
  left join clubs c on c.id = a.club_id
  left join club_teams t on t.id = a.team_id
  where a.id = r.album_id;
end;
$$;

comment on function media_gallery_open is
  'Ouvre une galerie publique. `offres` porte TOUTES les formules vendues par ce lien (tableau vide = galerie de consultation), `apercu_limite` le plafond de photos visibles avant achat (null = toutes).';

grant execute on function media_gallery_open(text, text, text) to anon, authenticated;

commit;
