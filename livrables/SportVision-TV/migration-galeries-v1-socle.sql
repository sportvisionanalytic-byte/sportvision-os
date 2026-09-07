-- Migration : Galeries SportVision — socle (Lot 0)
-- À exécuter dans Supabase → SQL Editor.
--
-- Spec : master prompt « Galeries SportVision » (Fouka, 07/09/2026).
-- Décisions prises avec Fouka avant écriture :
--   * dérivés (vignette / preview filigranée) générés À L'UPLOAD, stockés dans Supabase ;
--   * achat 100 % anonyme, compte Connect proposé APRÈS, le droit temporaire devenant permanent
--     au rattachement.
--
-- ── CE QUE CETTE MIGRATION NE FAIT PAS, ET POURQUOI ──
--
-- Elle ne crée PAS de brique « galeries ». L'audit du 07/09 a montré que le moteur média
-- générique posé le 02/09 couvre déjà la moitié de la spec, avec le même vocabulaire :
--   media_albums            = la galerie (club, équipe, mission, saison, événement, statut)
--   media_products          = la tarification pilotée depuis l'OS. Ses types sont déjà
--                             exactement ceux du prompt : photo_unite, pack, album_complet,
--                             pass_saison, evenementiel, physique
--   media_club_policy       = le modèle commercial par défaut du club
--   media_sales_operations  = les opérations (photo de rentrée, tournoi, media day, stage)
--   media_access_rules      = consultation seule / téléchargement / partage / visibilité
--   media_orders + Stripe   = commande et paiement, droit écrit par le seul webhook
--   media_entitlements      = droit durable, bénéficiaire ≠ acheteur
--   can_access_media()      = la fonction d'accès unique, non dupliquée
-- Rien de tout ça n'est touché ici. Une deuxième modélisation de la même chose serait la pire
-- issue possible pour ce chantier.
--
-- Elle ne modifie PAS non plus `can_access_media()` ni la signification de `access_mode`.
-- C'était l'option la plus évidente pour ouvrir les galeries au public, et c'est justement pour
-- ça qu'elle est écartée : `access_mode='public'` signifie aujourd'hui « gratuit pour les
-- familles du club », après un contrôle d'appartenance. Lui faire dire « visible par tout
-- Internet » changerait rétroactivement le sens d'une valeur déjà utilisée par le moteur.
-- L'accès anonyme est donc porté par le LIEN (media_album_links), jamais par le mode d'accès :
-- qui détient le lien voit les previews, et rien d'autre. Les fichiers d'origine restent
-- gouvernés par can_access_media() et par les droits de téléchargement, inchangés.
--
-- ── CE QUI MANQUAIT VRAIMENT (constat d'audit, vérifié en base) ──
--   1. AUCUNE photo n'existe dans le système. `media_albums.photo_count` est un entier saisi à
--      la main dans l'OS et `secure_collection_ref` un lien externe collé par le staff : on ne
--      vend pas des photos, on vend l'accès à un lien. D'où `media_assets`.
--   2. Aucun lien public de galerie (ni slug, ni jeton). D'où `media_album_links`.
--   3. `media_orders.purchased_by_user_id` et `beneficiary_person_id` sont NOT NULL : une
--      commande anonyme est littéralement impossible à représenter. D'où la section 5.
--   4. Une commande = un produit unique. Un panier de 5 photos n'a pas de forme.
--      D'où `media_order_items`.
--   5. Aucune vue anonyme tracée (media_link_access_log ne trace que les ouvertures HD par un
--      compte connecté). D'où `media_album_views`.
--
-- ── Contexte vérifié en base réelle AVANT écriture (07/09/2026) ──
--   media_albums 0 ligne · media_products 0 · media_orders 0 · media_entitlements 1
--   media_sales_operations 2 · buckets : sportvision-media-prive (privé, 15 Mo/fichier)
--   pgcrypto et unaccent présents (jetons et slugs).
--   Aucune galerie réelle n'existe encore : c'est le bon moment pour poser le socle.

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. LA PHOTO — l'entité qui manquait
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists media_assets (
  id uuid default gen_random_uuid() primary key,
  album_id uuid references media_albums(id) on delete cascade not null,
  -- Dénormalisé depuis l'album : toutes les policies et tous les filtres passent par le club.
  -- Le trigger de la section 6 le maintient, il n'est jamais à renseigner par l'appelant.
  club_id uuid references clubs(id) on delete cascade not null,

  -- 'video' est accepté dès maintenant alors que la V1 ne traite que la photo (§7 du prompt) :
  -- ajouter une valeur à une contrainte check plus tard est trivial, mais découvrir à ce
  -- moment-là que toute la chaîne suppose une image ne l'est pas.
  kind text not null default 'photo',

  -- Trois fichiers par média, c'est le cœur de la décision prise avec Fouka : les dérivés sont
  -- produits à l'upload, pas à la volée.
  --   original : le fichier vendu, bucket PRIVÉ, jamais servi sans droit vérifié
  --   preview   : basse résolution filigranée, c'est ce que voit un visiteur anonyme
  --   thumb     : vignette de grille, c'est ce qui doit charger vite sur un mobile en 4G
  storage_bucket text not null default 'sportvision-media-prive',
  original_path text not null,
  preview_path text,
  thumb_path text,

  width integer,
  height integer,
  bytes bigint,
  -- Empreinte du fichier d'origine. Permet de réimporter un dossier sans recréer ce qui est déjà
  -- là : un photographe qui relance un envoi interrompu ne doit pas produire 400 doublons.
  checksum text,

  position integer not null default 0,
  status text not null default 'ready',
  captured_at timestamptz,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint media_assets_kind_check check (kind in ('photo','video')),
  constraint media_assets_status_check check (status in ('uploading','ready','hidden','removed')),
  constraint media_assets_bytes_check check (bytes is null or bytes >= 0)
);

-- Un même chemin de stockage ne peut pas être référencé deux fois dans le même album.
create unique index if not exists media_assets_path_uniq on media_assets (album_id, original_path);

-- Idempotence d'upload. Partiel : un checksum non calculé (NULL) ne doit bloquer personne.
create unique index if not exists media_assets_checksum_uniq
  on media_assets (album_id, checksum) where checksum is not null;

-- Index de lecture de la grille : c'est LA requête chaude de la galerie publique.
create index if not exists idx_massets_album on media_assets (album_id, position, id)
  where status = 'ready';
create index if not exists idx_massets_club on media_assets (club_id);

comment on column media_assets.original_path is
  'Chemin du fichier vendu dans le bucket privé. N''est jamais exposé au client : la galerie sert `preview_path`, et le téléchargement passe par une URL signée émise après vérification du droit.';
comment on column media_assets.checksum is
  'Empreinte du fichier source. Rend un réimport idempotent : relancer un envoi interrompu ne recrée pas ce qui est déjà en place.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LE LIEN PUBLIC — c'est lui qui porte l'accès anonyme, pas le mode d'accès
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists media_album_links (
  id uuid default gen_random_uuid() primary key,
  album_id uuid references media_albums(id) on delete cascade not null,

  -- Deux identifiants, deux usages, et c'est volontaire :
  --   slug  : lisible et partageable à l'oral ou sur une affiche (/gallery/villemomble-cup-u12)
  --   token : non devinable, c'est lui qui fait la sécurité. Un slug lisible est par nature
  --           énumérable ; sans jeton, deviner « nom-du-club-u12 » ouvrirait la galerie.
  slug text not null,
  token text not null default encode(gen_random_bytes(18), 'base64'),

  -- Optionnel (§10). Stocké haché : un mot de passe de galerie reste un mot de passe, et
  -- certains parents réutilisent le leur.
  password_hash text,

  is_enabled boolean not null default true,
  expires_at timestamptz,

  -- Dénormalisés depuis media_album_views pour l'écran de l'OS : afficher un compteur ne doit pas
  -- coûter un COUNT sur toutes les vues à chaque ouverture de la liste.
  view_count integer not null default 0,
  unique_visitor_count integer not null default 0,

  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists media_album_links_slug_uniq on media_album_links (lower(slug));
create unique index if not exists media_album_links_token_uniq on media_album_links (token);
create index if not exists idx_malinks_album on media_album_links (album_id) where is_enabled;

comment on table media_album_links is
  'Lien public d''une galerie. Un album peut en avoir plusieurs : révoquer un lien qui a trop circulé ne doit pas obliger à casser celui imprimé sur les affiches du tournoi.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. LES VUES — statistiques (§24) sans donnée personnelle
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists media_album_views (
  id uuid default gen_random_uuid() primary key,
  album_id uuid references media_albums(id) on delete cascade not null,
  link_id uuid references media_album_links(id) on delete set null,
  -- Empreinte anonyme = hash(adresse IP + jour + sel). Compter les visiteurs uniques sans
  -- conserver d'adresse IP : la donnée brute n'est jamais écrite, et l'empreinte change chaque
  -- jour, donc elle ne permet pas de suivre quelqu'un dans le temps.
  visitor_hash text,
  user_id uuid references auth.users on delete set null,
  viewed_at timestamptz not null default now()
);

create index if not exists idx_maviews_album on media_album_views (album_id, viewed_at desc);
create index if not exists idx_maviews_dedup on media_album_views (album_id, visitor_hash, viewed_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. LE PANIER — une commande peut enfin contenir plusieurs lignes
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists media_order_items (
  id uuid default gen_random_uuid() primary key,
  order_id uuid references media_orders(id) on delete cascade not null,
  -- Le produit tel que l'OS l'a configuré : c'est lui qui porte le prix de référence.
  product_id uuid references media_products(id) on delete restrict,
  -- La photo concernée. NULL pour un produit qui ne cible pas une photo précise (album complet,
  -- pass saison) : la ligne porte alors l'album.
  asset_id uuid references media_assets(id) on delete set null,
  album_id uuid references media_albums(id) on delete set null,

  -- Prix RECOPIÉ à la commande, jamais relu depuis media_products à l'affichage d'une facture :
  -- un tarif qui change en cours de saison ne doit pas réécrire l'histoire des ventes passées.
  unit_price_cents integer not null,
  quantity integer not null default 1,
  created_at timestamptz not null default now(),

  constraint media_order_items_price_check check (unit_price_cents >= 0),
  constraint media_order_items_qty_check check (quantity > 0)
);

create index if not exists idx_moitems_order on media_order_items (order_id);
create index if not exists idx_moitems_asset on media_order_items (asset_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. LA COMMANDE INVITÉE — ouverture de media_orders à l'anonyme
-- ═══════════════════════════════════════════════════════════════════════════
-- Aujourd'hui purchased_by_user_id ET beneficiary_person_id sont NOT NULL : une commande sans
-- compte est impossible à écrire. C'est ce qui obligeait le parcours invité existant à créer un
-- compte AVANT le paiement — exactement la friction que le §12 demande de supprimer.

alter table media_orders add column if not exists guest_email text;
alter table media_orders add column if not exists guest_name text;
-- La galerie d'origine de la commande : sans elle, impossible de dire quelle galerie a vendu
-- quoi (§24), ni de retrouver le contexte d'un achat depuis l'OS.
alter table media_orders add column if not exists album_id uuid references media_albums(id) on delete set null;

alter table media_orders alter column purchased_by_user_id drop not null;
alter table media_orders alter column beneficiary_person_id drop not null;
-- Une commande à plusieurs lignes n'a plus un produit unique : il vit désormais dans
-- media_order_items. La colonne reste pour tout ce qui existe déjà (pass, produit unitaire).
alter table media_orders alter column product_id drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'media_orders_buyer_check') then
    -- Le garde-fou qui remplace les NOT NULL retirés : une commande appartient toujours à
    -- quelqu'un, compte Connect ou adresse e-mail. Jamais à personne.
    alter table media_orders add constraint media_orders_buyer_check
      check (purchased_by_user_id is not null or guest_email is not null);
  end if;
end $$;

create index if not exists idx_mord_guest_email on media_orders (lower(guest_email))
  where guest_email is not null;
create index if not exists idx_mord_album on media_orders (album_id);

-- `mord_self_select` (purchased_by_user_id = auth.uid()) reste correct tel quel : avec une
-- colonne désormais nullable, la comparaison vaut NULL pour une commande invitée, donc faux.
-- Aucune commande invitée ne fuite vers un utilisateur connecté.

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. LE DROIT DE TÉLÉCHARGER — y compris sans compte
-- ═══════════════════════════════════════════════════════════════════════════
-- Décision produit du 07/09 : l'acheteur anonyme reçoit un droit TEMPORAIRE porté par un jeton
-- envoyé par e-mail. Créer un compte Connect ne redonne pas accès, il PROMEUT ce droit en droit
-- permanent (media_entitlements). C'est ce qui permet d'avoir à la fois l'achat sans compte du
-- §12 et la garantie de retrouver ses photos du §15, qui semblaient s'exclure.

create table if not exists media_download_grants (
  id uuid default gen_random_uuid() primary key,
  order_id uuid references media_orders(id) on delete cascade not null,
  token text not null default encode(gen_random_bytes(24), 'base64'),
  email text not null,

  -- Une durée, et pas un accès perpétuel : un lien de téléchargement circule sur WhatsApp aussi
  -- bien que le lien de galerie. 30 jours laissent largement le temps de récupérer ses fichiers,
  -- et la création d'un compte Connect lève la limite pour de bon.
  expires_at timestamptz not null default (now() + interval '30 days'),
  max_downloads integer,
  download_count integer not null default 0,

  -- Rempli quand l'invité crée son compte avec la même adresse (§16). C'est la trace du
  -- rattachement, et la garantie qu'il n'a lieu qu'une fois.
  claimed_by_user_id uuid references auth.users on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),

  constraint media_download_grants_downloads_check check (download_count >= 0),
  constraint media_download_grants_max_check check (max_downloads is null or max_downloads > 0)
);

create unique index if not exists media_download_grants_token_uniq on media_download_grants (token);
create index if not exists idx_mdgrants_email on media_download_grants (lower(email));
create index if not exists idx_mdgrants_order on media_download_grants (order_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. COHÉRENCE AUTOMATIQUE
-- ═══════════════════════════════════════════════════════════════════════════

-- club_id d'un asset : recopié depuis son album, jamais accepté depuis l'appelant. Un client qui
-- pourrait le choisir pourrait ranger une photo dans le club d'un autre.
create or replace function media_assets_set_club()
returns trigger
language plpgsql
as $$
begin
  select club_id into new.club_id from media_albums where id = new.album_id;
  if new.club_id is null then
    raise exception 'Album introuvable : %', new.album_id using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_media_assets_club on media_assets;
create trigger trg_media_assets_club
  before insert or update of album_id on media_assets
  for each row execute function media_assets_set_club();

-- photo_count : dérivé dès qu'un album contient de vraies photos.
--
-- Le compteur est aujourd'hui SAISI À LA MAIN dans l'OS, parce qu'un album n'était qu'un pointeur
-- vers une collection externe. Les deux modes doivent cohabiter le temps de la transition : tant
-- qu'un album n'a aucun asset, la valeur saisie est respectée ; dès qu'il en a, elle est
-- recalculée. Sans cette précaution, poser ce trigger remettrait à 0 le compteur de tous les
-- albums livrés par lien externe.
create or replace function media_album_refresh_photo_count()
returns trigger
language plpgsql
as $$
declare
  v_album uuid := coalesce(new.album_id, old.album_id);
  v_count integer;
begin
  select count(*) into v_count from media_assets
  where album_id = v_album and status = 'ready';

  if v_count > 0 then
    update media_albums set photo_count = v_count, updated_at = now() where id = v_album;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_media_assets_count on media_assets;
create trigger trg_media_assets_count
  after insert or delete or update of status, album_id on media_assets
  for each row execute function media_album_refresh_photo_count();

drop trigger if exists trg_media_assets_upd on media_assets;
create trigger trg_media_assets_upd before update on media_assets
  for each row execute function media_touch_updated_at();

drop trigger if exists trg_media_album_links_upd on media_album_links;
create trigger trg_media_album_links_upd before update on media_album_links
  for each row execute function media_touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. RLS
-- ═══════════════════════════════════════════════════════════════════════════
-- Même doctrine que media_albums, qui n'a volontairement AUCUNE policy SELECT pour
-- `authenticated` : tout ce que lit un non-staff passe par une fonction SECURITY DEFINER
-- (media_album_list, media_album_get_link) qui vérifie le droit à cet instant précis. On ne
-- déroge pas ici. Les tables ci-dessous sont donc fermées, et les galeries publiques seront
-- servies par des RPC dédiées (Lot 1), jamais par une policy « lisible par tous » — une policy
-- ne sait pas vérifier un jeton de lien ni journaliser une vue.

alter table media_assets enable row level security;
alter table media_album_links enable row level security;
alter table media_album_views enable row level security;
alter table media_order_items enable row level security;
alter table media_download_grants enable row level security;

drop policy if exists massets_staff_all on media_assets;
create policy massets_staff_all on media_assets
  for all using (media_staff_write()) with check (media_staff_write());

drop policy if exists malinks_staff_all on media_album_links;
create policy malinks_staff_all on media_album_links
  for all using (media_staff_write()) with check (media_staff_write());

-- Le journal de vues est en lecture seule pour les humains, comme calendar_sync_runs : il est
-- écrit par la RPC d'ouverture de galerie (service de la fonction), et personne ne doit pouvoir
-- gonfler ou effacer des statistiques de vente.
drop policy if exists maviews_staff_select on media_album_views;
create policy maviews_staff_select on media_album_views
  for select using (media_commerce_staff());

-- Un acheteur voit le détail de SES commandes ; le staff commerce voit tout. Miroir exact de
-- mord_self_select sur media_orders : une ligne de commande ne doit pas être plus visible que la
-- commande qui la porte.
drop policy if exists moitems_self_select on media_order_items;
create policy moitems_self_select on media_order_items
  for select using (
    exists (
      select 1 from media_orders o
      where o.id = media_order_items.order_id and o.purchased_by_user_id = auth.uid()
    )
  );

drop policy if exists moitems_staff_all on media_order_items;
create policy moitems_staff_all on media_order_items
  for all using (media_commerce_staff()) with check (media_commerce_staff());

-- Aucune policy SELECT pour l'acheteur sur les droits de téléchargement : le jeton EST le droit,
-- et il ne se lit que par la RPC qui le vérifie. Le laisser lisible reviendrait à distribuer des
-- jetons de téléchargement à qui sait lire une table.
drop policy if exists mdgrants_staff_all on media_download_grants;
create policy mdgrants_staff_all on media_download_grants
  for all using (media_commerce_staff()) with check (media_commerce_staff());

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. FABRIQUE DE SLUG
-- ═══════════════════════════════════════════════════════════════════════════
-- `unaccent` est déjà installé (vérifié avant écriture). Le suffixe court n'est ajouté que si le
-- slug lisible est déjà pris : deux tournois du même nom à deux saisons d'écart, c'est fréquent.

create or replace function media_gallery_slugify(p_text text)
returns text
language plpgsql
immutable
as $$
declare
  v text;
begin
  v := lower(unaccent(coalesce(p_text, '')));
  v := regexp_replace(v, '[^a-z0-9]+', '-', 'g');
  v := regexp_replace(v, '(^-+|-+$)', '', 'g');
  v := left(v, 60);
  if v = '' then v := 'galerie'; end if;
  return v;
end;
$$;

create or replace function media_gallery_unique_slug(p_text text)
returns text
language plpgsql
as $$
declare
  v_base text := media_gallery_slugify(p_text);
  v_try text := v_base;
  i integer := 0;
begin
  while exists (select 1 from media_album_links where lower(slug) = v_try) loop
    i := i + 1;
    v_try := v_base || '-' || i;
    if i > 50 then
      v_try := v_base || '-' || encode(gen_random_bytes(3), 'hex');
      exit;
    end if;
  end loop;
  return v_try;
end;
$$;

commit;
