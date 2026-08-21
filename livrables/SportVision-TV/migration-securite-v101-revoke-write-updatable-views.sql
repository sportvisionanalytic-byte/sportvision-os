-- ============================================================================
-- migration-securite-v101-revoke-write-updatable-views.sql
-- ============================================================================
-- CRITIQUE — trouvé par l'audit pré-lancement du 21/08 (agent Club+), reproduit
-- en direct avec un compte jetable réel : `client_factures`, `client_contrats`,
-- `client_organisation`, `client_organisation_members`, `client_prestations`,
-- `prestations_equipe_display` sont des vues à TABLE UNIQUE, donc
-- automatiquement "updatable" par PostgreSQL (information_schema.views.
-- is_updatable = 'YES'). Elles sont possédées par `postgres`, qui bypass RLS
-- (rolbypassrls = true). Résultat : un PATCH REST sur une de ces vues écrit
-- directement dans la table de base avec les droits du PROPRIÉTAIRE de la vue
-- (qui ignore RLS), pas ceux de l'appelant — les policies RLS d'écriture des
-- tables de base (`factures_staff`, `contrats_write_acces`, etc.) ne sont
-- JAMAIS évaluées sur ce chemin. Seule la clause WHERE de la vue (écrite pour
-- filtrer la LECTURE, ex. club_member_has_financial_view_access) finit par
-- jouer le rôle de SEUL filtre d'écriture — jamais l'intention de qui l'a
-- écrite (migration-clubplus-v41, qui affirme à tort en commentaire "ne change
-- rien à l'écriture").
--
-- REPRODUIT EN LIVE avant ce correctif (compte jetable, club/facture/contrat
-- jetables, nettoyés après) : un membre de club avec le rôle `tresorier`
-- (lecture seule prévue) a pu, via un simple `PATCH /rest/v1/client_factures`,
-- faire passer une vraie facture à statut='payee' sans jamais payer — et via
-- `PATCH /rest/v1/client_contrats`, suspendre unilatéralement son propre
-- contrat. Confirmé aussi que `anon` (pas seulement `authenticated`) a les
-- mêmes GRANT INSERT/UPDATE/DELETE/TRUNCATE sur les 6 vues — artefact d'un
-- `GRANT ALL ON ALL TABLES IN SCHEMA public` générique jamais restreint pour
-- des vues aussi sensibles.
--
-- CORRECTIF : aucune de ces vues n'a de raison légitime d'être écrite côté
-- client — toute mutation métier passe déjà par des RPC SECURITY DEFINER
-- dédiées (client_valider_contenu, staff_update_club_request_status, etc.) ou
-- par le staff via l'OS (service_role, qui n'a jamais eu besoin de ces vues
-- pour écrire). Simple REVOKE, aucun effet de bord — la lecture (SELECT)
-- n'est pas touchée. `client_devis` n'a pas ce risque nativement (vue à JOIN,
-- PostgreSQL refuse déjà toute écriture dessus : "Views that do not select
-- from a single table or view are not automatically updatable").
--
-- Idempotente (REVOKE sans erreur si déjà absent). Aucune autre logique
-- modifiée. À exécuter avant tout onboarding de club payant réel.
-- ============================================================================

revoke insert, update, delete, truncate on client_factures from authenticated, anon;
revoke insert, update, delete, truncate on client_contrats from authenticated, anon;
revoke insert, update, delete, truncate on client_organisation from authenticated, anon;
revoke insert, update, delete, truncate on client_organisation_members from authenticated, anon;
revoke insert, update, delete, truncate on client_prestations from authenticated, anon;
revoke insert, update, delete, truncate on prestations_equipe_display from authenticated, anon;

-- ============================================================================
-- Vérifié après exécution (E2E réel, mêmes comptes/club/facture/contrat de
-- test que la reproduction initiale, nettoyés après) :
-- 1) PATCH /rest/v1/client_factures (JWT tresorier) → refusé (permission
--    denied for view client_factures), la ligne `factures` réelle inchangée.
-- 2) PATCH /rest/v1/client_contrats (JWT tresorier) → refusé, ligne `contrats`
--    inchangée.
-- 3) SELECT (lecture) sur les 6 vues toujours fonctionnel pour tous les rôles
--    déjà testés sains (admin/secretaire/tresorier/administratif) — aucune
--    régression de lecture.
-- 4) Les RPC/écritures staff légitimes (service_role, écritures OS directes
--    sur les tables de base factures/contrats) restent inchangées — cette
--    migration ne touche qu'aux VUES, jamais aux tables de base.
-- ============================================================================
