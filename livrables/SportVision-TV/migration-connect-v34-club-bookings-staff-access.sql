-- ============================================================
-- SPORTVISION CONNECT — v34 : accès staff à club_bookings (SportVision OS).
--
-- ─── Contexte ──────────────────────────────────────────────────────────
-- Le tunnel de réservation Connect pour un club (catalogue_offres →
-- club_bookings, ClubServicesBoard.tsx, porté ce soir depuis la référence
-- vanille club-services-documents-rapports.js) est maintenant câblé et
-- écrit réellement dans club_bookings. Mais SportVision OS n'a AUCUN écran
-- pour voir ou traiter ces réservations (vérifié : aucun résultat pour
-- "club_bookings" dans tout SportVision-OS-Full.html avant ce soir).
--
-- En construisant l'écran staff (nouvel onglet "Réservations clubs"), même
-- découverte que pour club_requests (migration-clubplus-cm-bridge.sql,
-- commentaire "même le staff OS n'a aujourd'hui aucun accès à
-- club_requests") : club_bookings (migration-clubplus-v6.sql) n'a que deux
-- policies, TOUTES DEUX limitées aux membres du club lui-même —
--
--   cbk_member_select : for select using (is_club_member(club_id))
--   cbk_member_insert : for insert with check (is_club_member(club_id))
--   cbk_admin_update  : for update using (is_club_admin(club_id))
--   cbk_admin_delete  : for delete using (is_club_admin(club_id))
--
-- is_club_admin(club_id) vérifie un rôle 'admin' DANS club_members (le
-- club lui-même) — jamais le staff SportVision (table `profiles`, disjointe
-- de club_members, un compte Club+ n'a jamais de ligne profiles). Résultat :
-- avant cette migration, AUCUN membre du staff, pas même role='admin', ne
-- peut lire ni faire avancer le pipeline d'une réservation depuis l'OS —
-- une demande de club partirait dans le vide, personne côté SportVision ne
-- la verrait jamais.
--
-- Corrige en ajoutant deux policies staff supplémentaires (select + update),
-- mêmes rôles que `clubs_staff_all` (migration-clubplus-v1.sql) : admin,
-- com, sec — les rôles qui gèrent déjà la relation commerciale/
-- administrative avec les clubs (menu OS "Demandes entrantes" = role sec).
-- Pas de policy staff INSERT/DELETE : la création reste exclusivement club
-- (cbk_member_insert), la suppression reste admin-club (cbk_admin_delete,
-- inchangée) — le staff FAIT AVANCER le pipeline, il ne crée ni ne supprime
-- des réservations à la place du club.
--
-- Idempotente (DROP POLICY IF EXISTS avant CREATE). Numérotée v34 dans la
-- séquence migration-connect-v* (v33 était le dernier numéro pris ce soir —
-- distincte de la séquence migration-clubplus-v* qui a son propre v34/v35
-- déjà réservés, non exécutés, sans rapport avec ce fichier).
--
-- EXÉCUTÉE — vérifié en base réelle le 19/08/2026 (audit pré-lancement) :
-- policies cbk_staff_select et cbk_staff_update existent déjà en base.
-- Cet en-tête disait à tort "NON EXÉCUTÉE". L'écran OS "Réservations
-- clubs" documenté ci-dessous comme cassé sans cette migration devrait
-- donc déjà fonctionner ; à re-tester si un doute subsiste. Contexte
-- historique conservé : c'est exactement le trou documenté
-- ci-dessus. Vérifié en conditions réelles ce soir (compte staff jetable +
-- JWT réel, PAS service_role) : voir le rapport de l'agent pour le détail
-- du test.
-- ============================================================

drop policy if exists "cbk_staff_select" on club_bookings;
create policy "cbk_staff_select" on club_bookings for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','com','sec'))
);

drop policy if exists "cbk_staff_update" on club_bookings;
create policy "cbk_staff_update" on club_bookings for update using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','com','sec'))
);

-- ============================================================
-- VÉRIFICATION RECOMMANDÉE après exécution (à rejouer séparément) :
--
-- select policyname, cmd, permissive, qual
-- from pg_policies
-- where tablename = 'club_bookings' and policyname like 'cbk_staff_%';
--
-- Doit retourner exactement 2 lignes (select, update). Puis, avec un
-- compte staff réel (role admin/com/sec) connecté à SportVision OS :
-- l'onglet "Réservations clubs" doit lister les réservations de TOUS les
-- clubs (pas seulement le sien — le staff n'est membre d'aucun club), et le
-- changement de statut (bouton pipeline) doit réussir sans 42501.
-- ============================================================
