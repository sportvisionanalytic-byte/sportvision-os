-- migration-poles-v6-roadmap-basket.sql
--
-- Migration multi-pôles, Lot 8 — Roadmap de lancement pilotée par les données +
-- paliers/alertes automatiques (cahier des charges exact fourni par Fouka le
-- 31/08/2026, en parallèle du Lot 6 Finance/rémunération sur ce même projet
-- — ce lot gère uniquement l'ALERTE de franchissement de seuil, jamais le
-- calcul financier lui-même, pour ne pas dupliquer ce travail).
--
-- À exécuter APRÈS migration-poles-v1 à v5 (utilise poles, pole_affectations,
-- is_pole_responsable(), clients.pole_id).
--
-- Contenu :
--   1. Table `pole_roadmap_etapes` — les étapes des 4 phases de lancement
--      d'un pôle (Immersion / Premier contrat / Noyau équipe / 2 à 3 clubs),
--      certaines validables automatiquement depuis des données réelles
--      (contrats, pole_affectations), d'autres manuellement (qualitatif).
--   2. Table `pole_paliers_franchis` — trace idempotente du franchissement
--      des seuils d'alerte (§2 du cahier des charges), pour ne notifier
--      qu'UNE SEULE FOIS par palier/pôle (voir commentaire détaillé plus bas).
--   3. RLS sur les deux tables : visible/modifiable par l'admin et le
--      Responsable DU pôle concerné uniquement (is_pole_responsable()),
--      jamais par un simple membre — c'est la seule différence avec
--      pole_scope_ok() (qui, lui, inclut les simples membres) : la roadmap
--      et les paliers de rémunération sont un outil de pilotage, pas une
--      donnée opérationnelle à diffuser à toute l'équipe du pôle.
--   4. Fonction seed_pole_roadmap(p_pole_id) — remplit les 8 étapes standard
--      pour un pôle donné, puis appelée une fois pour Basket.
--
-- Choix d'architecture (documenté aussi dans SportVision-OS-Full.html, au
-- niveau des fonctions JS qui consomment ces tables) :
-- - Ni `creerTachesAuto`/`_TACHES_AUTO_CFG` ni `dispatchSVEvent`/
--   `SV_EVENT_WORKFLOWS` ne sont réutilisés tels quels pour l'envoi : les
--   deux systèmes existants notifient TOUS les profils d'un `role` FONCTIONNEL
--   donné (`profiles?role=eq.X`) — aucun des deux ne sait cibler "le
--   Responsable de CE pôle précis", qui vit dans pole_affectations et est
--   orthogonal au rôle fonctionnel. On réutilise en revanche leur brique de
--   base `creerNotifSiActive(destinataire_id, categorie, body)` (l'unité
--   d'envoi commune aux deux systèmes) et on suit leur convention de nommage
--   des payloads de notification.
-- - Calcul des seuils déclenché côté client à l'ouverture du dashboard Admin
--   (loadAdminDash) et de l'écran Roadmap pôle (loadPoleRoadmapData) — pas de
--   cron/edge function ce soir (plus propre mais plus lourd à mettre en place
--   dans le temps imparti). Limite assumée : si personne n'ouvre l'app, un
--   palier franchi ne déclenche pas d'alerte tant que l'app n'est pas rouverte
--   par un admin ou le Responsable du pôle.
--
-- Idempotente : create table if not exists, create policy précédée de drop if
-- exists, seed via on conflict do nothing.
--
-- ROLLBACK :
--   drop function if exists seed_pole_roadmap(uuid);
--   drop table if exists pole_paliers_franchis;
--   drop table if exists pole_roadmap_etapes;

-- ── 1. Table pole_roadmap_etapes ────────────────────────────────────────
create table if not exists pole_roadmap_etapes (
  id uuid default gen_random_uuid() primary key,
  pole_id uuid not null references poles(id) on delete cascade,
  phase text not null check (phase in ('immersion','premier_contrat','noyau_equipe','stabilisation')),
  phase_ordre smallint not null,
  ordre smallint not null default 0,
  code text not null,
  libelle text not null,
  description text,
  validation text not null default 'manuel' check (validation in ('auto','manuel')),
  -- metrique/seuil : uniquement renseignés quand validation='auto'. La métrique est calculée
  -- en direct côté client par getPoleMetriques(poleId) (SportVision-OS-Full.html) — cette
  -- colonne stocke seulement QUELLE métrique et QUEL seuil s'appliquent à cette étape, jamais
  -- la valeur elle-même (qui doit rester "pilotée par les données réelles" à chaque affichage,
  -- pas figée au moment de la création de la ligne).
  metrique text,
  seuil numeric,
  statut text not null default 'a_venir' check (statut in ('a_venir','en_cours','atteinte')),
  valide_par uuid references profiles(id),
  valide_le timestamptz,
  created_at timestamptz default now(),
  unique (pole_id, code)
);

comment on table pole_roadmap_etapes is 'Étapes de la roadmap de lancement d''un pôle sportif (4 phases : immersion/premier_contrat/noyau_equipe/stabilisation), Lot 8 migration multi-pôles (31/08/2026). Statut recalculé à chaque ouverture de l''écran Roadmap pour les étapes validation=''auto'' (voir refreshPoleRoadmapAuto() côté client) ; mis à jour par un clic Responsable/Admin pour validation=''manuel''.';
comment on column pole_roadmap_etapes.metrique is 'Clé de métrique calculée par getPoleMetriques() : contrats_recurrents_actifs | clubs_recurrents_actifs | operateurs_actifs | cm_actifs. Non utilisé si validation=''manuel''.';

create index if not exists idx_pole_roadmap_etapes_pole on pole_roadmap_etapes(pole_id);

alter table pole_roadmap_etapes enable row level security;

drop policy if exists "pole_roadmap_etapes_admin_ou_responsable" on pole_roadmap_etapes;
create policy "pole_roadmap_etapes_admin_ou_responsable" on pole_roadmap_etapes for all using (
  (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  or is_pole_responsable(pole_roadmap_etapes.pole_id)
);

-- ── 2. Table pole_paliers_franchis ──────────────────────────────────────
-- Trace idempotente : une ligne = "ce palier a déjà été franchi et notifié pour ce pôle".
-- Sans cette table, verifierPaliersPole() renotifierait l'admin/le responsable à CHAQUE
-- ouverture du dashboard tant que le seuil reste dépassé (aucun mécanisme d'edge de
-- franchissement autrement, le calcul étant relancé à chaque chargement — voir plus haut).
create table if not exists pole_paliers_franchis (
  id uuid default gen_random_uuid() primary key,
  pole_id uuid not null references poles(id) on delete cascade,
  palier_code text not null,
  franchi_le timestamptz not null default now(),
  unique (pole_id, palier_code)
);

comment on table pole_paliers_franchis is 'Franchissements de seuils déjà notifiés (Lot 8, §2 du cahier des charges) — évite de renotifier à chaque ouverture du dashboard tant que le palier reste dépassé. palier_code correspond à _PALIERS_POLE_CFG côté client (SportVision-OS-Full.html).';

alter table pole_paliers_franchis enable row level security;

drop policy if exists "pole_paliers_franchis_admin_ou_responsable" on pole_paliers_franchis;
create policy "pole_paliers_franchis_admin_ou_responsable" on pole_paliers_franchis for all using (
  (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  or is_pole_responsable(pole_paliers_franchis.pole_id)
);

-- ── 3. Seed standard (4 phases, 8 étapes) ───────────────────────────────
create or replace function seed_pole_roadmap(p_pole_id uuid)
returns void
language plpgsql
as $$
begin
  insert into pole_roadmap_etapes (pole_id, phase, phase_ordre, ordre, code, libelle, description, validation, metrique, seuil)
  values
    -- Phase 1 — Immersion (Mois 1) : qualitatif, validé manuellement par l'admin/le Responsable.
    (p_pole_id, 'immersion', 1, 1, 'immersion_prestations',
      'Réaliser des prestations sur le terrain',
      'Le Responsable comprend SportVision en réalisant lui-même des prestations photo/vidéo.',
      'manuel', null, null),
    (p_pole_id, 'immersion', 1, 2, 'immersion_admin',
      'Prendre en main l''administratif',
      'Devis, contrats, facturation — le Responsable maîtrise le fonctionnement administratif de SportVision.',
      'manuel', null, null),
    (p_pole_id, 'immersion', 1, 3, 'immersion_prospection',
      'Faire de la prospection terrain',
      'Premiers contacts avec des clubs potentiels, pour comprendre le marché du pôle.',
      'manuel', null, null),
    -- Phase 2 — Premier contrat (Mois 2) : mix qualitatif + un jalon chiffré.
    (p_pole_id, 'premier_contrat', 2, 1, 'prospection_active',
      'Prospection active',
      'La prospection s''intensifie, avec un objectif clair de signature.',
      'manuel', null, null),
    (p_pole_id, 'premier_contrat', 2, 2, 'premier_club_signe',
      'Premier club récurrent signé',
      'Un premier contrat Full Communication actif est signé sur ce pôle.',
      'auto', 'contrats_recurrents_actifs', 1),
    (p_pole_id, 'premier_contrat', 2, 3, 'communication_appuyee',
      'Communication assurée avec l''appui de l''équipe',
      'Le contenu du premier club est produit avec le soutien de l''équipe Communication existante.',
      'manuel', null, null),
    -- Phase 3 — Noyau équipe (Mois 3) : recrutement chiffré, selon le volume réel.
    (p_pole_id, 'noyau_equipe', 3, 1, 'recrutement_photo_video',
      '2 photographes/vidéastes recrutés',
      'Recrutement progressif de 2 photographes/vidéastes dédiés au pôle, selon le volume réel de missions.',
      'auto', 'operateurs_actifs', 2),
    (p_pole_id, 'noyau_equipe', 3, 2, 'recrutement_cm',
      '1 Community Manager recruté',
      'Un Community Manager dédié au pôle assure la communication des clubs signés.',
      'auto', 'cm_actifs', 1),
    -- Phase 4 — 2 à 3 clubs (Mois 4+) : stabilisation dans la durée.
    (p_pole_id, 'stabilisation', 4, 1, 'deux_trois_clubs',
      '2 à 3 clubs sous contrat récurrent',
      'Plusieurs contrats récurrents actifs simultanément sur le pôle.',
      'auto', 'contrats_recurrents_actifs', 2),
    (p_pole_id, 'stabilisation', 4, 2, 'contrats_stabilises',
      'Contrats stabilisés dans la durée',
      'Les clubs signés sont satisfaits et renouvellent — pas seulement signés, mais fidélisés.',
      'manuel', null, null)
  on conflict (pole_id, code) do nothing;
end;
$$;

comment on function seed_pole_roadmap(uuid) is 'Remplit les 8 étapes standard de la roadmap de lancement (Lot 8) pour le pôle donné. Idempotente (on conflict do nothing). À rappeler manuellement pour tout futur pôle créé après Basket — non automatisé ce soir (aucun trigger sur insert dans `poles`), limite assumée et documentée plutôt qu''un automatisme non demandé par le cahier des charges.';

select seed_pole_roadmap(id) from poles where slug = 'basket';

-- ── 4. Vérification (à exécuter manuellement après migration) ──────────
-- select phase, code, libelle, validation, statut from pole_roadmap_etapes
--   where pole_id = (select id from poles where slug = 'basket') order by phase_ordre, ordre;
