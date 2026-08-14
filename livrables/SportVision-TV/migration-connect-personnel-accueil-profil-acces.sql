-- ============================================================
-- SPORTVISION CONNECT (personnel) — Accueil / Mon profil / Accès à mon profil
--
-- Écrite par l'agent en charge de l'enrichissement de ces trois écrans dans
-- app-connect (14/08/2026). NON EXÉCUTÉE — à relire puis exécuter par Fouka
-- dans Supabase → SQL Editor. Idempotente (create table/policy if not
-- exists, drop policy if exists avant chaque create policy, create or
-- replace function) : peut être rejouée sans effet de bord.
--
-- Portée : 3 sujets indépendants, détaillés dans chaque section ci-dessous.
-- ============================================================


-- ────────────────────────────────────────────────────────────────────────
-- 1. PRÉFÉRENCES DE PROFIL PERSONNELLES (Mon profil → Profil sportif,
--    Informations personnelles, Notifications)
-- ────────────────────────────────────────────────────────────────────────
--
-- Pourquoi une nouvelle table plutôt qu'étendre player_profiles :
-- player_profiles.club_id est NOT NULL (migration-clubplus-v13.sql) et la
-- ligne n'est créée QUE quand un joueur rejoint un vrai club partenaire
-- (edge function connect-player-onboarding, action "join" — vérifié en
-- lisant son code le 14/08). Un utilisateur qui a choisi "club déclaré",
-- "plus tard"/"aucun club", ou qui s'est inscrit comme "particulier" n'a
-- AUCUNE ligne player_profiles. Le sport/poste/catégorie/ville saisis
-- pendant l'inscription (signup-context.tsx) ne sont d'ailleurs déjà
-- persistés nulle part aujourd'hui (vérifié : l'edge function n'écrit que
-- prenom/nom/date_naissance/club_id sur player_profiles). Cette table est
-- donc la seule façon de couvrir 100% des comptes Connect (avec ou sans
-- club), sans toucher au schéma partagé avec Club+ (player_profiles sert
-- aussi de roster staff, avec son propre trigger de garde) ni sans rendre
-- club_id nullable (chantier à part, hors périmètre de cette tâche).
--
-- Prénom/Nom/E-mail restent en dehors de cette table : ils vivent dans
-- auth.users (user_metadata.first_name/last_name, éditable par l'utilisateur
-- via supabase.auth.updateUser() — email via le flux de reconfirmation natif
-- de Supabase Auth) et, quand une ligne player_profiles existe déjà, sont
-- répliqués dessus par l'app pour rester cohérents avec le roster Club+
-- ("une seule identité" — voir MASTER-CONNECT-V1.md §5). Téléphone n'a de
-- son côté aucune colonne existante sur player_profiles : il vit ici.

create table if not exists connect_profile_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  telephone text,
  sport text,
  poste text,
  categorie text,
  ville text,
  notif_contenus boolean not null default true,
  notif_cotisations boolean not null default true,
  notif_prestations boolean not null default true,
  notif_messages boolean not null default true,
  notif_affiliations boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table connect_profile_settings enable row level security;

drop policy if exists "cps_self_all" on connect_profile_settings;
create policy "cps_self_all" on connect_profile_settings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function set_connect_profile_settings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_cps_updated_at on connect_profile_settings;
create trigger trg_cps_updated_at before update on connect_profile_settings
  for each row execute procedure set_connect_profile_settings_updated_at();


-- ────────────────────────────────────────────────────────────────────────
-- 2. ACCÈS À MON PROFIL — modèle de droits granulaires réel
-- ────────────────────────────────────────────────────────────────────────
--
-- Écart volontaire par rapport à la piste initiale (réutiliser
-- parent_player_relationships / parental_authorizations) — schéma réel
-- vérifié en lisant migration-clubplus-v13/v14/v15.sql le 14/08 avant
-- d'écrire la moindre ligne ici :
--
--   1. parent_player_relationships relie parent_profiles.id à
--      player_profiles.id — DEUX identités qui n'existent que pour des
--      utilisateurs déjà rattachés à un club (voir §1 ci-dessus : pas de
--      player_profiles sans club réel). Le cas central de "Accès à mon
--      profil" (un joueur SANS club, ou un compte "particulier", qui
--      autorise un proche) n'aurait alors tout simplement AUCUNE ligne où
--      exister.
--   2. parental_authorizations n'a rien à voir avec ce besoin : c'est le
--      registre des AUTORISATIONS LÉGALES (droit à l'image, RGPD...),
--      avec des colonnes type/version/méthode de signature/document/
--      vérification — un objet juridique, pas "quels boutons voir/
--      télécharger/réserver/commandes/factures sont activés pour ce
--      proche". Réutiliser cette table aurait mélangé deux concepts
--      juridiquement et fonctionnellement différents dans la même ligne.
--
-- Conclusion (demandée explicitement par le brief avant d'écrire du code) :
-- ces deux tables ne couvrent pas ce modèle et ne peuvent pas être
-- étendues proprement sans casser leur sémantique existante. Nouvelle
-- table ci-dessous, scopée directement sur deux comptes auth.users (pas de
-- dépendance à un club ou à un player_profiles).
--
-- Sécurité (MASTER-CONNECT-V1.md §36) : AUCUNE policy INSERT/UPDATE/DELETE
-- n'est accordée au rôle authenticated. Toute écriture passe par les
-- fonctions SECURITY DEFINER ci-dessous, qui vérifient elles-mêmes
-- l'identité de l'appelant (auth.uid()) avant d'agir — jamais une simple
-- confiance dans ce que le client affiche.

create table if not exists connect_access_relationships (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  grantee_user_id uuid not null references auth.users(id) on delete cascade,
  -- Instantané du nom/e-mail du demandeur au moment de la demande (pas une lecture live de
  -- auth.users : le rôle authenticated ne peut pas lire les autres utilisateurs directement, et
  -- il n'y a aucune raison de créer un "annuaire" — voir README design, "aucun annuaire public").
  -- Renseigné par connect_request_profile_access() (SECURITY DEFINER, seul point d'écriture).
  grantee_display_name text,
  grantee_email text,
  relation_type text not null check (relation_type in ('parent','tuteur_legal','proche','agent','autre')),
  relation_label text,
  message text,
  status text not null default 'en_attente' check (status in ('en_attente','acceptee','refusee','retiree')),
  right_voir boolean not null default false,
  right_download boolean not null default false,
  right_reserver boolean not null default false,
  right_commandes boolean not null default false,
  right_factures boolean not null default false,
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint car_no_self_request check (owner_user_id <> grantee_user_id),
  unique (owner_user_id, grantee_user_id)
);

create index if not exists idx_car_owner on connect_access_relationships(owner_user_id, status);
create index if not exists idx_car_grantee on connect_access_relationships(grantee_user_id, status);

alter table connect_access_relationships enable row level security;

drop policy if exists "car_owner_select" on connect_access_relationships;
create policy "car_owner_select" on connect_access_relationships for select
  using (owner_user_id = auth.uid());

drop policy if exists "car_grantee_select" on connect_access_relationships;
create policy "car_grantee_select" on connect_access_relationships for select
  using (grantee_user_id = auth.uid());

-- Demande d'accès — appelée depuis le côté "particulier" (hors périmètre de
-- cette vague, mais la primitive doit exister pour que ce flux puisse s'y
-- brancher sans nouvelle migration). Idempotente sur une paire (owner,
-- grantee) : une nouvelle demande après refus/retrait réutilise la même
-- ligne plutôt que d'en créer une deuxième.
create or replace function connect_request_profile_access(
  p_owner_email text,
  p_relation_type text,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_existing connect_access_relationships%rowtype;
  v_id uuid;
  v_grantee_email text;
  v_grantee_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;
  if p_relation_type not in ('parent','tuteur_legal','proche','agent','autre') then
    raise exception 'Type de relation invalide.';
  end if;

  select id into v_owner_id from auth.users where lower(email) = lower(trim(p_owner_email));
  if v_owner_id is null then
    raise exception 'Aucun compte SportVision Connect ne correspond à cette adresse e-mail.';
  end if;
  if v_owner_id = auth.uid() then
    raise exception 'Vous ne pouvez pas demander accès à votre propre profil.';
  end if;

  select email, trim(coalesce(raw_user_meta_data->>'first_name','') || ' ' || coalesce(raw_user_meta_data->>'last_name',''))
    into v_grantee_email, v_grantee_name
    from auth.users where id = auth.uid();
  if v_grantee_name is null or v_grantee_name = '' then
    v_grantee_name := v_grantee_email;
  end if;

  select * into v_existing from connect_access_relationships
    where owner_user_id = v_owner_id and grantee_user_id = auth.uid();

  if found then
    if v_existing.status = 'acceptee' then
      raise exception 'Vous avez déjà accès à ce profil.';
    end if;
    if v_existing.status = 'en_attente' then
      return v_existing.id;
    end if;
    update connect_access_relationships set
      status = 'en_attente', relation_type = p_relation_type, message = p_message,
      grantee_display_name = v_grantee_name, grantee_email = v_grantee_email,
      requested_at = now(), responded_at = null, revoked_at = null, updated_at = now()
    where id = v_existing.id
    returning id into v_id;
  else
    insert into connect_access_relationships
      (owner_user_id, grantee_user_id, relation_type, message, grantee_display_name, grantee_email)
    values (v_owner_id, auth.uid(), p_relation_type, p_message, v_grantee_name, v_grantee_email)
    returning id into v_id;
  end if;

  -- Notification dédiée côté propriétaire du profil (README design § Accès à
  -- mon profil : "Une notification dédiée pointe vers cette page"). Catégorie
  -- 'requests' (member_notifications.category — check contraint existant,
  -- migration-connect-v16) : pas de catégorie "accès" dédiée, celle-ci est la
  -- plus proche sémantiquement.
  insert into member_notifications (user_id, category, title, body, target_href)
  values (
    v_owner_id, 'requests', 'Nouvelle demande d''accès à votre profil',
    'Un proche souhaite accéder à votre profil SportVision Connect.', '/acces'
  );

  return v_id;
end;
$$;

grant execute on function connect_request_profile_access(text, text, text) to authenticated;

-- Accepter / refuser une demande en attente. Sur acceptation, les droits par
-- défaut reprennent exactement ceux du prototype de référence (Connect
-- Espace Joueur.dc.html, accept() de la demande) : voir + télécharger +
-- suivre les commandes accordés d'emblée, réserver et factures laissés
-- désactivés — le propriétaire ajuste ensuite depuis "Accès accordés".
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
      right_commandes = true, right_factures = false
    where id = p_id;
  else
    update connect_access_relationships set
      status = 'refusee', responded_at = now(), updated_at = now(),
      right_voir = false, right_download = false, right_reserver = false,
      right_commandes = false, right_factures = false
    where id = p_id;
  end if;
end;
$$;

grant execute on function connect_respond_profile_access_request(uuid, boolean) to authenticated;

-- Bascule d'un droit précis sur un accès déjà accordé — jamais depuis une
-- demande en attente ou un accès retiré (empêche de "pré-activer" des
-- droits avant acceptation).
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
  if p_right not in ('voir','download','reserver','commandes','factures') then
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

-- Retrait d'un accès — la confirmation obligatoire côté design est gérée
-- côté UI (modale), cette fonction est l'action finale une fois confirmée.
create or replace function connect_revoke_profile_access(p_id uuid)
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
    raise exception 'Accès introuvable.';
  end if;
  if v_row.owner_user_id <> auth.uid() then
    raise exception 'Action non autorisée.';
  end if;

  update connect_access_relationships set
    status = 'retiree', revoked_at = now(), updated_at = now(),
    right_voir = false, right_download = false, right_reserver = false,
    right_commandes = false, right_factures = false
  where id = p_id;
end;
$$;

grant execute on function connect_revoke_profile_access(uuid) to authenticated;

-- Primitive de vérification serveur, À CONSOMMER PAR LES FUTURS MODULES
-- (contenus, commandes, factures, réservation "pour un sportif" côté espace
-- particulier — aucun de ces écrans n'existe encore dans app-connect au
-- 14/08, donc rien n'est branché dessus aujourd'hui, mais le master doc §36
-- est explicite : la permission doit être revérifiée SERVEUR à chaque
-- lecture sensible, jamais seulement à l'affichage). Utilisation typique
-- dans une policy RLS d'un futur module :
--   using (owner_user_id = auth.uid() or connect_has_profile_access(owner_user_id, 'voir'))
create or replace function connect_has_profile_access(p_owner_user_id uuid, p_right text)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if p_right not in ('voir','download','reserver','commandes','factures') then
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
      end
  );
end;
$$;

grant execute on function connect_has_profile_access(uuid, text) to authenticated;


-- ────────────────────────────────────────────────────────────────────────
-- 3. ACCUEIL — accès en lecture pour le joueur/parent à SES PROPRES données
-- ────────────────────────────────────────────────────────────────────────
--
-- 3.1 — "Prochain événement". Deux tables "calendrier" existent dans le
-- schéma : `calendar_events` (organization_id, migration-connect-v3,
-- quasi pas utilisée : 3 fichiers y font référence) et
-- `club_calendar_events` (club_id, migration-clubplus-v4, table réellement
-- utilisée par app-next : AddEventModal.tsx/fetchClubCalendarEvents, 5
-- fichiers, colonnes event_time/location ajoutées par la v35). Le vrai
-- calendrier d'un club, c'est `club_calendar_events` — c'est celui-ci
-- qu'utilise la carte "Prochainement" de l'Accueil, pas `calendar_events`.
--
-- Sa policy de lecture actuelle (`ccal_member_select`, is_club_member) ne
-- couvre que les DIRIGEANTS d'un club (table club_members) — un joueur n'y
-- est jamais présent (vérifié : is_club_member interroge club_members, où
-- seuls admin/staff sont insérés). Sans cette policy additive, la carte
-- "Prochainement" serait TOUJOURS vide pour un joueur, silencieusement (pas
-- une erreur, un simple résultat RLS filtré à 0 ligne) — donc jamais
-- réellement fonctionnelle. Policy ajoutée, strictement en lecture,
-- réutilisant is_confirmed_parent_of() déjà existante (migration-clubplus-v13).
drop policy if exists "ccal_player_select" on club_calendar_events;
create policy "ccal_player_select" on club_calendar_events for select using (
  exists (
    select 1 from player_profiles pp
    where pp.club_id = club_calendar_events.club_id
      and pp.account_status <> 'retire'
      and (pp.user_id = auth.uid() or is_confirmed_parent_of(pp.id))
  )
);

-- 3.2 — "Prochaine prestation". Même constat sur `prestations` : la seule
-- policy SELECT existante (`prestations_acces`, supabase-schema-v2.sql) est
-- réservée au staff/collaborateurs — un client (même via client_users) n'a
-- AUJOURD'HUI AUCUNE policy SELECT sur `prestations`, seulement une policy
-- INSERT (migration-portail-v2/v33). Prolonge exactement le même schéma
-- d'extension que migration-connect-v43 a déjà appliqué à messages_client
-- (player_has_client_access(client_id)) : additive, scopée au seul
-- client_id résolu pour CE joueur (resolve_player_client_id), zéro
-- changement sur les policies existantes.
drop policy if exists "prestations_player_select" on prestations;
create policy "prestations_player_select" on prestations for select using (
  player_has_client_access(client_id)
);

-- ============================================================
-- FIN. Résumé des actions manuelles requises après relecture :
--   1. Exécuter ce fichier entier dans Supabase → SQL Editor (idempotent).
--   2. Aucun redéploiement d'Edge Function nécessaire : tout passe par des
--      fonctions Postgres (RPC), actives dès l'exécution du script.
-- ============================================================
