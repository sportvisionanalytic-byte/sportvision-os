-- v373 — Le cron qui vide la file de push (30/09/2026)
--
-- Chaque minute, comme `dispatch-notifications` pour les e-mails. Une proposition de mission est
-- datée : la pousser avec dix minutes de retard, c'est la pousser pour rien.
--
-- DEUX EN-TÊTES, ET C'EST VOULU
--
-- `Authorization` porte la clé PUBLIQUE. Elle ne donne aucun droit — c'est celle qui est déjà dans
-- le JavaScript du site et dans les applications — mais elle suffit à passer la porte `verify_jwt`
-- de Supabase. C'est ce qui permet de garder cette porte FERMÉE sur `envoyer-push`, au lieu
-- d'ouvrir une neuvième fonction sans vérification.
--
-- `x-sportvision-cle` porte le vrai contrôle : le même secret partagé que le cron des e-mails,
-- lu dans le coffre. C'est lui que la fonction vérifie.
--
-- La clé publique est écrite en clair ici, et c'est assumé : elle est publique par construction.
-- Si elle est un jour changée, ce cron répondra 401 et cela se verra dans `cron.job_run_details`,
-- au lieu d'échouer en silence.

begin;

select cron.unschedule('sportvision-envoyer-push')
where exists (select 1 from cron.job where jobname = 'sportvision-envoyer-push');

select cron.schedule(
  'sportvision-envoyer-push',
  '* * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/envoyer-push',
    headers := jsonb_build_object(
      'Authorization', 'Bearer sb_publishable_N_S7DxALGutAd6KlQmpaTw_h7cHNaE4',
      'x-sportvision-cle', (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_notifications_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $cron$
);

commit;
