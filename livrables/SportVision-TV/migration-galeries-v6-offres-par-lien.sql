-- Migration : Galeries SportVision — le lien devient un canal de vente (Lot 4)
-- À exécuter APRÈS migration-galeries-v5-email-commande.sql.
--
-- ── Ce qui change, et pourquoi ──
-- Le parcours actuel fait construire son prix au client, photo par photo : « 1 photo · 4 € »,
-- « 2 photos · 8 € ». Ça marche, mais ça montre le prix qui grimpe pendant qu'il regarde, et ça
-- l'oblige à choisir avant de savoir ce qu'il paie. On vend désormais un ACCÈS : il choisit une
-- formule, il paie, puis il choisit ses photos.
--
-- Et une même galerie doit pouvoir se vendre à des prix différents selon à qui on envoie le lien.
-- Un match Villeneuve vs Gennevilliers, ce sont les MÊMES 200 photos : dupliquer l'album pour
-- avoir deux tarifs serait dupliquer 200 fichiers, deux fois le stockage, et deux albums à tenir
-- à jour. Le lien porte donc sa propre configuration commerciale.
--
-- ── Ce qui n'est PAS refait ──
-- media_products reste le catalogue (le lien y pointe), media_orders / Stripe / les droits de
-- téléchargement / le webhook ne changent pas de forme, media_album_links est ÉTENDUE et non
-- remplacée. Le moteur de prix par combinaison (_media_gallery_best_price) est conservé tel quel :
-- il reste la bonne réponse pour une galerie sans offre configurée, et c'est ce qui garantit que
-- les liens déjà créés continuent de fonctionner à l'identique (§27).
--
-- ── La règle de prix, à un seul endroit ──
-- prix effectif = price_override_cents du lien, sinon prix du produit.
-- Elle vit dans media_link_offer() et nulle part ailleurs : ni le frontend, ni le checkout, ni
-- l'OS ne la réimplémentent. Le navigateur affiche un prix, il n'en décide jamais.

begin;

-- Postgres refuse de changer le type de retour d'une fonction existante : ces trois-là gagnent des
-- colonnes de sortie, il faut donc les supprimer d'abord. Elles sont recréées plus bas dans la
-- même transaction — aucun instant où elles n'existent pas pour un appelant.
drop function if exists media_album_links_stats(uuid);
drop function if exists media_link_offer(uuid);
drop function if exists media_gallery_products(text, text, text);
drop function if exists media_gallery_quote(text, text, uuid[], text);
drop function if exists media_gallery_order_summary(text);

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. QUI A LE DROIT DE FIXER UN PRIX
-- ═══════════════════════════════════════════════════════════════════════════
-- Décision de Fouka : le photographe dépose les photos, il ne décide pas de leur prix de vente.
-- Le responsable production, lui, doit pouvoir préparer et publier une galerie complète sans
-- attendre le fondateur.
create or replace function media_pricing_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.role in ('admin','sec','prod')
  );
$$;

comment on function media_pricing_staff is
  'Peut créer un lien public et en fixer le tarif : admin, secrétariat, production. Volontairement PAS les photographes (ils déposent, ils ne vendent pas) ni les CM.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LE LIEN PORTE SA CONFIGURATION COMMERCIALE
-- ═══════════════════════════════════════════════════════════════════════════

-- Nom interne, jamais montré au visiteur : c'est ce qui permet à l'équipe de distinguer
-- « Parents Villeneuve » de « Gennevilliers » dans une liste de six liens.
alter table media_album_links add column if not exists label text;

-- L'audience sert à IDENTIFIER le lien et à choisir le bon discours à l'écran. Elle n'impose
-- aucun prix : c'est une étiquette, pas une règle. Un lien « club partenaire » transféré à
-- quelqu'un d'autre donne le tarif du lien, et c'est assumé pour cette V1 — vérifier
-- l'appartenance réelle demanderait un compte, donc la friction qu'on vient de supprimer.
alter table media_album_links add column if not exists audience text;

-- L'offre vendue par ce lien. NULL = lien historique, qui garde exactement le comportement
-- d'avant (catalogue complet du club, prix par combinaison). C'est ce qui rend la migration non
-- destructive.
alter table media_album_links add column if not exists product_id uuid references media_products(id) on delete set null;

-- Le prix commercial de CE lien. NULL = on prend celui du produit. C'est ce qui permet d'avoir
-- « Galerie complète » à 30 € au catalogue et à 15 € pour les parents du club partenaire, sans
-- créer deux produits ni deux albums.
alter table media_album_links add column if not exists price_override_cents integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'media_album_links_audience_check') then
    alter table media_album_links add constraint media_album_links_audience_check
      check (audience is null or audience in ('club_partenaire','equipe_adverse','public','evenementiel','personnalise'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_album_links_price_check') then
    alter table media_album_links add constraint media_album_links_price_check
      check (price_override_cents is null or price_override_cents >= 0);
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. LA COMMANDE SE SOUVIENT DU LIEN QUI L'A PRODUITE
-- ═══════════════════════════════════════════════════════════════════════════
-- Sans ça, impossible de dire « le lien à 15 € a fait 25 ventes et celui à 30 € en a fait 8 »,
-- donc impossible d'ajuster quoi que ce soit (§21, §22).
alter table media_orders add column if not exists link_id uuid references media_album_links(id) on delete set null;

-- Combien de photos ce droit couvre. NULL = toutes celles figées à l'achat (galerie complète).
-- Un nombre = l'acheteur choisira ce nombre de photos APRÈS avoir payé.
alter table media_orders add column if not exists photos_allowance integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'media_orders_allowance_check') then
    alter table media_orders add constraint media_orders_allowance_check
      check (photos_allowance is null or photos_allowance > 0);
  end if;
end $$;

create index if not exists idx_mord_link on media_orders (link_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. LA RÈGLE DE PRIX, CENTRALISÉE
-- ═══════════════════════════════════════════════════════════════════════════
-- Un seul endroit décide du prix effectif. Si un jour la règle change (remise Connect, tarif
-- Pass Saison), elle change ici et partout à la fois.
create or replace function media_link_offer(p_link_id uuid)
returns table (
  link_id uuid,
  album_id uuid,
  -- Trois états, pas deux. `configured` dit qu'une offre a été attachée à ce lien,
  -- `available` qu'elle est encore vendable. Les confondre faisait retomber un lien dont le
  -- produit vient d'être désactivé sur le CATALOGUE PUBLIC du club : un lien préférentiel à 15 €
  -- se serait mis à afficher les tarifs publics. Trouvé en test, pas en relecture.
  configured boolean,
  available boolean,
  product_id uuid,
  offer_type text,
  offer_name text,
  price_cents integer,
  currency text,
  photos_allowance integer,
  audience text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  l media_album_links;
  p media_products;
begin
  select * into l from media_album_links where media_album_links.id = p_link_id;
  if not found then return; end if;

  if l.product_id is null then
    -- Lien historique : aucune offre attachée. L'appelant retombe sur le catalogue du club et le
    -- moteur de prix par combinaison, exactement comme avant ce lot.
    return query select l.id, l.album_id, false, false, null::uuid, null::text, null::text,
                        null::integer, null::text, null::integer, l.audience;
    return;
  end if;

  select * into p from media_products where media_products.id = l.product_id;
  if not found or p.status <> 'active' then
    -- Produit supprimé ou désactivé après la création du lien. `configured = true` et
    -- `available = false` : le lien cesse de vendre, il ne retombe SURTOUT pas sur le catalogue.
    return query select l.id, l.album_id, true, false, null::uuid, null::text, null::text,
                        null::integer, null::text, null::integer, l.audience;
    return;
  end if;

  return query select
    l.id,
    l.album_id,
    true,
    true,
    p.id,
    p.type,
    p.name,
    -- LA règle : l'override du lien prime, sinon le prix du catalogue.
    coalesce(l.price_override_cents, p.price_cents),
    coalesce(p.currency, 'eur'),
    case
      when p.type = 'album_complet' then null            -- toutes les photos
      when p.type = 'pack' then media_product_pack_size(p.metadata, p.type)
      when p.type = 'photo_unite' then 1
      else null
    end,
    l.audience;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. CE QUE LA GALERIE PUBLIQUE AFFICHE
-- ═══════════════════════════════════════════════════════════════════════════
-- Lien configuré : on ne montre QUE son offre, au prix de ce lien. Montrer le catalogue complet
-- ferait apparaître le tarif public à quelqu'un venu par un lien préférentiel, ce qui est
-- exactement ce qu'on cherche à éviter.
create or replace function media_gallery_products(p_slug text, p_token text, p_password text default null)
returns table (
  id uuid,
  name text,
  type text,
  price_cents integer,
  currency text,
  pack_photos integer,
  physical_product boolean
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
begin
  select * into r from _media_gallery_resolve(p_slug, p_token, p_password);
  if r.raison is not null then return; end if;

  select * into o from media_link_offer(r.link_id);
  if o.configured then
    -- Offre attachée mais plus vendable : on ne propose rien. Retomber sur le catalogue
    -- afficherait le tarif public à quelqu'un venu par un lien préférentiel.
    if o.available then
      return query select o.product_id, o.offer_name, o.offer_type, o.price_cents, o.currency,
                          o.photos_allowance, false;
    end if;
    return;
  end if;

  -- Comportement historique, inchangé : catalogue du club applicable à cet album.
  select * into v_album from media_albums where media_albums.id = r.album_id;
  return query
  select p.id, p.name, p.type, p.price_cents, p.currency,
         media_product_pack_size(p.metadata, p.type), coalesce(p.physical_product, false)
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
  order by p.price_cents;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. LE DEVIS FERME, POUR LES DEUX MODÈLES
-- ═══════════════════════════════════════════════════════════════════════════
-- Lien configuré : le prix ne dépend plus de la sélection, donc `p_asset_ids` est ignoré. C'est
-- le cœur du changement — le client paie un accès, il choisira ensuite.
create or replace function media_gallery_quote(
  p_slug text,
  p_token text,
  p_asset_ids uuid[] default null,
  p_password text default null
)
returns table (
  album_id uuid,
  club_id uuid,
  saison_id uuid,
  link_id uuid,
  product_id uuid,
  offer_type text,
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
  select * into o from media_link_offer(r.link_id);

  -- ── Modèle « formule » : le lien vend un accès ────────────────────────────────────────────
  if o.configured then
    -- Offre devenue indisponible : aucun devis, donc aucun paiement possible. Le lien ne bascule
    -- jamais sur la tarification par combinaison, qui n'est pas celle qu'on lui a configurée.
    if not o.available then return; end if;

    if o.offer_type = 'album_complet' then
      -- Toutes les photos PUBLIABLES AU MOMENT DE L'ACHAT. Choix explicite : une photo ajoutée
      -- après coup n'entre pas dans une commande déjà payée. Sinon un album complété pendant des
      -- mois transformerait un achat de 30 € en abonnement à vie, ce que personne n'a vendu.
      select coalesce(array_agg(m.id), '{}') into v_valid
      from media_assets m where m.album_id = r.album_id and m.status = 'ready';
    else
      -- Pack : aucune photo n'est figée maintenant, l'acheteur choisira après paiement.
      v_valid := '{}';
    end if;

    return query select r.album_id, v_album.club_id, v_album.saison_id, r.link_id, o.product_id,
                        o.offer_type, v_valid, o.photos_allowance, o.price_cents, o.currency,
                        jsonb_build_array(jsonb_build_object(
                          'product_id', o.product_id, 'name', o.offer_name, 'type', o.offer_type,
                          'quantity', 1, 'unit_price_cents', o.price_cents,
                          'covers_photos', coalesce(o.photos_allowance, coalesce(array_length(v_valid, 1), 0)))),
                        (o.offer_type = 'album_complet');
    return;
  end if;

  -- ── Modèle historique : prix par combinaison sur une sélection ─────────────────────────────
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
                      null::text, v_valid, null::integer, b.total_cents,
                      coalesce(v_currency, 'eur'), b.lines, b.whole_album;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. LA SÉLECTION APRÈS PAIEMENT
-- ═══════════════════════════════════════════════════════════════════════════
-- « Votre formule comprend 5 photos HD. » L'acheteur choisit, et le serveur vérifie. Un client ne
-- doit pas pouvoir payer un pack de 5 puis envoyer 20 identifiants : la vérification est ici, pas
-- dans le navigateur.
--
-- Définitif par défaut : une fois validée, la sélection ne se refait pas. Sinon un acheteur
-- pourrait tourner sur toute la galerie en changeant ses 5 photos à volonté, ce qui revient à
-- vendre l'album complet au prix du pack.
create or replace function media_gallery_order_select(p_token text, p_asset_ids uuid[])
returns table (ok boolean, raison text, selectionnees integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  g record;
  o record;
  v_valid uuid[];
  v_count integer;
  v_deja integer;
begin
  select * into g from media_download_grants where token = p_token;
  if not found then
    return query select false, 'introuvable', 0; return;
  end if;

  select * into o from media_orders where media_orders.id = g.order_id;
  if not found or o.status <> 'paid' then
    return query select false, 'non_payee', 0; return;
  end if;
  if o.photos_allowance is null then
    -- Galerie complète : rien à choisir, tout est déjà rattaché.
    return query select false, 'sans_objet', 0; return;
  end if;

  select count(*)::integer into v_deja from media_order_items where order_id = o.id;
  if v_deja > 0 then
    return query select false, 'deja_choisie', v_deja; return;
  end if;

  -- Seules des photos publiables de CET album comptent : une liste venue du client ne prouve rien.
  select coalesce(array_agg(m.id), '{}') into v_valid
  from media_assets m
  where m.album_id = o.album_id and m.status = 'ready' and m.id = any (coalesce(p_asset_ids, '{}'));

  v_count := coalesce(array_length(v_valid, 1), 0);
  if v_count = 0 then
    return query select false, 'aucune_photo', 0; return;
  end if;
  if v_count > o.photos_allowance then
    return query select false, 'trop_de_photos', o.photos_allowance; return;
  end if;

  insert into media_order_items (order_id, product_id, asset_id, album_id, unit_price_cents, quantity)
  select o.id, o.product_id, id, o.album_id, 0, 1 from unnest(v_valid) as id;

  return query select true, null::text, v_count;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. RÉCAPITULATIF DE COMMANDE — l'état de la sélection
-- ═══════════════════════════════════════════════════════════════════════════
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
  photos_allowance integer,
  selection_faite boolean,
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
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. RLS — le prix est une décision commerciale
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists malinks_staff_all on media_album_links;
create policy malinks_staff_all on media_album_links
  for all using (media_pricing_staff()) with check (media_pricing_staff());

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. STATISTIQUES PAR LIEN
-- ═══════════════════════════════════════════════════════════════════════════
-- Calculées à la lecture plutôt que dénormalisées : quelques dizaines de commandes par lien, et
-- un compteur dénormalisé finit toujours par diverger du réel.
create or replace function media_album_links_stats(p_album_id uuid)
returns table (
  id uuid,
  label text,
  slug text,
  token text,
  audience text,
  offer_name text,
  offer_type text,
  price_cents integer,
  is_enabled boolean,
  expires_at timestamptz,
  view_count integer,
  unique_visitor_count integer,
  orders_count integer,
  revenue_cents integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select l.id, l.label, l.slug, l.token, l.audience,
         o.offer_name, o.offer_type, o.price_cents,
         l.is_enabled, l.expires_at, l.view_count, l.unique_visitor_count,
         coalesce(v.n, 0)::integer, coalesce(v.ca, 0)::integer
  from media_album_links l
  cross join lateral media_link_offer(l.id) o
  left join lateral (
    select count(*) as n, sum(amount_cents) as ca
    from media_orders mo where mo.link_id = l.id and mo.status = 'paid'
  ) v on true
  where l.album_id = p_album_id
    and media_pricing_staff()
  order by l.created_at;
$$;

revoke all on function media_link_offer(uuid) from public;
revoke all on function media_album_links_stats(uuid) from public;
revoke all on function media_gallery_order_select(text, uuid[]) from public;
grant execute on function media_link_offer(uuid) to authenticated, service_role;
grant execute on function media_album_links_stats(uuid) to authenticated;
-- L'acheteur choisit ses photos sans compte : c'est le jeton de sa commande qui l'autorise.
grant execute on function media_gallery_order_select(text, uuid[]) to anon, authenticated;
grant execute on function media_gallery_quote(text, text, uuid[], text) to service_role;
grant execute on function media_gallery_products(text, text, text) to anon, authenticated;
grant execute on function media_gallery_order_summary(text) to anon, authenticated;

commit;
