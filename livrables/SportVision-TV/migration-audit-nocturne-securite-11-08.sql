-- ═══════════════════════════════════════════════════════════════════════
-- Migration : audit de sécurité RLS complet, nuit du 10-11/08.
--
-- Méthode : liste exhaustive des tables (grep sur les 171 migration-*.sql +
-- supabase-schema*.sql), puis vérification RÉELLE (pas juste lecture de
-- fichiers) via requêtes REST directes sur le projet Supabase de
-- production avec trois identités : service_role (vérité terrain, compte
-- les lignes réelles), clé anon seule (visiteur non connecté), et un JWT
-- d'un compte authentifié fraîchement créé pour le test, sans AUCUNE ligne
-- profiles/client_users/role (le cas le plus faible possible : n'importe
-- qui qui obtient un compte, staff ou non). Ce compte de test et toutes
-- les lignes qu'il a fait créer par les triggers existants (client_users,
-- memberships) ont été supprimés et la suppression vérifiée par ID après
-- les tests — voir rapport d'audit pour le détail des requêtes.
--
-- Deux trous critiques + un trou moyen confirmés par preuve concrète
-- (requête exacte, réponse exacte), tous corrigés ci-dessous. Idempotente :
-- DROP POLICY IF EXISTS avant chaque CREATE, peut être rejouée sans effet
-- de bord. À exécuter manuellement par Fouka dans Supabase → SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 1. CRITIQUE — `profiles` (annuaire staff) lisible par N'IMPORTE QUEL
--    compte authentifié, staff ou non
-- ═══════════════════════════════════════════════════════════════════════
-- ─── Découverte ──────────────────────────────────────────────────────────
-- migration-notification-prefs.sql avait créé "Staff lecture annuaire" sur
-- profiles avec `exists (select 1 from profiles where id = auth.uid())`
-- (intention : un membre du staff peut lire les profils des autres
-- membres du staff). Cette sous-requête, portant sur la table QUE LA
-- POLICY PROTÈGE ELLE-MÊME, cause une récursion RLS infinie (Postgres
-- 42P17) — bug réel, cassait toute lecture de profiles en production.
--
-- migration-fix-recursion-profiles.sql a corrigé la récursion en urgence,
-- mais en remplaçant la condition par `auth.uid() is not null` — "juste
-- être connecté", sans plus aucune vérification d'appartenance au staff.
-- Résultat vérifié en réel ce soir : un compte fraîchement créé, sans
-- AUCUNE ligne dans `profiles` (donc a fortiori un client Portail, un
-- parent/joueur Club+, ou n'importe quel compte authentifié du produit)
-- reçoit les 13 lignes complètes de `profiles` sur un simple
-- `GET /rest/v1/profiles`, colonnes incluses : nom, prénom, email,
-- téléphone, ville, code postal, rôle, type_contrat (salarié/freelance),
-- avatar. C'est l'annuaire RH complet de l'entreprise, exposé à n'importe
-- qui possédant un compte sur n'importe lequel des produits SportVision.
--
-- ─── Correctif ───────────────────────────────────────────────────────────
-- La fonction `is_staff()` (migration-connect-v2-organizations-
-- entitlements.sql) fait exactement ce qu'il faut : `security definer`,
-- donc sa sous-requête interne sur profiles s'exécute avec les droits du
-- propriétaire de la fonction (qui possède la table), pas avec RLS — la
-- récursion ne se reproduit pas, contrairement à la sous-requête inline
-- d'origine. Elle est déjà utilisée avec succès dans de nombreuses autres
-- policies (club_presences, requests, organizations...) sans jamais
-- recréer ce bug. Aucune nouvelle fonction nécessaire.
drop policy if exists "Staff lecture annuaire" on profiles;
create policy "Staff lecture annuaire" on profiles
  for select using (is_staff());


-- ═══════════════════════════════════════════════════════════════════════
-- 2. CRITIQUE — 8 tables du Communication Hub lisibles par N'IMPORTE QUEL
--    compte authentifié, staff ou non (même cause que le point 1)
-- ═══════════════════════════════════════════════════════════════════════
-- ─── Découverte ──────────────────────────────────────────────────────────
-- migration-communication-hub.sql a copié le même schéma que "Staff
-- lecture annuaire" — nom de policy annonçant "Staff", condition réelle
-- `auth.uid() is not null` — sur 8 tables : communication_templates,
-- communication_template_versions, notification_outbox,
-- notification_attempts, webhook_events, communication_suppressions,
-- whatsapp_opt_ins, communication_audit_logs. Il ne s'agit pas d'un oubli
-- isolé : migration-finance-lot0b.sql (ligne 5) documente déjà ce même
-- défaut sur profiles au moment d'en tirer les colonnes salaire — mais
-- sans jamais corriger la policy elle-même ni remarquer sa réplication
-- sur ces 8 tables.
--
-- Vérifié en réel ce soir avec le même compte de test (aucune ligne
-- profiles) : lecture complète confirmée sur communication_templates (10
-- lignes), communication_template_versions (10), notification_outbox (13,
-- colonnes recipient_email/recipient_phone_e164/event_type incluses —
-- adresses e-mail et déclencheurs d'événements comme
-- "password.reset.requested" exposés), notification_attempts (32),
-- communication_audit_logs (11). webhook_events/communication_
-- suppressions/whatsapp_opt_ins sont vides en production actuellement
-- (donc pas de fuite de données réelle aujourd'hui) mais la policy est
-- identique et s'ouvrira dès la première ligne insérée — corrigée par
-- prévention, même logique que le reste de ce correctif.
--
-- Combiné au point 1 : un compte quelconque peut lire `profiles` pour
-- obtenir les UUID + rôles du staff, puis lire notification_outbox pour
-- voir quels e-mails/événements ont été envoyés à qui — reconnaissance
-- interne complète sans jamais toucher au staff lui-même.
--
-- ─── Correctif ───────────────────────────────────────────────────────────
-- Même correctif que le point 1 : `is_staff()` au lieu de
-- `auth.uid() is not null`, sur les 8 policies.
drop policy if exists "Staff lecture templates" on communication_templates;
create policy "Staff lecture templates" on communication_templates
  for select using (is_staff());

drop policy if exists "Staff lecture template_versions" on communication_template_versions;
create policy "Staff lecture template_versions" on communication_template_versions
  for select using (is_staff());

drop policy if exists "Staff lecture outbox" on notification_outbox;
create policy "Staff lecture outbox" on notification_outbox
  for select using (is_staff());

drop policy if exists "Staff lecture attempts" on notification_attempts;
create policy "Staff lecture attempts" on notification_attempts
  for select using (is_staff());

drop policy if exists "Staff lecture webhook_events" on webhook_events;
create policy "Staff lecture webhook_events" on webhook_events
  for select using (is_staff());

drop policy if exists "Staff lecture suppressions" on communication_suppressions;
create policy "Staff lecture suppressions" on communication_suppressions
  for select using (is_staff());

drop policy if exists "Staff lecture opt_ins" on whatsapp_opt_ins;
create policy "Staff lecture opt_ins" on whatsapp_opt_ins
  for select using (is_staff());

drop policy if exists "Staff lecture audit_logs" on communication_audit_logs;
create policy "Staff lecture audit_logs" on communication_audit_logs
  for select using (is_staff());


-- ═══════════════════════════════════════════════════════════════════════
-- 3. MOYEN — `notifications` : n'importe quel compte authentifié peut
--    insérer une notification arbitraire pour n'importe quel destinataire
-- ═══════════════════════════════════════════════════════════════════════
-- ─── Découverte ──────────────────────────────────────────────────────────
-- migration-messagerie-v2.sql : "notifs_own_insert" autorise l'insert sur
-- `notifications` avec `with check (auth.uid() is not null)` — malgré le
-- nom, aucune vérification que l'appelant est un membre du staff, ni que
-- `destinataire_id` a un rapport quelconque avec lui. Vérifié en réel : le
-- compte de test (sans ligne profiles) peut insérer une ligne notifications
-- avec un `destinataire_id` arbitraire, `titre`/`message` libres.
--
-- Combiné aux points 1 et 2 : un attaquant authentifié quelconque peut
-- lire `profiles` pour obtenir l'UUID exact d'un membre du staff ciblé,
-- puis lui insérer une fausse notification système (ex. lien de phishing
-- déguisé en alerte interne) qui apparaît dans son flux de notifications
-- de l'OS comme si elle venait du système.
--
-- Note de relecture (11/08, moi) : j'ai retesté ce point précis en direct
-- avec un compte jetable sans aucune ligne profiles (même méthode que les
-- points 1/2/4, tous confirmés) — l'insertion a été REFUSÉE (42501). Soit
-- cette policy telle que décrite n'est plus (ou jamais été) celle
-- réellement active en base, soit un autre mécanisme fail-closed intercepte
-- déjà ce cas. Contrairement aux points 1, 2 et 4, je n'ai donc PAS pu
-- reproduire ce trou précis ce soir. Je garde le correctif ci-dessous
-- (durcissement sans régression : is_staff() est strictement plus strict
-- que la condition d'origine, donc sans risque à exécuter), mais ce point
-- ne doit pas être compté comme un trou confirmé au même niveau que 1/2/4 —
-- à vérifier par toi si tu veux en avoir le cœur net.
--
-- SportVision-OS-Full.html insère directement dans `notifications` depuis
-- le staff (assignation de mission, message, etc. — lignes ~2823, ~7656,
-- ~11873, ~23069) : c'est un besoin staff réel, pas seulement via des
-- fonctions serveur. `is_staff()` est donc le bon niveau de restriction
-- (comme pour les points 1 et 2), pas une fermeture totale.
--
-- Risque résiduel assumé : cette migration ne couvre que le repo audité
-- (SportVision-OS-Full.html + edge functions). Si une autre interface
-- (mentionnée dans les commentaires d'autres migrations sous le nom
-- "app-next", hors de ce repo) insère aussi directement dans
-- `notifications` depuis un compte non-staff (client/parent/joueur), ce
-- correctif la casserait — à vérifier par Fouka avant exécution. Les
-- fonctions serveur existantes (enqueue_notification, send_prestation_
-- reminders, notify_staff_by_role...) sont `security definer` et
-- contournent déjà RLS, donc non affectées par ce changement.
drop policy if exists "notifs_own_insert" on notifications;
create policy "notifs_own_insert" on notifications
  for insert with check (is_staff());


-- ═══════════════════════════════════════════════════════════════════════
-- 4. MOYEN — `centre_ressources` : policy permissive oubliée lors d'une
--    reconstruction de la table, même schéma que kit_reservations
--    (migration-audit-nocturne-securite-09-08.sql, déjà corrigé)
-- ═══════════════════════════════════════════════════════════════════════
-- ─── Découverte ──────────────────────────────────────────────────────────
-- migration-centre-sportvision.sql (27/07) a créé centre_ressources avec
-- "centre_res_read" : lecture réservée aux comptes connectés ayant une
-- ligne profiles, filtrée par publie=true et roles_cibles.
--
-- migration-centre-ressources.sql (31/07, postérieure) a réutilisé la
-- même table (create table if not exists — no-op) mais avec un schéma
-- différent (colonnes actif/type/url/icone au lieu de publie/roles_
-- cibles/confidentialite) et des policies renommées "cr_read"/"cr_manage"
-- — jamais un DROP POLICY sur les anciens noms "centre_res_read"/
-- "centre_res_admin". Les deux policies SELECT coexistent, combinées en
-- OR par Postgres. "cr_read" est `using (actif = true or admin/prod)` —
-- AUCUNE vérification d'authentification. Résultat vérifié en réel avec
-- la clé anon SEULE (sans aucun compte) : les 12 ressources actives sont
-- lisibles publiquement (check-lists drone/matériel/colorimétrie/montage,
-- arborescence projet, barème de certification interne...).
--
-- Confirmé par le code de SportVision-OS-Full.html (renderCentreRessources,
-- ~L22271) : c'est le modèle actif/type/url/icone qui est utilisé en
-- production ; l'UI affiche explicitement "Visible par toute l'équipe" —
-- l'intention produit est bien un accès réservé au staff connecté, jamais
-- public. Les colonnes publie/roles_cibles de l'ancien modèle sont mortes
-- (aucune ligne n'a jamais publie=true).
--
-- ─── Correctif ───────────────────────────────────────────────────────────
-- Retire les policies mortes de l'ancien modèle (centre_res_read/
-- centre_res_admin, jamais droppées) et corrige cr_read pour exiger
-- is_staff() en plus de actif=true.
drop policy if exists "centre_res_read" on centre_ressources;
drop policy if exists "centre_res_admin" on centre_ressources;

drop policy if exists "cr_read" on centre_ressources;
create policy "cr_read" on centre_ressources for select using (
  (actif = true and is_staff())
  or exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);
