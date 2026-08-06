-- Fix sécurité : dispatch-notifications se disait "appelée uniquement par
-- pg_cron, jamais depuis le navigateur" mais ne vérifiait rien côté code —
-- n'importe quel appelant connaissant l'URL de la fonction pouvait déclencher
-- le traitement de la file d'attente à volonté. Découvert lors de l'audit du
-- 2026-08-06.
--
-- Root cause plus profonde : le secret Vault "dispatch_notifications_key"
-- (créé par migration-communication-hub-part2.sql, commentaire ligne 53)
-- était prévu pour contenir "VOTRE_CLE_SERVICE_ROLE_OU_ANON" — potentiellement
-- la clé anon, PUBLIQUE, ce qui n'aurait rien vérifié du tout même avec un
-- contrôle côté fonction. On remplace ici par un secret dédié, généré
-- aléatoirement, qui ne sert QUE à cet usage.
--
-- Après exécution de cette migration :
--   1. Va dans Supabase → Edge Functions → dispatch-notifications → Secrets
--   2. Ajoute DISPATCH_NOTIFICATIONS_SECRET avec EXACTEMENT la valeur ci-dessous
--      (la même que celle insérée dans Vault par cette migration)
--   3. Le code de la fonction (index.ts) a été mis à jour pour comparer le
--      header Authorization reçu à ce secret et refuser (401) tout appel qui
--      ne correspond pas.

delete from vault.secrets where name = 'dispatch_notifications_key';
select vault.create_secret(
  '2ae56659d591d2243dd9c5f567d88593b81db5fadd448f5124aee91c67cf2357',
  'dispatch_notifications_key',
  'Secret partagé dédié — utilisé uniquement par le cron sportvision-dispatch-notifications pour authentifier ses appels à la fonction dispatch-notifications. Ne pas réutiliser ailleurs.'
);
