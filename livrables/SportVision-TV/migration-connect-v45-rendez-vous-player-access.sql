-- ============================================================
-- Migration v45 — Étend rendez_vous au compte Joueur (Connect personnel)
--
-- Contexte : chantier "Calendrier" de l'Espace Joueur (agent app-connect, 14/08). Le Calendrier
-- doit pouvoir afficher les rendez-vous SportVision liés au joueur (MASTER-CONNECT-V1 §22 : la
-- liste des événements inclut explicitement "rendez-vous"). Mais la policy actuelle sur
-- `rendez_vous` (migration-portail-v1.sql, "rdv_client_own"/"rdv_client_insert") ne reconnaît que
-- `client_users`, jamais un joueur — exactement le même trou que celui déjà corrigé pour
-- `messages_client` par migration-connect-v43-espace-joueur.sql (qui a ajouté
-- `player_has_client_access()`). Cette migration applique le même correctif à rendez_vous, sans
-- rien retirer aux policies existantes (additive, "or player_has_client_access(...)").
--
-- Pré-requis : migration-connect-v43-espace-joueur.sql (définit player_has_client_access) doit
-- déjà être exécutée — c'est le cas, confirmée en base le 14/08 (RPC /rpc/player_has_client_access
-- déjà exposée).
--
-- Idempotente (drop policy if exists avant chaque create policy).
--
-- EXÉCUTÉE — vérifié en base réelle le 19/08/2026 (audit pré-lancement) :
-- policies rdv_client_own et rdv_client_insert existent déjà sur
-- rendez_vous. Cet en-tête disait à tort "NON EXÉCUTÉE".
-- ============================================================

drop policy if exists "rdv_client_own" on rendez_vous;
create policy "rdv_client_own" on rendez_vous for select using (
  exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = rendez_vous.client_id)
  or player_has_client_access(rendez_vous.client_id)
);

drop policy if exists "rdv_client_insert" on rendez_vous;
create policy "rdv_client_insert" on rendez_vous for insert with check (
  exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = rendez_vous.client_id)
  or player_has_client_access(rendez_vous.client_id)
);

-- Remarque : "rdv_staff_all" (accès staff) n'est pas touchée, aucune régression possible pour le
-- staff. Le Calendrier de l'Espace Joueur reste néanmoins LECTURE SEULE côté joueur (aucun insert
-- déclenché par le code Connect) : la ligne insert ci-dessus est ajoutée par cohérence/complétude
-- avec le modèle "client" existant, pas parce que Connect l'utilise aujourd'hui.
