-- Multi-club joueur (04/09/2026, décision produit Fouka — audit transversal) : "un joueur doit
-- pouvoir être affilié simultanément à plusieurs structures (club principal + académie +
-- sélection...). La personne et son compte doivent rester uniques, alors que les affiliations/
-- memberships sont multiples par club, équipe et saison."
--
-- player_profiles reste la personne canonique (déjà acté, migration-clubplus-v56-import-effectif-
-- anti-doublon.sql:8-10 — pas de nouvelle table `persons`). Le vrai blocage n'était pas
-- structurel mais UNE contrainte : player_user_unique unique(user_id) empêchait un même compte
-- d'avoir 2 lignes player_profiles (une par club). Cartographie complète faite avant cette
-- migration (0 ligne player_profiles en prod, vérifié en direct — migration sans risque de
-- backfill) : team_memberships.club_id est déjà prêt pour le multi-club (validé contre club_teams,
-- pas contre player_profiles.club_id) ; toutes les policies RLS résolvent par player_id (un seul
-- id), donc déjà compatibles ; le vrai risque identifié est le CODE APPLICATIF qui résolvait par
-- user_id seul (voir connect-player-onboarding, corrigé dans ce même lot).

alter table player_profiles drop constraint if exists player_user_unique;
alter table player_profiles add constraint player_user_club_unique unique (user_id, club_id);

comment on constraint player_user_club_unique on player_profiles is 'Multi-club (04/09/2026) : un compte peut avoir plusieurs fiches player_profiles (une par club), jamais deux pour LE MÊME club. Remplace player_user_unique (une seule fiche, une seule affiliation possible).';
