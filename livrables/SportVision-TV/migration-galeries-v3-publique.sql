-- Migration : Galeries SportVision — ouverture publique (Lot 2)
-- À exécuter APRÈS migration-galeries-v2-upload.sql.
--
-- ── La règle qui gouverne ce fichier ──
-- L'accès anonyme est porté par le LIEN, jamais par `access_mode` (décision du 07/09, inchangée).
-- Concrètement : `can_access_media()` n'est pas touchée, aucune policy « lisible par tous » n'est
-- ajoutée sur media_albums ni media_assets, et tout ce qu'un visiteur sans compte peut lire passe
-- par les trois fonctions ci-dessous, qui vérifient le jeton avant de renvoyer quoi que ce soit.
--
-- Une policy RLS ne saurait pas faire ce travail : elle ne peut ni recevoir un jeton, ni vérifier
-- un mot de passe, ni journaliser une vue. C'est pour ça que le socle avait laissé ces tables
-- fermées, et c'est ici que la porte s'ouvre — d'un seul côté, et sous condition.
--
-- ── Ce qui n'est JAMAIS renvoyé au public ──
--   * `original_path` : le chemin du fichier vendu. Le frontend public n'en a aucun besoin et ne
--     doit pas pouvoir le construire (§28 du prompt).
--   * `secure_collection_ref` : le lien de livraison privée des anciens albums. Le renvoyer
--     donnerait à quiconque détient le lien de galerie l'accès à la collection complète, en pleine
--     résolution, sans achat. Un simple booléen `livraison_externe` suffit à ce que la page dise
--     « ces photos vous sont livrées par lien privé » sans rien divulguer (§25).

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. TAILLE D'UN PACK
-- ═══════════════════════════════════════════════════════════════════════════
-- `media_products.type='pack'` existait déjà, mais rien ne disait COMBIEN de photos contient un
-- pack : impossible d'appliquer « 5 photos = 15 € » sans cette information. Elle va dans
-- `metadata`, colonne jsonb déjà présente et prévue pour ça, plutôt que dans une nouvelle colonne
-- qui ne servirait qu'à un seul des sept types de produits.
create or replace function media_product_pack_size(p_metadata jsonb, p_type text)
returns integer
language sql
immutable
as $$
  select case
    when p_type <> 'pack' then null
    when p_metadata ? 'photo_count' and (p_metadata ->> 'photo_count') ~ '^[0-9]+$'
      then (p_metadata ->> 'photo_count')::integer
    else null
  end;
$$;

comment on function media_product_pack_size is
  'Nombre de photos d''un produit de type pack, lu dans media_products.metadata->>photo_count. Renvoie NULL si le pack n''est pas configuré : un pack sans taille n''est simplement pas proposé, plutôt que d''être appliqué au hasard.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. VALIDATION DU LIEN — une seule fonction, réutilisée par les trois RPC
-- ═══════════════════════════════════════════════════════════════════════════
-- Interne (non grantée à anon) : elle renvoie l'album_id, donc l'exposer permettrait de tester des
-- jetons en masse avec une réponse plus riche que nécessaire.
create or replace function _media_gallery_resolve(p_slug text, p_token text, p_password text)
returns table (album_id uuid, link_id uuid, raison text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v record;
begin
  select l.id as link_id, l.album_id, l.token, l.password_hash, l.is_enabled, l.expires_at,
         a.status as album_status
  into v
  from media_album_links l
  join media_albums a on a.id = l.album_id
  where lower(l.slug) = lower(coalesce(p_slug, ''))
  limit 1;

  if not found then
    return query select null::uuid, null::uuid, 'introuvable';
    return;
  end if;

  -- Le jeton est comparé en temps constant : une comparaison ordinaire s'arrête au premier octet
  -- différent, ce qui laisse deviner un jeton caractère par caractère en mesurant le temps de
  -- réponse. Le slug, lui, est public par nature — il n'a rien à protéger.
  if v.token is null or p_token is null or length(v.token) <> length(p_token)
     or not _media_constant_time_eq(v.token, p_token) then
    return query select null::uuid, null::uuid, 'introuvable';
    return;
  end if;

  if not v.is_enabled then
    return query select null::uuid, null::uuid, 'desactive';
    return;
  end if;
  if v.expires_at is not null and v.expires_at < now() then
    return query select null::uuid, null::uuid, 'expire';
    return;
  end if;
  if v.album_status <> 'published' then
    return query select null::uuid, null::uuid, 'non_publie';
    return;
  end if;
  if v.password_hash is not null then
    if p_password is null or p_password = '' then
      return query select null::uuid, v.link_id, 'mot_de_passe';
      return;
    end if;
    -- `extensions.crypt` et non `crypt` : pgcrypto est installe dans le schema `extensions`
    -- chez Supabase, et le search_path fige de ces fonctions ne le contient pas. Sans la
    -- qualification, la verification de mot de passe echouerait a l'execution.
    if extensions.crypt(p_password, v.password_hash) <> v.password_hash then
      return query select null::uuid, v.link_id, 'mot_de_passe_invalide';
      return;
    end if;
  end if;

  return query select v.album_id, v.link_id, null::text;
end;
$$;

/** Comparaison à temps constant de deux chaînes de même longueur. */
create or replace function _media_constant_time_eq(a text, b text)
returns boolean
language plpgsql
immutable
as $$
declare
  diff integer := 0;
  i integer;
begin
  if a is null or b is null or length(a) <> length(b) then
    return false;
  end if;
  for i in 1..length(a) loop
    diff := diff | (ascii(substr(a, i, 1)) # ascii(substr(b, i, 1)));
  end loop;
  return diff = 0;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. OUVERTURE DE LA GALERIE
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function media_gallery_open(p_slug text, p_token text, p_password text default null)
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
  watermark boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  select * into r from _media_gallery_resolve(p_slug, p_token, p_password);

  if r.raison is not null then
    -- 'mot_de_passe' n'est pas un refus : c'est une demande. La page affiche un champ plutôt
    -- qu'une erreur, et le visiteur ne sait rien de plus sur l'album pour autant.
    return query select false, r.raison, null::uuid, null::text, null::date, null::text, null::text,
                        null::text, null::integer, (r.raison = 'mot_de_passe'), null::boolean, null::boolean;
    return;
  end if;

  return query
  select true, null::text, a.id, a.title, a.event_date, c.nom, t.name, a.cover_preview_url,
         (select count(*)::integer from media_assets m where m.album_id = a.id and m.status = 'ready'),
         false,
         -- Anciens albums livrés par lien privé : on dit qu'il existe, on ne le donne jamais.
         (a.secure_collection_ref is not null
          and not exists (select 1 from media_assets m where m.album_id = a.id and m.status = 'ready')),
         a.watermark_previews
  from media_albums a
  left join clubs c on c.id = a.club_id
  left join club_teams t on t.id = a.team_id
  where a.id = r.album_id;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. LES PHOTOS — paginées, dérivés uniquement
-- ═══════════════════════════════════════════════════════════════════════════
-- `total` est renvoyé sur chaque ligne : la page sait combien il reste à charger sans une seconde
-- requête. Les dimensions accompagnent chaque photo pour que la grille réserve la place exacte
-- avant que l'image arrive — c'est ce qui évite que la page saute pendant le chargement.
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
  total bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  select * into r from _media_gallery_resolve(p_slug, p_token, p_password);
  if r.raison is not null then
    return;
  end if;

  return query
  select m.id, m.thumb_path, m.preview_path, m.width, m.height, count(*) over () as total
  from media_assets m
  where m.album_id = r.album_id
    and m.status = 'ready'
    and m.thumb_path is not null
  order by m.position, m.created_at, m.id
  limit greatest(1, least(coalesce(p_limit, 60), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. LES PRODUITS APPLICABLES À CET ALBUM
-- ═══════════════════════════════════════════════════════════════════════════
-- Même règle de portée que fetchAvailableMediaProducts (app-connect) : produit du club, ou produit
-- d'équipe dont la liste contient l'équipe de l'album. Deux différences assumées :
--   * la saison est vérifiée. Un produit de la saison passée ne doit pas être vendu sur un album
--     de cette saison.
--   * les bornes valid_from / valid_until sont respectées. Les colonnes existaient et n'étaient
--     lues nulle part : une opération de vente fermée restait achetable.
-- `override_product_ids` sur l'album, s'il est renseigné, remplace entièrement la sélection : c'est
-- le sens de la colonne posée par le moteur générique.
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
  v_album media_albums;
begin
  select * into r from _media_gallery_resolve(p_slug, p_token, p_password);
  if r.raison is not null then
    return;
  end if;
  -- `media_albums.id` et non `id` : cette fonction déclare une colonne de sortie nommée `id`
  -- (RETURNS TABLE), et PL/pgSQL refuse une référence ambiguë entre une variable et une colonne.
  -- Trouvé en ouvrant la vraie galerie : la liste de produits remontait vide, donc aucune
  -- mécanique de panier ne s'affichait.
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
          -- `team_ids` est un uuid[] (vérifié en base), pas un text[] : comparer avec un
          -- `::text` produisait « operator does not exist: text = uuid » et faisait échouer toute
          -- la résolution de produits.
          or (p.scope_type = 'team' and v_album.team_id is not null and v_album.team_id = any (p.team_ids))
          or (p.scope_type = 'event' and v_album.event_id is not null)
      end
    )
    -- Un pack sans taille configurée n'est pas proposé : mieux vaut ne pas le vendre que
    -- l'appliquer sur un nombre de photos inventé.
    and (p.type <> 'pack' or media_product_pack_size(p.metadata, p.type) is not null)
  order by p.price_cents;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. COMPTAGE DES VUES (§26)
-- ═══════════════════════════════════════════════════════════════════════════
-- Le visiteur est identifié par un jeton de SESSION aléatoire, généré par la page et gardé le
-- temps de l'onglet. Ce n'est pas une empreinte de navigateur : rien n'est déduit de l'appareil,
-- et un nouvel onglet est un nouveau visiteur. C'est délibérément moins précis qu'un fingerprint,
-- et suffisant pour distinguer « vue » de « visiteur ».
--
-- Le jeton est haché avec l'identifiant de l'album avant stockage : même en lisant la table, on ne
-- peut pas rapprocher deux galeries visitées par la même personne.
create or replace function media_gallery_track_view(p_slug text, p_token text, p_session text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_hash text;
  v_recent boolean;
begin
  select * into r from _media_gallery_resolve(p_slug, p_token, null);
  -- Un mot de passe non fourni n'empêche pas de compter l'ouverture : le visiteur est bien arrivé
  -- sur la galerie. Un jeton invalide, si.
  if r.album_id is null and r.raison is distinct from 'mot_de_passe' then
    return;
  end if;
  if r.album_id is null then
    select l.album_id into r.album_id from media_album_links l where l.id = r.link_id;
  end if;

  -- Meme raison que pour crypt : pgcrypto vit dans le schema `extensions`.
  v_hash := encode(extensions.digest(coalesce(p_session, '') || ':' || r.album_id::text, 'sha256'), 'hex');

  select exists (
    select 1 from media_album_views v
    where v.album_id = r.album_id and v.visitor_hash = v_hash and v.viewed_at > now() - interval '30 minutes'
  ) into v_recent;

  -- Un rechargement de page dans la même demi-heure n'est pas une nouvelle vue : sinon le compteur
  -- mesure la nervosité du visiteur, pas l'intérêt pour la galerie.
  if v_recent then
    return;
  end if;

  insert into media_album_views (album_id, link_id, visitor_hash)
  values (r.album_id, r.link_id, v_hash);

  update media_album_links l
  set view_count = l.view_count + 1,
      unique_visitor_count = (
        select count(distinct v.visitor_hash) from media_album_views v where v.album_id = r.album_id
      )
  where l.id = r.link_id;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. DROITS D'EXÉCUTION
-- ═══════════════════════════════════════════════════════════════════════════
-- `anon` : c'est tout l'objet de ce lot. Ces quatre fonctions sont la seule surface publique des
-- galeries, et chacune commence par vérifier le jeton.
revoke all on function _media_gallery_resolve(text, text, text) from public;
revoke all on function media_gallery_open(text, text, text) from public;
revoke all on function media_gallery_photos(text, text, text, integer, integer) from public;
revoke all on function media_gallery_products(text, text, text) from public;
revoke all on function media_gallery_track_view(text, text, text) from public;

grant execute on function media_gallery_open(text, text, text) to anon, authenticated;
grant execute on function media_gallery_photos(text, text, text, integer, integer) to anon, authenticated;
grant execute on function media_gallery_products(text, text, text) to anon, authenticated;
grant execute on function media_gallery_track_view(text, text, text) to anon, authenticated;

commit;
