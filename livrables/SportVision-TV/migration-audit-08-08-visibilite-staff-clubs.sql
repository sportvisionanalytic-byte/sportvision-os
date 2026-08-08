-- ============================================================
-- Migration — visibilité staff sur les demandes clubs Connect
-- (suite de l'audit du 08/08/2026, item non traité #3)
--
-- club_sponsors, club_creations et club_newsroom_items n'avaient AUCUNE
-- policy accessible au staff SportVision (admin/cm/com/sec) — seuls
-- is_club_member/is_club_admin (le club lui-même) pouvaient lire ces
-- tables. L'OS ne les interroge nulle part aujourd'hui : un club qui
-- soumet une fiche sponsor, une demande de création ou une actualité
-- via Connect n'était vu par PERSONNE côté SportVision, pouvant rester
-- bloqué indéfiniment sans que personne ne le sache.
--
-- Cette migration ajoute une policy de LECTURE pour le staff (les
-- policies membres/admin de club existantes ne sont pas touchées).
-- L'écriture (changement de statut, validation) reste à la charge du
-- club lui-même pour l'instant — construire le workflow de traitement
-- côté OS (UI + policies d'update staff) est un chantier séparé, plus
-- gros, qui suit dans SportVision-OS-Full.html (nouvel onglet CM).
--
-- Idempotent. À exécuter dans Supabase → SQL Editor.
-- ============================================================

drop policy if exists "csp_staff_select" on club_sponsors;
create policy "csp_staff_select" on club_sponsors for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','cm','com','sec'))
);

drop policy if exists "ccr_staff_select" on club_creations;
create policy "ccr_staff_select" on club_creations for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','cm','com','sec'))
);

drop policy if exists "cni_staff_select" on club_newsroom_items;
create policy "cni_staff_select" on club_newsroom_items for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','cm','com','sec'))
);
