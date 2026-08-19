-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v51
-- Espace particulier : type de compte, profils gérés, extension des
-- 9 droits d'accès, bénéficiaire de réservation/cotisation.
--
-- Contexte : livrables/SportVision-Connect/app-connect n'a jusqu'ici construit
-- que l'Espace joueur. Le tunnel d'inscription (signup-context.tsx) capture
-- déjà un choix de profil (joueur/sportif/particulier/parent/autre) mais ne le
-- persiste NULLE PART côté backend — vérifié en lisant signup/club/page.tsx et
-- lib/signup/pending-onboarding.ts le 14/08 avant d'écrire une ligne ici :
-- pour un profil non "sport-like", auth.signUp() est appelé puis le compte
-- atterrit directement sur l'Espace joueur (AppShell.tsx), quel que soit le
-- choix. Cette migration comble ce trou (§1) puis construit tout ce qui
-- manque pour que l'Espace particulier existe réellement (§2-6).
--
-- Idempotente (create table/column if not exists, drop policy if exists avant
-- chaque create policy, create or replace function) : peut être rejouée sans
--
-- EXÉCUTÉE — vérifié en base réelle le 19/08/2026 (audit pré-lancement) :
-- table managed_athlete_profiles, colonnes connect_access_relationships.
-- right_payer/right_cotisation/right_calendrier/right_modifier,
-- prestations.booked_by_user_id, group_fundings.beneficiary_*, policies
-- map_owner_select/insert/update/delete et l'ensemble des fonctions
-- propres à ce fichier (connect_owner_client_id, connect_list_my_athletes,
-- create_group_funding, etc.) existent déjà en base. Cet en-tête disait à
-- tort "NON EXÉCUTÉE".
-- effet de bord. Écrite en suivant le même niveau de rigueur que
-- migration-connect-v50-groupes-cotisations-personnelles.sql (référence de
-- style et de sécurité explicitement demandée par le brief).
-- ============================================================


-- ────────────────────────────────────────────────────────────────────────
-- 1. TYPE DE COMPTE (Joueur / Particulier)
-- ────────────────────────────────────────────────────────────────────────
--
-- Où stocker "ce compte est un compte particulier" ? Décision prise après
-- avoir vérifié le schéma réel (aucune des deux pistes côté Club+ ne
-- convient, même conclusion et même méthode que la migration précédente
-- pour connect_access_relationships) :
--   - `player_profiles` : n'existe QUE pour un compte déjà rattaché à un
--     club réel (club_id NOT NULL) — un compte particulier n'en a jamais
--     et ne doit jamais en obtenir une (ce n'est pas un joueur).
--   - `parent_profiles`/`parent_player_relationships` (Club+) : couplées à
--     un player_profiles.id existant (même écart déjà documenté par
--     migration-connect-personnel-accueil-profil-acces.sql §2) — ne
--     couvrent pas un compte qui n'a et n'aura jamais de player_profiles.
--
-- `connect_profile_settings` (migration précédente, déjà exécutée) est en
-- revanche déjà la seule table couvrant TOUT compte Connect personnel, avec
-- ou sans club. On y ajoute donc `account_type`, colonne minimale qui
-- détermine quel shell (AppShell joueur vs. nouveau shell particulier) le
-- layout serveur doit rendre. Défaut 'joueur' : tous les comptes déjà créés
-- avant cette migration sont des comptes joueur (aucune régression).
alter table connect_profile_settings
  add column if not exists account_type text not null default 'joueur'
    check (account_type in ('joueur', 'particulier'));

-- Résolution du client_id "propre" d'un compte SANS player_profiles (un
-- particulier, ou un joueur/sportif inscrit sans club). Même rôle que
-- player_profiles.client_id (migration-connect-v43) mais pour les comptes
-- qui n'auront jamais de ligne player_profiles. Alimentée uniquement par
-- connect_resolve_beneficiary_client_id() ci-dessous (§4), jamais écrite
-- directement par le client.
alter table connect_profile_settings
  add column if not exists client_id uuid references clients(id) on delete set null;


-- ────────────────────────────────────────────────────────────────────────
-- 2. PROFILS GÉRÉS ("il n'a pas encore de compte")
-- ────────────────────────────────────────────────────────────────────────
--
-- Concept entièrement nouveau (README design § Espace particulier →
-- Ajouter un sportif, voie b) : un enfant/sportif accompagné qui n'a et ne
-- veut pas d'adresse e-mail personnelle. Rattaché directement au compte du
-- particulier qui le crée (owner_user_id), sans aucune identité auth.users
-- propre — ce n'est PAS un compte, juste une fiche.
--
-- club_declare est un champ texte libre (comme "club déclaré" côté
-- inscription joueur) : aucune vérification, aucun lien vers une vraie
-- organization. Un profil géré n'a donc, en V1, aucun accès à club_media /
-- club_calendar_events (aucune organisation réelle à interroger) — état
-- honnête plutôt qu'une fausse promesse (même principe que "Nouveaux
-- contenus" volontairement absent du dashboard joueur, cf. commentaire de
-- dashboard/page.tsx).
--
-- Avertissement juridique : AUCUNE vérification de qualité de responsable
-- légal n'est faite ici (le brief l'interdit explicitement — "ne construis
-- pas de logique de vérification légale toi-même, juste l'avertissement
-- UI"). Cette table est donc, sciemment, une simple déclaration non
-- vérifiée. Voir le rapport final pour la décision produit non tranchée qui
-- en découle (mineurs, preuve de responsabilité légale, RGPD).
create table if not exists managed_athlete_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  prenom text not null,
  nom text not null,
  sport text,
  categorie text,
  club_declare text,
  relation_label text not null default 'Parent',
  -- Résolu paresseusement à la première réservation/cotisation (jamais à la
  -- création) — même principe que player_profiles.client_id : ne pas créer
  -- de ligne `clients` fantôme pour un profil géré qui ne réserve jamais.
  client_id uuid references clients(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_map_owner on managed_athlete_profiles(owner_user_id);

drop trigger if exists trg_map_upd on managed_athlete_profiles;
create trigger trg_map_upd before update on managed_athlete_profiles
  for each row execute procedure update_updated_at_generic();

alter table managed_athlete_profiles enable row level security;

-- Lecture/écriture directe réservée au créateur — pas de logique métier
-- complexe ici (contrairement à connect_access_relationships, il n'y a pas
-- de "deuxième partie" qui accepte/refuse : le profil géré n'existe QUE
-- pour son créateur), donc pas besoin de RPC SECURITY DEFINER pour les
-- opérations de base.
drop policy if exists "map_owner_select" on managed_athlete_profiles;
create policy "map_owner_select" on managed_athlete_profiles for select
  using (owner_user_id = auth.uid());

drop policy if exists "map_owner_insert" on managed_athlete_profiles;
create policy "map_owner_insert" on managed_athlete_profiles for insert
  with check (owner_user_id = auth.uid() and trim(coalesce(prenom, '')) <> '' and trim(coalesce(nom, '')) <> '');

drop policy if exists "map_owner_update" on managed_athlete_profiles;
create policy "map_owner_update" on managed_athlete_profiles for update
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

-- "Retirer" un profil géré (README § Fiche sportif → Accès & autorisations,
-- appliqué par analogie : pas de compte à conserver ici, donc suppression
-- réelle plutôt qu'un retrait de relation). Le client_id résolu et les
-- prestations déjà créées pour ce profil restent en base (ON DELETE ne
-- touche que managed_athlete_profiles.client_id, jamais `clients` ni
-- `prestations` — historique métier conservé, même principe que "ne pas
-- supprimer brutalement l'historique" MASTER-CONNECT-V1 §27).
drop policy if exists "map_owner_delete" on managed_athlete_profiles;
create policy "map_owner_delete" on managed_athlete_profiles for delete
  using (owner_user_id = auth.uid());


-- ────────────────────────────────────────────────────────────────────────
-- 3. EXTENSION DES 9 DROITS (connect_access_relationships)
-- ────────────────────────────────────────────────────────────────────────
--
-- Le design de référence (Connect Espace Particulier.dc.html, PERM_LABELS)
-- liste 9 droits, la migration précédente n'en avait câblé que 5 (les seuls
-- nécessaires à l'Espace joueur au 14/08) : voir, télécharger, réserver,
-- suivre les commandes, factures. Ajout des 4 manquants — additif, aucune
-- colonne existante touchée, valeurs par défaut conservatrices (false),
-- sauf calendrier (lecture seule, faible sensibilité, expérience minimale
-- déjà utile par défaut).
alter table connect_access_relationships add column if not exists right_payer boolean not null default false;
alter table connect_access_relationships add column if not exists right_cotisation boolean not null default false;
alter table connect_access_relationships add column if not exists right_calendrier boolean not null default true;
alter table connect_access_relationships add column if not exists right_modifier boolean not null default false;

-- Défauts à l'acceptation étendus aux 4 nouveaux droits (mêmes valeurs que
-- la carte "PROCHE" du prototype de référence pour les droits sensibles :
-- payer/cotisation/modifier restent désactivés, calendrier activé). Le
-- propriétaire du profil ajuste ensuite depuis "Accès à mon profil".
create or replace function connect_respond_profile_access_request(p_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row connect_access_relationships%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  select * into v_row from connect_access_relationships where id = p_id for update;
  if not found then
    raise exception 'Demande introuvable.';
  end if;
  if v_row.owner_user_id <> auth.uid() then
    raise exception 'Action non autorisée.';
  end if;
  if v_row.status <> 'en_attente' then
    raise exception 'Cette demande a déjà été traitée.';
  end if;

  if p_accept then
    update connect_access_relationships set
      status = 'acceptee', responded_at = now(), updated_at = now(),
      right_voir = true, right_download = true, right_reserver = false,
      right_commandes = true, right_factures = false,
      right_payer = false, right_cotisation = false, right_calendrier = true, right_modifier = false
    where id = p_id;
  else
    update connect_access_relationships set
      status = 'refusee', responded_at = now(), updated_at = now(),
      right_voir = false, right_download = false, right_reserver = false,
      right_commandes = false, right_factures = false,
      right_payer = false, right_cotisation = false, right_calendrier = false, right_modifier = false
    where id = p_id;
  end if;
end;
$$;

grant execute on function connect_respond_profile_access_request(uuid, boolean) to authenticated;

-- Bascule d'un droit — liste des droits valides étendue aux 9 (au lieu de
-- 5). Comportement inchangé pour les 5 droits déjà en prod.
create or replace function connect_update_profile_access_right(p_id uuid, p_right text, p_value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row connect_access_relationships%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;
  if p_right not in ('voir','download','reserver','commandes','factures','payer','cotisation','calendrier','modifier') then
    raise exception 'Droit inconnu.';
  end if;

  select * into v_row from connect_access_relationships where id = p_id for update;
  if not found then
    raise exception 'Accès introuvable.';
  end if;
  if v_row.owner_user_id <> auth.uid() then
    raise exception 'Action non autorisée.';
  end if;
  if v_row.status <> 'acceptee' then
    raise exception 'Cet accès n''est pas actif.';
  end if;

  execute format('update connect_access_relationships set right_%I = $1, updated_at = now() where id = $2', p_right)
    using p_value, p_id;
end;
$$;

grant execute on function connect_update_profile_access_right(uuid, text, boolean) to authenticated;

-- Primitive de vérification serveur — liste des droits valides étendue.
-- Signature strictement inchangée (aucun appelant existant à mettre à jour).
create or replace function connect_has_profile_access(p_owner_user_id uuid, p_right text)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if p_right not in ('voir','download','reserver','commandes','factures','payer','cotisation','calendrier','modifier') then
    return false;
  end if;
  return exists (
    select 1 from connect_access_relationships
    where owner_user_id = p_owner_user_id
      and grantee_user_id = auth.uid()
      and status = 'acceptee'
      and case p_right
        when 'voir' then right_voir
        when 'download' then right_download
        when 'reserver' then right_reserver
        when 'commandes' then right_commandes
        when 'factures' then right_factures
        when 'payer' then right_payer
        when 'cotisation' then right_cotisation
        when 'calendrier' then right_calendrier
        when 'modifier' then right_modifier
      end
  );
end;
$$;

grant execute on function connect_has_profile_access(uuid, text) to authenticated;


-- ────────────────────────────────────────────────────────────────────────
-- 4. RÉSOLUTION DU BÉNÉFICIAIRE (réservation "pour qui ?")
-- ────────────────────────────────────────────────────────────────────────
--
-- connect_owner_client_id() : le client_id "propre" d'un utilisateur, qu'il
-- ait ou non une ligne player_profiles (source unique de vérité couvrant
-- les deux cas, réutilisée par toutes les fonctions ci-dessous et par les
-- futures policies qui en auraient besoin).
create or replace function connect_owner_client_id(p_owner_user_id uuid)
returns uuid
language sql security definer stable set search_path = public as $$
  select coalesce(
    (select client_id from player_profiles where user_id = p_owner_user_id limit 1),
    (select client_id from connect_profile_settings where user_id = p_owner_user_id limit 1)
  );
$$;

grant execute on function connect_owner_client_id(uuid) to authenticated;

-- Résout (et crée si besoin) le client_id d'un bénéficiaire de réservation.
-- p_kind ∈ 'self' (l'appelant lui-même) | 'linked' (sportif ayant un compte,
-- p_ref_id = son user_id, droit "reserver" vérifié via
-- connect_access_relationships) | 'managed' (profil géré, p_ref_id = son
-- id, propriété vérifiée). Même prudence que resolve_player_client_id
-- (migration-connect-v43) : SECURITY DEFINER car `clients` est réservée au
-- staff pour toute écriture directe, mais la vérification d'autorisation se
-- fait explicitement AVANT toute lecture/écriture, jamais après.
create or replace function connect_resolve_beneficiary_client_id(p_kind text, p_ref_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_client_id uuid;
  v_prenom text;
  v_nom text;
  v_email text;
  v_label text;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  if p_kind = 'managed' then
    if not exists (select 1 from managed_athlete_profiles where id = p_ref_id and owner_user_id = auth.uid()) then
      raise exception 'Profil géré introuvable ou accès refusé.';
    end if;

    select client_id, prenom, nom into v_client_id, v_prenom, v_nom
      from managed_athlete_profiles where id = p_ref_id;
    if v_client_id is not null then
      return v_client_id;
    end if;

    insert into clients (nom, type_client, prenom_contact, nom_contact)
      values (v_prenom || ' ' || v_nom, 'particulier', v_prenom, v_nom)
      returning id into v_client_id;
    update managed_athlete_profiles set client_id = v_client_id, updated_at = now() where id = p_ref_id;
    return v_client_id;
  end if;

  if p_kind = 'self' then
    v_owner := auth.uid();
  elsif p_kind = 'linked' then
    if p_ref_id is null then
      raise exception 'Sportif requis.';
    end if;
    if p_ref_id = auth.uid() then
      v_owner := auth.uid(); -- garde-fou : "linked" vers soi-même équivaut à "self"
    elsif not exists (
      select 1 from connect_access_relationships
      where owner_user_id = p_ref_id and grantee_user_id = auth.uid()
        and status = 'acceptee' and right_reserver
    ) then
      raise exception 'Autorisation de réservation manquante pour ce sportif.';
    else
      v_owner := p_ref_id;
    end if;
  else
    raise exception 'Type de bénéficiaire invalide.';
  end if;

  -- Ligne player_profiles existante (sportif affilié à un club) : même
  -- résolution que resolve_player_client_id, mais keyée sur v_owner (pas
  -- forcément auth.uid()) puisque l'autorisation vient d'être vérifiée
  -- ci-dessus pour le cas "linked".
  select client_id, prenom, nom into v_client_id, v_prenom, v_nom
    from player_profiles where user_id = v_owner limit 1;
  if found then
    if v_client_id is not null then
      return v_client_id;
    end if;
    insert into clients (nom, type_client, prenom_contact, nom_contact)
      values (coalesce(v_prenom, '') || ' ' || coalesce(v_nom, ''), 'particulier', v_prenom, v_nom)
      returning id into v_client_id;
    update player_profiles set client_id = v_client_id where user_id = v_owner;
    return v_client_id;
  end if;

  -- Pas de player_profiles (particulier, ou joueur/sportif sans club) :
  -- connect_profile_settings.client_id, provisionné à la demande.
  select client_id into v_client_id from connect_profile_settings where user_id = v_owner;
  if v_client_id is not null then
    return v_client_id;
  end if;

  select email, raw_user_meta_data->>'first_name', raw_user_meta_data->>'last_name'
    into v_email, v_prenom, v_nom
    from auth.users where id = v_owner;
  v_label := nullif(trim(coalesce(v_prenom, '') || ' ' || coalesce(v_nom, '')), '');
  if v_label is null then
    v_label := coalesce(split_part(v_email, '@', 1), 'Client Connect');
  end if;

  insert into clients (nom, type_client, prenom_contact, nom_contact)
    values (v_label, 'particulier', v_prenom, v_nom)
    returning id into v_client_id;

  insert into connect_profile_settings (user_id, client_id, account_type)
    values (v_owner, v_client_id, 'particulier')
  on conflict (user_id) do update set client_id = excluded.client_id;

  return v_client_id;
end;
$$;

grant execute on function connect_resolve_beneficiary_client_id(text, uuid) to authenticated;

-- Liste, pour l'appelant, tous les client_id accessibles pour un droit
-- donné : lui-même (si un client_id existe déjà — jamais forcé ici, une
-- simple liste ne doit provisionner aucune ligne `clients` fantôme, même
-- principe que resolve_player_client_id "à la demande" côté Messages),
-- chaque sportif lié ayant accordé ce droit, et tous ses profils gérés
-- (droits toujours pleins sur ses propres profils gérés — pas de tiers à
-- qui les refuser). Alimente les listes multi-sportifs (commandes,
-- cotisations, contenus, calendrier, factures) et l'edge function
-- connect-player-prestations (mode "multi").
create or replace function connect_client_ids_for_caller(p_right text)
returns table (client_id uuid, kind text, ref_id uuid, label text)
language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;
  if p_right not in ('voir','download','reserver','commandes','factures','payer','cotisation','calendrier','modifier') then
    raise exception 'Droit inconnu.';
  end if;

  return query
  select cid, 'self'::text, auth.uid(), null::text
  from (select connect_owner_client_id(auth.uid()) as cid) s
  where cid is not null

  union all
  select connect_owner_client_id(car.owner_user_id), 'linked'::text, car.owner_user_id,
    coalesce(nullif(trim(concat(pp.prenom, ' ', pp.nom)), ''), car.grantee_display_name, 'Sportif')
  from connect_access_relationships car
  left join player_profiles pp on pp.user_id = car.owner_user_id
  where car.grantee_user_id = auth.uid()
    and car.status = 'acceptee'
    and connect_owner_client_id(car.owner_user_id) is not null
    and case p_right
      when 'voir' then car.right_voir
      when 'download' then car.right_download
      when 'reserver' then car.right_reserver
      when 'commandes' then car.right_commandes
      when 'factures' then car.right_factures
      when 'payer' then car.right_payer
      when 'cotisation' then car.right_cotisation
      when 'calendrier' then car.right_calendrier
      when 'modifier' then car.right_modifier
    end

  union all
  select map.client_id, 'managed'::text, map.id, map.prenom || ' ' || map.nom
  from managed_athlete_profiles map
  where map.owner_user_id = auth.uid() and map.client_id is not null;
end;
$$;

grant execute on function connect_client_ids_for_caller(text) to authenticated;


-- ────────────────────────────────────────────────────────────────────────
-- 5. LISTE ENRICHIE "MES SPORTIFS" + FICHE SPORTIF
-- ────────────────────────────────────────────────────────────────────────
--
-- Fusionne sportifs liés (connect_access_relationships, status='acceptee')
-- et profils gérés en une seule liste, avec les informations d'affichage
-- déjà résolues côté serveur (jamais de lecture directe de player_profiles/
-- auth.users d'un tiers depuis le client — RLS ne le permettrait pas, et ce
-- n'est de toute façon pas souhaitable, cf. "aucun annuaire public").
create or replace function connect_list_my_athletes()
returns table (
  kind text,
  ref_id uuid,
  relationship_id uuid,
  first_name text,
  last_name text,
  sport text,
  categorie text,
  club_nom text,
  club_status text,
  relation_label text,
  status text,
  right_voir boolean,
  right_download boolean,
  right_reserver boolean,
  right_commandes boolean,
  right_factures boolean,
  right_payer boolean,
  right_cotisation boolean,
  right_calendrier boolean,
  right_modifier boolean
)
language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  return query
  select
    'linked'::text, car.owner_user_id, car.id,
    coalesce(pp.prenom, split_part(car.grantee_display_name, ' ', 1), 'Sportif'),
    coalesce(pp.nom, ''),
    cps.sport, cps.categorie,
    org.nom, case when pp.club_id is not null and pp.account_status <> 'retire' then 'affilie' else null end,
    initcap(car.relation_type), 'actif',
    car.right_voir, car.right_download, car.right_reserver, car.right_commandes, car.right_factures,
    car.right_payer, car.right_cotisation, car.right_calendrier, car.right_modifier
  from connect_access_relationships car
  left join player_profiles pp on pp.user_id = car.owner_user_id
  left join organizations org on org.id = pp.club_id
  left join connect_profile_settings cps on cps.user_id = car.owner_user_id
  where car.grantee_user_id = auth.uid() and car.status = 'acceptee'

  union all
  select
    'managed'::text, map.id, map.id,
    map.prenom, map.nom, map.sport, map.categorie,
    map.club_declare, null,
    map.relation_label, 'gere',
    true, true, true, true, true, true, true, true, true
  from managed_athlete_profiles map
  where map.owner_user_id = auth.uid()
  order by 4;
end;
$$;

grant execute on function connect_list_my_athletes() to authenticated;

-- Détail enrichi d'un sportif (fiche) : identité + activité récente
-- (prochaine prestation, dernier contenu, prochain événement, cotisation en
-- cours). NULL si l'appelant n'a pas cette relation — le frontend traite
-- NULL comme "introuvable/non autorisé" (même convention que
-- get_group_detail/get_funding_detail).
create or replace function connect_get_athlete_detail(p_kind text, p_ref_id uuid)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_owner uuid;
  v_client_id uuid;
  v_result jsonb;
  v_car connect_access_relationships%rowtype;
  v_map managed_athlete_profiles%rowtype;
  v_first text; v_last text; v_sport text; v_categorie text; v_club text; v_club_id uuid; v_relation text;
  v_next_presta jsonb; v_next_event jsonb; v_funding jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;
  if p_kind not in ('linked', 'managed') then
    return null;
  end if;

  if p_kind = 'linked' then
    select * into v_car from connect_access_relationships
      where owner_user_id = p_ref_id and grantee_user_id = auth.uid() and status = 'acceptee';
    if not found then return null; end if;
    v_owner := p_ref_id;
    select pp.prenom, pp.nom, cps.sport, cps.categorie, org.nom, pp.club_id
      into v_first, v_last, v_sport, v_categorie, v_club, v_club_id
      from player_profiles pp
      left join organizations org on org.id = pp.club_id
      left join connect_profile_settings cps on cps.user_id = pp.user_id
      where pp.user_id = v_owner;
    if v_first is null then
      v_first := coalesce(split_part(v_car.grantee_display_name, ' ', 1), 'Sportif');
      v_last := '';
    end if;
    v_relation := initcap(v_car.relation_type);
    v_client_id := connect_owner_client_id(v_owner);
  else
    select * into v_map from managed_athlete_profiles where id = p_ref_id and owner_user_id = auth.uid();
    if not found then return null; end if;
    v_first := v_map.prenom; v_last := v_map.nom; v_sport := v_map.sport; v_categorie := v_map.categorie;
    v_club := v_map.club_declare; v_club_id := null; v_relation := v_map.relation_label;
    v_client_id := v_map.client_id;
  end if;

  if v_client_id is not null then
    select jsonb_build_object(
      'id', p.id, 'reference', p.reference, 'statut', p.statut,
      'date', p.date_prestation, 'lieu', p.lieu
    ) into v_next_presta
    from prestations p
    where p.client_id = v_client_id and p.statut not in ('terminee', 'annulee')
    order by p.date_prestation asc nulls last limit 1;
  end if;

  if v_club_id is not null then
    select jsonb_build_object(
      'title', title, 'date', event_date, 'time', event_time, 'location', location
    ) into v_next_event
    from club_calendar_events
    where club_id = v_club_id and event_date >= current_date
    order by event_date asc limit 1;
  end if;

  select jsonb_build_object(
    'id', gf.id, 'titre', gf.titre, 'montant_cible', gf.montant_cible, 'montant_collecte', gf.montant_collecte
  ) into v_funding
  from group_fundings gf
  where gf.statut in ('ouverte', 'objectif_atteint')
    and (
      (p_kind = 'linked' and gf.beneficiary_kind = 'linked' and gf.beneficiary_owner_user_id = p_ref_id)
      or (p_kind = 'managed' and gf.beneficiary_kind = 'managed' and gf.beneficiary_managed_id = p_ref_id)
    )
  order by gf.created_at desc limit 1;

  select jsonb_build_object(
    'kind', p_kind,
    'ref_id', p_ref_id,
    'first_name', v_first,
    'last_name', v_last,
    'sport', v_sport,
    'categorie', v_categorie,
    'club_nom', v_club,
    'club_id', v_club_id,
    'relation_label', v_relation,
    'status', case when p_kind = 'managed' then 'gere' else 'actif' end,
    'client_id', v_client_id,
    'relationship_id', case when p_kind = 'linked' then v_car.id else null end,
    'rights', case when p_kind = 'managed' then
        jsonb_build_object('voir', true, 'download', true, 'reserver', true, 'commandes', true, 'factures', true, 'payer', true, 'cotisation', true, 'calendrier', true, 'modifier', true)
      else
        jsonb_build_object(
          'voir', v_car.right_voir, 'download', v_car.right_download, 'reserver', v_car.right_reserver,
          'commandes', v_car.right_commandes, 'factures', v_car.right_factures, 'payer', v_car.right_payer,
          'cotisation', v_car.right_cotisation, 'calendrier', v_car.right_calendrier, 'modifier', v_car.right_modifier
        )
      end,
    'next_prestation', v_next_presta,
    'next_event', v_next_event,
    'funding', v_funding
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function connect_get_athlete_detail(text, uuid) to authenticated;

-- Retrait d'un sportif lié (README § Fiche sportif → Accès & autorisations
-- → "Retirer ce sportif" : "La relation est supprimée. Le compte ou le
-- profil du sportif est conservé."). Ici c'est le GRANTEE (le particulier)
-- qui retire sa propre relation — jamais côté propriétaire (déjà couvert
-- par connect_revoke_profile_access, réservé à owner_user_id = auth.uid()).
-- Symétrique nécessaire : l'accompagnant doit aussi pouvoir se retirer
-- lui-même sans dépendre du sportif.
create or replace function connect_remove_athlete_relationship(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_row connect_access_relationships%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  select * into v_row from connect_access_relationships where id = p_id for update;
  if not found then
    raise exception 'Relation introuvable.';
  end if;
  if v_row.grantee_user_id <> auth.uid() then
    raise exception 'Action non autorisée.';
  end if;

  update connect_access_relationships set
    status = 'retiree', revoked_at = now(), updated_at = now(),
    right_voir = false, right_download = false, right_reserver = false,
    right_commandes = false, right_factures = false,
    right_payer = false, right_cotisation = false, right_calendrier = false, right_modifier = false
  where id = p_id;
end;
$$;

grant execute on function connect_remove_athlete_relationship(uuid) to authenticated;

-- Création d'un profil géré. RPC (plutôt que l'insert direct déjà permis
-- par la policy map_owner_insert) pour renvoyer directement l'id créé et
-- garder un point d'entrée unique documenté côté frontend — l'insert direct
-- reste possible (policy conservée en filet), cette fonction ne fait rien
-- de plus qu'un insert validé, mais évite de dupliquer la validation
-- basique côté client uniquement.
create or replace function connect_create_managed_athlete(
  p_prenom text, p_nom text, p_sport text, p_categorie text, p_club text, p_relation text
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;
  if trim(coalesce(p_prenom, '')) = '' or trim(coalesce(p_nom, '')) = '' then
    raise exception 'Prénom et nom sont obligatoires.';
  end if;

  insert into managed_athlete_profiles (owner_user_id, prenom, nom, sport, categorie, club_declare, relation_label)
  values (auth.uid(), trim(p_prenom), trim(p_nom), nullif(trim(coalesce(p_sport, '')), ''),
          nullif(trim(coalesce(p_categorie, '')), ''), nullif(trim(coalesce(p_club, '')), ''),
          coalesce(nullif(trim(coalesce(p_relation, '')), ''), 'Parent'))
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function connect_create_managed_athlete(text, text, text, text, text, text) to authenticated;


-- ────────────────────────────────────────────────────────────────────────
-- 6. BÉNÉFICIAIRE SUR LES PRESTATIONS ET LES COTISATIONS
-- ────────────────────────────────────────────────────────────────────────
--
-- prestations.booked_by_user_id : distingue "bénéficiaire" (client_id — à
-- qui profite la prestation) de "commanditaire" (qui a rempli la demande),
-- nécessaire dès qu'un particulier réserve pour un sportif qu'il accompagne
-- (README § Réservation pour un sportif : "récapitulatif distinguant
-- bénéficiaire / commanditaire / payeur"). NULL = commanditaire identique
-- au bénéficiaire (comportement actuel de l'Espace joueur, inchangé).
-- "Payeur" reste implicitement identique au commanditaire en V1 (paiement
-- Stripe toujours initié par la session qui commande) — aucune colonne
-- séparée nécessaire tant qu'un tiers ne peut pas payer à la place du
-- commanditaire hors cotisation collective (déjà gérée par group_fundings).
alter table prestations add column if not exists booked_by_user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_prestations_booked_by on prestations(booked_by_user_id) where booked_by_user_id is not null;

-- group_fundings : bénéficiaire de la cotisation (README § Cotisation pour
-- un sportif). Purement additif et nullable — une cotisation créée par un
-- joueur pour lui-même (flux existant, inchangé) laisse ces colonnes NULL.
-- beneficiary_label est un instantané (le nom peut changer/le profil géré
-- peut être supprimé plus tard sans casser l'affichage historique).
alter table group_fundings add column if not exists beneficiary_kind text check (beneficiary_kind in ('self','linked','managed'));
alter table group_fundings add column if not exists beneficiary_owner_user_id uuid references auth.users(id) on delete set null;
alter table group_fundings add column if not exists beneficiary_managed_id uuid references managed_athlete_profiles(id) on delete set null;
alter table group_fundings add column if not exists beneficiary_label text;

-- create_group_funding étendue avec des paramètres optionnels en fin de
-- liste (appel existant côté joueur en paramètres nommés — voir
-- CreateFundingWizard.tsx — donc aucune régression : les nouveaux
-- paramètres restent à leurs valeurs par défaut pour tout appelant
-- inchangé). Le montant cible reste calculé ici, jamais par le client.
-- DROP d'abord : la signature (nombre de paramètres) change par rapport à la
-- version v50 (6 → 9 paramètres) — Postgres traiterait sinon un simple CREATE
-- OR REPLACE comme une surcharge distincte, laissant coexister l'ancienne et
-- la nouvelle version et provoquant une ambiguïté d'appel (42725) pour tout
-- appelant qui passe encore exactement 6 arguments nommés (cas de l'Espace
-- joueur, inchangé).
drop function if exists create_group_funding(uuid, uuid, text, text, integer, date);
create or replace function create_group_funding(
  p_group_id uuid,
  p_catalogue_offre_id uuid,
  p_contexte text,
  p_repartition_mode text,
  p_nb_participants integer,
  p_date_limite date,
  p_beneficiary_kind text default null,
  p_beneficiary_owner_user_id uuid default null,
  p_beneficiary_managed_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offre catalogue_offres;
  v_montant numeric(10,2);
  v_id uuid;
  v_token text;
  v_label text;
begin
  if p_group_id is not null and not is_member_of_user_group(p_group_id) then
    raise exception 'Vous n''êtes pas membre de ce groupe.';
  end if;

  if p_repartition_mode not in ('egale', 'libre') then
    raise exception 'Mode de répartition invalide.';
  end if;

  if p_repartition_mode = 'egale' and (p_nb_participants is null or p_nb_participants < 2) then
    raise exception 'Indiquez au moins 2 participants pour une répartition à parts égales.';
  end if;

  if p_date_limite is null or p_date_limite < current_date then
    raise exception 'La date limite doit être une date future.';
  end if;

  select * into v_offre from catalogue_offres where id = p_catalogue_offre_id and actif = true;
  if not found then
    raise exception 'Prestation introuvable ou indisponible.';
  end if;
  if v_offre.tarif_type <> 'fixe' or v_offre.prix_ht is null then
    raise exception 'Cette prestation est sur devis : elle ne peut pas être financée par cotisation.';
  end if;

  -- Bénéficiaire (facultatif) : vérification serveur du droit "cotisation"
  -- avant toute écriture, jamais une confiance dans ce que l'écran affiche.
  if p_beneficiary_kind is not null then
    if p_beneficiary_kind = 'linked' then
      if p_beneficiary_owner_user_id is null or not exists (
        select 1 from connect_access_relationships
        where owner_user_id = p_beneficiary_owner_user_id and grantee_user_id = auth.uid()
          and status = 'acceptee' and right_cotisation
      ) then
        raise exception 'Autorisation de cotisation manquante pour ce sportif.';
      end if;
      select coalesce(nullif(trim(concat(pp.prenom, ' ', pp.nom)), ''), 'Sportif') into v_label
        from player_profiles pp where pp.user_id = p_beneficiary_owner_user_id;
    elsif p_beneficiary_kind = 'managed' then
      if p_beneficiary_managed_id is null or not exists (
        select 1 from managed_athlete_profiles where id = p_beneficiary_managed_id and owner_user_id = auth.uid()
      ) then
        raise exception 'Profil géré introuvable.';
      end if;
      select prenom || ' ' || nom into v_label from managed_athlete_profiles where id = p_beneficiary_managed_id;
    elsif p_beneficiary_kind <> 'self' then
      raise exception 'Type de bénéficiaire invalide.';
    end if;
  end if;

  v_montant := round(v_offre.prix_ht * (1 + coalesce(v_offre.tva_pct, 20) / 100), 2);

  insert into group_fundings (
    group_id, created_by, catalogue_offre_id, titre, contexte,
    montant_cible, repartition_mode, nb_participants_prevu, date_limite,
    beneficiary_kind, beneficiary_owner_user_id, beneficiary_managed_id, beneficiary_label
  ) values (
    p_group_id, auth.uid(), p_catalogue_offre_id, v_offre.nom, nullif(trim(coalesce(p_contexte, '')), ''),
    v_montant, p_repartition_mode, case when p_repartition_mode = 'egale' then p_nb_participants else null end, p_date_limite,
    p_beneficiary_kind, p_beneficiary_owner_user_id, p_beneficiary_managed_id, v_label
  )
  returning id, share_token into v_id, v_token;

  return jsonb_build_object('id', v_id, 'share_token', v_token, 'montant_cible', v_montant);
end;
$$;

grant execute on function create_group_funding(uuid, uuid, text, text, integer, date, text, uuid, uuid) to authenticated;


-- ────────────────────────────────────────────────────────────────────────
-- 7. CONTENUS ET CALENDRIER — AGRÉGATION MULTI-SPORTIFS
-- ────────────────────────────────────────────────────────────────────────
--
-- club_media/club_calendar_events ne sont lisibles, via RLS, que par le
-- sportif lui-même ou un membre du bureau du club (cmd_family_select/
-- ccal_player_select, migration-connect-v43/migration-connect-personnel-
-- accueil-profil-acces.sql) — un particulier authentifié comme lui-même
-- n'y a normalement aucune ligne visible, même avec un droit "voir"/
-- "calendrier" accordé. Ces deux fonctions vérifient explicitement le droit
-- avant de lire (SECURITY DEFINER, contournement volontaire et contrôlé de
-- ces policies, même schéma que get_group_detail) plutôt que d'ajouter des
-- policies RLS supplémentaires sur des tables déjà partagées avec Club+ —
-- cohérent avec la décision déjà prise par cette migration de tout faire
-- passer par des fonctions dédiées plutôt que d'élargir des policies
-- partagées (voir la note en tête de fichier sur connect_client_ids_for_caller).
create or replace function connect_list_contents_for_athletes()
returns table (
  athlete_kind text, athlete_ref_id uuid, athlete_label text,
  id uuid, title text, type text, team text, link text, created_at timestamptz
)
language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  return query
  select 'linked'::text, pp.user_id, coalesce(nullif(trim(pp.prenom), ''), 'Sportif'),
    cm.id, cm.title, cm.type, cm.team, cm.link, cm.created_at
  from connect_access_relationships car
  join player_profiles pp on pp.user_id = car.owner_user_id
  join club_media cm on cm.club_id = pp.club_id and cm.expired = false
  where car.grantee_user_id = auth.uid() and car.status = 'acceptee' and car.right_voir
    and pp.account_status <> 'retire';
end;
$$;

grant execute on function connect_list_contents_for_athletes() to authenticated;

create or replace function connect_list_calendar_for_athletes()
returns table (
  athlete_kind text, athlete_ref_id uuid, athlete_label text,
  id uuid, event_date date, type text, title text, team text, event_time time, location text
)
language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  return query
  select 'linked'::text, pp.user_id, coalesce(nullif(trim(pp.prenom), ''), 'Sportif'),
    cc.id, cc.event_date, cc.type, cc.title, cc.team, cc.event_time, cc.location
  from connect_access_relationships car
  join player_profiles pp on pp.user_id = car.owner_user_id
  join club_calendar_events cc on cc.club_id = pp.club_id
  where car.grantee_user_id = auth.uid() and car.status = 'acceptee' and car.right_calendrier
    and pp.account_status <> 'retire';
end;
$$;

grant execute on function connect_list_calendar_for_athletes() to authenticated;


-- ────────────────────────────────────────────────────────────────────────
-- 8. list_my_fundings() / get_funding_detail() — EXPOSER beneficiary_label
-- ────────────────────────────────────────────────────────────────────────
--
-- Re-créées pour ajouter la seule colonne manquante à l'affichage "Pour X"
-- (README § Cotisation pour un sportif) sur les cotisations créées avec un
-- bénéficiaire (§6 ci-dessus) — reste, ligne pour ligne, identique à
-- migration-connect-v50 sinon (aucune régression pour l'Espace joueur, qui
-- reçoit simplement une colonne supplémentaire toujours NULL pour ses
-- propres cotisations).
-- DROP d'abord : le jeu de colonnes retourné change (ajout de beneficiary_label
-- en fin de liste) — Postgres refuse un CREATE OR REPLACE qui change le type
-- de retour d'une fonction TABLE (erreur 42P13 "cannot change return type of
-- existing function... Row type defined by OUT parameters is different").
drop function if exists list_my_fundings();
create or replace function list_my_fundings()
returns table (
  id uuid,
  group_id uuid,
  group_name text,
  titre text,
  contexte text,
  catalogue_offre_nom text,
  montant_cible numeric,
  montant_collecte numeric,
  repartition_mode text,
  nb_participants_prevu integer,
  date_limite date,
  statut text,
  is_creator boolean,
  participants_count bigint,
  my_contribution_amount numeric,
  created_at timestamptz,
  beneficiary_label text
) language sql security definer stable set search_path = public as $$
  select
    gf.id, gf.group_id, ug.name as group_name, gf.titre, gf.contexte, co.nom as catalogue_offre_nom,
    gf.montant_cible, gf.montant_collecte, gf.repartition_mode, gf.nb_participants_prevu, gf.date_limite,
    case
      when gf.statut = 'ouverte' and gf.date_limite is not null and gf.date_limite < current_date then 'expiree'
      else gf.statut
    end as statut,
    gf.created_by = auth.uid() as is_creator,
    (select count(*) from funding_contributions fc where fc.funding_id = gf.id and fc.statut = 'paye') as participants_count,
    (select sum(fc.montant) from funding_contributions fc where fc.funding_id = gf.id and fc.contributor_user_id = auth.uid() and fc.statut = 'paye') as my_contribution_amount,
    gf.created_at,
    gf.beneficiary_label
  from group_fundings gf
  left join user_groups ug on ug.id = gf.group_id
  left join catalogue_offres co on co.id = gf.catalogue_offre_id
  where gf.created_by = auth.uid()
     or (gf.group_id is not null and is_member_of_user_group(gf.group_id))
     or exists (select 1 from funding_contributions fc where fc.funding_id = gf.id and fc.contributor_user_id = auth.uid())
  order by gf.created_at desc;
$$;

grant execute on function list_my_fundings() to authenticated;

create or replace function get_funding_detail(p_funding_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  v_funding group_fundings;
  v_offre catalogue_offres;
  v_result jsonb;
  v_display_statut text;
begin
  if not can_view_group_funding(p_funding_id) then
    return null;
  end if;

  select * into v_funding from group_fundings where id = p_funding_id;
  if not found then return null; end if;

  select * into v_offre from catalogue_offres where id = v_funding.catalogue_offre_id;

  v_display_statut := case
    when v_funding.statut = 'ouverte' and v_funding.date_limite is not null and v_funding.date_limite < current_date then 'expiree'
    else v_funding.statut
  end;

  select jsonb_build_object(
    'id', v_funding.id,
    'group_id', v_funding.group_id,
    'group_name', (select name from user_groups where id = v_funding.group_id),
    'created_by', v_funding.created_by,
    'is_creator', v_funding.created_by = auth.uid(),
    'titre', v_funding.titre,
    'contexte', v_funding.contexte,
    'catalogue_offre_nom', v_offre.nom,
    'montant_cible', v_funding.montant_cible,
    'montant_collecte', v_funding.montant_collecte,
    'repartition_mode', v_funding.repartition_mode,
    'nb_participants_prevu', v_funding.nb_participants_prevu,
    'date_limite', v_funding.date_limite,
    'statut', v_display_statut,
    'share_token', v_funding.share_token,
    'created_at', v_funding.created_at,
    'beneficiary_label', v_funding.beneficiary_label,
    'my_contribution_amount', (
      select sum(fc.montant) from funding_contributions fc
      where fc.funding_id = v_funding.id and fc.contributor_user_id = auth.uid() and fc.statut = 'paye'
    ),
    'contributions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', fc.id,
        'name', coalesce(
          nullif(trim(concat(pp.prenom, ' ', pp.nom)), ''),
          fc.guest_prenom,
          split_part(u.email, '@', 1),
          'Participant'
        ),
        'is_guest', fc.contributor_user_id is null,
        'montant', fc.montant,
        'created_at', fc.created_at
      ) order by fc.created_at desc), '[]'::jsonb)
      from funding_contributions fc
      left join player_profiles pp on pp.user_id = fc.contributor_user_id
      left join auth.users u on u.id = fc.contributor_user_id
      where fc.funding_id = v_funding.id and fc.statut = 'paye'
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function get_funding_detail(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 9. MESSAGES CONTEXTUALISÉS (README § Messages contextualisées)
-- ────────────────────────────────────────────────────────────────────────
--
-- "Ce message concerne : Mon compte / [Sportif A] / [Sportif B]" nécessite qu'un particulier
-- puisse lire/écrire messages_client pour SON PROPRE client_id (résolu via connect_profile_
-- settings, pas player_profiles) ET pour celui de chaque sportif lié qui lui a accordé le droit
-- "voir" (aucun droit dédié "messages" dans les 9 — voir README, PERM_LABELS : "voir" est le plus
-- proche sémantiquement d'un accès de suivi général) ET pour ses profils gérés. Étend
-- mc_client_select/mc_client_insert (déjà étendues une fois par migration-connect-v43 pour le
-- joueur) avec 3 branches additives — aucune branche existante modifiée.
drop policy if exists "mc_client_select" on messages_client;
create policy "mc_client_select" on messages_client for select using (
  exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = messages_client.client_id)
  or (select client_id from clubs c join club_members cm on cm.club_id = c.id
      where cm.user_id = auth.uid() and cm.status = 'actif' and c.portail_client_id = messages_client.client_id
      limit 1) is not null
  or player_has_client_access(messages_client.client_id)
  or connect_owner_client_id(auth.uid()) = messages_client.client_id
  or exists (
    select 1 from connect_access_relationships car
    where car.grantee_user_id = auth.uid() and car.status = 'acceptee' and car.right_voir
      and connect_owner_client_id(car.owner_user_id) = messages_client.client_id
  )
  or exists (
    select 1 from managed_athlete_profiles map
    where map.owner_user_id = auth.uid() and map.client_id = messages_client.client_id
  )
);

drop policy if exists "mc_client_insert" on messages_client;
create policy "mc_client_insert" on messages_client for insert with check (
  auteur_type = 'client'
  and (auteur_client_id = auth.uid() or auteur_client_id is null)
  and (
    exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = messages_client.client_id)
    or (select client_id from clubs c join club_members cm on cm.club_id = c.id
        where cm.user_id = auth.uid() and cm.status = 'actif' and c.portail_client_id = messages_client.client_id
        limit 1) is not null
    or player_has_client_access(messages_client.client_id)
    or connect_owner_client_id(auth.uid()) = messages_client.client_id
    or exists (
      select 1 from connect_access_relationships car
      where car.grantee_user_id = auth.uid() and car.status = 'acceptee' and car.right_voir
        and connect_owner_client_id(car.owner_user_id) = messages_client.client_id
    )
    or exists (
      select 1 from managed_athlete_profiles map
      where map.owner_user_id = auth.uid() and map.client_id = messages_client.client_id
    )
  )
);

-- ============================================================
-- FIN. Résumé des actions manuelles requises après relecture :
--   1. Exécuter ce fichier entier dans Supabase → SQL Editor (idempotent).
--   2. Redéployer connect-player-prestations (Edge Function) — modifiée
--      pour accepter un bénéficiaire et un mode "multi" (voir son en-tête
--      pour le détail exact des changements). Aucune autre Edge Function
--      touchée par cette migration.
-- ============================================================
