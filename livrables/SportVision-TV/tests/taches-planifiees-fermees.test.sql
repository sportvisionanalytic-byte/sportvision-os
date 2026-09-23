-- Les tâches planifiées ne doivent jamais être appelables depuis une application (v253).
--
-- Pourquoi ce test existe : deux fonctions de relance par e-mail ont vécu ouvertes à `anon`
-- pendant des semaines sans que rien ne le signale. La clé publique est dans le JavaScript du
-- site : « ouvert à anon » veut dire ouvert à la terre entière. Le seul moyen que ça ne
-- recommence pas est de le vérifier à chaque passage de la batterie.
--
-- Une seule requête, parce que l'API ne rend que le résultat de la dernière instruction.
with taches(nom) as (values
  ('check_factures_en_retard()'), ('check_devis_sans_reponse()'),
  ('check_echeances_depenses()'), ('check_devis_expiration_proche()'),
  ('check_contrats_renouvellement_proche()'), ('check_echeances_documents_rh()'),
  ('check_cotisations_a_traiter()'), ('send_prestation_reminders()')
),
sensibles(nom) as (values
  ('supprimer_compte_definitivement(uuid)'), ('generate_missions_from_plan(uuid)')
),

-- 1. Les tâches lancées par le cron : fermées à l'anonyme ET au connecté.
--    Elles tournent sous `postgres`, personne d'autre n'a de raison de les appeler.
a as (
  select case when count(*) = 0
    then '✅ les 8 tâches du cron sont fermées aux applications'
    else '❌ ' || count(*) || ' tâche(s) du cron restent appelables : ' || string_agg(nom, ', ')
  end as verdict
  from taches
  where has_function_privilege('anon', 'public.'||nom, 'EXECUTE')
     or has_function_privilege('authenticated', 'public.'||nom, 'EXECUTE')
),

-- 2. La file d'envoi elle-même ne se remplit pas depuis le dehors.
b as (
  select case when not has_function_privilege('anon',
      'public.enqueue_notification(text,text,text,text,text,text,uuid,uuid,text,uuid,jsonb,timestamptz)',
      'EXECUTE')
    then '✅ enqueue_notification est fermée à l''anonyme'
    else '❌ enqueue_notification est exécutable par anon'
  end as verdict
),

-- 3. Les fonctions sensibles de l'OS : jamais l'anonyme, mais le connecté doit rester — c'est
--    par lui qu'elles sont appelées, et elles vérifient elles-mêmes qui appelle.
c as (
  select case
    when count(*) filter (where has_function_privilege('anon', 'public.'||nom, 'EXECUTE')) > 0
      then '❌ exécutable par anon : ' || string_agg(nom, ', ') filter (
           where has_function_privilege('anon', 'public.'||nom, 'EXECUTE'))
    when count(*) filter (where not has_function_privilege('authenticated', 'public.'||nom, 'EXECUTE')) > 0
      then '❌ l''OS ne peut plus appeler : ' || string_agg(nom, ', ') filter (
           where not has_function_privilege('authenticated', 'public.'||nom, 'EXECUTE'))
    else '✅ fonctions sensibles de l''OS : anonyme fermé, connecté conservé'
  end as verdict
  from sensibles
),

-- 4. Plus aucune fonction à privilèges sans chemin de recherche figé.
d as (
  select case when count(*) = 0
    then '✅ aucune fonction à privilèges sans search_path'
    else '❌ ' || count(*) || ' fonction(s) à privilèges sans search_path : '
         || string_agg(p.proname, ', ')
  end as verdict
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and (p.proconfig is null
         or not exists (select 1 from unnest(p.proconfig) x where x like 'search_path=%'))
)
select verdict from a
union all select verdict from b
union all select verdict from c
union all select verdict from d;
