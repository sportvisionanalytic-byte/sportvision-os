-- migration-media-v1-moteur-generique.sql (02/09/2026)
--
-- Moteur générique de commercialisation média (master prompt Fouka) : remplace le prototype
-- "Pass Photo" (migration-connect-pass-photo-v1, 28/08) par un moteur configurable depuis l'OS,
-- sans aucune logique par club en dur. Décision validée par Fouka le 02/09 : remplacement direct
-- (photo_albums = 0 ligne, photo_pass_entitlements = 0 ligne — jamais activé commercialement,
-- prix Stripe jamais créé, donc aucune migration de données réelles à faire).
--
-- Chaîne : club → saison → media_club_policy (politique par défaut) → media_products (produits
-- vendables) → media_sales_operations (opérations type "photo de rentrée"/tournoi, override
-- événement) → media_albums (override par album) → media_orders → media_entitlements →
-- can_access_media() (fonction centrale unique, jamais dupliquée).
--
-- Réutilisé tel quel de l'existant (voir audit du 02/09) : le doctrine RPC-only de
-- photo_album_list (aucun SELECT direct sur une table portant un lien de déverrouillage),
-- is_family_of_team/is_own_player/is_confirmed_parent_of (déjà réels, déjà testés), stripe_events
-- (idempotence webhook, inchangé).

-- ══════════════════════════════════════════════════════════════════════════
-- 1. SAISONS — entité globale, source de vérité unique (décision Fouka 02/09).
--    clubs.saison / team_memberships.saison restent en texte libre (aucun consommateur existant
--    réécrit dans cette migration, trop de points d'usage pour une réécriture sûre en une passe)
--    mais gagnent une colonne saison_id synchronisée automatiquement par trigger — la définition
--    de la saison (dates) devient unique, sans casser aucun code déjà en place.
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.saisons (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  date_debut date,
  date_fin date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.saisons is 'Référentiel global des saisons (ex. 2026-2027) — source de vérité unique pour le moteur média et, progressivement, pour clubs.saison/team_memberships.saison via saison_id.';

alter table public.saisons enable row level security;
create policy "saisons_select_authenticated" on public.saisons for select using (auth.uid() is not null);
create policy "saisons_staff_write" on public.saisons for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec'))
) with check (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec'))
);

create or replace function public.get_or_create_saison(p_label text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if p_label is null or btrim(p_label) = '' then
    return null;
  end if;
  select id into v_id from saisons where label = p_label;
  if v_id is null then
    insert into saisons (label) values (p_label)
    on conflict (label) do update set label = excluded.label
    returning id into v_id;
  end if;
  return v_id;
end;
$function$;
comment on function public.get_or_create_saison(text) is 'Résout un libellé de saison (ex. 2026-2027) vers son id dans saisons, en la créant si nécessaire — appelé par les triggers de synchronisation clubs/team_memberships et par le moteur média.';

alter table public.clubs add column if not exists saison_id uuid references public.saisons(id);
alter table public.team_memberships add column if not exists saison_id uuid references public.saisons(id);

create or replace function public.sync_saison_id()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  new.saison_id := public.get_or_create_saison(new.saison);
  return new;
end;
$function$;

drop trigger if exists trg_clubs_sync_saison_id on public.clubs;
create trigger trg_clubs_sync_saison_id before insert or update of saison on public.clubs
  for each row execute function public.sync_saison_id();

drop trigger if exists trg_team_memberships_sync_saison_id on public.team_memberships;
create trigger trg_team_memberships_sync_saison_id before insert or update of saison on public.team_memberships
  for each row execute function public.sync_saison_id();

-- Backfill des lignes déjà existantes (déclenche le trigger via un update sur elle-même).
update public.clubs set saison = saison where saison is not null and saison_id is null;
update public.team_memberships set saison = saison where saison is not null and saison_id is null;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. Helper RLS générique : famille (joueur ou parent confirmé) d'un club, pas seulement d'une
--    équipe — nécessaire pour la lecture des produits/politiques par des familles qui ne sont
--    jamais club_members (doctrine déjà établie : un joueur/parent ne devient jamais club_members).
-- ══════════════════════════════════════════════════════════════════════════

create or replace function public.is_family_of_club(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from team_memberships tm
    join player_profiles p on p.id = tm.player_id
    where tm.club_id = p_club_id and tm.statut = 'active'
      and (p.user_id = auth.uid() or is_confirmed_parent_of(p.id))
  );
$function$;

create or replace function public.media_staff_write()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec'));
$function$;
comment on function public.media_staff_write() is 'Admin/Direction + Secrétaire configurent le moteur média (point 37 du master prompt) — is_staff() reste utilisé pour la simple lecture, plus large (CM/RP/prod...).';

create or replace function public.media_touch_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. Politique média par défaut, par club et par saison (§3-4, §18-19 du master prompt).
-- ══════════════════════════════════════════════════════════════════════════

create table public.media_club_policy (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  saison_id uuid not null references public.saisons(id),
  default_policy text not null check (default_policy in ('gratuit','pass_saison','vente_unite','vente_pack','evenementiel','hybride')),
  revenue_share_pct numeric check (revenue_share_pct is null or (revenue_share_pct >= 0 and revenue_share_pct <= 100)),
  status text not null default 'draft' check (status in ('draft','active','paused','ended')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, saison_id)
);
comment on table public.media_club_policy is 'Politique média par défaut d''un club pour une saison donnée — point de départ de la résolution (priorité la plus basse), configurable uniquement depuis l''OS (media_staff_write). revenue_share_pct null = SportVision garde 100% (point 17), jamais hardcodé ailleurs.';

alter table public.media_club_policy enable row level security;
create policy "mcp_staff_write" on public.media_club_policy for all using (media_staff_write()) with check (media_staff_write());
create policy "mcp_read" on public.media_club_policy for select using (
  is_staff() or is_club_member(club_id) or is_family_of_club(club_id)
);
drop trigger if exists trg_mcp_updated_at on public.media_club_policy;
create trigger trg_mcp_updated_at before update on public.media_club_policy
  for each row execute function public.media_touch_updated_at();

-- ══════════════════════════════════════════════════════════════════════════
-- 4. Produits vendables (§6 du master prompt).
-- ══════════════════════════════════════════════════════════════════════════

create table public.media_products (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  saison_id uuid not null references public.saisons(id),
  name text not null,
  type text not null check (type in ('pass_saison','photo_unite','pack','album_complet','evenementiel','physique','autre')),
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'eur',
  scope_type text not null check (scope_type in ('club','team','event')),
  team_ids uuid[] not null default '{}',
  physical_product boolean not null default false,
  status text not null default 'draft' check (status in ('draft','active','paused','ended')),
  valid_from date,
  valid_until date,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_products_dates_check check (valid_until is null or valid_from is null or valid_until >= valid_from)
);
comment on table public.media_products is 'Catalogue des produits vendables (pass saison, photo à l''unité, pack, album complet, produit événementiel ou physique) — un club/saison peut en avoir plusieurs actifs simultanément (modèle hybride, point 6).';

alter table public.media_products enable row level security;
create policy "mprod_staff_write" on public.media_products for all using (media_staff_write()) with check (media_staff_write());
create policy "mprod_read" on public.media_products for select using (
  is_staff() or is_club_member(club_id) or is_family_of_club(club_id)
);
drop trigger if exists trg_mprod_updated_at on public.media_products;
create trigger trg_mprod_updated_at before update on public.media_products
  for each row execute function public.media_touch_updated_at();

-- ══════════════════════════════════════════════════════════════════════════
-- 5. Opérations commerciales (photo de rentrée, tournoi, media day... §7, §24-26).
-- ══════════════════════════════════════════════════════════════════════════

create table public.media_sales_operations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  saison_id uuid not null references public.saisons(id),
  name text not null,
  kind text not null check (kind in ('photo_rentree','tournoi','media_day','stage','autre')),
  event_id uuid references public.club_calendar_events(id),
  team_ids uuid[] not null default '{}',
  date_debut date,
  date_fin date,
  vente_debut timestamptz,
  vente_fin timestamptz,
  status text not null default 'draft' check (status in ('draft','active','paused','ended')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mso_dates_check check (date_fin is null or date_debut is null or date_fin >= date_debut),
  constraint mso_vente_dates_check check (vente_fin is null or vente_debut is null or vente_fin >= vente_debut)
);
comment on table public.media_sales_operations is 'Opération commerciale ponctuelle (template générique réutilisable pour n''importe quel club, point 24-26) — event_id la relie au calendrier club et sert d''override événement dans resolve_media_policy().';

create table public.media_sales_operation_products (
  sales_operation_id uuid not null references public.media_sales_operations(id) on delete cascade,
  product_id uuid not null references public.media_products(id) on delete cascade,
  primary key (sales_operation_id, product_id)
);

alter table public.media_sales_operations enable row level security;
create policy "mso_staff_write" on public.media_sales_operations for all using (media_staff_write()) with check (media_staff_write());
create policy "mso_read" on public.media_sales_operations for select using (
  is_staff() or is_club_member(club_id) or is_family_of_club(club_id)
);
drop trigger if exists trg_mso_updated_at on public.media_sales_operations;
create trigger trg_mso_updated_at before update on public.media_sales_operations
  for each row execute function public.media_touch_updated_at();

alter table public.media_sales_operation_products enable row level security;
create policy "msop_staff_write" on public.media_sales_operation_products for all using (
  exists (select 1 from media_sales_operations mso where mso.id = sales_operation_id and media_staff_write())
) with check (
  exists (select 1 from media_sales_operations mso where mso.id = sales_operation_id and media_staff_write())
);
create policy "msop_read" on public.media_sales_operation_products for select using (
  exists (
    select 1 from media_sales_operations mso
    where mso.id = sales_operation_id
      and (is_staff() or is_club_member(mso.club_id) or is_family_of_club(mso.club_id))
  )
);

-- ══════════════════════════════════════════════════════════════════════════
-- 6. Albums — généralisation de photo_albums (0 ligne réelle, confirmé le 02/09 : renommage et
--    restructuration sans risque, aucune donnée à migrer).
-- ══════════════════════════════════════════════════════════════════════════

drop function if exists public.photo_album_list(uuid, uuid, text);
drop table if exists public.photo_pass_entitlements;

alter table public.photo_albums rename to media_albums;
alter table public.media_albums alter column team_id drop not null;
alter table public.media_albums drop column season_id;
alter table public.media_albums add column saison_id uuid references public.saisons(id);
alter table public.media_albums alter column saison_id set not null;
alter table public.media_albums add column event_id uuid references public.club_calendar_events(id);
alter table public.media_albums add column access_mode text not null default 'inherit' check (access_mode in ('inherit','public','free_members','season_pass','purchase','private_delivery','specific_users'));
alter table public.media_albums add column override_product_ids uuid[] not null default '{}';

comment on table public.media_albums is 'Ex-photo_albums (renommée 02/09, moteur média générique) — access_mode=''inherit'' (défaut) applique la résolution club/saison/événement ; toute autre valeur écrase explicitement (override album, priorité maximale, point 8-9).';
comment on column public.media_albums.access_mode is 'inherit = pas d''override, on résout via resolve_media_policy() ; sinon la valeur ici prime sur tout (album > événement > club/saison > fallback, point 9).';

-- La policy staff_all existante (photo_albums_staff_all, admin/prod) est conservée automatiquement
-- par le rename — aucune action nécessaire.

-- ══════════════════════════════════════════════════════════════════════════
-- 7. Commandes — Order, séparé de l'Entitlement (§14). Paiement traité par webhook Stripe
--    uniquement (service_role), jamais par le client — cohérent avec MASTER-CONNECT-V1 §25
--    ("le webhook confirme, jamais le retour navigateur").
-- ══════════════════════════════════════════════════════════════════════════

create table public.media_orders (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  product_id uuid not null references public.media_products(id),
  purchased_by_user_id uuid not null references auth.users(id),
  beneficiary_person_id uuid not null references public.player_profiles(id),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'eur',
  status text not null default 'pending' check (status in ('pending','paid','refunded','cancelled')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  refunded_at timestamptz
);
comment on table public.media_orders is 'Commande + paiement (mêmes principes que la table paiements existante, dupliquée volontairement plutôt que réutilisée — doctrine déjà établie dans CLUBPLUS_PLAYER_FAMILY_ARCHITECTURE.md : "dupliquer le pattern Stripe, jamais la fonction paiements"). Ne constitue JAMAIS à elle seule un droit d''accès : voir media_entitlements et can_access_media().';

alter table public.media_orders enable row level security;
create policy "mord_staff_all" on public.media_orders for all using (is_staff()) with check (is_staff());
create policy "mord_self_select" on public.media_orders for select using (purchased_by_user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════════════
-- 8. Droits d'accès — séparés du paiement, bénéficiaire distinct de l'acheteur (§5, §13, §20).
-- ══════════════════════════════════════════════════════════════════════════

create table public.media_entitlements (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  saison_id uuid not null references public.saisons(id),
  product_id uuid references public.media_products(id),
  beneficiary_person_id uuid not null references public.player_profiles(id),
  purchased_by_user_id uuid not null references auth.users(id),
  scope_type text not null check (scope_type in ('club','team','album','event')),
  scope_id uuid,
  order_id uuid references public.media_orders(id),
  status text not null default 'active' check (status in ('active','expired','refunded','revoked')),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  constraint me_scope_id_check check (scope_type = 'club' or scope_id is not null)
);
comment on table public.media_entitlements is 'Droit d''accès média, généré uniquement par le webhook Stripe (service_role) ou un octroi manuel staff — jamais par le client. beneficiary_person_id (qui a le droit) est volontairement distinct de purchased_by_user_id (qui a payé), pour le cas parent achète/enfant bénéficie (point 5, 20).';

create index idx_media_entitlements_lookup on public.media_entitlements (club_id, scope_type, scope_id, status);

alter table public.media_entitlements enable row level security;
create policy "ment_staff_all" on public.media_entitlements for all using (is_staff()) with check (is_staff());
create policy "ment_family_select" on public.media_entitlements for select using (
  purchased_by_user_id = auth.uid()
  or is_own_player(beneficiary_person_id)
  or is_confirmed_parent_of(beneficiary_person_id)
);

-- ══════════════════════════════════════════════════════════════════════════
-- 9. Résolution de politique + fonction centrale unique d'autorisation (§8-9, §39-40).
-- ══════════════════════════════════════════════════════════════════════════

-- IMPORTANT : deux vocabulaires distincts coexistent volontairement (comme dans le master prompt
-- lui-même, §3 vs §10) — le modèle commercial du CLUB (gratuit/pass_saison/vente_unite/
-- vente_pack/evenementiel/hybride, ce que configure l'OS) et le mode d'accès OPÉRATIONNEL d'un
-- ALBUM (public/free_members/season_pass/purchase/private_delivery/specific_users, ce que
-- can_access_media() sait interpréter). resolve_media_policy() traduit toujours vers le
-- vocabulaire opérationnel en sortie — c'est le bug trouvé par le test de vérification du 02/09
-- (les deux vocabulaires étaient mélangés sans traduction).
create or replace function public.resolve_media_policy(p_album_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_album record;
  v_club_default text;
begin
  select * into v_album from media_albums where id = p_album_id;
  if not found then
    return 'aucune_vente';
  end if;

  -- 1. Override album (priorité maximale) — déjà dans le vocabulaire opérationnel.
  if v_album.access_mode is not null and v_album.access_mode <> 'inherit' then
    return v_album.access_mode;
  end if;

  -- 2. Override événement : une opération de vente active liée au même événement -> payant.
  if v_album.event_id is not null and exists (
    select 1 from media_sales_operations mso
    where mso.event_id = v_album.event_id and mso.status = 'active'
  ) then
    return 'purchase';
  end if;

  -- 3. Politique équipe : non implémentée en V1 (optionnelle selon le master prompt §5).

  -- 4. Politique par défaut club/saison, traduite vers le vocabulaire opérationnel.
  select mcp.default_policy into v_club_default
  from media_club_policy mcp
  where mcp.club_id = v_album.club_id and mcp.saison_id = v_album.saison_id and mcp.status = 'active';

  -- 5. Fallback sécurisé : aucune politique configurée = aucune vente, jamais un accès par défaut.
  return case v_club_default
    when 'gratuit' then 'free_members'
    when 'pass_saison' then 'season_pass'
    when 'vente_unite' then 'purchase'
    when 'vente_pack' then 'purchase'
    when 'evenementiel' then 'purchase'
    when 'hybride' then 'purchase'
    else 'aucune_vente'
  end;
end;
$function$;
comment on function public.resolve_media_policy(uuid) is 'Priorité de résolution : override album > override événement > (équipe, non implémentée) > politique club/saison (traduite vers le vocabulaire opérationnel de can_access_media) > fallback ''aucune_vente'' (point 9). Jamais deux règles appliquées simultanément.';

create or replace function public.can_access_media(p_album_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_album record;
  v_policy text;
  v_family boolean;
begin
  if auth.uid() is null then
    return false;
  end if;
  if is_staff() then
    return true;
  end if;

  select * into v_album from media_albums where id = p_album_id;
  if not found then
    return false;
  end if;

  if v_album.team_id is not null then
    v_family := is_family_of_team(v_album.team_id);
  else
    v_family := is_family_of_club(v_album.club_id);
  end if;
  if not v_family then
    return false;
  end if;

  v_policy := resolve_media_policy(p_album_id);

  if v_policy in ('free_members','public') then
    return true;
  end if;

  if v_policy = 'aucune_vente' then
    return false;
  end if;

  return exists (
    select 1 from media_entitlements me
    where me.status = 'active'
      and (me.valid_until is null or me.valid_until > now())
      and (
        (me.scope_type = 'club' and me.club_id = v_album.club_id)
        or (me.scope_type = 'team' and v_album.team_id is not null and me.scope_id = v_album.team_id)
        or (me.scope_type = 'album' and me.scope_id = v_album.id)
        or (me.scope_type = 'event' and v_album.event_id is not null and me.scope_id = v_album.event_id)
      )
      and (
        me.purchased_by_user_id = auth.uid()
        or is_own_player(me.beneficiary_person_id)
        or is_confirmed_parent_of(me.beneficiary_person_id)
      )
  );
end;
$function$;
comment on function public.can_access_media(uuid) is 'Fonction centrale UNIQUE d''autorisation média (point 39-40) — jamais dupliquée ailleurs. Appelée par media_album_list() ; à réutiliser par tout futur écran/RPC qui a besoin de savoir si un utilisateur peut voir un album.';

grant execute on function public.can_access_media(uuid) to authenticated;
grant execute on function public.resolve_media_policy(uuid) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- 10. RPC de listing — remplace photo_album_list(), doctrine RPC-only inchangée : aucune policy
--     SELECT publique sur media_albums, secure_collection_ref jamais renvoyé si non débloqué.
-- ══════════════════════════════════════════════════════════════════════════

create or replace function public.media_album_list(p_club_id uuid, p_team_id uuid default null, p_saison_id uuid default null)
returns table(id uuid, title text, event_date date, cover_preview_url text, photo_count integer, published_at timestamptz, unlocked boolean, secure_collection_ref text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  return query
  select
    a.id, a.title, a.event_date, a.cover_preview_url, a.photo_count, a.published_at,
    can_access_media(a.id),
    case when can_access_media(a.id) then a.secure_collection_ref else null end
  from media_albums a
  where a.club_id = p_club_id
    and a.status = 'published'
    and (p_team_id is null or a.team_id = p_team_id)
    and (p_saison_id is null or a.saison_id = p_saison_id)
  order by coalesce(a.event_date, a.published_at::date) desc nulls last, a.published_at desc nulls last;
end;
$function$;
comment on function public.media_album_list(uuid, uuid, uuid) is 'Remplace photo_album_list() (portée club/équipe/saison figée) — p_team_id/p_saison_id optionnels pour lister au niveau club entier. Chaque ligne revérifie can_access_media(), jamais de court-circuit.';

grant execute on function public.media_album_list(uuid, uuid, uuid) to authenticated;
