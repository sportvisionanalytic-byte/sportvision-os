-- ============================================================
-- SPORTVISION — Migration v40 : un collaborateur (photo/prod/cm/sec sans
-- accès staff large) ne voit AUCUN nom de client/club sur ses propres
-- missions — `clients` reste fail-closed pour lui alors que `prestations`
-- et `prestations_equipe` lui sont déjà ouvertes sur ses propres lignes.
--
-- ─── Découverte (audit bout-en-bout du scénario 2 du master prompt de
--    pré-lancement, 11/08/2026 — "un photographe voit-il correctement sa
--    propre mission ?") ────────────────────────────────────────────────
--
-- Test réel exécuté (compte jetable, JWT réel, données jetables créées
-- puis entièrement supprimées après coup) :
--   1. Création d'un compte auth avec role='photo' (comportement par
--      défaut de handle_new_user() hors invitation admin — migration-
--      connect-v31), d'un client OS, d'une prestation confirmée, et d'une
--      ligne prestations_equipe assignant ce compte à la prestation.
--   2. Connexion avec le JWT réel du compte photo, acceptation de
--      l'invitation via UPDATE prestations_equipe (flux self-service réel
--      protégé par protect_sensitive_affectation_fields, migration-
--      connect-v1) — fonctionne comme attendu.
--   3. Reproduction EXACTE de la requête de loadPhotoDash()
--      (SportVision-OS-Full.html:7156) avec ce JWT :
--        prestations_equipe?select=...,prestations(...,clients(nom))
--        &collaborateur_id=eq.<uid>
--      → la ligne prestations_equipe et la ligne prestations imbriquée
--        sont bien renvoyées (référence, date, heures, lieu, adresse
--        complète — tout visible), MAIS `clients` est systématiquement
--        `null` dans la réponse.
--   4. Confirmation directe : `select id, nom from clients where
--      id = eq.<clientId>` avec ce même JWT renvoie 0 ligne (pas une
--      erreur 403 — un SELECT silencieusement vide, signature typique
--      d'un blocage RLS sur une relation imbriquée PostgREST).
--
-- ─── Cause ───────────────────────────────────────────────────────────
-- `clients_write_acces` (migration-cm-tiers.sql, qui a remplacé l'ancienne
-- `clients_acces` de supabase-schema-v2.sql) n'autorise que
-- role in ('admin','sec','com','compta','prod'). `clients_cm_select_acces`
-- couvre le cas CM (portefeuille/paliers), mais AUCUNE policy ne couvre le
-- cas photo/vidéaste — pourtant `prestations_acces` (supabase-schema-v2.sql)
-- et `equipe_acces` autorisent déjà explicitement un collaborateur à voir
-- SES PROPRES prestations/affectations via
-- `collaborateur_id = auth.uid()`. Le trou n'est donc pas dans
-- prestations/prestations_equipe (déjà correctement scopés), seulement
-- dans `clients`, la dernière étape de la chaîne d'embed PostgREST.
--
-- ─── Portée réelle du bug (grep exhaustif de `clients(nom)` combiné à un
--    `collaborateur_id=eq.'+uid` dans SportVision-OS-Full.html) ─────────
-- Tous les écrans du rôle photo qui affichent le nom du client sur une
-- mission assignée sont concernés, silencieusement (pas d'erreur, juste
-- un blanc) : loadPhotoDash (hero card, invitations, kits), loadPhotoMes
-- Prestations, loadPhotoRevenus, loadPhotoPlan, loadJourJ (mode Jour J),
-- loadPhotoMedias, loadMobilePhotoDash, et le sélecteur de mission de
-- modalSignalerIncident. Un photographe voit sa date/heure/lieu/adresse
-- mais jamais pour QUEL club — seul un fallback sur `reference` (ex.
-- "SV-2026-0055") existe par endroits, jamais le vrai nom.
--
-- ─── Correctif ──────────────────────────────────────────────────────────
-- Nouvelle policy SELECT sur `clients`, scoping identique au patron déjà
-- établi ailleurs (club_member_has_client_access, contenus_visible_par_cm,
-- clients_cm_select_acces) : accès à la ligne `clients` UNIQUEMENT si le
-- demandeur a une affectation `prestations_equipe` sur une `prestations`
-- de ce client — même condition que celle qui lui ouvre déjà `prestations`
-- elle-même (`prestations_acces`), donc pas d'élargissement au-delà de ce
-- qu'il peut déjà déduire indirectement (référence, date, lieu, adresse
-- déjà visibles). Ligne complète exposée (pas de vue dédiée) : la relation
-- imbriquée PostgREST `prestations(clients(nom))` utilisée partout dans
-- l'OS repose sur la FK prestations.client_id -> clients.id et ne peut pas
-- pointer vers une vue séparée sans réécrire chacun des ~15 appels
-- listés ci-dessus (hors mandat de cette migration — SportVision-OS-
-- Full.html n'est pas modifié ici, voir note de bas de fichier). Même
-- compromis déjà accepté pour clients_cm_select_acces (ligne complète,
-- pas de vue) : cohérent avec l'existant, pas une nouvelle exception.
--
-- Idempotente (DROP POLICY IF EXISTS avant CREATE). PRÉPARÉE, PAS EXÉCUTÉE
-- ni testée en conditions réelles (règle absolue du projet : jamais de SQL
-- exécuté contre la production par un agent) — à exécuter manuellement par
-- Fouka dans Supabase → SQL Editor, PUIS à revérifier avec le même
-- protocole que ci-dessus (compte jetable + JWT réel) avant de considérer
-- le scénario 2 clos.
-- ============================================================

drop policy if exists "clients_collaborateur_missions_select" on clients;
create policy "clients_collaborateur_missions_select" on clients for select using (
  exists (
    select 1
    from prestations p
    join prestations_equipe pe on pe.prestation_id = p.id
    where p.client_id = clients.id
      and pe.collaborateur_id = auth.uid()
  )
);

-- ─── Vérification recommandée après exécution ─────────────────────────
-- Rejouer exactement le protocole de découverte ci-dessus (compte photo
-- jetable, prestation + affectation jetables, JWT réel) et confirmer que
-- `clients(nom)` n'est plus `null` dans la réponse de la requête
-- loadPhotoDash(). Vérifier aussi le côté qu'on NE VEUT PAS ouvrir : un
-- second compte photo jetable, SANS affectation sur ce client, doit
-- toujours obtenir 0 ligne sur `select nom from clients where
-- id=eq.<clientId>` avec son propre JWT.
--
-- Note : cette migration ne touche ni ne requiert aucune modification de
-- SportVision-OS-Full.html — les ~15 requêtes listées ci-dessus
-- fonctionnent déjà avec la syntaxe d'embed existante, seul le blocage
-- RLS sur `clients` disparaît. Un autre agent travaillant en parallèle ce
-- soir sur SportVision-OS-Full.html (texte marketing + sweep TODO) n'est
-- donc pas impacté par ce fichier.
-- ============================================================
