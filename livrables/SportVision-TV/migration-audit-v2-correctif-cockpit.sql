-- ═══════════════════════════════════════════════════════════════════════════════
-- Correctif : le verrouillage de l'audit avait casse le cockpit Production
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Regression introduite par migration-audit-v1 et signalee par Fouka le 09/09/2026 :
-- l'ecran « Production — Missions » renvoyait une erreur.
--
--   GET /rest/v1/v_production_missions  ->  403
--   {"code":"42501","message":"permission denied for function mission_cloture_manquant"}
--
-- CE QUE J'AVAIS MAL COMPRIS. Une vue en `security_invoker=off` lit ses TABLES avec les droits
-- de son proprietaire — c'est ce qui protege les donnees. Mais l'execution d'une FONCTION
-- appelee dans cette vue reste verifiee contre le role APPELANT. Retirer EXECUTE a
-- `authenticated` a donc casse la vue pour tout le monde, alors que la vue elle-meme etait
-- toujours lisible.
--
-- POURQUOI MES TESTS N'ONT RIEN VU. Ils interrogeaient la base par l'API Management, qui
-- s'execute en `postgres` : ce role conserve EXECUTE, donc la vue repondait. Le defaut
-- n'apparaissait qu'a travers PostgREST, avec un vrai jeton. C'est la lecon de ce correctif :
-- une revocation de droits se verifie par le chemin que prend l'application, pas en superutilisateur.
--
-- CE QU'ON GARDE DE L'AUDIT. Le trou reel etait l'acces ANONYME : n'importe qui pouvait appeler
-- ces fonctions sans aucun compte. `anon` et `public` restent donc fermes. Seul `authenticated`
-- recupere ce qui est necessaire au fonctionnement — et uniquement la fonction reellement
-- utilisee par une vue.

begin;

-- `mission_cloture_manquant` est appelee par la vue v_production_missions : c'est la seule des
-- six fonctions verrouillees dans ce cas (verifie sur l'ensemble des vues du schema).
-- Elle rend un tableau de libelles (« Rushs video non transmis »...) pour une mission donnee ;
-- la vue expose deja exactement la meme information au meme public.
grant execute on function public.mission_cloture_manquant(uuid) to authenticated;

-- Les cinq autres restent fermees : elles ne sont appelees que depuis des fonctions
-- SECURITY DEFINER (declencheurs, cron), qui s'executent avec les droits du proprietaire et
-- n'ont donc besoin d'aucun droit cote appelant.
--   notifier, destinataires_production, check_echeances_documents_rh,
--   fin_generer_depenses_recurrentes, generate_full_com_monthly_invoices

commit;

-- Etat attendu : mission_cloture_manquant ouverte aux seuls comptes connectes, jamais a anon.
select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as connecte
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('mission_cloture_manquant','notifier','destinataires_production',
                     'check_echeances_documents_rh','fin_generer_depenses_recurrentes',
                     'generate_full_com_monthly_invoices')
 order by 1;
