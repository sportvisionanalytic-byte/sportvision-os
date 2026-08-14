-- ============================================================
-- Migration v52 — Accès staff en lecture sur les cotisations Connect
--
-- Contexte : la vue "Cotisations" ajoutée le 14/08 à SportVision-OS-Full.html
-- interroge group_fundings/funding_contributions/user_groups avec le jeton
-- staff (pas de clé service_role dans ce fichier, par choix de sécurité
-- déjà en place). Or aucune des deux migrations qui ont créé ces tables
-- (migration-connect-v50-groupes-cotisations-personnelles.sql,
-- migration-connect-v51-espace-particulier.sql) n'accorde de policy SELECT
-- au staff — seuls créateur/membre du groupe/contributeur y ont accès. Sous
-- RLS, PostgREST ne renvoie pas d'erreur dans ce cas, juste un tableau vide :
-- la vue OS afficherait "Aucune cotisation" même si des lignes existent.
--
-- Additive et strictement en lecture (le staff ne crée/modifie rien depuis
-- l'OS en V1, cohérent avec la vue déjà livrée) — n'entre en conflit avec
-- aucune policy existante. Même fonction is_staff() déjà utilisée sur
-- prestations/clients/factures.
--
-- NON EXÉCUTÉE — à relire puis exécuter par Fouka dans Supabase → SQL Editor.
-- Idempotente (drop policy if exists avant chaque create policy).
-- ============================================================

drop policy if exists "gf_staff_select" on group_fundings;
create policy "gf_staff_select" on group_fundings for select using (is_staff());

drop policy if exists "fc_staff_select" on funding_contributions;
create policy "fc_staff_select" on funding_contributions for select using (is_staff());

drop policy if exists "ug_staff_select" on user_groups;
create policy "ug_staff_select" on user_groups for select using (is_staff());
