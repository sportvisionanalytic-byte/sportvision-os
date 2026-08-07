-- Migration : rotation du secret dispatch_notifications_key.
--
-- ─── Pourquoi ────────────────────────────────────────────────────────────
-- Le secret actuel (posé par migration-connect-v11-dispatch-notifications-
-- secret.sql) est écrit EN CLAIR dans ce fichier, qui est commité dans un
-- dépôt GitHub PUBLIC (vérifié le 2026-08-07 : sportvisionanalytic-byte/
-- sportvision-os, visibility PUBLIC). Tant que la vérification JWT de la
-- fonction dispatch-notifications était active, ce n'était pas exploitable
-- (la plateforme Supabase bloquait tout appel avant même d'atteindre ce
-- secret). Depuis que Fouka a désactivé "Enforce JWT Verification" sur
-- cette fonction (2026-08-07, pour débloquer le cron — cf. mémoire projet
-- "sportvision-communication-hub"), ce secret est la SEULE protection
-- restante — donc exploitable par quiconque lit ce dépôt public.
--
-- ─── ATTENTION AVANT D'EXÉCUTER CE FICHIER ────────────────────────────────
-- 1. Remplace {{NOUVEAU_SECRET}} ci-dessous par une vraie valeur aléatoire
--    AVANT de l'exécuter dans Supabase → SQL Editor.
-- 2. NE JAMAIS COMMITER CE FICHIER AVEC LA VRAIE VALEUR EN CLAIR — remets
--    {{NOUVEAU_SECRET}} (ou supprime le fichier) avant tout `git add`/commit,
--    sinon on reproduit exactement le problème que cette migration corrige.
-- 3. Juste après avoir exécuté le SQL, va dans Supabase → Edge Functions →
--    dispatch-notifications → Secrets → DISPATCH_NOTIFICATIONS_SECRET et
--    mets EXACTEMENT la même valeur (le code de la fonction compare les
--    deux, cf. supabase/functions/dispatch-notifications/index.ts).
-- 4. Vérifie ensuite qu'une notification part bien automatiquement (le
--    cron sportvision-dispatch-notifications tourne chaque minute).
--
-- Idempotente côté SQL (DELETE puis INSERT), mais évidemment à n'exécuter
-- qu'une fois avec la bonne valeur.

delete from vault.secrets where name = 'dispatch_notifications_key';
select vault.create_secret(
  '{{NOUVEAU_SECRET}}',
  'dispatch_notifications_key',
  'Secret partagé dédié — utilisé uniquement par le cron sportvision-dispatch-notifications pour authentifier ses appels à la fonction dispatch-notifications. Rotation du 2026-08-07 suite à exposition de l''ancien secret dans le dépôt public (v11). Ne pas réutiliser ailleurs, ne jamais commiter en clair.'
);
