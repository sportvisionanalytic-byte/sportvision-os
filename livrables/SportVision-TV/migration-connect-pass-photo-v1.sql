-- ============================================================
-- SPORTVISION CONNECT — Migration Pass Photo v1
-- Déverrouillage payant d'un album photo par équipe + saison (Espace joueur).
--
-- Contexte (28/08/2026) : un club/une équipe peut avoir un album de photos d'un événement
-- (match, tournoi...) capté par SportVision. Jusqu'ici, ces photos ne passaient que par
-- club_media (Mes contenus, accès gratuit inclus dans l'affiliation club). Le "Pass Photo" est un
-- NOUVEAU produit distinct : un achat ponctuel (pas un abonnement) qui déverrouille l'accès complet
-- à un ou plusieurs albums publiés pour UNE équipe + UNE saison données.
--
-- Schéma calqué EXACTEMENT sur le principe déjà en prod pour l'abonnement Agent
-- (migration-connect-v57-abonnement-agent.sql §1) : "le webhook confirme, jamais le retour
-- navigateur" (MASTER-CONNECT-V1.md §25) — photo_pass_entitlements n'est JAMAIS écrite par
-- create-pass-photo-checkout, uniquement par stripe-webhook (service_role, après
-- checkout.session.completed réellement encaissé). Différence volontaire avec l'abonnement Agent :
-- mode Stripe Checkout 'payment' (achat ponctuel), pas 'subscription' — même mode que
-- create-checkout-session (prestations), mais SANS pré-création de ligne 'en_attente' (pas de table
-- `paiements` dédiée ici, cf. décision au §2 plus bas).
--
-- season_id est un TEXT libre (convention déjà utilisée par clubs.saison / team_memberships.saison,
-- ex. '2026-2027') — ce projet n'a pas de table `saisons`, volontairement pas créée ici non plus.
--
-- Sécurité — RÈGLE LA PLUS IMPORTANTE de tout ce chantier : ne JAMAIS exposer
-- photo_albums.secure_collection_ref à un utilisateur Connect sans entitlement actif. Row Level
-- Security seule ne suffit PAS ici : une policy SELECT "published" laisserait passer TOUTES les
-- colonnes de la ligne (RLS filtre des LIGNES, pas des colonnes), y compris secure_collection_ref
-- pour un album publié même sans achat. Solution retenue : photo_albums n'a AUCUNE policy SELECT
-- pour authenticated (donc AUCUN accès direct via PostgREST hors staff) — toute lecture côté
-- Connect passe exclusivement par la RPC SECURITY DEFINER photo_album_list() plus bas, qui masque
-- elle-même secure_collection_ref tant que l'entitlement n'est pas vérifié en base à l'instant de
-- l'appel. Même schéma déjà utilisé dans ce projet pour un accès conditionnel server-side
-- (is_own_player/is_confirmed_parent_of, connect_agent_discount, resolve_player_client_id...).
--
-- Idempotente (create table/policy/function if not exists, drop policy/function if exists avant
-- chaque recreate) : peut être rejouée sans effet de bord. Schéma réel vérifié en direct
-- (service_role, .env racine, information_schema.columns + pg_constraint) avant écriture — clubs,
-- club_teams, prestations, profiles, connect_agent_subscriptions, paiements, stripe_events déjà
-- confirmés ; aucune table photo_albums / photo_pass_entitlements n'existait avant cette migration.
--
-- EXÉCUTÉE — vérifié en base réelle le 28/08/2026 : tables photo_albums/photo_pass_entitlements,
-- policies photo_albums_staff_all/ppe_self_select et fonction photo_album_list() existent déjà en
-- base. RLS vérifiée avec un vrai compte de test jetable (créé/supprimé via l'API Admin Auth, JWT
-- réel via /auth/v1/token) : lecture directe de photo_albums bloquée pour authenticated (RPC
-- uniquement), écriture directe de photo_albums et de photo_pass_entitlements bloquée pour un
-- compte non-staff (403, RLS), déverrouillage correct de secure_collection_ref uniquement après
-- entitlement actif inséré via service_role. Données de test nettoyées après vérification. Reste
-- NON FAIT (hors périmètre technique de cette session) : création du Price Stripe et secret
-- STRIPE_PRICE_PASS_PHOTO — voir le résumé en fin de fichier.
-- ============================================================


-- ────────────────────────────────────────────────────────────────────────
-- 1. ALBUMS PHOTO (créés/publiés côté OS, prod/admin uniquement)
-- ────────────────────────────────────────────────────────────────────────
--
-- Un album appartient à UNE équipe (club_teams) d'UN club, pour UNE saison texte libre — c'est
-- exactement la granularité de l'entitlement acheté (photo_pass_entitlements ci-dessous), donc
-- aussi celle de l'album : pas de notion d'album "multi-équipes".
--
-- mission_id (nullable) : lien optionnel vers la prestation SportVision qui a produit ces photos
-- ('mission' = prestations dans ce projet, pas de table séparée — repris du reste du vocabulaire
-- métier de l'OS, ex. media_livrables.prestation_id).
--
-- secure_collection_ref : V1 volontairement minimal (texte libre, peut rester vide) — pas
-- d'intégration Supabase Storage signée ce soir, cf. brief. Le champ EXISTE dès maintenant pour ne
-- pas avoir à re-migrer quand cette intégration sera construite, mais reste un simple texte
-- affiché tel quel côté déverrouillé (lien externe, référence de dossier...).
create table if not exists photo_albums (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  team_id uuid not null references club_teams(id) on delete cascade,
  season_id text not null,
  mission_id uuid references prestations(id) on delete set null,
  title text not null,
  event_date date,
  cover_preview_url text,
  photo_count integer not null default 0,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  secure_collection_ref text,
  published_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Requête la plus fréquente côté Connect : "albums publiés de CETTE équipe/saison" (RPC
-- photo_album_list ci-dessous) — index composite sur exactement ces 3 colonnes + status.
create index if not exists idx_photo_albums_team_season on photo_albums(club_id, team_id, season_id, status);

alter table photo_albums enable row level security;

-- Écriture (création/édition/publication) réservée aux rôles staff 'admin'/'prod' — mêmes rôles
-- exacts que mlivr_write sur media_livrables (vérifié via pg_policies avant d'écrire cette policy :
-- media_livrables utilise ['admin','prod','sec'] pour l'écriture, mais le brief demande
-- explicitement "admin/prod" pour LA VALIDATION PRODUCTION de ce module précis — la vérification
-- production/publication d'un album est un geste de prod, pas de secrétariat). ALL (pas seulement
-- INSERT/UPDATE) : couvre aussi la lecture complète côté OS (sbFetch avec le JWT staff), qui a
-- besoin de voir secure_collection_ref pour l'éditer — voir le commentaire de tête sur pourquoi
-- AUCUNE policy SELECT séparée n'existe pour authenticated en dehors de celle-ci.
drop policy if exists "photo_albums_staff_all" on photo_albums;
create policy "photo_albums_staff_all" on photo_albums for all
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any(array['admin', 'prod'])))
  with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any(array['admin', 'prod'])));

-- Volontairement AUCUNE autre policy SELECT (ni "published pour tous", ni "family_of_team") : un
-- accès table direct exposerait secure_collection_ref à quiconque peut lire la ligne (RLS ne filtre
-- pas les colonnes). Tout accès Connect (particulier/joueur) passe par photo_album_list() plus bas.

drop trigger if exists trg_photo_albums_updated_at on photo_albums;
create trigger trg_photo_albums_updated_at before update on photo_albums
  for each row execute procedure update_updated_at_generic();


-- ────────────────────────────────────────────────────────────────────────
-- 2. ENTITLEMENTS PASS PHOTO (achat ponctuel, écrit UNIQUEMENT par le webhook Stripe)
-- ────────────────────────────────────────────────────────────────────────
--
-- Une ligne = un utilisateur Connect a payé le Pass Photo pour UNE équipe + UNE saison — déverrouille
-- TOUS les albums publiés de cette équipe/saison (pas un achat par album). user_id référence
-- auth.users(id) directement, comme connect_agent_subscriptions.user_id (vérifié : la table
-- Connect existante utilise `references auth.users(id)`, pas `profiles` — `profiles` est réservé
-- au staff SportVision dans ce projet, jamais aux comptes Connect particuliers).
--
-- order_id : référence optionnelle au paiement Stripe. Ce chantier ne crée volontairement PAS de
-- ligne `paiements` pour le Pass Photo (ce n'est pas une prestation/un devis — le modèle `paiements`
-- de ce projet est structurellement lié à `prestations`/`devis`/`client_id`, cf.
-- create-checkout-session, et le forcer ici dupliquerait un mauvais modèle). order_id reste donc
-- toujours NULL pour l'instant — la colonne existe pour ne pas re-migrer si un futur chantier
-- décide de tracer ces paiements dans `paiements` malgré tout.
--
-- unique(user_id, club_id, team_id, season_id) : un seul achat par utilisateur/équipe/saison — un
-- second paiement pour la même combinaison est un renouvellement (upsert côté webhook), jamais une
-- seconde ligne.
create table if not exists photo_pass_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  club_id uuid not null references clubs(id) on delete cascade,
  team_id uuid not null references club_teams(id) on delete cascade,
  season_id text not null,
  status text not null default 'active' check (status in ('active', 'expired', 'refunded')),
  purchased_at timestamptz not null default now(),
  expires_at timestamptz,
  order_id uuid references paiements(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, club_id, team_id, season_id)
);

create index if not exists idx_ppe_user on photo_pass_entitlements(user_id);

alter table photo_pass_entitlements enable row level security;

-- Lecture réservée au propriétaire — identique à connect_agent_subscriptions §1 (cas_self_select).
-- Aucune policy INSERT/UPDATE/DELETE pour authenticated : la ligne n'est écrite QUE par le webhook
-- Stripe (service_role, bypass RLS), jamais par le client, jamais par une simple intention de payer.
drop policy if exists "ppe_self_select" on photo_pass_entitlements;
create policy "ppe_self_select" on photo_pass_entitlements for select
  using (user_id = auth.uid());


-- ────────────────────────────────────────────────────────────────────────
-- 3. LECTURE CÔTÉ CONNECT — RPC SECURITY DEFINER (voir §1 pour le pourquoi : jamais de SELECT
--    direct sur photo_albums côté authenticated, secure_collection_ref serait sinon exposée à
--    quiconque peut lire une ligne publiée, entitlement ou non)
-- ────────────────────────────────────────────────────────────────────────
--
-- Retourne les albums PUBLIÉS d'une équipe/saison. `unlocked` est calculé UNE FOIS pour toute la
-- liste (l'entitlement est par équipe/saison, pas par album — cf. §2) : soit l'appelant a payé
-- pour cette équipe/saison et voit TOUS les albums déverrouillés, soit aucun. secure_collection_ref
-- n'est renvoyé QUE si unlocked = true — c'est la seule porte de sortie de cette colonne vers le
-- client, revérifiée à CHAQUE appel (jamais mise en cache côté serveur au-delà de la requête).
--
-- Champs teaser toujours renvoyés (verrouillé ou non), volontairement limités : title, event_date,
-- cover_preview_url, photo_count, published_at — jamais mission_id/created_by/season_id en clair
-- au-delà de ce que l'appelant a déjà fourni en paramètre.
create or replace function photo_album_list(p_club_id uuid, p_team_id uuid, p_season_id text)
returns table (
  id uuid,
  title text,
  event_date date,
  cover_preview_url text,
  photo_count integer,
  published_at timestamptz,
  unlocked boolean,
  secure_collection_ref text
)
language plpgsql security definer stable set search_path = public
as $$
declare
  v_has_entitlement boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  select exists (
    select 1 from photo_pass_entitlements pe
    where pe.user_id = auth.uid()
      and pe.club_id = p_club_id
      and pe.team_id = p_team_id
      and pe.season_id = p_season_id
      and pe.status = 'active'
      and (pe.expires_at is null or pe.expires_at > now())
  ) into v_has_entitlement;

  return query
  select
    a.id, a.title, a.event_date, a.cover_preview_url, a.photo_count, a.published_at,
    v_has_entitlement,
    case when v_has_entitlement then a.secure_collection_ref else null end
  from photo_albums a
  where a.club_id = p_club_id and a.team_id = p_team_id and a.season_id = p_season_id and a.status = 'published'
  order by coalesce(a.event_date, a.published_at::date) desc nulls last, a.published_at desc nulls last;
end;
$$;

grant execute on function photo_album_list(uuid, uuid, text) to authenticated;


-- ============================================================
-- FIN. Résumé des actions manuelles requises après relecture :
--
--   1. Exécuter ce fichier entier dans Supabase → SQL Editor (idempotent). PAS ENCORE EXÉCUTÉ au
--      moment d'écrire ce commentaire — à faire avant tout test réel.
--
--   2. Créer UN Price Stripe ponctuel (Dashboard Stripe → Product catalog, produit "SportVision
--      Connect — Pass Photo", prix à définir par Fouka — décision commerciale, pas technique).
--      Copier le Price ID (price_xxx) dans les secrets Supabase Edge Functions :
--        STRIPE_PRICE_PASS_PHOTO
--      Aucun montant n'est écrit en dur côté code : create-pass-photo-checkout lit exclusivement
--      cette variable d'environnement. Tant qu'elle n'est pas configurée, l'edge function répond
--      une erreur claire (pas de crash) — comportement voulu, pas un bug.
--
--   3. Déployer la nouvelle Edge Function create-pass-photo-checkout (Supabase Dashboard → Edge
--      Functions → New Function) — voir son en-tête pour les secrets requis.
--
--   4. Redéployer stripe-webhook (modifié, additif — nouvelle branche checkout.session.completed
--      pour metadata.product = 'pass_photo', voir son en-tête pour le détail exact).
--
--   5. checkout.session.completed est déjà écouté côté Stripe Dashboard → Developers → Webhooks
--      (utilisé par tous les autres flux de paiement ponctuel de ce projet) — aucun nouvel
--      événement à ajouter pour ce chantier.
-- ============================================================
