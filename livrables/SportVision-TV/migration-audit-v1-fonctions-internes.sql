-- ═══════════════════════════════════════════════════════════════════════════════
-- P0 — Des fonctions internes étaient appelables sans aucun compte
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Trouvé à l'audit du 09/09/2026, et EXPLOITÉ pour de vrai avant correction : une simple
-- requête avec la clé anonyme — celle qui est publique par nature, présente dans le bundle
-- client — a inséré une notification dans le centre de l'administrateur, avec titre, message
-- et priorité choisis par l'appelant.
--
--   POST /rest/v1/rpc/notifier  →  true, puis 1 ligne dans `notifications`.
--
-- La cause n'est pas la fonction : c'est le défaut de PostgREST, où toute fonction du schéma
-- `public` est exécutable par `anon` tant qu'on ne le retire pas. `notifier()` est SECURITY
-- DEFINER, elle écrit donc avec les droits du propriétaire.
--
-- Impact réel : n'importe qui pouvait écrire n'importe quel message dans le centre de
-- notifications de n'importe quel utilisateur. Le vecteur évident est l'hameçonnage — un
-- message d'apparence interne demandant de valider un paiement.
--
-- Ce n'est pas une régression du module opérateur : trois fonctions de cron plus anciennes
-- étaient déjà correctement verrouillées (check_echeances_depenses,
-- check_devis_expiration_proche, check_contrats_renouvellement_proche) et trois autres avaient
-- été oubliées. C'est cet oubli qui est réparé ici, pour toutes.

begin;

-- IMPORTANT — révoquer depuis `public`, pas seulement depuis `anon` et `authenticated`.
-- PostgreSQL accorde EXECUTE à PUBLIC par défaut sur toute fonction. Retirer le droit à
-- `anon` seul ne change donc rien : le rôle continue d'hériter de PUBLIC. Constaté ici même,
-- une première version de cette migration n'a verrouillé que les deux fonctions qui portaient
-- un droit direct, et les quatre autres sont restées ouvertes.
-- Le propriétaire conserve EXECUTE dans tous les cas, donc les appelants SECURITY DEFINER
-- (déclencheurs, cron, vue) continuent de fonctionner.

-- ── Les fonctions strictement internes ───────────────────────────────────────
-- Aucune n'est appelée depuis un écran : vérifié sur tout le dépôt avant de révoquer. Leurs
-- appelants (déclencheurs, cron, vue) sont tous SECURITY DEFINER et s'exécutent donc avec les
-- droits du propriétaire, qui conserve EXECUTE. Rien ne casse.
revoke execute on function public.notifier(uuid,text,text,text,text,uuid,text,text) from public, anon, authenticated;
revoke execute on function public.destinataires_production(uuid) from public, anon, authenticated;
revoke execute on function public.mission_cloture_manquant(uuid) from public, anon, authenticated;

-- ── Les fonctions de cron oubliées ───────────────────────────────────────────
-- Elles ne doivent être déclenchées que par pg_cron. `check_echeances_documents_rh` est
-- idempotente (garde NOT EXISTS), donc l'impact restait faible — mais une tâche planifiée n'a
-- aucune raison d'être déclenchable depuis l'extérieur, et les trois autres du même lot
-- avaient déjà été fermées.
revoke execute on function public.check_echeances_documents_rh() from public, anon, authenticated;
revoke execute on function public.fin_generer_depenses_recurrentes() from public, anon, authenticated;
revoke execute on function public.generate_full_com_monthly_invoices(uuid[], boolean) from public, anon, authenticated;

commit;

-- Vérification : plus aucune de ces fonctions n'est exécutable sans compte.
select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as connecte
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('notifier','destinataires_production','mission_cloture_manquant',
                     'check_echeances_documents_rh','fin_generer_depenses_recurrentes',
                     'generate_full_com_monthly_invoices')
 order by 1;
