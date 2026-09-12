-- Les surveillances courtes tournent assez souvent pour servir (12/09/2026).
--
-- `send_prestation_reminders` porte des seuils de 4 h, 12 h et 20 h. Le cron ne la lançait
-- qu'une fois par jour, à 17 h : une prestation terminée à 18 h n'était examinée que le lendemain
-- à 17 h. Toutes ces alertes arrivaient systématiquement trop tard.
--
-- Ce test tient pour vrai que la fréquence d'exécution est au moins horaire, et que l'anti-doublon
-- qui rend cette fréquence sans danger — une clé d'occurrence portant le jour — est bien là.

begin;
create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

select pg_temp.note('les rappels terrain tournent au moins toutes les heures', 'oui',
  (select case when schedule ~ '^[0-9]+ \*' then 'oui' else 'NON (' || schedule || ')' end
     from cron.job where jobname = 'sportvision-rappels-prestation'));

select pg_temp.note('l''anti-doublon par occurrence est en place', 'oui',
  (select case when position('on conflict (cle_occurrence)' in prosrc) > 0 then 'oui' else 'NON' end
     from pg_proc where proname = 'notifier'));

select pg_temp.note('et les cles portent le jour', 'oui',
  (select case when position(':''||v_jour' in prosrc) > 0 then 'oui' else 'NON' end
     from pg_proc where proname = 'send_prestation_reminders'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
