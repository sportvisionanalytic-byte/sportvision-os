-- Migration : Galeries SportVision — checkout invité (Lot 3)
-- À exécuter APRÈS migration-galeries-v3-publique.sql.
--
-- ── Pourquoi le calcul du prix descend en base ──
-- La galerie publique calculait jusqu'ici la meilleure combinaison de produits dans le navigateur
-- (src/lib/gallery/pricing.ts). C'était bien pour afficher, c'est inacceptable pour encaisser :
-- un client qui poste sa propre requête au checkout choisirait son prix.
--
-- La règle de ce lot : le PRIX EST CALCULÉ EN BASE, une seule fois, et personne d'autre ne le
-- calcule. Le navigateur ne fait plus d'arithmétique commerciale — il lit une grille tarifaire
-- pré-calculée (media_gallery_price_ladder) pour afficher un total instantanément au doigt, et la
-- fonction de paiement recalcule tout depuis les mêmes règles (media_gallery_quote) sans jamais
-- lire le moindre montant venu du client.
--
-- C'est la même exigence que le moteur média du 02/09 : un seul moteur, jamais deux implémentations
-- d'une règle commerciale.
--
-- ── Pourquoi un « droit de téléchargement » et pas un media_entitlements ──
-- media_entitlements.beneficiary_person_id est NOT NULL : un droit y désigne toujours un joueur.
-- Un parent qui achète trois photos depuis un lien WhatsApp n'est rattaché à aucun joueur connu,
-- et lui en inventer un serait exactement le genre de donnée fausse qu'on refuse d'écrire.
-- media_download_grants (posé au Lot 0) porte donc le droit : temporaire pour un invité, rendu
-- permanent quand il crée son compte Connect. can_access_media() n'est pas touchée.

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. LE MOTEUR DE PRIX, EN BASE
-- ═══════════════════════════════════════════════════════════════════════════
-- Programmation dynamique : coût(n) = min( coût(n-1) + prix unitaire ; pour chaque pack de taille
-- k : coût(max(0,n-k)) + prix du pack ). Un pack peut « déborder » volontairement — acheter un
-- pack de 5 pour 4 photos est la bonne réponse s'il coûte moins que 4 photos à l'unité, et c'est
-- ce qu'un client attend. L'album complet plafonne le tout.
create or replace function _media_gallery_best_price(p_album_id uuid, p_count integer)
returns table (total_cents integer, lines jsonb, whole_album boolean, baseline_cents integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_album media_albums;
  INF constant integer := 2147483647;
  -- Catalogue en mémoire plutôt qu'en table temporaire : créer une table est une écriture, ce qui
  -- contredit le `stable` de cette fonction et lui interdirait de tourner dans une transaction en
  -- lecture seule. Un club a quelques produits, pas quelques milliers.
  prod_ids uuid[] := '{}';
  prod_names text[] := '{}';
  prod_types text[] := '{}';
  prod_prices integer[] := '{}';
  prod_packs integer[] := '{}';
  v_unit_ix integer := null;
  v_whole_ix integer := null;
  r record;
  i integer;
  cost integer[];
  from_n integer[];
  pick integer[];
  n integer;
  best integer;
  best_from integer;
  best_ix integer;
  candidate integer;
  v_lines jsonb := '[]'::jsonb;
  qty integer[];
  cov integer[];
  v_baseline integer;
  v_total_photos integer;
begin
  if p_count is null or p_count <= 0 then
    return;
  end if;

  select * into v_album from media_albums where media_albums.id = p_album_id;
  if not found then return; end if;

  select count(*)::integer into v_total_photos
  from media_assets where album_id = p_album_id and status = 'ready';

  -- Produits applicables : mêmes règles de portée, de saison et de validité que
  -- media_gallery_products. Un pack sans taille configurée est exclu ici aussi — mieux vaut ne pas
  -- le vendre que l'appliquer sur un nombre de photos inventé.
  for r in
    select p.id, p.name, p.type, p.price_cents, media_product_pack_size(p.metadata, p.type) as pack
    from media_products p
    where p.club_id = v_album.club_id
      and p.status = 'active'
      and (p.saison_id is null or v_album.saison_id is null or p.saison_id = v_album.saison_id)
      and (p.valid_from is null or p.valid_from <= current_date)
      and (p.valid_until is null or p.valid_until >= current_date)
      and (
        case
          when v_album.override_product_ids is not null and array_length(v_album.override_product_ids, 1) > 0
            then p.id = any (v_album.override_product_ids)
          else p.scope_type = 'club'
            or (p.scope_type = 'team' and v_album.team_id is not null and v_album.team_id = any (p.team_ids))
            or (p.scope_type = 'event' and v_album.event_id is not null)
        end
      )
      and (p.type <> 'pack' or media_product_pack_size(p.metadata, p.type) is not null)
    order by p.price_cents
  loop
    prod_ids := prod_ids || r.id;
    prod_names := prod_names || r.name;
    prod_types := prod_types || r.type;
    prod_prices := prod_prices || r.price_cents;
    prod_packs := prod_packs || coalesce(r.pack, 0);
    i := array_length(prod_ids, 1);
    if r.type = 'photo_unite' and v_unit_ix is null then v_unit_ix := i; end if;
    if r.type = 'album_complet' and v_whole_ix is null then v_whole_ix := i; end if;
  end loop;

  if array_length(prod_ids, 1) is null then return; end if;

  v_baseline := case when v_unit_ix is not null then prod_prices[v_unit_ix] * p_count else null end;

  -- Index 1 = 0 photo : les tableaux PostgreSQL commencent à 1.
  cost := array_fill(INF, array[p_count + 1]);
  from_n := array_fill(0, array[p_count + 1]);
  pick := array_fill(0, array[p_count + 1]);
  cost[1] := 0;

  for n in 1..p_count loop
    best := INF; best_from := 0; best_ix := 0;
    if v_unit_ix is not null and cost[n] < INF then
      candidate := cost[n] + prod_prices[v_unit_ix];
      if candidate < best then best := candidate; best_from := n - 1; best_ix := v_unit_ix; end if;
    end if;
    for i in 1..array_length(prod_ids, 1) loop
      if prod_types[i] = 'pack' and prod_packs[i] > 0 then
        candidate := cost[greatest(0, n - prod_packs[i]) + 1];
        if candidate < INF then
          candidate := candidate + prod_prices[i];
          -- `<` strict : à prix égal on garde la solution déjà trouvée, qui utilise le plus petit
          -- produit. Un client préfère « 1 photo » à « pack de 10 » pour le même montant.
          if candidate < best then
            best := candidate; best_from := greatest(0, n - prod_packs[i]); best_ix := i;
          end if;
        end if;
      end if;
    end loop;
    cost[n + 1] := best; from_n[n + 1] := best_from; pick[n + 1] := best_ix;
  end loop;

  -- L'album complet plafonne : s'il couvre tout pour moins cher, c'est lui la bonne réponse, même
  -- si le client n'a sélectionné qu'une partie des photos.
  if v_whole_ix is not null and (cost[p_count + 1] = INF or prod_prices[v_whole_ix] < cost[p_count + 1]) then
    return query select
      prod_prices[v_whole_ix],
      jsonb_build_array(jsonb_build_object(
        'product_id', prod_ids[v_whole_ix], 'name', prod_names[v_whole_ix], 'type', 'album_complet',
        'quantity', 1, 'unit_price_cents', prod_prices[v_whole_ix], 'covers_photos', v_total_photos)),
      true,
      v_baseline;
    return;
  end if;

  if cost[p_count + 1] = INF then
    return; -- aucune combinaison possible : galerie non vendable à la photo
  end if;

  -- Remontée du chemin optimal.
  qty := array_fill(0, array[array_length(prod_ids, 1)]);
  cov := array_fill(0, array[array_length(prod_ids, 1)]);
  n := p_count;
  while n > 0 and pick[n + 1] > 0 loop
    i := pick[n + 1];
    qty[i] := qty[i] + 1;
    cov[i] := cov[i] + (n - from_n[n + 1]);
    n := from_n[n + 1];
  end loop;

  -- Alias `ix` et non `i` : `i` est aussi une variable PL/pgSQL de cette fonction, et Postgres
  -- refuse la reference ambigue.
  select coalesce(jsonb_agg(x.line order by x.price desc), '[]'::jsonb) into v_lines
  from (
    select prod_prices[ix] as price,
           jsonb_build_object(
             'product_id', prod_ids[ix], 'name', prod_names[ix], 'type', prod_types[ix],
             'quantity', qty[ix], 'unit_price_cents', prod_prices[ix], 'covers_photos', cov[ix]
           ) as line
    from generate_subscripts(prod_ids, 1) as ix
    where qty[ix] > 0
  ) x;

  return query select cost[p_count + 1], v_lines, false, v_baseline;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. GRILLE TARIFAIRE POUR L'AFFICHAGE
-- ═══════════════════════════════════════════════════════════════════════════
-- Le navigateur ne calcule plus rien : il reçoit à l'ouverture le coût pour 1, 2, 3… photos et
-- lit la ligne correspondant à sa sélection. Affichage instantané au doigt, sans aller-retour à
-- chaque case cochée, et surtout sans deuxième implémentation de la règle commerciale.
create or replace function media_gallery_price_ladder(p_slug text, p_token text, p_password text default null)
returns table (photos integer, total_cents integer, lines jsonb, whole_album boolean, baseline_cents integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_max integer;
  i integer;
begin
  select * into r from _media_gallery_resolve(p_slug, p_token, p_password);
  if r.raison is not null then return; end if;

  select count(*)::integer into v_max from media_assets where album_id = r.album_id and status = 'ready';
  if v_max is null or v_max = 0 then return; end if;

  for i in 1..v_max loop
    return query select i, b.total_cents, b.lines, b.whole_album, b.baseline_cents
                 from _media_gallery_best_price(r.album_id, i) b;
  end loop;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. DEVIS FERME — la seule source du montant encaissé
-- ═══════════════════════════════════════════════════════════════════════════
-- Appelée par la fonction de paiement, jamais par le navigateur. Elle revalide que chaque photo
-- appartient bien à cette galerie et est bien publiable : une liste d'identifiants venue du client
-- ne prouve rien.
create or replace function media_gallery_quote(
  p_slug text,
  p_token text,
  p_asset_ids uuid[],
  p_password text default null
)
returns table (
  album_id uuid,
  club_id uuid,
  saison_id uuid,
  valid_asset_ids uuid[],
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
  v_album media_albums;
  v_valid uuid[];
  v_count integer;
  b record;
  v_currency text;
begin
  select * into r from _media_gallery_resolve(p_slug, p_token, p_password);
  if r.raison is not null then return; end if;
  select * into v_album from media_albums where media_albums.id = r.album_id;

  select coalesce(array_agg(m.id), '{}') into v_valid
  from media_assets m
  where m.album_id = r.album_id and m.status = 'ready' and m.id = any (coalesce(p_asset_ids, '{}'));

  v_count := coalesce(array_length(v_valid, 1), 0);
  if v_count = 0 then return; end if;

  select * into b from _media_gallery_best_price(r.album_id, v_count);
  if b.total_cents is null then return; end if;

  select p.currency into v_currency from media_products p
  where p.club_id = v_album.club_id and p.status = 'active' limit 1;

  return query select r.album_id, v_album.club_id, v_album.saison_id, v_valid,
                      b.total_cents, coalesce(v_currency, 'eur'), b.lines, b.whole_album;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. CE QU'UNE COMMANDE PAYÉE DONNE LE DROIT DE TÉLÉCHARGER
-- ═══════════════════════════════════════════════════════════════════════════
-- Le jeton EST le droit : il ne se lit que par cette fonction, qui vérifie l'expiration et le
-- paiement à chaque appel. Elle ne renvoie jamais de chemin d'original — c'est la route serveur
-- qui signera l'URL, une par une, au clic.
create or replace function media_gallery_order_summary(p_token text)
returns table (
  order_id uuid,
  album_titre text,
  club_nom text,
  email text,
  total_cents integer,
  currency text,
  expires_at timestamptz,
  expiree boolean,
  deja_rattachee boolean,
  photos jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  g record;
  o record;
begin
  select * into g from media_download_grants where token = p_token;
  if not found then return; end if;

  select * into o from media_orders where media_orders.id = g.order_id;
  -- Une commande non payée ne donne aucun droit, même avec un jeton valide : le jeton est créé
  -- par le webhook Stripe, mais on revérifie plutôt que de faire confiance à l'ordre des choses.
  if not found or o.status <> 'paid' then return; end if;

  return query
  select o.id,
         a.title,
         c.nom,
         g.email,
         o.amount_cents,
         o.currency,
         g.expires_at,
         (g.expires_at < now() and g.claimed_by_user_id is null),
         (g.claimed_by_user_id is not null),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', m.id,
                    'thumb_path', m.thumb_path,
                    'preview_path', m.preview_path,
                    'filename', coalesce(m.original_filename, 'photo.jpg')
                  ) order by m.position)
           from media_order_items oi
           join media_assets m on m.id = oi.asset_id
           where oi.order_id = o.id
         ), '[]'::jsonb)
  from media_orders o2
  left join media_albums a on a.id = o.album_id
  left join clubs c on c.id = o.club_id
  where o2.id = o.id;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. RATTACHEMENT À UN COMPTE CONNECT
-- ═══════════════════════════════════════════════════════════════════════════
-- Le §15 voulait « compte après l'achat », et la fonction invité existante créait un compte AVANT
-- le paiement pour que l'acheteur puisse retrouver ses photos. Les deux se réconcilient ici : le
-- droit temporaire devient permanent, et la commande rejoint le compte.
--
-- La comparaison se fait sur l'e-mail VÉRIFIÉ du compte (auth.users.email_confirmed_at), jamais
-- sur une adresse simplement saisie : sans ça, n'importe qui pourrait s'attribuer la commande d'un
-- autre en devinant son adresse.
create or replace function media_gallery_claim_order(p_token text)
returns table (ok boolean, raison text, order_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  g record;
  u record;
begin
  if auth.uid() is null then
    return query select false, 'non_connecte', null::uuid;
    return;
  end if;

  select * into g from media_download_grants where token = p_token;
  if not found then
    return query select false, 'introuvable', null::uuid;
    return;
  end if;
  if g.claimed_by_user_id is not null then
    return query select (g.claimed_by_user_id = auth.uid()), 'deja_rattachee', g.order_id;
    return;
  end if;

  select id, email, email_confirmed_at into u from auth.users where id = auth.uid();
  if u.email is null or u.email_confirmed_at is null then
    return query select false, 'email_non_verifie', g.order_id;
    return;
  end if;
  if lower(u.email) <> lower(g.email) then
    return query select false, 'email_different', g.order_id;
    return;
  end if;

  -- Le droit devient permanent : c'est tout l'intérêt de créer un compte.
  update media_download_grants
  set claimed_by_user_id = auth.uid(), claimed_at = now(), expires_at = now() + interval '100 years'
  where id = g.id;

  update media_orders
  set purchased_by_user_id = auth.uid()
  where media_orders.id = g.order_id and purchased_by_user_id is null;

  return query select true, null::text, g.order_id;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. DROITS D'EXÉCUTION
-- ═══════════════════════════════════════════════════════════════════════════
revoke all on function _media_gallery_best_price(uuid, integer) from public;
revoke all on function media_gallery_price_ladder(text, text, text) from public;
revoke all on function media_gallery_quote(text, text, uuid[], text) from public;
revoke all on function media_gallery_order_summary(text) from public;
revoke all on function media_gallery_claim_order(text) from public;

-- La grille tarifaire et le récapitulatif de commande sont publics : ils ne renvoient aucun
-- original et sont protégés par le jeton du lien ou celui de la commande.
grant execute on function media_gallery_price_ladder(text, text, text) to anon, authenticated;
grant execute on function media_gallery_order_summary(text) to anon, authenticated;
-- Le devis ferme n'est appelé que par la fonction de paiement (service_role) : l'exposer
-- permettrait de sonder les tarifs d'un club en masse, et surtout il n'a aucune raison d'être
-- appelé depuis un navigateur puisque personne ne doit calculer un prix côté client.
grant execute on function media_gallery_quote(text, text, uuid[], text) to service_role;
-- Le rattachement suppose un compte connecté, par construction.
grant execute on function media_gallery_claim_order(text) to authenticated;

commit;
