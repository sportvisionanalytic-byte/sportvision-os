-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v57
-- Abonnement payant "Agent / représentant" + saisie manuelle de match.
--
-- Contexte (15/08/2026, décision produit validée par Fouka) : un compte Connect qui suit
-- plusieurs sportifs via relation_type = 'agent' (connect_access_relationships, migration-
-- connect-personnel-accueil-profil-acces.sql §2) doit payer un abonnement mensuel au-delà de 2
-- sportifs suivis. C'est la toute première intégration Stripe RÉCURRENTE d'app-connect (Espace
-- particulier) — tout ce qui existait jusqu'ici dans ce périmètre (create-checkout-session,
-- create-funding-contribution-checkout, create-guest-*) est du paiement ponctuel (`mode:
-- "payment"`). Traité avec la même rigueur que les migrations financières précédentes : jamais de
-- confiance client sur un montant, jamais de statut "actif" écrit ailleurs que par le webhook
-- Stripe (MASTER-CONNECT-V1.md §25 : "le webhook confirme, jamais le retour navigateur").
--
-- Paliers (prix fixés côté Stripe Dashboard — 3 Price ID créés MANUELLEMENT par Fouka après
-- l'exécution de cette migration, voir le résumé en fin de fichier ; JAMAIS de montant en dur
-- côté SQL ou edge function, conformément à la consigne du brief) :
--   Gratuit  : 0-2  sportifs suivis  · 0 €      (aucune ligne connect_agent_subscriptions)
--   Starter  : 3-5  sportifs suivis  · 9,90 €/mois  · -5% Montage Compilation
--   Growth   : 6-10 sportifs suivis  · 15,90 €/mois · -5% Montage Compilation
--   Pro      : 11-20 sportifs suivis · 24,90 €/mois · -5% Montage Compilation + -10% une
--              prestation au choix, une fois par période de facturation
--   Au-delà de 20 : pas de palier self-service — message "contactez-nous" côté frontend, rien à
--   coder ici (aucune ligne, aucun palier serveur au-delà de 'pro').
--
-- Idempotente (create
-- table/policy if not exists, drop policy/function if exists avant chaque recreate) : peut être
-- rejouée sans effet de bord. Schéma réel vérifié en direct (service_role, .env racine) avant
--
-- EXÉCUTÉE — vérifié en base réelle le 19/08/2026 (audit pré-lancement) :
-- tables connect_agent_subscriptions/connect_manual_calendar_events,
-- policies cas_self_select/cmce_creator_select et fonctions
-- connect_agent_tier_limit/connect_agent_effective_tier/
-- connect_agent_relationship_count/connect_agent_subscription_status/
-- connect_agent_discount/connect_add_manual_calendar_event/
-- connect_delete_manual_calendar_event existent déjà en base. Cet en-tête
-- disait à tort "NON EXÉCUTÉE".
-- d'écrire une seule ligne : connect_access_relationships porte déjà right_modifier (colonne
-- posée par migration-connect-v51-espace-particulier.sql, jamais branchée à une fonctionnalité —
-- c'est le point d'accroche de la partie 3 ci-dessous), connect_profile_settings.account_type
-- existe, managed_athlete_profiles existe. Aucune table connect_agent_subscriptions ni
-- connect_manual_calendar_events n'existe encore.
-- ============================================================


-- ────────────────────────────────────────────────────────────────────────
-- 1. ÉTAT DE L'ABONNEMENT AGENT
-- ────────────────────────────────────────────────────────────────────────
--
-- Une ligne par utilisateur AGENT abonné (pas par relation) : l'abonnement est attaché au compte
-- qui suit des sportifs, pas à un sportif en particulier. Absence de ligne = palier "gratuit"
-- (0-2 sportifs) — jamais besoin d'insérer une ligne "gratuit" explicite, cf.
-- connect_agent_effective_tier() plus bas, même principe que connect_profile_settings (absence de
-- ligne = valeurs par défaut, pas un état d'erreur).
--
-- La ligne est conservée après résiliation (status = 'canceled', stripe_subscription_id gardé
-- comme trace) plutôt que supprimée — même choix que `clubs` pour l'abonnement Club+
-- (migration-clubplus-v25 : "stripe_subscription_id est volontairement CONSERVÉ").
--
-- monthly_discount_used_at : suivi de la remise "-10% une prestation au choix, une fois par mois"
-- (palier Pro uniquement). Méthode choisie : une simple colonne timestamptz, remise à NULL par le
-- webhook Stripe à CHAQUE `invoice.payment_succeeded` de l'abonnement (première facture ou
-- renouvellement — un nouvel événement `invoice.payment_succeeded` signifie systématiquement
-- "nouvelle période de facturation qui démarre", donc "la remise du mois redevient disponible").
-- Choisi plutôt qu'une comparaison de dates (monthly_discount_used_at vs current_period_end) :
-- plus simple, aucune fenêtre d'ambiguïté à la limite de période, et le webhook a de toute façon
-- besoin d'écrire sur cette ligne à chaque facture payée pour maintenir `current_period_end` à
-- jour. Non-NULL = remise déjà consommée sur la période en cours.
create table if not exists connect_agent_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  tier text not null default 'starter' check (tier in ('starter', 'growth', 'pro')),
  status text not null default 'incomplete' check (status in ('incomplete', 'active', 'past_due', 'canceled')),
  current_period_end timestamptz,
  monthly_discount_used_at timestamptz,
  -- Reflète Stripe Subscription.cancel_at_period_end (résiliation programmée par
  -- manage-agent-subscription, action "cancel" — l'abonnement reste actif jusqu'à cette date,
  -- puis customer.subscription.deleted passe status à 'canceled'). Écrit uniquement par le
  -- webhook (customer.subscription.updated/created), jamais directement par
  -- manage-agent-subscription : même principe que le reste de cette table, l'appel à l'API
  -- Stripe n'est jamais considéré confirmé tant que le webhook ne l'a pas répercuté.
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cas_stripe_subscription on connect_agent_subscriptions(stripe_subscription_id) where stripe_subscription_id is not null;

alter table connect_agent_subscriptions enable row level security;

-- Lecture réservée au propriétaire (consigne du brief). Aucune policy INSERT/UPDATE/DELETE pour
-- authenticated : la ligne n'est écrite QUE par le webhook Stripe (service_role, bypass RLS) —
-- jamais par le client, jamais par une simple intention de payer (même principe que `clubs.plan`/
-- `subscription_status`, verrouillés côté Club+ par trg_protect_sensitive_club_fields).
drop policy if exists "cas_self_select" on connect_agent_subscriptions;
create policy "cas_self_select" on connect_agent_subscriptions for select
  using (user_id = auth.uid());

drop trigger if exists trg_cas_updated_at on connect_agent_subscriptions;
create trigger trg_cas_updated_at before update on connect_agent_subscriptions
  for each row execute procedure update_updated_at_generic();


-- ────────────────────────────────────────────────────────────────────────
-- 2. LIMITES DE PALIER + COMPTAGE + PAYWALL
-- ────────────────────────────────────────────────────────────────────────

-- Table de correspondance palier → nombre de sportifs "agent" autorisés. IMMUTABLE + SQL pur
-- (pas de dépendance à auth.uid()) : appelable librement depuis n'importe quelle autre fonction
-- de cette migration, y compris en contexte non authentifié (jamais le cas ici en pratique, mais
-- pas de raison de restreindre une simple table de correspondance publique).
create or replace function connect_agent_tier_limit(p_tier text)
returns integer
language sql immutable
as $$
  select case p_tier
    when 'starter' then 5
    when 'growth' then 10
    when 'pro' then 20
    else 2 -- 'gratuit' (aucune ligne / abonnement non actif) ou valeur inconnue
  end;
$$;

-- Palier RÉELLEMENT actif d'un utilisateur donné : 'gratuit' si aucune ligne, ou si la ligne
-- existe mais status <> 'active' (impayé, résilié, jamais confirmé) — un abonnement "incomplete"
-- ou "past_due" ne doit JAMAIS élargir la limite, seul un paiement réellement confirmé par le
-- webhook (status = 'active') compte. SECURITY DEFINER : appelée avec un p_user_id qui n'est pas
-- forcément auth.uid() (cf. §3, vérification faite par le PROPRIÉTAIRE du profil sur le palier de
-- la personne qui lui demande accès), donc doit pouvoir lire connect_agent_subscriptions au-delà
-- de ce que la policy RLS autoriserait pour l'appelant direct.
create or replace function connect_agent_effective_tier(p_user_id uuid)
returns text
language plpgsql security definer stable set search_path = public
as $$
declare
  v_tier text;
begin
  select tier into v_tier from connect_agent_subscriptions
    where user_id = p_user_id and status = 'active';
  return coalesce(v_tier, 'gratuit');
end;
$$;

-- Nombre de sportifs actuellement suivis en tant qu'agent (relation_type = 'agent', status =
-- 'acceptee') pour un utilisateur donné. SECURITY DEFINER pour la même raison que ci-dessus :
-- appelée depuis connect_respond_profile_access_request avec grantee_user_id (le demandeur), pas
-- forcément auth.uid() (l'appelant de cette fonction-ci est le PROPRIÉTAIRE qui répond).
create or replace function connect_agent_relationship_count(p_user_id uuid)
returns integer
language sql security definer stable set search_path = public
as $$
  select count(*)::int from connect_access_relationships
    where grantee_user_id = p_user_id and relation_type = 'agent' and status = 'acceptee';
$$;

-- RPC consommée par le frontend ("Mon abonnement", bannière palier sur "Mes sportifs") — l'appelant
-- consulte SON PROPRE état uniquement (contrairement aux deux fonctions ci-dessus, pas de
-- paramètre p_user_id : jamais de fuite du palier/nombre de sportifs d'un tiers).
--
-- Contrat exact (consommé par app-connect, src/lib/supabase/agentSubscription.ts) :
--   { tier: 'gratuit'|'starter'|'growth'|'pro',
--     status: 'gratuit'|'incomplete'|'active'|'past_due'|'canceled',
--     athletes_count: integer,
--     limit: integer,
--     can_accept_more: boolean,
--     current_period_end: timestamptz|null,
--     cancel_at_period_end: boolean,
--     monthly_discount_used_at: timestamptz|null }
create or replace function connect_agent_subscription_status()
returns jsonb
language plpgsql security definer stable set search_path = public
as $$
declare
  v_sub connect_agent_subscriptions%rowtype;
  v_tier text;
  v_count integer;
  v_limit integer;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  select * into v_sub from connect_agent_subscriptions where user_id = auth.uid();
  v_tier := connect_agent_effective_tier(auth.uid());
  v_count := connect_agent_relationship_count(auth.uid());
  v_limit := connect_agent_tier_limit(v_tier);

  return jsonb_build_object(
    'tier', v_tier,
    'status', coalesce(v_sub.status, 'gratuit'),
    'athletes_count', v_count,
    'limit', v_limit,
    'can_accept_more', v_count < v_limit,
    'current_period_end', v_sub.current_period_end,
    'cancel_at_period_end', coalesce(v_sub.cancel_at_period_end, false),
    'monthly_discount_used_at', v_sub.monthly_discount_used_at
  );
end;
$$;

grant execute on function connect_agent_subscription_status() to authenticated;

-- RPC STABLE destinée à un chantier SÉPARÉ (Montage Compilation, catalogue pas encore construit
-- au moment d'écrire cette migration — il ajoutera l'offre juste après ce chantier-ci). Résout la
-- remise applicable à un payeur donné au moment du paiement d'une prestation. Exemple d'appel
-- attendu depuis l'edge function de paiement du futur chantier (service_role, ou via le JWT de
-- l'utilisateur — la fonction est SECURITY DEFINER et ne fait aucune écriture, donc les deux
-- fonctionnent) :
--
--   const { data } = await supabase.rpc('connect_agent_discount', { p_user_id: payeurUserId });
--   // data = { montage_pct: 0|5, monthly_pct: 0|10, monthly_used_this_period: boolean }
--   const remiseMontageHt = data.montage_pct > 0 ? montantHt * data.montage_pct / 100 : 0;
--   // Si le payeur choisit d'appliquer monthly_pct à CETTE prestation (n'importe laquelle du
--   // catalogue, palier Pro uniquement, une fois par période) : appliquer le pourcentage puis
--   // marquer la remise consommée pour la période en cours —
--   //   update connect_agent_subscriptions set monthly_discount_used_at = now(), updated_at = now()
--   //   where user_id = payeurUserId;
--   // — écriture directe via un client service_role (RLS bloque authenticated en écriture sur
--   // cette table, volontairement : voir §1). Cette RPC-ci reste PUREMENT EN LECTURE, elle ne
--   // consomme jamais la remise elle-même — au chantier appelant de le faire au bon moment (après
--   // confirmation du paiement par le webhook Stripe, jamais avant, même principe que le reste de
--   // ce fichier : le webhook confirme, jamais l'intention de payer).
--
-- montage_pct : -5% sur Montage Compilation, dès le palier Starter. monthly_pct : -10% sur UNE
-- prestation au choix (n'importe laquelle du catalogue, pas seulement Montage), une fois par
-- période de facturation, palier Pro uniquement. monthly_used_this_period reflète l'état actuel
-- (déjà consommée ou non) — à vérifier AVANT d'appliquer monthly_pct.
create or replace function connect_agent_discount(p_user_id uuid)
returns jsonb
language plpgsql security definer stable set search_path = public
as $$
declare
  v_sub connect_agent_subscriptions%rowtype;
  v_tier text;
  v_monthly_used boolean;
begin
  select * into v_sub from connect_agent_subscriptions where user_id = p_user_id and status = 'active';
  v_tier := coalesce(v_sub.tier, 'gratuit');
  v_monthly_used := v_tier = 'pro' and v_sub.monthly_discount_used_at is not null;

  return jsonb_build_object(
    'montage_pct', case when v_tier in ('starter', 'growth', 'pro') then 5 else 0 end,
    'monthly_pct', case when v_tier = 'pro' and not v_monthly_used then 10 else 0 end,
    'monthly_used_this_period', coalesce(v_monthly_used, false)
  );
end;
$$;

grant execute on function connect_agent_discount(uuid) to authenticated;

-- Paywall réel : réécrite pour ajouter la vérification de palier AVANT d'accepter une demande
-- 'agent' — reprend EXACTEMENT le corps de la version migration-connect-v51-espace-particulier.sql
-- §3 (droits par défaut à l'acceptation inchangés), seul le nouveau bloc "PAYWALL AGENT" est
-- ajouté, en tout début de la branche p_accept. Le message d'exception commence par le préfixe
-- fixe "PAYWALL_AGENT_LIMIT:" — c'est le contrat exact que lit le frontend (RequestCard.tsx) pour
-- distinguer ce refus d'une erreur technique générique et afficher le bon message.
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

  if p_accept and v_row.relation_type = 'agent' then
    v_count := connect_agent_relationship_count(v_row.grantee_user_id);
    v_limit := connect_agent_tier_limit(connect_agent_effective_tier(v_row.grantee_user_id));
    if v_count >= v_limit then
      raise exception 'PAYWALL_AGENT_LIMIT: Le compte qui vous a envoyé cette demande a atteint la limite de son abonnement Agent (% sportifs sur %). Il doit souscrire ou changer de palier avant de pouvoir suivre un nouveau sportif.', v_count, v_limit;
    end if;
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


-- ────────────────────────────────────────────────────────────────────────
-- 3. SAISIE MANUELLE DE MATCH (right_modifier)
-- ────────────────────────────────────────────────────────────────────────
--
-- Premier branchement réel de right_modifier (colonne posée par migration-connect-v51 §3, jamais
-- utilisée jusqu'ici — vérifié par grep sur tout app-connect avant d'écrire cette section).
-- Objectif énoncé par Fouka : "pour pas se perdre" — un simple ajout/liste de match (adversaire,
-- date, lieu), rien de plus élaboré que ce qui existe déjà pour les autres événements du
-- calendrier particulier. Couvre aussi bien un sportif LIÉ (right_modifier accordé par le
-- sportif) qu'un profil GÉRÉ (droits pleins par construction, cf. migration-connect-v51 §5).
create table if not exists connect_manual_calendar_events (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  athlete_kind text not null check (athlete_kind in ('linked', 'managed')),
  -- 'linked' → connect_access_relationships.owner_user_id (le sportif) ; 'managed' →
  -- managed_athlete_profiles.id. Pas de contrainte FK directe (la cible dépend de athlete_kind) —
  -- vérifiée dans les RPC ci-dessous, jamais côté client.
  athlete_ref_id uuid not null,
  adversaire text,
  event_date date not null,
  event_time time,
  lieu text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cmce_creator on connect_manual_calendar_events(created_by);
create index if not exists idx_cmce_athlete on connect_manual_calendar_events(athlete_kind, athlete_ref_id);

alter table connect_manual_calendar_events enable row level security;

-- Lecture RLS directe réservée au créateur (consigne du brief). La lecture PARTAGÉE avec les
-- autres accompagnants ayant le droit "calendrier" sur le même sportif passe exclusivement par
-- connect_list_calendar_for_athletes() ci-dessous (SECURITY DEFINER, contournement volontaire et
-- contrôlé de cette policy — même schéma que club_calendar_events/club_media, cf. migration-
-- connect-v51 §7) : un calendrier partagé n'a de sens que si tout le monde voit les mêmes
-- événements, mais l'accès table brut reste minimal par défaut.
drop policy if exists "cmce_creator_select" on connect_manual_calendar_events;
create policy "cmce_creator_select" on connect_manual_calendar_events for select
  using (created_by = auth.uid());

drop trigger if exists trg_cmce_updated_at on connect_manual_calendar_events;
create trigger trg_cmce_updated_at before update on connect_manual_calendar_events
  for each row execute procedure update_updated_at_generic();

-- Aucune policy INSERT/UPDATE/DELETE pour authenticated : toute écriture passe par les RPC
-- SECURITY DEFINER ci-dessous, qui revérifient right_modifier CÔTÉ SERVEUR à chaque appel —
-- jamais une confiance dans le fait que le bouton n'est affiché côté client que si ce droit est
-- déjà vrai (MASTER-CONNECT-V1.md §36).
create or replace function connect_add_manual_calendar_event(
  p_athlete_kind text, p_athlete_ref_id uuid, p_adversaire text, p_event_date date, p_event_time time, p_lieu text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;
  if p_athlete_kind not in ('linked', 'managed') then
    raise exception 'Sportif invalide.';
  end if;
  if p_event_date is null then
    raise exception 'La date est obligatoire.';
  end if;

  if p_athlete_kind = 'managed' then
    if not exists (select 1 from managed_athlete_profiles where id = p_athlete_ref_id and owner_user_id = auth.uid()) then
      raise exception 'Profil géré introuvable ou accès refusé.';
    end if;
  else
    if not exists (
      select 1 from connect_access_relationships
      where owner_user_id = p_athlete_ref_id and grantee_user_id = auth.uid()
        and status = 'acceptee' and right_modifier
    ) then
      raise exception 'Autorisation de modification manquante pour ce sportif.';
    end if;
  end if;

  insert into connect_manual_calendar_events (created_by, athlete_kind, athlete_ref_id, adversaire, event_date, event_time, lieu)
  values (auth.uid(), p_athlete_kind, p_athlete_ref_id, nullif(trim(coalesce(p_adversaire, '')), ''), p_event_date, p_event_time, nullif(trim(coalesce(p_lieu, '')), ''))
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function connect_add_manual_calendar_event(text, uuid, text, date, time, text) to authenticated;

-- Suppression — réservée au créateur (corrige une erreur de saisie ; pas de droit "modifier"
-- distinct requis ici puisque created_by = auth.uid() garantit déjà que c'est bien la personne qui
-- avait le droit au moment de la création — un retrait ultérieur du droit right_modifier ne doit
-- pas empêcher de corriger une entrée déjà créée, seulement d'en créer de nouvelles).
create or replace function connect_delete_manual_calendar_event(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;
  delete from connect_manual_calendar_events where id = p_id and created_by = auth.uid();
  if not found then
    raise exception 'Événement introuvable ou accès refusé.';
  end if;
end;
$$;

grant execute on function connect_delete_manual_calendar_event(uuid) to authenticated;

-- connect_list_calendar_for_athletes() étendue pour fusionner les matchs manuels aux événements
-- club réels. DROP d'abord : le jeu de colonnes retourné change (ajout de `source`) — même raison
-- que list_my_fundings()/get_funding_detail() dans migration-connect-v51 §8 (42P13, Postgres
-- refuse un CREATE OR REPLACE qui change le type de retour d'une fonction TABLE).
--
-- `source` ∈ 'club' | 'manual' — le frontend (CalendrierParticulierView.tsx) doit afficher un
-- badge "Ajouté manuellement" sur toute ligne source='manual', pour ne jamais laisser croire
-- qu'un match saisi à la main est un événement SportVision officiel (consigne explicite du brief).
--
-- Visibilité des matchs manuels d'un sportif LIÉ : volontairement PAS restreinte au seul créateur
-- — tout accompagnant ayant le droit "calendrier" sur ce même sportif les voit aussi (même
-- principe de partage que les événements club ci-dessus : un calendrier partagé n'a de sens que
-- si tout le monde voit les mêmes événements). La policy RLS "créateur uniquement" du §3 reste le
-- filet de sécurité pour un accès table direct hors de cette fonction. Pour un profil GÉRÉ, seul
-- son propriétaire y a de toute façon jamais accès (aucun tiers, cf. migration-connect-v51 §2).
drop function if exists connect_list_calendar_for_athletes();
create or replace function connect_list_calendar_for_athletes()
returns table (
  athlete_kind text, athlete_ref_id uuid, athlete_label text,
  id uuid, event_date date, type text, title text, team text, event_time time, location text,
  source text
)
language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  return query
  select 'linked'::text, pp.user_id, coalesce(nullif(trim(pp.prenom), ''), 'Sportif'),
    cc.id, cc.event_date, cc.type, cc.title, cc.team, cc.event_time, cc.location, 'club'::text
  from connect_access_relationships car
  join player_profiles pp on pp.user_id = car.owner_user_id
  join club_calendar_events cc on cc.club_id = pp.club_id
  where car.grantee_user_id = auth.uid() and car.status = 'acceptee' and car.right_calendrier
    and pp.account_status <> 'retire'

  union all
  select 'linked'::text, car.owner_user_id, coalesce(nullif(trim(pp2.prenom), ''), car.grantee_display_name, 'Sportif'),
    mce.id, mce.event_date, 'match'::text,
    case when mce.adversaire is not null then 'Match vs ' || mce.adversaire else 'Match' end,
    null::text, mce.event_time, mce.lieu, 'manual'::text
  from connect_manual_calendar_events mce
  join connect_access_relationships car on car.owner_user_id = mce.athlete_ref_id and car.grantee_user_id = auth.uid()
  left join player_profiles pp2 on pp2.user_id = mce.athlete_ref_id
  where mce.athlete_kind = 'linked' and car.status = 'acceptee' and car.right_calendrier

  union all
  select 'managed'::text, mce.athlete_ref_id, coalesce(nullif(trim(map.prenom || ' ' || map.nom), ''), 'Sportif'),
    mce.id, mce.event_date, 'match'::text,
    case when mce.adversaire is not null then 'Match vs ' || mce.adversaire else 'Match' end,
    null::text, mce.event_time, mce.lieu, 'manual'::text
  from connect_manual_calendar_events mce
  join managed_athlete_profiles map on map.id = mce.athlete_ref_id and map.owner_user_id = auth.uid()
  where mce.athlete_kind = 'managed';
end;
$$;

grant execute on function connect_list_calendar_for_athletes() to authenticated;


-- ============================================================
-- FIN. Résumé des actions manuelles requises après relecture :
--
--   1. Exécuter ce fichier entier dans Supabase → SQL Editor (idempotent).
--
--   2. Créer 3 Price Stripe récurrents mensuels (Dashboard Stripe → Product catalog), un produit
--      "SportVision Connect — Agent" avec 3 prix (ou 3 produits séparés, au choix) :
--        Starter : 9,90 €/mois
--        Growth  : 15,90 €/mois
--        Pro     : 24,90 €/mois
--      Copier les 3 Price ID (price_xxx) dans les secrets Supabase Edge Functions :
--        STRIPE_PRICE_AGENT_STARTER, STRIPE_PRICE_AGENT_GROWTH, STRIPE_PRICE_AGENT_PRO
--      Aucun montant n'est écrit en dur côté code : create-agent-subscription-checkout et
--      stripe-webhook lisent exclusivement ces 3 variables d'environnement.
--
--   3. Déployer 3 nouvelles Edge Functions (Supabase Dashboard → Edge Functions → New Function) :
--        create-agent-subscription-checkout, manage-agent-subscription, connect-agent-billing-portal
--      (voir le README en tête de chaque fichier pour les secrets requis).
--
--   4. Redéployer stripe-webhook (modifié, additif) — voir son en-tête pour le détail exact des
--      événements ajoutés.
--
--   5. Dans Stripe Dashboard → Developers → Webhooks → (l'endpoint existant), ajouter les
--      événements pas encore écoutés : customer.subscription.created, invoice.payment_succeeded.
--      (customer.subscription.updated, customer.subscription.deleted et invoice.payment_failed
--      sont déjà écoutés depuis l'abonnement Club+, migration-clubplus-v25 — aucun ajout requis
--      pour ceux-là.)
--
--   6. Optionnel : Stripe Dashboard → Settings → Billing → Customer portal — si vous voulez que
--      "Gérer ma facturation" (connect-agent-billing-portal) affiche aussi l'historique de
--      factures/moyen de paiement en self-service (recommandé). Le changement de palier et la
--      résiliation passent par manage-agent-subscription (API directe), PAS par le Portail — donc
--      "Customers can switch plans" n'a pas besoin d'être activé pour ce chantier (à la différence
--      de Club+).
-- ============================================================
