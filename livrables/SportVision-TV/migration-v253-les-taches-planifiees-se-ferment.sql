-- v253 — Les tâches planifiées ne s'appellent plus depuis le dehors (23/09/2026)
--
-- Constat de l'audit du 23/09 : onze tâches tournent par cron, toutes sous le compte `postgres`.
-- Neuf d'entre elles sont correctement fermées. Deux ne l'étaient pas :
--
--   check_factures_en_retard()   -- relances de factures
--   check_devis_sans_reponse()   -- relances de devis
--
-- Elles portaient EXECUTE pour PUBLIC, donc pour `anon`. La clé publique Supabase est dans le
-- JavaScript du site, visible de tout navigateur : n'importe qui pouvait appeler ces deux
-- fonctions et mettre en file des e-mails de relance vers de vrais clients. La clé
-- d'idempotence empêchait les doublons et les conditions de date bornaient l'envoi, donc le
-- dégât restait faible. Ça reste une écriture non authentifiée dans la file d'envoi, et rien
-- ne la justifie : personne ne les appelle depuis une application.
--
-- Deux autres fonctions étaient ouvertes à `anon` alors qu'elles se défendent déjà toutes
-- seules (elles vérifient auth.uid() et refusent). On ferme quand même l'accès anonyme : une
-- vérification interne peut être réécrite un jour par mégarde, un droit retiré ne se remet pas
-- tout seul. Elles restent ouvertes aux comptes connectés, qui sont ceux qui les appellent
-- pour de bon depuis l'OS.
--
-- Le cron n'est pas concerné : il s'exécute en `postgres`, propriétaire des fonctions.

-- ── Les deux relances : plus personne, hors postgres ────────────────────────────────────────
revoke execute on function public.check_factures_en_retard() from public, anon, authenticated;
revoke execute on function public.check_devis_sans_reponse() from public, anon, authenticated;

-- ── Les deux fonctions de l'OS : l'anonyme dehors, le connecté reste ────────────────────────
revoke execute on function public.supprimer_compte_definitivement(uuid) from public, anon;
revoke execute on function public.generate_missions_from_plan(uuid) from public, anon;

-- ── Le chemin de recherche figé, pour les deux seules fonctions à privilèges qui en manquaient
-- Une fonction SECURITY DEFINER sans search_path fixe résout ses noms de table dans le chemin
-- de l'appelant. Ici l'appelant est le cron, donc le risque est théorique — mais c'étaient les
-- deux dernières sur 515, et une exception qui traîne finit par servir de modèle.
alter function public.check_factures_en_retard() set search_path = public, pg_temp;
alter function public.check_devis_sans_reponse() set search_path = public, pg_temp;
