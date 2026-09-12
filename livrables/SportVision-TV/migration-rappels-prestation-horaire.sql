-- Les rappels terrain tournent à l'heure, pas une fois par jour (12/09/2026).
--
-- CE QUI N'ALLAIT PAS. `send_prestation_reminders` surveille des seuils courts : une mission non
-- acceptée depuis 12 h, une prestation terminée depuis 4 h dont les fichiers ne sont pas
-- sécurisés, une sécurisation vieille de 20 h sans livraison, un retour de kit attendu dans 12 h.
-- Le cron ne la lançait qu'UNE fois par jour, à 17 h UTC.
--
-- Un seuil de 4 h contrôlé une fois par jour ne veut rien dire : une prestation terminée à 18 h
-- n'était examinée que le lendemain à 17 h, soit 23 heures plus tard. Toutes ces surveillances se
-- déclenchaient systématiquement trop tard, c'est-à-dire quand le problème était déjà installé.
--
-- Pourquoi c'est sans danger. `notifier` insère avec `on conflict (cle_occurrence) do nothing`, et
-- toutes les clés portent le jour (`:'||v_jour`) : la même alerte ne peut pas être posée deux fois
-- dans la même journée, quelle que soit la fréquence d'exécution. Passer à l'heure change le
-- MOMENT où l'alerte tombe, pas leur nombre.
-- Idempotente.

select cron.unschedule(jobid) from cron.job where jobname = 'sportvision-rappels-prestation';
select cron.schedule(
  'sportvision-rappels-prestation',
  '5 * * * *',
  $$select send_prestation_reminders();$$
);
