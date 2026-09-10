-- Regression de migration-audit-v1-fonctions-internes.sql (09/09/2026), trouvee le 10/09.
--
-- `fin_generer_depenses_recurrentes` y a ete revoquee pour `authenticated`, avec la note
-- « appelee seulement par des fonctions SECURITY DEFINER (declencheurs, cron) ». C'est faux :
-- l'ecran Finance > Depenses de l'OS l'appelle directement (loadFinDepenses, a chaque ouverture,
-- et genererDepensesRecurrentes, le bouton). Aucun cron ne l'appelle, et aucun ne le pourrait :
-- la fonction exige auth.uid() admin ou compta.
--
-- Sans ce correctif, le 05/10/2026 les onze abonnements mensuels ne se generaient pas, en
-- silence (l'appel automatique avale l'erreur).
--
-- Ce qui est rouvert, et rien de plus : EXECUTE pour les comptes connectes. La fonction garde
-- son propre controle (admin/compta, sinon exception). `anon` et `public` restent fermes, le
-- trou reel de l'audit etait l'acces sans compte.
--
-- Verification par le chemin reel : tests/api-depenses-recurrentes.test.mjs (jeton compta reel
-- via PostgREST, anonyme refuse, photographe refuse par la fonction).

begin;
grant execute on function public.fin_generer_depenses_recurrentes() to authenticated;
commit;

select has_function_privilege('anon', 'public.fin_generer_depenses_recurrentes()', 'EXECUTE') as anon,
       has_function_privilege('authenticated', 'public.fin_generer_depenses_recurrentes()', 'EXECUTE') as connecte;

-- Retour arriere : revoke execute on function public.fin_generer_depenses_recurrentes() from authenticated;
