-- ============================================================
-- SPORTVISION CONNECT — Migration v44 : demandes d'ouverture Connect (club)
-- Corrige une faille de sécurité/business réelle et live : aujourd'hui,
-- n'importe quel visiteur anonyme qui s'inscrit sur /signup avec
-- orgType==='club' et choisit Club+ Start/Performance obtient un club ACTIF
-- et en devient ADMINISTRATEUR immédiatement, sans validation humaine
-- (clubplus-onboarding, "Portée v1 : crée toujours un NOUVEAU club avec
-- l'appelant comme admin", role:"admin" posé en dur). N'importe qui peut
-- taper "Paris Saint-Germain" et devenir admin d'un vrai club actif.
--
-- Décidé avec Fouka (12/08/2026) : une inscription publique de club ne doit
-- plus jamais créer directement un club actif + admin. Elle crée une
-- "Demande d'ouverture Connect" (cette table), notifie le staff, et
-- attend une validation humaine explicite avant toute création réelle.
--
-- Nouveau parcours :
--   Formulaire public (app-next /signup/club-request, 4 étapes, AUCUN
--   compte créé) → connect-club-signup-request (Edge Function anonyme,
--   rate-limitée) insère une ligne 'a_traiter' ici → notify_staff_by_role
--   prévient le staff avec un lien d'action → SportVision OS (nouvel
--   écran de traitement) → connect-club-signup-review (Edge Function
--   staff-only) → staff choisit/confirme EXPLICITEMENT le rôle Connect
--   initial du contact (jamais déduit de sa fonction déclarée dans le
--   club) → génère un lien d'activation → le contact clique, crée son
--   compte, et c'est SEULEMENT À CE MOMENT-LÀ (clubplus-activate) que le
--   club + club_members sont créés.
--
-- ── Pourquoi étendre clubplus_activation_tokens plutôt que dupliquer ────
-- Le patron "validation staff → lien d'activation → clubplus-activate crée
-- le club à la consommation" existe déjà et tourne en prod
-- (migration-clubplus-v26-activation-tokens.sql / clubplus-generate-
-- activation / clubplus-activate). Il ne bloque que sur deux points :
--   1. client_id est NOT NULL (suppose un client CRM déjà existant, faux
--      pour un prospect qui vient de déposer une demande publique) — réglé
--      en laissant connect-club-signup-review créer/rattacher la fiche
--      `clients` au moment de la validation, comme le fait déjà
--      clubplus-onboarding pour le flux self-service qu'on retire ici.
--   2. clubplus-activate pose role:"admin" EN DUR à la création de
--      club_members — exactement la même famille de faille que celle
--      qu'on corrige, translatée d'un cran : le rôle doit être un choix
--      EXPLICITE du staff au moment de VALIDER la demande, jamais une
--      valeur par défaut implicite. D'où initial_role ci-dessous
--      (colonne nouvelle, défaut 'admin' pour ne rien casser du flux
--      existant clubplus-generate-activation qui n'a jamais eu ce choix
--      et vise toujours un dirigeant déjà identifié comme admin) — voir
--      clubplus-activate/index.ts, modifié pour lire tokenRow.initial_role
--      au lieu de la valeur en dur.
-- Cela évite de dupliquer tout le mécanisme (table de tokens, écran
-- d'activation #/activation déjà en prod, Edge Function de consommation
-- atomique) pour un comportement structurellement identique.
--
-- Idempotente. À exécuter après migration-connect-v43-espace-joueur.sql.
-- ============================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. connect_club_signup_requests — la demande elle-même
-- ═══════════════════════════════════════════════════════════════

create table if not exists connect_club_signup_requests (
  id uuid default gen_random_uuid() primary key,

  -- Étape 1 · Votre club
  club_nom text not null,
  structure_type text not null,
  ville text not null,
  code_postal text,
  site_web text,

  -- Étape 2 · Vous (le contact, PAS un compte — aucune ligne auth.users
  -- n'existe à ce stade, voir en-tête de fichier)
  contact_prenom text not null,
  contact_nom text not null,
  contact_email text not null,
  contact_telephone text not null,
  -- Fonction DÉCLARÉE dans le club (informative, liste fermée + "Autre" côté
  -- formulaire) — ne détermine JAMAIS system_role/le rôle Connect. C'est
  -- exactement la distinction que ce chantier introduit : fonction déclarée
  -- (ici) vs rôle Connect réel (choisi séparément par le staff, colonne
  -- clubplus_activation_tokens.initial_role, section 2 ci-dessous).
  fonction text not null,
  fonction_autre text,

  -- Étape 3 · Votre besoin (choix multiples)
  besoins jsonb not null default '[]'::jsonb,
  besoin_autre_precision text,

  -- Étape 4 · Validation
  certification_acceptee boolean not null default false,
  certification_acceptee_le timestamptz,

  -- Traitement staff (SportVision OS)
  statut text check (statut in ('a_traiter', 'infos_demandees', 'valide', 'refuse')) not null default 'a_traiter',
  traite_par uuid references profiles(id),
  traite_le timestamptz,
  notes_staff text,

  created_at timestamptz default now()
);

create index if not exists idx_ccsr_statut on connect_club_signup_requests (statut, created_at desc);

alter table connect_club_signup_requests enable row level security;

-- Écriture réservée au service role : l'Edge Function connect-club-signup-request
-- (anonyme côté appelant, mais elle-même en service role côté serveur) fait
-- l'insert, jamais un insert REST direct depuis le navigateur d'un visiteur —
-- même famille que guest_rate_limits / create-guest-request. Sans ça, un
-- visiteur pourrait forger statut='valide' ou traite_par lui-même : AUCUNE
-- policy d'insert public/anon n'existe ci-dessous, volontairement.
--
-- Lecture/mise à jour réservées au staff SportVision ('admin','sec','com'),
-- même garde que clubplus_activation_tokens (migration-clubplus-v26) et
-- connect-signup-lead.
drop policy if exists "ccsr_staff_all" on connect_club_signup_requests;
create policy "ccsr_staff_all" on connect_club_signup_requests for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'sec', 'com'))
) with check (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'sec', 'com'))
);


-- ═══════════════════════════════════════════════════════════════
-- 2. clubplus_activation_tokens — rôle Connect initial + traçabilité
-- ═══════════════════════════════════════════════════════════════

-- initial_role : choix EXPLICITE du staff au moment de valider une demande
-- (jamais déduit de la fonction déclarée par le contact dans le formulaire
-- public). Défaut 'admin' pour ne rien changer au comportement du flux
-- existant clubplus-generate-activation (fiche client déjà suivie
-- commercialement, staff invite toujours un dirigeant identifié comme
-- admin — ce flux n'est pas modifié, juste rendu explicite).
-- Mêmes valeurs que club_members.role (migration-clubplus-v1.sql).
alter table clubplus_activation_tokens
  add column if not exists initial_role text check (initial_role in (
    'admin', 'president', 'secretaire', 'comm', 'cm_externe', 'coach',
    'resp_equipe', 'sponsor_mgr', 'tresorier', 'membre_bureau', 'lecture_seule'
  )) default 'admin';

-- source_request_id : trace la demande d'origine quand ce token vient d'une
-- validation de connect_club_signup_requests (nul pour les tokens générés
-- depuis une fiche client existante via clubplus-generate-activation, flux
-- inchangé).
alter table clubplus_activation_tokens
  add column if not exists source_request_id uuid references connect_club_signup_requests(id) on delete set null;

create index if not exists idx_cpat_source_request on clubplus_activation_tokens (source_request_id) where source_request_id is not null;


-- ═══════════════════════════════════════════════════════════════
-- 3. notifications — lien d'action vers une demande club
-- ═══════════════════════════════════════════════════════════════

-- Même famille que lien_prestation_id / lien_client_id (migration-
-- notifications-fix.sql) : permet au panneau de notifications de l'OS
-- d'ouvrir directement le nouvel écran de traitement des demandes au lieu
-- de se contenter de marquer la notification comme lue.
alter table notifications
  add column if not exists lien_club_signup_request_id uuid references connect_club_signup_requests(id) on delete set null;


-- ═══════════════════════════════════════════════════════════════
-- 4. notify_staff_by_role — nouveau paramètre optionnel
-- ═══════════════════════════════════════════════════════════════

-- Ajouter un paramètre change la signature (nom, count) de la fonction :
-- CREATE OR REPLACE ne "remplace" que si la signature est identique, sinon
-- Postgres crée un DEUXIÈME objet function (nouvel OID) qui n'hérite PAS du
-- `revoke execute` déjà posé par migration-securite-notify-staff-by-role.sql
-- sur l'ancienne signature à 6 arguments — il faudrait alors re-fermer
-- l'accès pour CETTE signature précise. Pour éviter toute ambiguïté, on
-- DROP l'ancienne fonction et on la recrée avec le nouveau paramètre (7e,
-- avec valeur par défaut) : un seul objet function, un seul revoke à
-- vérifier. Tous les appels existants (6 arguments nommés, Edge Functions +
-- trigger trg_notify_nouvelle_demande) continuent de fonctionner à
-- l'identique : un paramètre final avec DEFAULT peut toujours être omis,
-- que l'appel soit positionnel (PL/pgSQL) ou nommé (PostgREST .rpc()).
drop function if exists notify_staff_by_role(text[], text, text, text, uuid, uuid);

create or replace function notify_staff_by_role(
  p_roles text[], p_titre text, p_message text, p_priorite text, p_prestation_id uuid, p_client_id uuid,
  p_club_signup_request_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (
    type, titre, message, destinataire_id, lue, priorite,
    lien_prestation_id, lien_client_id, lien_club_signup_request_id, created_at
  )
  select 'systeme', p_titre, p_message, pr.id, false, p_priorite, p_prestation_id, p_client_id, p_club_signup_request_id, now()
  from profiles pr
  where pr.role = any(p_roles);
end;
$$;

-- Réaffirme le revoke pour cette signature précise (7 arguments) — voir
-- explication ci-dessus, indispensable même si CREATE OR REPLACE a
-- effectivement remplacé l'objet, une nouvelle fonction reçoit par défaut
-- EXECUTE pour PUBLIC en PostgreSQL tant qu'aucun revoke n'est explicite.
revoke execute on function notify_staff_by_role(text[], text, text, text, uuid, uuid, uuid) from public, anon, authenticated;
