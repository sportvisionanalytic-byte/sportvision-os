-- v490 — Un pack payé se complète jusqu'au bout (03/10/2026)
--
-- CE QUI EST ARRIVÉ À UN VRAI CLIENT. Le 03/10 à 16h32, un parent paie 10 € la formule « pack
-- souvenirs » de la galerie « Joinville VS Villemomble ». La formule couvre 15 photos. Sa commande
-- en contient 4. Il a payé 15, il en a reçu 4, et rien ne le lui a dit.
--
-- Il avait coché 4 photos dans la galerie avant de choisir la formule. `create-gallery-checkout`
-- accepte : il vérifie qu'il y a AU MOINS une photo et PAS PLUS que le quota, jamais que le quota
-- est atteint. Ces 4 photos sont alors écrites dans la commande comme si c'était son choix final.
--
-- Deux fonctions achèvent de l'enfermer :
--
--   `media_gallery_order_summary` répondait `selection_faite = (photos_allowance is null or
--   v_items > 0)`. UNE photo suffisait donc à déclarer les quinze choisies. L'écran de choix, qui
--   ne s'affiche que `si allowance is not null and not selection_faite`, ne s'est jamais ouvert :
--   le parent n'a même pas su qu'il avait quinze photos à prendre.
--
--   `media_gallery_order_select` refusait `deja_choisie` dès `v_deja > 0`. Même en trouvant
--   l'écran, il n'aurait pas pu ajouter les onze restantes.
--
-- C'est le piège de la semaine une fois de plus : une condition qui laisse passer précisément le
-- cas qui se produit. `v_items > 0` ne compare pas au quota, il compare à zéro.
--
-- CE QUI NE CHANGE PAS, ET POURQUOI. Le choix reste IRRÉVERSIBLE : une photo prise ne se rend pas.
-- OrderSelect.tsx dit la raison, et elle est bonne — pouvoir rechanger ses photos indéfiniment
-- revient à obtenir la galerie entière au prix d'un pack. On autorise donc le CUMUL jusqu'au
-- quota, jamais le REMPLACEMENT. Un parent qui a payé quinze crédits en prend quinze, en une fois
-- ou en plusieurs, et pas une de plus.
--
-- Ce que ça rouvre : les deux commandes payées incomplètes de l'historique (10 € pour 4 photos sur
-- 15, et 5 € pour 2 sur 5), dont les liens de téléchargement expirent le 02/11 et le 29/10. Leur
-- page leur proposera de choisir le reste d'elle-même, sans rien refacturer ni rien décider pour
-- eux : PERSONNE ne choisit les photos d'une famille à sa place.

begin;

-- ── Le quota est atteint, ou il ne l'est pas ──────────────────────────────────────────────────
-- Seule la 4e ligne du `select` change. Le reste est repris tel quel : une commande payée doit
-- rester consultable même si l'album ou le club a été supprimé depuis, d'où les sous-requêtes.
create or replace function public.media_gallery_order_summary(p_token text)
returns table(order_id uuid, album_id uuid, album_titre text, club_nom text, email text,
              total_cents integer, currency text, expires_at timestamptz, expiree boolean,
              deja_rattachee boolean, photos_allowance integer, selection_faite boolean,
              photos jsonb)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  g record;
  o record;
  v_items integer;
begin
  select * into g from media_download_grants where token = p_token;
  if not found then return; end if;

  select * into o from media_orders where media_orders.id = g.order_id;
  if not found or o.status <> 'paid' then return; end if;

  -- `media_order_items.order_id` qualifié : `order_id` est aussi une colonne de sortie de cette
  -- fonction (RETURNS TABLE), et PL/pgSQL refuse la référence ambiguë.
  select count(*)::integer into v_items
  from media_order_items where media_order_items.order_id = o.id;

  return query
  select o.id,
         o.album_id,
         (select a.title from media_albums a where a.id = o.album_id),
         (select c.nom from clubs c where c.id = o.club_id),
         g.email, o.amount_cents, o.currency, g.expires_at,
         (g.expires_at < now() and g.claimed_by_user_id is null),
         (g.claimed_by_user_id is not null),
         o.photos_allowance,
         -- LE CORRECTIF. Une formule « N photos » n'est servie que quand les N sont prises.
         -- `v_items > 0` répondait oui à partir de la première, et fermait l'écran de choix sur
         -- un pack à peine entamé.
         (o.photos_allowance is null or v_items >= o.photos_allowance),
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

-- ── On complète, on ne remplace pas ───────────────────────────────────────────────────────────
create or replace function public.media_gallery_order_select(p_token text, p_asset_ids uuid[])
returns table(ok boolean, raison text, selectionnees integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  g record;
  o record;
  v_valid uuid[];
  v_count integer;
  v_deja integer;
  v_reste integer;
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
  v_reste := o.photos_allowance - v_deja;

  -- `deja_choisie` ne veut plus dire « il a déjà choisi quelque chose » mais « il n'a plus de
  -- crédit ». C'est le seul cas où il n'y a réellement plus rien à prendre.
  if v_reste <= 0 then
    return query select false, 'deja_choisie', v_deja; return;
  end if;

  -- Seules des photos publiables de CET album comptent : une liste venue du client ne prouve rien.
  -- Et celles DÉJÀ dans la commande sont écartées ici : sans ce filtre, renvoyer une photo qu'on
  -- possède déjà consommerait un second crédit pour le même fichier.
  select coalesce(array_agg(m.id), '{}') into v_valid
  from media_assets m
  where m.album_id = o.album_id
    and m.status = 'ready'
    and m.id = any (coalesce(p_asset_ids, '{}'))
    and not exists (select 1 from media_order_items oi
                    where oi.order_id = o.id and oi.asset_id = m.id);

  v_count := coalesce(array_length(v_valid, 1), 0);
  if v_count = 0 then
    return query select false, 'aucune_photo', 0; return;
  end if;
  -- `selectionnees` porte ici ce qu'il peut ENCORE prendre, pas le quota total : sur un pack
  -- entamé, « votre formule en couvre 15 » n'aide pas celui à qui il n'en reste que 11.
  if v_count > v_reste then
    return query select false, 'trop_de_photos', v_reste; return;
  end if;

  insert into media_order_items (order_id, product_id, asset_id, album_id, unit_price_cents, quantity)
  select o.id, o.product_id, id, o.album_id, 0, 1 from unnest(v_valid) as id;

  -- Le total après ajout, pas le seul lot ajouté : c'est ce qui permet à l'écran de dire
  -- « 7 sur 15 » après un deuxième passage.
  return query select true, null::text, v_deja + v_count;
end;
$function$;

commit;
