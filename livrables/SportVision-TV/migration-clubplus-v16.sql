-- ============================================================
-- SPORTVISION CLUB+ — Migration v16
-- Suite de migration-clubplus-v1 à v15.sql. Idempotente.
--
-- Portée : Phase 6 du module « Espace Joueur & Famille »
-- (cf. CLUBPLUS_PLAYER_FAMILY_ARCHITECTURE.md) — lecture seule pour un
-- joueur/parent sur trois tables déjà existantes (club_teams,
-- club_calendar_events, club_matches), nécessaires pour que l'Espace
-- Joueur affiche son équipe et son calendrier. Ces trois tables
-- n'avaient jusqu'ici que des policies is_club_member(...), qui
-- excluent délibérément les joueurs/parents (cf. l'en-tête de
-- migration-clubplus-v13.sql) — sans cette migration, l'Espace Joueur
-- ne peut littéralement rien lire.
--
-- Toutes les policies ajoutées ici sont ADDITIVES (Postgres évalue les
-- policies SELECT d'une même table en OR) : elles ne remplacent ni
-- n'affaiblissent aucune policy existante, elles ajoutent seulement un
-- second chemin de lecture, plus restreint (scopé à l'équipe via
-- is_family_of_team, pas au club entier via is_club_member).
--
-- club_calendar_events.team et club_matches.team restent des colonnes
-- text (convention historique de l'app, cf. architecture §0 — pas de FK
-- vers club_teams), donc la policy doit faire une jointure par nom
-- d'équipe pour retrouver le club_teams.id attendu par
-- is_family_of_team(). Un événement/match dont le champ team est vide
-- ou ne correspond à aucune équipe du joueur (ex. échéance sponsor,
-- réunion interne) reste invisible, ce qui est le comportement voulu.
--
-- Ce qui n'est PAS ajouté ici, volontairement : club_media et
-- club_creations. Leur visibilité famille dépend de media_access_rules
-- (phase 8, pas encore créée) — y donner un accès large maintenant
-- casserait le principe « ne jamais donner accès automatiquement à
-- toutes les galeries du club » déjà posé dans l'architecture (§15).
-- ============================================================

drop policy if exists "ctm_family_select" on club_teams;
create policy "ctm_family_select" on club_teams for select using (is_family_of_team(id));

drop policy if exists "ccal_family_select" on club_calendar_events;
create policy "ccal_family_select" on club_calendar_events for select using (
  exists (
    select 1 from club_teams ct
    where ct.club_id = club_calendar_events.club_id
      and ct.name = club_calendar_events.team
      and is_family_of_team(ct.id)
  )
);

drop policy if exists "cma_family_select" on club_matches;
create policy "cma_family_select" on club_matches for select using (
  exists (
    select 1 from club_teams ct
    where ct.club_id = club_matches.club_id
      and ct.name = club_matches.team
      and is_family_of_team(ct.id)
  )
);
