-- Migration : Galeries — un aperçu, pas la galerie entière
-- À exécuter APRÈS migration-galeries-v11-enqueue-null.sql.
--
-- ── Ce qui change ──
-- Depuis le passage aux formules, le visiteur voyait TOUTES les photos avant de payer, en aperçus
-- filigranés. C'est trop : 200 photos filigranées, c'est déjà l'essentiel du souvenir, et il
-- suffit d'accepter le filigrane pour n'avoir jamais besoin d'acheter. On n'en montre plus qu'un
-- extrait. Le reste est annoncé — « et 188 autres » — mais pas servi.
--
-- ── La limite est SERVEUR, pas d'affichage ──
-- Charger les 200 photos puis en cacher 188 en CSS ne protège rien : les chemins seraient dans la
-- réponse réseau, lisibles en dix secondes depuis l'inspecteur du navigateur. La fonction ne
-- renvoie donc tout simplement pas les photos au-delà de la limite. `total` continue d'annoncer
-- le vrai nombre : c'est un argument de vente, pas un secret.
--
-- ── Combien, et où c'est décidé ──
-- Sur le LIEN, comme le tarif : c'est un levier commercial, et on peut vouloir montrer davantage
-- aux parents du club qu'à l'équipe adverse. Aucune valeur en dur par club, aucun réglage caché
-- dans le code : `preview_limit` est réglable depuis l'OS, et retombe sur 12 quand elle est nulle.
--
-- ── Quelles photos ──
-- Les premières dans l'ordre de l'album. Le photographe range déjà ses photos dans l'OS, et la
-- couverture est en tête : réordonner suffit donc à choisir la vitrine, sans nouvel écran ni
-- nouvelle notion. Un tirage au hasard donnerait une vitrine différente à chaque rechargement,
-- donc impossible à préparer.

begin;

alter table media_album_links
  add column if not exists preview_limit integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'media_album_links'::regclass and conname = 'media_album_links_preview_limit_check'
  ) then
    alter table media_album_links
      add constraint media_album_links_preview_limit_check
      check (preview_limit is null or preview_limit >= 1);
  end if;
end $$;

comment on column media_album_links.preview_limit is
  'Nombre de photos visibles AVANT achat sur ce lien. null = valeur par défaut (12). 0 est refusé : une galerie sans aucune photo visible ne se vend pas.';

-- ── La valeur par défaut, à un seul endroit ────────────────────────────────────────────────
create or replace function _media_gallery_preview_limit(p_link_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- 12 : assez pour juger le travail du photographe et se reconnaître, trop peu pour remplacer
  -- l'achat. Une seule définition, relue par media_gallery_open comme par media_gallery_photos —
  -- deux valeurs par défaut différentes afficheraient « et 188 autres » à côté de 20 vignettes.
  select coalesce((select l.preview_limit from media_album_links l where l.id = p_link_id), 12);
$$;

-- ── Les photos servies au public ───────────────────────────────────────────────────────────
drop function if exists media_gallery_photos(text, text, text, integer, integer);

create function media_gallery_photos(
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
  v_fin integer;
begin
  select * into r from _media_gallery_resolve(p_slug, p_token, p_password);
  if r.raison is not null then
    return;
  end if;

  v_max := _media_gallery_preview_limit(r.link_id);
  v_debut := greatest(0, coalesce(p_offset, 0));
  -- Combien il reste à servir avant d'atteindre la vitrine. Négatif ou nul : on ne sert rien,
  -- et surtout pas « les 12 premières à nouveau » — une page 2 qui répète la page 1 donnerait
  -- l'illusion d'une galerie sans fin.
  v_fin := v_max - v_debut;
  if v_fin <= 0 then
    return;
  end if;

  return query
  select m.id, m.thumb_path, m.preview_path, m.width, m.height,
         -- Le vrai nombre de photos de l'album, pas le nombre servi : « et 188 autres » est
         -- l'argument de vente, il n'y a rien à cacher là-dessus.
         count(*) over () as total,
         v_max as visibles
  from media_assets m
  where m.album_id = r.album_id
    and m.status = 'ready'
    and m.thumb_path is not null
  order by m.position, m.created_at, m.id
  limit least(greatest(1, least(coalesce(p_limit, 60), 200)), v_fin)
  offset v_debut;
end;
$$;

comment on function media_gallery_photos is
  'Photos visibles AVANT achat sur un lien public : au plus preview_limit, jamais davantage. La limite est appliquée ici et pas à l''affichage — des chemins envoyés au navigateur puis masqués en CSS ne protègent rien.';

grant execute on function media_gallery_photos(text, text, text, integer, integer) to anon, authenticated;

-- ── La page doit savoir ce qu'elle ne montre pas ───────────────────────────────────────────
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
  offre jsonb,
  apercu_limite integer
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
    return query select false, r.raison, null::uuid, null::text, null::date, null::text, null::text,
                        null::text, null::integer, (r.raison = 'mot_de_passe'), null::boolean,
                        null::boolean, null::jsonb, null::integer;
    return;
  end if;

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
         (a.secure_collection_ref is not null
          and not exists (select 1 from media_assets m where m.album_id = a.id and m.status = 'ready')),
         a.watermark_previews,
         v_offre,
         _media_gallery_preview_limit(r.link_id)
  from media_albums a
  left join clubs c on c.id = a.club_id
  left join club_teams t on t.id = a.team_id
  where a.id = r.album_id;
end;
$$;

comment on function media_gallery_open is
  'Ouvre une galerie publique depuis son lien. `offre` porte la formule vendue par CE lien (null = lien historique), `apercu_limite` le nombre de photos montrées avant achat.';

grant execute on function media_gallery_open(text, text, text) to anon, authenticated;

commit;
