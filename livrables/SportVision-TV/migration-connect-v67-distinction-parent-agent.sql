-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v67
-- Distinction Parent / Agent au niveau du compte Espace particulier + plafond dur pour un parent
-- (3 sportifs max, jamais payant) — décidé par Fouka le 15/08.
--
-- ────────────────────────────────────────────────────────────────────────
-- CONTEXTE
-- ────────────────────────────────────────────────────────────────────────
--
-- Le tunnel d'inscription capture déjà le choix précis du profil (joueur/sportif/particulier/
-- parent/agent/autre — src/app/signup/signup-context.tsx) mais ne persiste QUE le booléen
-- account_type ('joueur'/'particulier') — le choix fin (agent vs parent vs tuteur vs autre) n'a
-- jamais été écrit nulle part (vérifié par audit avant d'écrire cette migration). Cette migration
-- ajoute la colonne pour l'enregistrer enfin, et l'utilise pour deux choses :
--   1. Vocabulaire adapté ("Mes enfants" pour un parent, "Mes sportifs suivis" pour un agent —
--      câblé côté frontend, hors SQL).
--   2. Un plafond, unifié entre agent et parent, sur le nombre TOTAL de sportifs suivis :
--        - agent  → palier payant existant (connect_agent_tier_limit/effective_tier, INCHANGÉS,
--          2 gratuit / 5 starter / 10 growth / 20 pro).
--        - parent (et tuteur, même traitement) → 3, plafond DUR, jamais payant. Au-delà, contact
--          manuel avec SportVision plutôt qu'un palier automatique (choix explicite de Fouka : "un
--          parent n'est pas un pro qui gère un portefeuille").
--        - autre → 3 par défaut (même plafond que parent, choix conservateur en l'absence de
--          consigne — à ajuster si Fouka veut un traitement différent plus tard).
--        - compte existant AVANT cette migration (profil_particulier NULL, jamais choisi) → PAS
--          de plafond (valeur haute volontaire) pour ne jamais bloquer rétroactivement un compte
--          déjà en usage réel sans avoir fait ce choix.
--
-- BUG PRÉ-EXISTANT CORRIGÉ AU PASSAGE (pas la demande initiale, mais découvert en creusant) :
-- connect_create_managed_athlete() (migration-connect-v51) n'avait JUSQU'ICI AUCUNE vérification
-- de plafond — un compte agent pouvait entièrement contourner son palier payant en créant des
-- "sportifs gérés" (managed_athlete_profiles) au lieu de demander l'accès à un compte joueur
-- existant (seul chemin déjà plafonné, via connect_respond_profile_access_request). Cette
-- migration unifie le comptage sur LES DEUX mécanismes à la fois (connect_access_relationships
-- acceptées + managed_athlete_profiles), donc ferme ce trou pour agent ET parent en même temps.
--
-- Idempotente
-- (add column if not exists, create or replace function). connect_agent_tier_limit()/
-- connect_agent_effective_tier() (migration-connect-v57) NE SONT PAS MODIFIÉES ici, seulement
--
-- EXÉCUTÉE — vérifié en base réelle le 19/08/2026 (audit pré-lancement) :
-- colonne connect_profile_settings.profil_particulier existe déjà en
-- base, et les définitions live de connect_create_managed_athlete et
-- connect_respond_profile_access_request correspondent exactement à la
-- version de cette migration. Cet en-tête disait à tort "NON EXÉCUTÉE".
-- réutilisées.
-- ============================================================


-- ─── 1. Profil précis du compte particulier ────────────────────────────────────────────────
alter table connect_profile_settings add column if not exists profil_particulier text
  check (profil_particulier in ('agent', 'parent', 'tuteur', 'autre'));

comment on column connect_profile_settings.profil_particulier is
  'Choix précis fait à l''inscription (agent/parent/tuteur/autre), account_type=''particulier'' '
  'uniquement. NULL = compte créé avant migration-connect-v67, jamais demandé rétroactivement — '
  'traité comme "pas de plafond" par connect_particulier_limit(). Câblé par le frontend au '
  'premier login (voir pending-onboarding.ts), jamais modifiable après coup dans cette version.';


-- ─── 2. Comptage total unifié (relations acceptées + sportifs gérés créés directement) ──────
-- Corrige au passage le trou connect_create_managed_athlete() décrit en en-tête : ces profils
-- n'étaient comptés NULLE PART avant cette migration.
create or replace function connect_particulier_total_sportifs_count(p_user_id uuid)
returns integer
language sql security definer stable set search_path = public
as $$
  select
    (select count(*)::int from connect_access_relationships
       where grantee_user_id = p_user_id and status = 'acceptee')
    +
    (select count(*)::int from managed_athlete_profiles
       where owner_user_id = p_user_id);
$$;

-- ─── 3. Plafond applicable selon le profil du compte ────────────────────────────────────────
-- 999 = volontairement "pas de plafond réel" pour profil_particulier NULL (compte antérieur à
-- cette migration) — pas NULL/0 pour éviter tout comportement surprenant (0 bloquerait tout,
-- NULL casserait les comparaisons `count >= limit` en aval sans vérification supplémentaire).
create or replace function connect_particulier_limit(p_user_id uuid)
returns integer
language plpgsql security definer stable set search_path = public
as $$
declare
  v_profil text;
begin
  select profil_particulier into v_profil from connect_profile_settings where user_id = p_user_id;

  if v_profil = 'agent' then
    return connect_agent_tier_limit(connect_agent_effective_tier(p_user_id));
  elsif v_profil in ('parent', 'tuteur', 'autre') then
    return 3;
  else
    return 999; -- profil jamais choisi (compte pré-v67) : pas de plafond rétroactif
  end if;
end;
$$;


-- ─── 4. Applique le plafond à connect_create_managed_athlete() (jusqu'ici JAMAIS vérifié) ───
create or replace function connect_create_managed_athlete(
  p_prenom text, p_nom text, p_sport text, p_categorie text, p_club text, p_relation text
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_count integer;
  v_limit integer;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;
  if trim(coalesce(p_prenom, '')) = '' or trim(coalesce(p_nom, '')) = '' then
    raise exception 'Prénom et nom sont obligatoires.';
  end if;

  v_count := connect_particulier_total_sportifs_count(auth.uid());
  v_limit := connect_particulier_limit(auth.uid());
  if v_count >= v_limit then
    raise exception 'PAYWALL_PARTICULIER_LIMIT: Vous suivez déjà % sportif(s) sur %. Contactez SportVision pour aller au-delà.', v_count, v_limit;
  end if;

  insert into managed_athlete_profiles (owner_user_id, prenom, nom, sport, categorie, club_declare, relation_label)
  values (auth.uid(), trim(p_prenom), trim(p_nom), nullif(trim(coalesce(p_sport, '')), ''),
          nullif(trim(coalesce(p_categorie, '')), ''), nullif(trim(coalesce(p_club, '')), ''),
          coalesce(nullif(trim(coalesce(p_relation, '')), ''), 'Parent'))
  returning id into v_id;

  return v_id;
end;
$$;


-- ─── 5. Remplace le plafond agent-only de connect_respond_profile_access_request() ──────────
-- par le plafond unifié (agent payant / parent-tuteur-autre à 3 dur / NULL illimité), sur TOUTE
-- acceptation (plus seulement relation_type='agent') — reprend EXACTEMENT le corps de la version
-- migration-connect-v57-abonnement-agent.sql (droits par défaut à l'acceptation inchangés), seul
-- le bloc PAYWALL change. Message distingué par préfixe (PAYWALL_AGENT_LIMIT vs
-- PAYWALL_PARTICULIER_LIMIT) pour que le frontend (RequestCard.tsx) puisse proposer "changer de
-- palier" UNIQUEMENT dans le cas agent (le seul qui a un palier payant à proposer) et un message
-- simple "contactez SportVision" dans le cas parent/tuteur/autre (aucun palier payant à vendre).
create or replace function connect_respond_profile_access_request(p_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row connect_access_relationships%rowtype;
  v_count integer;
  v_limit integer;
  v_profil text;
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
    v_count := connect_particulier_total_sportifs_count(v_row.grantee_user_id);
    v_limit := connect_particulier_limit(v_row.grantee_user_id);
    if v_count >= v_limit then
      select profil_particulier into v_profil from connect_profile_settings where user_id = v_row.grantee_user_id;
      if v_profil = 'agent' then
        raise exception 'PAYWALL_AGENT_LIMIT: Le compte qui vous a envoyé cette demande a atteint la limite de son abonnement Agent (% sportifs sur %). Il doit souscrire ou changer de palier avant de pouvoir suivre un nouveau sportif.', v_count, v_limit;
      else
        raise exception 'PAYWALL_PARTICULIER_LIMIT: Le compte qui vous a envoyé cette demande a atteint sa limite (% sportifs sur %). Il doit contacter SportVision avant de pouvoir suivre un nouveau sportif.', v_count, v_limit;
      end if;
    end if;
  end if;

  update connect_access_relationships
  set
    status = case when p_accept then 'acceptee' else 'refusee' end,
    responded_at = now(),
    right_voir = case when p_accept then true else right_voir end,
    right_download = case when p_accept then true else right_download end,
    updated_at = now()
  where id = p_id;
end;
$$;

-- ============================================================
-- FIN. Actions manuelles requises après relecture :
--   1. Exécuter ce fichier dans Supabase → SQL Editor (idempotent).
--   2. Le câblage frontend (persistance du choix à l'inscription, vocabulaire "Mes enfants" pour
--      un parent, bannière de plafond sur "Mes sportifs", gestion du nouveau préfixe
--      PAYWALL_PARTICULIER_LIMIT côté RequestCard.tsx) est un chantier séparé, pas dans ce
--      fichier.
--   3. Aucune Edge Function à redéployer pour cette migration (uniquement des fonctions SQL,
--      appelées directement en RPC par le frontend).
-- ============================================================
