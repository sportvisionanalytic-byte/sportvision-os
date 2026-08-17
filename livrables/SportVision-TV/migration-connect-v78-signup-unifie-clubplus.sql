-- ============================================================
-- SPORTVISION CLUB+ — Migration v78 : généralisation du tunnel de demande
-- d'ouverture Club+ à 7 types de structure (club, académie, coach,
-- structure de coaching, tournoi, stage, association/autre structure).
-- NON EXÉCUTÉE — à relire puis exécuter par Fouka dans Supabase → SQL Editor.
-- Ne JAMAIS exécuter depuis un agent.
-- ============================================================
--
-- ── Contexte ────────────────────────────────────────────────────────────
-- SIGNUP-UNIFIE-MASTER-PROMPT.md (transmis par Fouka le 17/08/2026 + décision
-- d'architecture en bas du fichier) : le tunnel public `/signup/club-request/*`
-- (4 étapes, club uniquement) devient LE tunnel de "demande d'ouverture d'un
-- espace Club+" pour 7 types de structure, et remplace pour de bon l'ancien
-- tunnel générique `/signup/type → .../done` qui créait un compte + une
-- organisation ACTIVE immédiatement pour coach/académie (connect-org-signup)
-- et generic/tournament_organizer (portal-onboarding), sans aucune validation
-- SportVision — exactement ce que Fouka veut éliminer.
--
-- ── Vérifié en direct par curl (REST, lecture seule, SUPABASE_URL/
--    SUPABASE_SECRET_KEY du .env racine) juste avant d'écrire cette migration ──
--   - GET connect_club_signup_requests?select=id&limit=1 -> 404 PGRST205
--     "Could not find the table 'public.connect_club_signup_requests' in the
--     schema cache" — IDENTIQUE à l'erreur obtenue sur un nom de table bidon
--     de comparaison. migration-connect-v44-club-signup-requests.sql (qui
--     crée cette table) n'a donc JAMAIS été exécutée sur ce projet, malgré
--     les Edge Functions/l'écran OS déjà écrits pour elle. AUCUNE ligne
--     réelle n'existe donc pour ce tunnel : aucun backfill n'est nécessaire,
--     la table peut être créée directement sous son nom définitif.
--   - GET clubplus_activation_tokens?select=*&limit=1 -> 200, colonnes
--     réelles = id, client_id, token, club_nom_prefill, plan, created_by,
--     expires_at, used_at, revoked_at, created_at. NI initial_role NI
--     source_request_id (ajoutées par v44 section 2) ne sont présentes —
--     confirme à nouveau que v44 n'a jamais tourné : ces 2 colonnes sont donc
--     ajoutées ici, pas dans une simple vérification "if not exists" à vide.
--   - GET notifications?select=id,lien_club_signup_request_id&limit=1 ->
--     42703 "column does not exist" — même confirmation pour v44 section 3.
--   - GET /rest/v1/ (OpenAPI) -> notify_staff_by_role a bien la signature à 6
--     paramètres (p_roles,p_titre,p_message,p_priorite,p_prestation_id,
--     p_client_id), pas les 7 de v44 section 4 — confirme une dernière fois.
--   - organizations?select=organization_type -> uniquement 'projet' (95) et
--     'club' (26) en prod, zéro ligne des 6 autres types. organizations n'a
--     plus la colonne event_kind (42703) et organization_role_catalog liste
--     déjà tournoi/stage (pas 'event') -> migration-clubplus-v44-tournament-
--     camp-org-types-split.sql, elle, A bien été exécutée : la contrainte
--     organizations_organization_type_check couvre déjà
--     ('club','academie','coach','projet','sponsor','tournoi','stage',
--     'cm_agency'). 'structure_coaching' n'y est pas -> ajoutée ici.
--   - connect_org_activation_tokens?select=id,organization_type -> 200 [],
--     contrainte actuelle (migration-clubplus-v44) = ('tournoi','stage',
--     'cm_agency') -> étendue ici avec les 4 types qui routent désormais
--     par ce mécanisme (academie, coach, structure_coaching, projet).
--
-- ── Décision de nommage ───────────────────────────────────────────────────
-- La table est créée sous le nom `connect_clubplus_signup_requests` (au lieu
-- de `connect_club_signup_requests`, jamais réellement créée) : le master
-- prompt parle partout de "demande d'ouverture Club+"/"espace Club+", jamais
-- de "demande de structure" — Club+ est LE produit cité pour les 7 types
-- (§73 Definition of Done : "Club+ seul produit cité"). Aucune migration de
-- données n'est nécessaire (table inexistante en prod, voir ci-dessus) ;
-- toutes les références (Edge Functions, écran OS) sont mises à jour dans ce
-- même chantier. Les noms des Edge Functions publiques/staff existantes
-- (connect-club-signup-request / connect-club-signup-review) NE sont PAS
-- renommés : le contrat d'API avec le futur frontend (5 étapes) reste
-- stable, seul leur comportement interne est généralisé.
--
-- Idempotente. À exécuter après migration-clubplus-v44-tournament-camp-org-
-- types-split.sql (déjà exécutée, vérifiée ci-dessus).
-- ============================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. connect_clubplus_signup_requests — la demande, généralisée à 7 types
-- ═══════════════════════════════════════════════════════════════

create table if not exists connect_clubplus_signup_requests (
  id uuid default gen_random_uuid() primary key,

  -- Type de structure choisi à l'écran 1 du tunnel (5 écrans, master prompt
  -- §2). 'projet' correspond à "Association / Autre structure" du formulaire
  -- (mapping déjà utilisé ailleurs dans ce repo pour "Autre structure
  -- sportive"/Espace Projet — voir ORG_TYPE_OPTIONS 'generic', signup-
  -- context.tsx). Défaut 'club' : préserve à l'identique le comportement de
  -- l'Edge Function connect-club-signup-request pour tout appelant qui
  -- n'enverrait pas encore ce champ.
  organization_type text not null default 'club' check (organization_type in (
    'club', 'academie', 'coach', 'structure_coaching', 'tournoi', 'stage', 'projet'
  )),

  -- Étape 2 · Votre structure (nom générique, volontairement inchangé —
  -- champ neutre quel que soit le type, voir SIGNUP-UNIFIE-MASTER-PROMPT.md
  -- §100 "Nom de la structure *", libellé affiché adapté côté frontend)
  club_nom text not null,
  -- Sous-classification administrative française — pertinente uniquement
  -- pour club/académie/projet(association) ; NULL et non affichée pour les
  -- 4 autres types (coach, structure_coaching, tournoi, stage). Rendue
  -- nullable ici (elle était `not null` dans la définition jamais exécutée
  -- de v44) car elle n'a plus de sens pour tous les types.
  structure_type text,
  ville text not null,
  code_postal text,
  site_web text,

  -- Champs conditionnels écran 2 — coach/préparateur (master prompt §12) :
  -- non affichés/non requis pour les autres types, NULL sinon.
  activite_type text,
  activite_type_autre text,
  exerce_sous_propre_nom boolean not null default false,

  -- Champ conditionnel écran 2 — tournoi/événement (master prompt §13) :
  -- NULL pour les autres types.
  nom_evenement_principal text,

  -- Étape 3 · Vous (le contact, PAS un compte — aucune ligne auth.users
  -- n'existe à ce stade)
  contact_prenom text not null,
  contact_nom text not null,
  contact_email text not null,
  contact_telephone text not null,
  -- Fonction DÉCLARÉE (informative, liste fermée + "Autre" côté formulaire)
  -- — ne détermine JAMAIS le rôle Connect/Club+ réel. Distinction volontaire
  -- (master prompt §20/§51) : le rôle initial est choisi/posé séparément par
  -- le staff (club : clubplus_activation_tokens.initial_role au moment de
  -- valider ; les 6 autres types : rôle admin unique du catalogue, posé à
  -- l'ACTIVATION, jamais à la demande).
  fonction text not null,
  fonction_autre text,

  -- Étape 4 · Votre besoin (choix multiples)
  besoins jsonb not null default '[]'::jsonb,
  besoin_autre_precision text,

  -- Étape 5 · Validation
  certification_acceptee boolean not null default false,
  certification_acceptee_le timestamptz,

  -- Traitement staff (SportVision OS)
  statut text check (statut in ('a_traiter', 'infos_demandees', 'valide', 'refuse')) not null default 'a_traiter',
  traite_par uuid references profiles(id),
  traite_le timestamptz,
  notes_staff text,

  created_at timestamptz default now()
);

create index if not exists idx_clubplus_sr_statut on connect_clubplus_signup_requests (statut, created_at desc);
create index if not exists idx_clubplus_sr_org_type on connect_clubplus_signup_requests (organization_type);

alter table connect_clubplus_signup_requests enable row level security;

-- Écriture réservée au service role (Edge Function connect-club-signup-request,
-- appelée sans session mais elle-même en service role côté serveur) — même
-- famille que guest_rate_limits / create-guest-request. Aucune policy d'insert
-- public/anon volontairement : un visiteur ne peut jamais forger statut='valide'
-- ou traite_par lui-même.
--
-- Lecture/mise à jour réservées au staff SportVision ('admin','sec','com'),
-- même garde que clubplus_activation_tokens et connect_org_activation_tokens.
drop policy if exists "clubplus_sr_staff_all" on connect_clubplus_signup_requests;
create policy "clubplus_sr_staff_all" on connect_clubplus_signup_requests for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'sec', 'com'))
) with check (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'sec', 'com'))
);


-- ═══════════════════════════════════════════════════════════════
-- 2. clubplus_activation_tokens — rôle Club+ initial + traçabilité (type club)
-- ═══════════════════════════════════════════════════════════════
-- Reprend exactement migration-connect-v44 section 2 (jamais exécutée) :
-- comportement club inchangé, seule la table référencée par source_request_id
-- change de nom (connect_clubplus_signup_requests au lieu de
-- connect_club_signup_requests, qui n'a jamais existé en prod).

alter table clubplus_activation_tokens
  add column if not exists initial_role text check (initial_role in (
    'admin', 'president', 'secretaire', 'comm', 'cm_externe', 'coach',
    'resp_equipe', 'sponsor_mgr', 'tresorier', 'membre_bureau', 'lecture_seule'
  )) default 'admin';

alter table clubplus_activation_tokens
  add column if not exists source_request_id uuid references connect_clubplus_signup_requests(id) on delete set null;

create index if not exists idx_cpat_source_request on clubplus_activation_tokens (source_request_id) where source_request_id is not null;


-- ═══════════════════════════════════════════════════════════════
-- 3. notifications — lien d'action vers une demande Club+ (tous types)
-- ═══════════════════════════════════════════════════════════════

alter table notifications
  add column if not exists lien_clubplus_signup_request_id uuid references connect_clubplus_signup_requests(id) on delete set null;


-- ═══════════════════════════════════════════════════════════════
-- 4. notify_staff_by_role — nouveau paramètre optionnel (7e argument)
-- ═══════════════════════════════════════════════════════════════
-- Même raisonnement que migration-connect-v44 section 4 : DROP + CREATE
-- plutôt que CREATE OR REPLACE, pour ne pas laisser un deuxième objet
-- function non couvert par le revoke déjà posé sur la signature à 6
-- arguments (migration-securite-notify-staff-by-role.sql). Tous les appels
-- existants (6 arguments) continuent de fonctionner à l'identique, le 7e
-- paramètre ayant une valeur par défaut.

drop function if exists notify_staff_by_role(text[], text, text, text, uuid, uuid);

create or replace function notify_staff_by_role(
  p_roles text[], p_titre text, p_message text, p_priorite text, p_prestation_id uuid, p_client_id uuid,
  p_clubplus_signup_request_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (
    type, titre, message, destinataire_id, lue, priorite,
    lien_prestation_id, lien_client_id, lien_clubplus_signup_request_id, created_at
  )
  select 'systeme', p_titre, p_message, pr.id, false, p_priorite, p_prestation_id, p_client_id, p_clubplus_signup_request_id, now()
  from profiles pr
  where pr.role = any(p_roles);
end;
$$;

revoke execute on function notify_staff_by_role(text[], text, text, text, uuid, uuid, uuid) from public, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 5. organizations.organization_type — ajout de 'structure_coaching'
-- ═══════════════════════════════════════════════════════════════
-- Nouveau type réel (master prompt : "Plusieurs coachs, intervenants ou
-- groupes"). Pas de dashboard/nav dédié construit ce soir (hors périmètre) —
-- retombe sur la navigation générique existante côté app-next
-- (resolveNavigation, src/lib/navigation.ts : fallback NAV_GENERIC pour tout
-- OrgType non explicitement branché, déjà le cas avant ce chantier).

alter table organizations drop constraint if exists organizations_organization_type_check;
alter table organizations add constraint organizations_organization_type_check
  check (organization_type in ('club', 'academie', 'coach', 'structure_coaching', 'projet', 'sponsor', 'tournoi', 'stage', 'cm_agency'));


-- ═══════════════════════════════════════════════════════════════
-- 6. organization_role_catalog — presets 'structure_coaching'
-- ═══════════════════════════════════════════════════════════════
-- Catalogue minimaliste, même pattern que 'coach' à sa création (migration-
-- connect-v20/v6) : un rôle admin, un ou deux rôles non-admin. Libellés
-- donnés par le brief : "Responsable" (admin=true), "Coach"/"Intervenant"
-- (non-admin). 'coach' choisi comme rôle par défaut (is_default=true) : le
-- cas d'usage le plus courant pour ce type de structure.

insert into organization_role_catalog (organization_type, role_key, label, is_admin, is_default) values
  ('structure_coaching', 'responsable', 'Responsable', true, false),
  ('structure_coaching', 'coach', 'Coach', false, true),
  ('structure_coaching', 'intervenant', 'Intervenant', false, false)
on conflict (organization_type, role_key) do nothing;


-- ═══════════════════════════════════════════════════════════════
-- 7. connect_org_activation_tokens.organization_type — extension
-- ═══════════════════════════════════════════════════════════════
-- Ce mécanisme (migration-connect-v20 : lien d'activation privé généré par
-- le staff, consommé par connect-org-activate qui crée réellement
-- organizations+memberships à ce moment-là) servait jusqu'ici uniquement à
-- 'tournoi'/'stage'/'cm_agency' (rattachement staff, jamais self-service).
-- Il devient le mécanisme d'activation pour les 6 types non-club de la
-- demande Club+ unifiée (academie/coach/structure_coaching/tournoi/stage/
-- projet) — voir connect-club-signup-review, qui route désormais dessus au
-- lieu du pipeline clients/clubplus_activation_tokens (réservé au club).

alter table connect_org_activation_tokens drop constraint if exists connect_org_activation_tokens_organization_type_check;
alter table connect_org_activation_tokens add constraint connect_org_activation_tokens_organization_type_check
  check (organization_type in ('academie', 'coach', 'structure_coaching', 'tournoi', 'stage', 'projet', 'cm_agency'));


-- ============================================================
-- Vérification manuelle suggérée après exécution
--
-- select count(*) from connect_clubplus_signup_requests; -- doit renvoyer 0
--
-- select column_name from information_schema.columns
--  where table_name = 'clubplus_activation_tokens'
--    and column_name in ('initial_role','source_request_id');
-- -> doit renvoyer 2 lignes.
--
-- select pg_get_constraintdef(oid) from pg_constraint
--  where conname = 'organizations_organization_type_check';
-- -> doit lister 'structure_coaching'.
--
-- select organization_type, role_key from organization_role_catalog
--  where organization_type = 'structure_coaching' order by role_key;
-- -> doit renvoyer 3 lignes (coach, intervenant, responsable).
--
-- select pg_get_constraintdef(oid) from pg_constraint
--  where conname = 'connect_org_activation_tokens_organization_type_check';
-- -> doit lister academie, cm_agency, coach, projet, stage, structure_coaching, tournoi.
--
-- select proname, pronargs from pg_proc where proname = 'notify_staff_by_role';
-- -> une seule ligne, pronargs = 7.
--
-- NOTE — ce qui reste hors périmètre de cette migration
-- Aucun dashboard/nav dédié pour structure_coaching (voir section 5) : un
-- espace réel de ce type utilise la navigation générique existante.
-- organization_entitlements n'est pas peuplée pour structure_coaching, même
-- logique que coach/academie/projet/tournoi/stage (pas de plan/quota vendu
-- au sens Club+ pour ces types).
-- ============================================================
