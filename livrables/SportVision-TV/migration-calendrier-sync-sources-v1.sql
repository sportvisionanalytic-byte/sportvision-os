-- Migration : Calendrier — sources externes et synchronisation (Lot 0)
-- À exécuter dans Supabase → SQL Editor.
-- NON ENCORE EXÉCUTÉE.
--
-- Spec : master prompt "SportVision — Synchronisation automatique des calendriers FFF"
-- (Fouka, 04/09/2026). Objectif : qu'un club de 40 équipes n'ait jamais à saisir
-- 500 matchs à la main.
--
-- ── CE QUE CETTE MIGRATION NE FAIT PAS (cadre explicite de Fouka) ──
--   * Aucune table `events` / `events_v2`. `club_matches` RESTE la table canonique
--     des matchs, décision produit déjà prise et vérifiée en réel le 04/09
--     (commit 2a86933 "événement canonique — un match n'existe plus qu'à un seul
--     endroit"). `club_calendar_events` garde ses 5 autres types (entraînement,
--     tournoi, tournage, sponsor, prestation), qui n'ont pas de cycle de vie match.
--   * Aucune nouvelle table saison. `saisons` existe déjà (2 lignes) et est
--     référencée par clubs, team_memberships et les 5 tables media_*. On la réutilise.
--   * Aucune logique FFF ni Footclubs en dur. L'audit des sources (04/09) a conclu
--     qu'il n'existe aucune API FFF ouverte aux tiers : api-dofa est non documentée,
--     sa doc a été retirée, et l'accès a été durci après la cyberattaque de mars 2024.
--     Le format exact des colonnes de l'export Footclubs Excel n'est pas connu tant
--     que Fouka n'a pas fourni un fichier réel. Cette migration pose donc uniquement
--     le socle générique ; le provider est une simple valeur de colonne.
--   * Aucune suppression. `club_matches.status` et l'index historique
--     `club_matches_no_reimport_dup` sont conservés tels quels : le code TypeScript
--     actuel (importClubMatches, onConflict "club_id,team,opponent,match_date") en
--     dépend et doit continuer de fonctionner sans modification.
--
-- ── Contexte vérifié en base réelle AVANT écriture (04/09/2026) ──
--   club_matches           0 ligne     club_teams   2 lignes (1 club)
--   club_calendar_events   0 ligne     saisons      2 lignes
--   → Les deux tables d'événements sont vides : aucune donnée à migrer, aucun
--     risque de perte. C'est la raison pour laquelle on pose le socle maintenant
--     plutôt qu'après l'onboarding des premiers clubs.
--   PostgreSQL 17.6 → `NULLS NOT DISTINCT` disponible (PG 15+), utilisé plus bas.

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. EXTENSION DE club_matches : provenance, identité stable, statut sportif
-- ═══════════════════════════════════════════════════════════════════════════

-- Provenance de la ligne (§38 "ne pas tout mélanger"). Volontairement une colonne
-- texte contrainte et non un enum : tout le reste du schéma Club+ utilise
-- text + check (cf. club_calendar_events.type), et ajouter une valeur de provider
-- ne doit pas exiger un ALTER TYPE bloquant.
alter table club_matches add column if not exists provider text not null default 'MANUAL';

-- Identité stable côté source (§16, §18, §19, §20). C'EST LA COLONNE CENTRALE de
-- cette migration : sans elle, un match dont l'horaire ou la date change ne peut pas
-- être reconnu comme le même match, et un report crée un doublon au lieu d'une
-- mise à jour. Nullable : les imports CSV/ICS et la saisie manuelle n'ont pas d'ID
-- externe, ils retombent sur la clé de repli définie en section 2.
alter table club_matches add column if not exists external_event_id text;

-- §13 : une équipe joue championnat + coupes. La compétition est portée par le match,
-- pas par l'équipe, sinon on ne peut pas représenter une équipe multi-compétitions.
-- `competition` (libellé lisible) existe déjà depuis la v34 ; on ajoute seulement
-- l'identifiant côté source, qui sert au rattachement automatique (§42).
alter table club_matches add column if not exists external_competition_id text;

-- §19 : sans heure, un changement d'horaire est invisible. Le code TS notait
-- explicitement "club_matches n'a pas de colonne heure", ce qui rendait le §19
-- inapplicable. Choix `time` et non `timestamptz` : cohérent avec
-- club_calendar_events.event_time et avec la note du parseur ICS ("les clubs
-- amateurs sont mono-fuseau France"). Ajouter un timestamptz aurait dupliqué
-- match_date, déjà utilisé par tout le code existant.
alter table club_matches add column if not exists kickoff_time time;

-- §20, §21 : statut SPORTIF, distinct du statut de PRODUCTION.
-- `club_matches.status` mélange aujourd'hui les deux concepts : a_venir /
-- a_transmettre / recu décrivent l'avancement du contenu, tandis que reportee /
-- annulee décrivent le match lui-même. Un match reporté dont le contenu reste à
-- transmettre ne peut pas exprimer les deux états dans une seule colonne.
-- On sépare donc, sans toucher à `status` ni à son check (le code TS existant
-- continue de fonctionner) ; le trigger de la section 3 les garde cohérents.
-- 5 valeurs, pas plus (cadre explicite : "n'invente pas 15 statuts").
alter table club_matches add column if not exists sport_status text not null default 'scheduled';

-- §43, §44 : le mapping et les calendriers sont season-aware. `saisons` existait,
-- mais aucun match n'y était rattaché.
alter table club_matches add column if not exists saison_id uuid references saisons(id) on delete set null;

-- §15, §31 : dater la donnée source permet de ne pas écraser une information plus
-- récente par une réponse de sync plus ancienne, et d'afficher "dernière
-- synchronisation" (§29).
alter table club_matches add column if not exists source_updated_at timestamptz;
alter table club_matches add column if not exists last_synced_at timestamptz;

-- Contraintes de valeurs. `not valid` inutile ici : les tables sont vides.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'club_matches_provider_check') then
    alter table club_matches add constraint club_matches_provider_check
      check (provider in ('MANUAL','CSV','ICS','FOOTCLUBS_XLSX','FFF','OTHER'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'club_matches_sport_status_check') then
    alter table club_matches add constraint club_matches_sport_status_check
      check (sport_status in ('scheduled','postponed','cancelled','completed','unknown'));
  end if;
end $$;

comment on column club_matches.external_event_id is
  'Identifiant du match chez la source (FFF, Footclubs...). Permet de reconnaître le même match après un changement de date ou d''horaire. NULL pour les saisies manuelles et les imports CSV/ICS sans ID.';
comment on column club_matches.sport_status is
  'Statut du match lui-même (scheduled/postponed/cancelled/completed/unknown). Distinct de `status`, qui décrit l''avancement de la production de contenu.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. IDENTITÉ ET ANTI-DOUBLON (§16, §17, §35)
-- ═══════════════════════════════════════════════════════════════════════════

-- Clé principale : (club_id, provider, external_event_id).
--
-- club_id EST INDISPENSABLE dans cette clé, ce n'est pas de la prudence excessive :
-- quand deux clubs clients de SportVision se rencontrent, la FFF leur attribue le
-- MÊME external_event_id pour ce match. Une clé (provider, external_event_id) seule
-- ferait collisionner les deux lignes et un club écraserait le match de l'autre.
-- Chaque club possède sa propre vision du même match réel (domicile/extérieur,
-- ses propres contenus, sa propre mission de production).
create unique index if not exists club_matches_provider_external_uniq
  on club_matches (club_id, provider, external_event_id)
  where external_event_id is not null;

-- Clé de repli, pour les sources sans identifiant (CSV, ICS, saisie manuelle).
-- NULLS NOT DISTINCT (PG 15+) est nécessaire : sans lui, deux lignes avec
-- team_id NULL ou kickoff_time NULL seraient considérées comme distinctes par
-- l'index et le dédoublonnage ne s'appliquerait pas du tout sur ces cas, qui sont
-- justement les plus fréquents dans un import CSV incomplet.
-- lower(opponent) : "FC Melun" et "fc melun" sont le même adversaire.
-- team_id et non team : le cadre impose que la logique d'unicité repose sur la
-- référence, pas sur le texte libre (le trigger resolve_team_id_from_name le
-- renseigne automatiquement depuis `team`).
create unique index if not exists club_matches_fallback_uniq
  on club_matches (club_id, team_id, lower(opponent), match_date, kickoff_time)
  nulls not distinct
  where external_event_id is null;

-- Index de lecture.
create index if not exists idx_cma_saison on club_matches (saison_id);
create index if not exists idx_cma_sport_status on club_matches (club_id, sport_status, match_date);

-- NOTE de compatibilité, à traiter dans la phase TypeScript et pas ici :
-- l'index historique `club_matches_no_reimport_dup (club_id, team, opponent,
-- match_date)` est conservé car importClubMatches() fait un upsert dessus
-- (onConflict "club_id,team,opponent,match_date"). Le supprimer maintenant
-- casserait l'import existant. Conséquence connue et acceptée : il empêche deux
-- matchs de la même équipe contre le même adversaire le même jour à des heures
-- différentes (cas de tournoi). À retirer quand l'import basculera sur les deux
-- index ci-dessus, jamais avant.

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. COHÉRENCE sport_status → status, ET SAISON PAR DÉFAUT
-- ═══════════════════════════════════════════════════════════════════════════

-- Pourquoi ce trigger : `status` porte encore les valeurs 'reportee' et 'annulee'
-- et l'UI les affiche (MatchResultModal, badges Match Center). Tant que le
-- TypeScript n'a pas basculé sur sport_status, une sync qui écrirait uniquement
-- sport_status='postponed' laisserait l'interface afficher "à venir" pour un match
-- reporté. La propagation est volontairement unidirectionnelle et limitée à ces
-- deux valeurs : sport_status est la vérité, `status` en reçoit le reflet.
create or replace function sync_match_sport_status_to_status()
returns trigger
language plpgsql
as $$
begin
  -- Saison par défaut : la saison active, si l'appelant ne l'a pas précisée.
  if new.saison_id is null then
    select id into new.saison_id
    from saisons where active order by date_debut desc nulls last limit 1;
  end if;

  if tg_op = 'INSERT' or new.sport_status is distinct from old.sport_status then
    if new.sport_status = 'postponed' then
      new.status := 'reportee';
    elsif new.sport_status = 'cancelled' then
      new.status := 'annulee';
    elsif new.sport_status in ('scheduled','completed')
          and new.status in ('reportee','annulee') then
      -- Un match re-planifié après un report redevient un match à couvrir.
      new.status := 'a_venir';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_club_matches_sport_status on club_matches;
create trigger trg_club_matches_sport_status
  before insert or update of sport_status, saison_id on club_matches
  for each row execute function sync_match_sport_status_to_status();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. SOURCE DE CALENDRIER PAR CLUB ET PAR SAISON (§8, §43, §44)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists club_calendar_sources (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  -- §43 : le mapping est saisonnier. Les identifiants externes d'une équipe
  -- peuvent changer d'une saison à l'autre et ne doivent jamais être réutilisés
  -- à l'aveugle (§44).
  saison_id uuid references saisons(id) on delete cascade not null,
  provider text not null,
  external_club_id text,
  external_club_name text,
  source_url text,
  -- §28, §29 : synchronisation périodique et manuelle.
  last_sync_at timestamptz,
  sync_status text not null default 'never',
  last_error text,
  -- Permet de couper une source sans la supprimer (§32 : si la source tombe, on
  -- ne supprime rien et le calendrier existant reste accessible).
  is_enabled boolean not null default true,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint club_calendar_sources_provider_check
    check (provider in ('MANUAL','CSV','ICS','FOOTCLUBS_XLSX','FFF','OTHER')),
  constraint club_calendar_sources_sync_status_check
    check (sync_status in ('never','ok','partial','error','disabled')),
  constraint club_calendar_sources_uniq unique (club_id, saison_id, provider)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. MAPPING ÉQUIPE SOURCE → ÉQUIPE SPORTVISION (§10, §11, §12, §40)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists club_team_source_mappings (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  -- Nullable : une équipe détectée chez la source peut ne pas encore exister côté
  -- SportVision (§40). On enregistre la découverte sans créer l'équipe en
  -- silence — la création reste une action humaine confirmée.
  team_id uuid references club_teams(id) on delete cascade,
  saison_id uuid references saisons(id) on delete cascade not null,
  provider text not null,
  external_team_id text not null,
  external_team_name text,
  -- §13 : une même équipe source joue plusieurs compétitions. La compétition fait
  -- donc partie de la clé, sinon l'import du calendrier de coupe écraserait celui
  -- du championnat.
  external_competition_id text,
  external_competition_name text,
  -- §11 : l'auto-suggestion propose, l'humain confirme si c'est ambigu.
  confidence numeric(3,2),
  status text not null default 'suggested',
  confirmed_by uuid references auth.users on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint club_team_source_mappings_provider_check
    check (provider in ('MANUAL','CSV','ICS','FOOTCLUBS_XLSX','FFF','OTHER')),
  constraint club_team_source_mappings_status_check
    check (status in ('suggested','confirmed','ignored')),
  constraint club_team_source_mappings_confidence_check
    check (confidence is null or (confidence >= 0 and confidence <= 1))
);

-- NULLS NOT DISTINCT : une équipe sans compétition précisée ne doit pas pouvoir
-- être enregistrée deux fois.
create unique index if not exists club_team_source_mappings_uniq
  on club_team_source_mappings (club_id, saison_id, provider, external_team_id, external_competition_id)
  nulls not distinct;

create index if not exists idx_ctsm_team on club_team_source_mappings (team_id);
create index if not exists idx_ctsm_pending on club_team_source_mappings (club_id, status)
  where status = 'suggested';

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. JOURNAL ET DIFF DE SYNCHRONISATION (§30, §31)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists calendar_sync_runs (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  saison_id uuid references saisons(id) on delete set null,
  source_id uuid references club_calendar_sources(id) on delete set null,
  provider text not null,
  trigger_kind text not null default 'manual',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  -- §30 : le diff que l'utilisateur voit après une sync.
  events_created integer not null default 0,
  events_updated integer not null default 0,
  events_cancelled integer not null default 0,
  events_unchanged integer not null default 0,
  -- Détail ligne par ligne, pour l'Action Center (§49) et pour prévenir le CM
  -- quand un horaire change alors qu'un contenu ou une mission existe déjà
  -- (§19, §54, §55). Volontairement du jsonb et pas une table dédiée : un diff
  -- ne contient que les lignes qui ont changé, pas les 500 matchs.
  changes jsonb not null default '[]',
  errors jsonb not null default '[]',
  created_by uuid references auth.users on delete set null,
  constraint calendar_sync_runs_status_check
    check (status in ('running','success','partial','error')),
  constraint calendar_sync_runs_trigger_check
    check (trigger_kind in ('manual','scheduled','import'))
);

create index if not exists idx_csr_club on calendar_sync_runs (club_id, started_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. RLS (§46, §47)
-- ═══════════════════════════════════════════════════════════════════════════
-- Règle : la configuration d'une source et les mappings sont des réglages
-- structurants du club. Ils sont réservés à l'administrateur du club et au staff
-- SportVision. Un CM ou un coach voit le calendrier (via club_matches, dont les
-- policies existantes sont inchangées) mais ne touche pas à la plomberie source.
-- §47 : aucune credential n'est stockée dans ces tables, par construction — le
-- modèle retenu est l'export de fichier par le club, jamais son mot de passe.

alter table club_calendar_sources enable row level security;
alter table club_team_source_mappings enable row level security;
alter table calendar_sync_runs enable row level security;

drop policy if exists ccs_admin_all on club_calendar_sources;
create policy ccs_admin_all on club_calendar_sources
  for all using (is_club_admin(club_id) or is_staff())
  with check (is_club_admin(club_id) or is_staff());

drop policy if exists ctsm_admin_all on club_team_source_mappings;
create policy ctsm_admin_all on club_team_source_mappings
  for all using (is_club_admin(club_id) or is_staff())
  with check (is_club_admin(club_id) or is_staff());

-- Le journal est en lecture seule pour les humains : il est écrit par le moteur
-- de synchronisation (service_role), qui n'est pas soumis à la RLS. Personne ne
-- doit pouvoir maquiller l'historique d'une synchronisation.
drop policy if exists csr_admin_select on calendar_sync_runs;
create policy csr_admin_select on calendar_sync_runs
  for select using (is_club_admin(club_id) or is_staff());

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. updated_at
-- ═══════════════════════════════════════════════════════════════════════════

drop trigger if exists trg_ccs_upd on club_calendar_sources;
create trigger trg_ccs_upd before update on club_calendar_sources
  for each row execute function update_updated_at_generic();

drop trigger if exists trg_ctsm_upd on club_team_source_mappings;
create trigger trg_ctsm_upd before update on club_team_source_mappings
  for each row execute function update_updated_at_generic();

commit;
