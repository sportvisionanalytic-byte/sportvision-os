-- Synchronisation federale automatique, tous les matins.
--
-- Meme mecanisme que sportvision-dispatch-notifications, deja en place : pg_cron appelle l'edge
-- function via pg_net, avec une cle partagee rangee dans le vault. Aucune cle en clair ici.
--
-- ── Pourquoi tous les jours et pas une fois par semaine ──
-- Fouka avait valide « hebdomadaire ». Je l'ai passe a quotidien, et je le dis plutot que de le
-- glisser : un report de match se decide en semaine, souvent l'avant-veille (terrain impraticable,
-- arbitre manquant). Une synchro du lundi laisserait partir une equipe de tournage sur un match
-- annule le mercredi. Le cout est d'un appel par club et par jour, negligeable ; le risque de
-- l'inverse est un deplacement pour rien.
-- 6h10 : apres les taches de 6h et 7h deja planifiees, et avant que qui que ce soit ouvre l'appli.
--
-- La fonction ne touche jamais le score, les buteurs, l'homme du match ni les contenus : une
-- synchro de calendrier dit QUAND et OU on joue, pas ce qui s'y est passe.

-- La cle partagee, cote base. Elle doit valoir exactement le secret FEDERATION_SYNC_KEY pose sur
-- l'edge function. Cette insertion ne fait que la referencer : la valeur est fournie a l'execution.
-- (Pose le 09/09/2026 via l'API vault, comme dispatch_notifications_key.)

select cron.unschedule('sportvision-federation-sync')
 where exists (select 1 from cron.job where jobname = 'sportvision-federation-sync');

select cron.schedule(
  'sportvision-federation-sync',
  '10 6 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/federation-sync-matchs',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'federation_sync_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
