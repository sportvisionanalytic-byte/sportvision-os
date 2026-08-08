-- ============================================================
-- Migration — workflow de traitement des demandes clubs (chantier
-- laissé ouvert par migration-audit-08-08-visibilite-staff-clubs.sql :
-- le staff pouvait désormais VOIR les demandes de création et
-- actualités soumises par les clubs, mais pas les faire avancer dans
-- leur workflow — seul le club lui-même le pouvait).
--
-- Policy d'UPDATE pour le staff (admin/cm/com/sec), en plus de la
-- policy membre déjà en place (ccr_member_update / cni_member_update,
-- non touchées). club_sponsors n'a pas de statut/workflow (juste des
-- données de fiche), pas de policy d'update staff nécessaire ici.
--
-- Idempotent. À exécuter dans Supabase → SQL Editor.
-- ============================================================

drop policy if exists "ccr_staff_update" on club_creations;
create policy "ccr_staff_update" on club_creations for update using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','cm','com','sec'))
);

drop policy if exists "cni_staff_update" on club_newsroom_items;
create policy "cni_staff_update" on club_newsroom_items for update using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','cm','com','sec'))
);
