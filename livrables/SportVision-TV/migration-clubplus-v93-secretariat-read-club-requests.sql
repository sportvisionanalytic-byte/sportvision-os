-- ============================================================================
-- migration-clubplus-v93-secretariat-read-club-requests.sql
-- ============================================================================
-- CONSTAT (trouvé en implémentant l'ajout des demandes Club+ à l'Inbox unique,
-- INC-027 pt.5, 20/08) : club_requests n'a que 2 policies SELECT — l'une pour
-- le membre du club lui-même (is_club_member), l'autre pour le staff mais
-- restreinte à role='admin' ou role='cm' (creq_staff_select). Le rôle 'sec',
-- qui possède l'écran "Demandes entrantes" (Inbox unique, sec.demandes), n'a
-- donc AUCUN accès en lecture à cette table — fusionner club_requests dans
-- cette Inbox aurait échoué silencieusement pour ce rôle (RLS filtre les
-- lignes sans erreur, la requête renvoie juste un tableau vide).
--
-- CE QUE FAIT CE FICHIER : ajoute une policy SELECT supplémentaire pour
-- role='sec', EN LECTURE SEULE. Ne touche à aucune policy existante, ne
-- change rien pour UPDATE (creq_member_comment reste la seule policy
-- d'écriture, is_club_member — le staff écrit uniquement via la RPC
-- staff_update_club_request_status, SECURITY DEFINER, qui reste elle-même
-- restreinte à admin/cm : volontaire, la décision d'accepter/refuser une
-- demande et de consommer des crédits reste un geste CM, pas secrétariat.
-- Sec voit juste qu'une demande existe et peut orienter, comme pour les
-- autres sources déjà dans cette Inbox.
-- ============================================================================

create policy "creq_sec_select" on club_requests for select
  using (
    exists (select 1 from profiles where id = auth.uid() and role = 'sec')
  );
