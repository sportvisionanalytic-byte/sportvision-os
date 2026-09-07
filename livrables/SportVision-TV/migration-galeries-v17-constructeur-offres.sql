-- Migration : Galeries — enregistrer un lien et ses offres en une seule fois
-- À exécuter APRÈS migration-galeries-v16-offres-illimitees.sql.
--
-- ── Pourquoi une fonction et pas des écritures depuis l'OS ──
-- Créer un lien avec sept offres, c'est huit écritures. Si la quatrième échoue, le staff se
-- retrouve avec un lien à moitié configuré, déjà copiable, qui vendrait trois formules au lieu de
-- sept — et personne ne s'en apercevrait avant qu'un parent ne paie. On enregistre donc tout dans
-- une seule fonction : tout passe, ou rien ne passe.
--
-- C'est aussi le seul endroit où les règles de validité vivent. L'interface les répète pour
-- guider la saisie, mais c'est ici qu'elles font foi.
--
-- ── Les produits redeviennent des TYPES ──
-- Le catalogue ne doit pas grossir d'un produit à chaque taille de pack. Deux produits suffisent
-- par club — « sélection de photos » et « galerie complète » — et c'est l'OFFRE qui porte le nom,
-- le quota, le prix, l'ordre et la mise en avant. media_link_type_product() récupère ou crée ces
-- deux produits à la demande, une fois pour toutes.

begin;

-- ── 1. Le produit qui sert de TYPE, jamais de tarif ────────────────────────────────────────
create or replace function media_link_type_product(p_club_id uuid, p_type text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_saison uuid;
  v_nom text;
begin
  if p_type not in ('pack', 'album_complet') then
    raise exception 'type d''offre inconnu : %', p_type;
  end if;

  -- On réutilise en priorité un produit déjà présent : les clubs qui ont un catalogue existant ne
  -- doivent pas voir apparaître un doublon.
  select id into v_id from media_products
  where club_id = p_club_id and type = p_type and status = 'active'
  order by created_at limit 1;
  if found then return v_id; end if;

  select id into v_saison from saisons order by label desc limit 1;
  v_nom := case p_type when 'pack' then 'Sélection de photos' else 'Galerie complète' end;

  -- price_cents à 0 : ce produit ne porte AUCUN tarif, il ne sert qu'à dire de quel type d'offre
  -- il s'agit. Le prix réel vit sur l'offre du lien.
  insert into media_products (club_id, saison_id, name, type, price_cents, currency, scope_type, status, metadata)
  values (p_club_id, v_saison, v_nom, p_type, 0, 'eur', 'club', 'active', '{}')
  returning id into v_id;
  return v_id;
end;
$$;

comment on function media_link_type_product is
  'Le produit de catalogue qui sert de TYPE à une offre (sélection / galerie complète), créé à la demande. Deux par club suffisent : le nom, le quota et le prix vivent sur l''offre du lien, jamais ici.';

-- ── 2. Un responsable de pôle ne décide que pour son pôle ──────────────────────────────────
-- media_pricing_staff() reste la porte générale (admin, production, secrétariat). Pour un
-- responsable de pôle, on vérifie en plus que l'album relève bien de son pôle : le chemin existe
-- déjà, media_albums.mission_id pointe vers prestations, qui porte pole_id.
--
-- Un album sans mission n'a pas de pôle : il reste réservé à admin/production/secrétariat plutôt
-- que d'être ouvert à tous les responsables de pôle par défaut.
create or replace function media_pricing_staff_album(p_album_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.role in ('admin','prod','sec')
  )
  or exists (
    select 1
    from pole_affectations pa
    join media_albums a on a.id = p_album_id
    join prestations pr on pr.id = a.mission_id
    where pa.user_id = auth.uid()
      and pa.role_pole = 'responsable'
      and pa.actif
      and pa.pole_id = pr.pole_id
  );
$$;

comment on function media_pricing_staff_album is
  'Peut configurer les offres de CET album. Admin, production et secrétariat partout ; un responsable de pôle uniquement sur les albums dont la mission relève de son pôle.';

grant execute on function media_pricing_staff_album(uuid) to authenticated;

-- ── 3. Enregistrer le lien et ses offres, tout ou rien ─────────────────────────────────────
create or replace function media_link_save(
  p_album_id uuid,
  p_offers jsonb default '[]'::jsonb,
  p_link_id uuid default null,
  p_label text default null,
  p_audience text default null,
  p_expires_at timestamptz default null,
  p_is_enabled boolean default true,
  p_preview_limit integer default null
)
returns table (ok boolean, raison text, link_id uuid, slug text, token text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_club uuid;
  v_link uuid;
  v_slug text;
  v_token text;
  o jsonb;
  v_type text;
  v_nom text;
  v_prix integer;
  v_quota integer;
  v_produit uuid;
  v_featured integer := 0;
  i integer := 0;
begin
  if not media_pricing_staff_album(p_album_id) then
    return query select false, 'non_autorise', null::uuid, null::text, null::text;
    return;
  end if;

  select club_id into v_club from media_albums where id = p_album_id;
  if v_club is null then
    return query select false, 'album_introuvable', null::uuid, null::text, null::text;
    return;
  end if;

  -- ── Validation AVANT toute écriture ──
  -- On refuse la configuration entière plutôt que d'en écrire une partie : un lien qui vend six
  -- formules sur sept est pire qu'un lien qu'on n'a pas pu enregistrer.
  for o in select * from jsonb_array_elements(coalesce(p_offers, '[]'::jsonb)) loop
    i := i + 1;
    v_type := o->>'type';
    v_nom := nullif(btrim(coalesce(o->>'name', '')), '');
    v_prix := (o->>'price_cents')::integer;
    v_quota := nullif(o->>'photos_allowance', '')::integer;

    if v_type not in ('pack', 'album_complet') then
      return query select false, 'offre_' || i || ' : type inconnu', null::uuid, null::text, null::text; return;
    end if;
    if v_nom is null then
      return query select false, 'offre_' || i || ' : nom manquant', null::uuid, null::text, null::text; return;
    end if;
    -- 0 est un prix VALIDE : une galerie peut être offerte. C'est `null` qui est refusé.
    if v_prix is null or v_prix < 0 then
      return query select false, 'offre_' || i || ' : prix invalide', null::uuid, null::text, null::text; return;
    end if;
    if v_type = 'pack' and (v_quota is null or v_quota < 1) then
      return query select false, 'offre_' || i || ' : nombre de photos manquant', null::uuid, null::text, null::text; return;
    end if;
    if coalesce((o->>'featured')::boolean, false) then v_featured := v_featured + 1; end if;
  end loop;

  if v_featured > 1 then
    return query select false, 'une seule offre peut être mise en avant', null::uuid, null::text, null::text; return;
  end if;

  -- ── Écriture ──
  if p_link_id is null then
    insert into media_album_links (album_id, slug, label, audience, expires_at, is_enabled, preview_limit, created_by)
    values (p_album_id, media_gallery_unique_slug(coalesce(p_label, (select title from media_albums where id = p_album_id))),
            p_label, p_audience, p_expires_at, coalesce(p_is_enabled, true), p_preview_limit, auth.uid())
    returning id, media_album_links.slug, media_album_links.token into v_link, v_slug, v_token;
  else
    update media_album_links
    set label = p_label,
        audience = p_audience,
        expires_at = p_expires_at,
        is_enabled = coalesce(p_is_enabled, true),
        preview_limit = p_preview_limit,
        updated_at = now()
    where id = p_link_id and album_id = p_album_id
    returning id, media_album_links.slug, media_album_links.token into v_link, v_slug, v_token;
    if v_link is null then
      return query select false, 'lien_introuvable', null::uuid, null::text, null::text; return;
    end if;
    -- Le slug et le jeton ne changent JAMAIS à la modification : des parents ont déjà le lien.
  end if;

  -- Les offres sont remplacées d'un bloc : c'est ce que l'écran montre, et gérer des différences
  -- ligne à ligne ferait diverger l'affichage de ce qui est réellement enregistré. Les commandes
  -- passées gardent leur montant, elles ne relisent jamais l'offre (media_orders.amount_cents).
  delete from media_album_link_offers where media_album_link_offers.link_id = v_link;

  i := 0;
  for o in select * from jsonb_array_elements(coalesce(p_offers, '[]'::jsonb)) loop
    i := i + 1;
    v_type := o->>'type';
    v_produit := media_link_type_product(v_club, v_type);
    insert into media_album_link_offers (
      link_id, product_id, price_override_cents, photos_allowance, label,
      display_order, is_featured, is_enabled, created_by
    ) values (
      v_link, v_produit, (o->>'price_cents')::integer,
      case when v_type = 'pack' then nullif(o->>'photos_allowance','')::integer else null end,
      btrim(o->>'name'),
      coalesce((o->>'display_order')::integer, i),
      coalesce((o->>'featured')::boolean, false),
      coalesce((o->>'is_enabled')::boolean, true),
      auth.uid()
    );
  end loop;

  return query select true, null::text, v_link, v_slug, v_token;
end;
$$;

comment on function media_link_save is
  'Enregistre un lien de galerie ET toutes ses offres en une seule transaction : tout passe ou rien ne passe. Valide avant d''écrire — un lien qui vend six formules sur sept est pire qu''un lien non enregistré. Le slug et le jeton ne changent jamais à la modification : des familles ont déjà le lien.';

grant execute on function media_link_save(uuid, jsonb, uuid, text, text, timestamptz, boolean, integer) to authenticated;

-- ── 4. Relire un lien pour l'éditer ────────────────────────────────────────────────────────
create or replace function media_link_editor(p_link_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  l record;
  v_offres jsonb;
begin
  select * into l from media_album_links where id = p_link_id;
  if not found then return null; end if;
  if not media_pricing_staff_album(l.album_id) and not media_upload_staff() then return null; end if;

  -- On relit les offres TELLES QU'ENREGISTRÉES, désactivées comprises : l'éditeur doit pouvoir
  -- réactiver ce que media_link_offers() masque au public.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'type', p.type, 'name', coalesce(o.label, p.name),
           'price_cents', coalesce(o.price_override_cents, p.price_cents),
           'photos_allowance', o.photos_allowance,
           'display_order', o.display_order,
           'featured', o.is_featured,
           'is_enabled', o.is_enabled
         ) order by o.display_order, o.created_at), '[]'::jsonb)
  into v_offres
  from media_album_link_offers o
  join media_products p on p.id = o.product_id
  where o.link_id = p_link_id;

  return jsonb_build_object(
    'id', l.id, 'album_id', l.album_id, 'slug', l.slug, 'token', l.token,
    'label', l.label, 'audience', l.audience, 'expires_at', l.expires_at,
    'is_enabled', l.is_enabled, 'preview_limit', l.preview_limit,
    'peut_tarifer', media_pricing_staff_album(l.album_id),
    'offres', v_offres
  );
end;
$$;

grant execute on function media_link_editor(uuid) to authenticated;

commit;
