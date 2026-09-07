-- Migration : Galeries — le parcours « formule » côté visiteur
-- À exécuter APRÈS migration-galeries-v7-permission-tarifs.sql.
--
-- ── Ce que ce lot ajoute ──
-- La v6 a posé le modèle commercial : un lien porte une formule (product_id + price_override).
-- Il manquait deux choses pour que le VISITEUR puisse en vivre le parcours :
--
--   1. La page doit savoir, dès son ouverture, si elle est une galerie « formule » (on regarde
--      tout, on paie un accès) ou une galerie « catalogue » (l'ancien panier photo par photo).
--      Elle appelle déjà media_gallery_open : on lui répond dans cet appel-là plutôt que d'en
--      ajouter un second.
--
--   2. L'acheteur d'un pack de 5 photos choisit ses photos APRÈS avoir payé. Il lui faut donc
--      pouvoir lister les photos de l'album depuis son seul jeton de commande — sans le lien
--      d'origine, qu'il n'a pas forcément gardé, et qui peut avoir été désactivé entre-temps.
--
-- Rien d'autre ne bouge : media_gallery_quote, media_gallery_order_select et le moteur de prix
-- sont ceux de la v6, inchangés.

begin;

-- ── 1. La galerie annonce son mode commercial à l'ouverture ────────────────────────────────
--
-- `offre` est un jsonb et non sept colonnes de plus : ces champs ne veulent rien dire séparément
-- (un prix sans son type d'offre n'est pas exploitable), et une colonne jsonb évite de refaire
-- une migration de signature à chaque champ commercial ajouté plus tard.
--
--   offre = null                              → lien historique : catalogue du club, ancien panier
--   offre.configured = true, available = true → formule vendable, tout est dans l'objet
--   offre.configured = true, available = false→ formule attachée mais plus vendable : la galerie
--                                               se consulte, elle ne vend plus. Elle NE retombe
--                                               PAS sur le catalogue public (règle de la v6).
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
  offre jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  o record;
  v_offre jsonb := null;
begin
  select * into r from _media_gallery_resolve(p_slug, p_token, p_password);

  if r.raison is not null then
    -- 'mot_de_passe' n'est pas un refus : c'est une demande. La page affiche un champ plutôt
    -- qu'une erreur, et le visiteur ne sait rien de plus sur l'album pour autant.
    return query select false, r.raison, null::uuid, null::text, null::date, null::text, null::text,
                        null::text, null::integer, (r.raison = 'mot_de_passe'), null::boolean,
                        null::boolean, null::jsonb;
    return;
  end if;

  -- LA règle de prix n'est pas réécrite ici : on interroge media_link_offer, la seule fonction
  -- qui sait ce qu'un lien vend et à quel prix.
  select * into o from media_link_offer(r.link_id);
  if o.configured then
    v_offre := jsonb_build_object(
      'configured', true,
      'available', o.available,
      'product_id', o.product_id,
      'type', o.offer_type,
      'name', o.offer_name,
      'price_cents', o.price_cents,
      'currency', o.currency,
      'photos_allowance', o.photos_allowance,
      'audience', o.audience
    );
  end if;

  return query
  select true, null::text, a.id, a.title, a.event_date, c.nom, t.name, a.cover_preview_url,
         (select count(*)::integer from media_assets m where m.album_id = a.id and m.status = 'ready'),
         false,
         -- Anciens albums livrés par lien privé : on dit qu'il existe, on ne le donne jamais.
         (a.secure_collection_ref is not null
          and not exists (select 1 from media_assets m where m.album_id = a.id and m.status = 'ready')),
         a.watermark_previews,
         v_offre
  from media_albums a
  left join clubs c on c.id = a.club_id
  left join club_teams t on t.id = a.team_id
  where a.id = r.album_id;
end;
$$;

comment on function media_gallery_open is
  'Ouvre une galerie publique depuis son lien. `offre` porte la formule vendue par CE lien (null = lien historique sur catalogue). Le visiteur n''est jamais authentifié : le lien fait l''accès.';

grant execute on function media_gallery_open(text, text, text) to anon, authenticated;

-- ── 2. Choisir ses photos après avoir payé ─────────────────────────────────────────────────
--
-- L'acheteur d'un pack arrive ici avec le jeton reçu par e-mail, et rien d'autre. On ne peut donc
-- pas passer par le lien de la galerie : il peut avoir expiré, avoir été désactivé, ou le parent
-- peut simplement avoir fermé l'onglet. Le droit de voir ces photos vient de la commande payée.
create or replace function media_gallery_order_choices(
  p_token text,
  p_limit integer default 200,
  p_offset integer default 0
)
returns table (
  id uuid,
  thumb_path text,
  preview_path text,
  width integer,
  height integer,
  total integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  g record;
  o record;
  v_total integer;
begin
  select * into g from media_download_grants where token = p_token;
  if not found then return; end if;

  select * into o from media_orders where media_orders.id = g.order_id;
  -- Payée, avec un quota, et pas encore choisie : hors de ces trois conditions il n'y a rien à
  -- choisir, et donc aucune raison d'exposer l'album entier.
  if not found or o.status <> 'paid' or o.photos_allowance is null then return; end if;
  if exists (select 1 from media_order_items where order_id = o.id) then return; end if;
  -- Un droit expiré ne rouvre pas l'album : sinon un jeton de l'an dernier ferait office de
  -- visionneuse permanente.
  if g.expires_at is not null and g.expires_at < now() then return; end if;

  select count(*)::integer into v_total
  from media_assets m where m.album_id = o.album_id and m.status = 'ready';

  return query
  select m.id, m.thumb_path, m.preview_path, m.width, m.height, v_total
  from media_assets m
  where m.album_id = o.album_id and m.status = 'ready'
  order by m.position asc nulls last, m.created_at asc
  limit greatest(1, least(coalesce(p_limit, 200), 500))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

comment on function media_gallery_order_choices is
  'Photos parmi lesquelles choisir après l''achat d''un pack, lisibles avec le seul jeton de commande. Ne renvoie jamais de chemin d''original. Se tait dès que la sélection est faite, que la commande n''est pas payée ou que le droit a expiré.';

grant execute on function media_gallery_order_choices(text, integer, integer) to anon, authenticated;

commit;
