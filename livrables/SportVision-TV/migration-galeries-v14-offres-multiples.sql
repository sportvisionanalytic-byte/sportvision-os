-- Migration : Galeries — plusieurs offres sur un même lien
-- À exécuter APRÈS migration-galeries-v13-rattachement-connect.sql.
--
-- ── Ce qui change ──
-- Un lien ne vendait qu'UNE chose (media_album_links.product_id). Sur un tournoi, il faut pouvoir
-- proposer côte à côte : 15 photos à 10 €, 30 photos à 18 €, toute la galerie à 50 €. C'est le
-- parent qui choisit, pas nous.
--
-- ── Trois décisions ──
--
-- 1. UNE TABLE, PAS DES COLONNES EN PLUS. Trois offres par lien ne se rangent pas dans des
--    colonnes product_id_2, prix_2… Le nombre d'offres doit rester libre.
--
-- 2. L'OFFRE PORTE SON PROPRE QUOTA. Le catalogue dit « pack photos », le lien dit combien.
--    Sur un tournoi 10 € peut donner 20 photos, sur un autre événement 10 photos : c'est
--    SportVision qui décide au moment de créer le lien, pas une règle universelle figée dans
--    media_products. Le quota du produit reste le repli quand l'offre n'en impose pas.
--
-- 3. LES ANCIENS LIENS NE BOUGENT PAS. Un lien qui porte encore product_id directement continue
--    de fonctionner : media_link_offers() le présente comme une offre unique. Aucune migration
--    de données, aucun lien déjà envoyé à des familles ne cesse de marcher.
--
-- ── Deux revirements assumés, demandés le 07/09 au soir ──
--
--   * Le SECRÉTARIAT retrouve le droit de fixer les prix (décision inverse de la v7). Fouka a
--     tranché : c'est lui qui prépare les liens au quotidien.
--
--   * L'APERÇU N'EST PLUS LIMITÉ PAR DÉFAUT. La v12 ne montrait que 12 photos avant achat. Sur un
--     tournoi de 500 photos, un parent ne peut pas retrouver son enfant dans 12 vignettes : il
--     n'achèterait rien. La colonne preview_limit reste (elle sert pour un lien « équipe
--     adverse » qu'on ne veut pas exposer entièrement) mais null signifie désormais « tout
--     montrer ». La protection redevient le filigrane, cuit dans l'aperçu à 18 % des pixels.

begin;

-- ── 1. Les offres d'un lien ────────────────────────────────────────────────────────────────
create table if not exists media_album_link_offers (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references media_album_links(id) on delete cascade,
  product_id uuid not null references media_products(id) on delete restrict,
  -- null = prix du catalogue. C'est ici qu'on vend le même pack 10 € aux parents et 15 € à
  -- l'équipe adverse, sans dupliquer ni l'album ni le produit.
  price_override_cents integer,
  -- null = quota du produit (metadata.photo_count). Renseigné, il prime : « 10 € pour 20 photos »
  -- sur ce tournoi-ci sans créer un produit de plus au catalogue.
  photos_allowance integer,
  -- null = nom du produit. Permet « 15 photos de votre enfant » là où le catalogue dit « Pack 15 ».
  label text,
  display_order integer not null default 0,
  is_featured boolean not null default false,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint malo_price_check check (price_override_cents is null or price_override_cents >= 0),
  constraint malo_allowance_check check (photos_allowance is null or photos_allowance >= 1),
  -- Deux fois le même produit sur un lien, ce sont deux prix pour la même chose à l'écran :
  -- le visiteur ne peut pas choisir, et nous ne saurions pas laquelle il a prise.
  constraint malo_unique_produit unique (link_id, product_id)
);

create index if not exists idx_malo_link on media_album_link_offers(link_id, display_order);

comment on table media_album_link_offers is
  'Offres proposées par un lien de galerie. Plusieurs par lien : 15 photos / 30 photos / galerie complète. Le prix et le quota de CE lien priment sur le catalogue.';

alter table media_album_link_offers enable row level security;

-- Lecture : ceux qui travaillent sur l'album ou qui décident commercialement. Le public ne lit
-- jamais cette table en direct, il passe par les RPC.
drop policy if exists malo_team_select on media_album_link_offers;
create policy malo_team_select on media_album_link_offers
  for select using (media_upload_staff() or media_pricing_staff());

drop policy if exists malo_pricing_insert on media_album_link_offers;
create policy malo_pricing_insert on media_album_link_offers
  for insert with check (media_pricing_staff());

drop policy if exists malo_pricing_update on media_album_link_offers;
create policy malo_pricing_update on media_album_link_offers
  for update using (media_pricing_staff()) with check (media_pricing_staff());

drop policy if exists malo_pricing_delete on media_album_link_offers;
create policy malo_pricing_delete on media_album_link_offers
  for delete using (media_pricing_staff());

-- ── 2. Le secrétariat prépare les liens ────────────────────────────────────────────────────
-- Revirement explicite du 07/09 au soir. La v7 l'avait retiré ; Fouka a précisé qu'au quotidien
-- c'est le secrétariat qui prépare et envoie les liens, offres comprises. Photographes, CM et
-- comptabilité restent exclus : déposer des photos ou animer un compte n'est pas vendre.
create or replace function media_pricing_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.role in ('admin','prod','sec')
  )
  or exists (
    select 1 from pole_affectations pa
    where pa.user_id = auth.uid() and pa.role_pole = 'responsable' and pa.actif
  );
$$;

comment on function media_pricing_staff is
  'Peut créer un lien de galerie, ses offres et leurs tarifs : admin, responsable production, secrétariat, responsable de pôle actif. Volontairement PAS les photographes (ils déposent, ils ne vendent pas), PAS les CM, PAS la comptabilité.';

-- ── 3. Toutes les offres d'un lien, offres héritées comprises ──────────────────────────────
create or replace function media_link_offers(p_link_id uuid)
returns table (
  offer_id uuid,
  link_id uuid,
  album_id uuid,
  product_id uuid,
  offer_type text,
  offer_name text,
  price_cents integer,
  currency text,
  photos_allowance integer,
  is_featured boolean,
  display_order integer,
  audience text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  l record;
  v_n integer;
begin
  select * into l from media_album_links where id = p_link_id;
  if not found then return; end if;

  select count(*)::integer into v_n
  from media_album_link_offers o
  join media_products p on p.id = o.product_id
  where o.link_id = p_link_id and o.is_enabled and p.status = 'active';

  if v_n > 0 then
    return query
    select o.id, l.id, l.album_id, p.id, p.type,
           coalesce(o.label, p.name),
           -- LA règle de prix : l'offre prime, sinon le catalogue. Écrite ici et nulle part
           -- ailleurs — ni le frontend, ni le checkout, ni l'OS ne la rejouent.
           coalesce(o.price_override_cents, p.price_cents),
           p.currency,
           -- Le quota de l'offre prime sur celui du produit. Une galerie complète n'a pas de
           -- quota : elle donne tout.
           case when p.type = 'album_complet' then null
                else coalesce(o.photos_allowance, (p.metadata->>'photo_count')::integer) end,
           o.is_featured, o.display_order, l.audience
    from media_album_link_offers o
    join media_products p on p.id = o.product_id
    where o.link_id = p_link_id and o.is_enabled and p.status = 'active'
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
$$;

comment on function media_link_offers is
  'Toutes les offres vendables d''un lien, prix et quota déjà résolus. Un lien antérieur au 07/09 qui porte encore product_id est présenté comme une offre unique : rien à migrer, rien qui cesse de marcher.';

grant execute on function media_link_offers(uuid) to anon, authenticated;

-- ── 4. Attribution de la vente à l'offre choisie ───────────────────────────────────────────
alter table media_orders
  add column if not exists offer_id uuid references media_album_link_offers(id) on delete set null;

comment on column media_orders.offer_id is
  'Offre choisie par l''acheteur. Permettra de savoir que « Pack 15 » a fait 42 ventes et « Galerie complète » 12. null pour un lien hérité, qui n''a pas d''offre identifiable.';

commit;
