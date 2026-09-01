-- ============================================================================
-- migration-poles-v32-fix-fuite-rls-medias-postprod-incidents.sql
-- Audit de cohérence global demandé par Fouka (01/09/2026, "tout rendre
-- cohérent, sans chevauchement, sans bug") — agent d'audit dédié à l'OS,
-- finding CRITIQUE #1 : media_liens/media_postproductions/incidents n'ont
-- JAMAIS été scopés par pôle en RLS, contrairement à clients/prestations/
-- prestations_equipe/factures/contrats/devis (migration-poles-v3-rls.sql).
-- Seul un filtre JS après fetch complet limitait l'affichage (loadProdMedias/
-- loadProdPostprod/loadIncidents) — trivialement contournable (les données
-- arrivent déjà côté navigateur avant filtrage) et incohérent avec le modèle
-- de scoping dur appliqué partout ailleurs. Impact réel : un membre staff
-- (photo/cm/sec/prod) affecté uniquement à Football voyait déjà tout le
-- Centre Médias/Postproduction/Incidents de Basket, et inversement.
--
-- Corrige aussi de facto le finding CRITIQUE #2 du même audit (course au
-- login : le tout premier écran après connexion s'affiche avant que
-- S.activePoleId ne soit peuplé) : ce n'était un vrai problème de sécurité
-- QUE pour ces 3 tables sans RLS — pour les tables déjà scopées en dur, la
-- RLS restreint déjà correctement même sans filtre pole_id côté requête
-- (pole_scope_ok() s'appuie sur pole_affectations, pas sur un paramètre
-- client). Aucun correctif JS séparé nécessaire.
--
-- Principe de composition identique à migration-poles-v3-rls.sql : ET-compose
-- prestation_pole_scope_ok(prestation_id) (déjà existante, SECURITY DEFINER)
-- avec la condition de rôle EXISTANTE de chaque policy — jamais élargie,
-- seulement restreinte. Les branches self-scopées (declare_par=auth.uid())
-- et les policies additives Responsable (incidents_responsable_pole_all,
-- mp_responsable_pole_write, migration-poles-v27) restent INTACTES.
--
-- prestation_id est nullable sur les 3 tables (media_liens/media_postpro-
-- ductions/incidents) : fail-open explicite ("prestation_id is null or
-- prestation_pole_scope_ok(...)"), même philosophie que client_pole_scope_ok
-- dans migration-poles-v3-rls.sql — une ligne jamais rattachée à une
-- prestation n'a rien à scoper, elle reste visible selon la condition de
-- rôle seule.
--
-- Vérifié en direct contre la prod (pg_policies.qual, 01/09/2026) avant
-- écriture, comme migration-poles-v3-rls.sql : ml_read/ml_write utilisent
-- is_staff() (pas l'ancien exists(...) littéral vu dans un vieux fichier de
-- référence), mp_write reste admin/prod, incidents_acces reste
-- admin/prod/sec OR declare_par=auth.uid().
-- ============================================================================

-- ── media_liens ──
drop policy if exists "ml_read" on public.media_liens;
create policy "ml_read" on public.media_liens for select using (
  is_staff() and (prestation_id is null or prestation_pole_scope_ok(prestation_id))
);

drop policy if exists "ml_write" on public.media_liens;
create policy "ml_write" on public.media_liens for all using (
  is_staff() and (prestation_id is null or prestation_pole_scope_ok(prestation_id))
);

-- ── media_postproductions ──
drop policy if exists "mp_read" on public.media_postproductions;
create policy "mp_read" on public.media_postproductions for select using (
  is_staff() and (prestation_id is null or prestation_pole_scope_ok(prestation_id))
);

drop policy if exists "mp_write" on public.media_postproductions;
create policy "mp_write" on public.media_postproductions for all using (
  (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod'])))
  and (prestation_id is null or prestation_pole_scope_ok(prestation_id))
);
-- mp_responsable_pole_write (migration-poles-v27) reste inchangée, additive.

-- ── incidents ──
drop policy if exists "incidents_acces" on public.incidents;
create policy "incidents_acces" on public.incidents for all using (
  (
    exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod','sec']))
    and (prestation_id is null or prestation_pole_scope_ok(prestation_id))
  )
  or declare_par = auth.uid()
);
-- incidents_responsable_pole_all (migration-poles-v27) reste inchangée, additive.

-- ROLLBACK (état exact d'avant cette migration, vérifié en direct le 01/09/2026) :
-- drop policy if exists "ml_read" on public.media_liens;
-- create policy "ml_read" on public.media_liens for select using (is_staff());
-- drop policy if exists "ml_write" on public.media_liens;
-- create policy "ml_write" on public.media_liens for all using (is_staff());
-- drop policy if exists "mp_read" on public.media_postproductions;
-- create policy "mp_read" on public.media_postproductions for select using (is_staff());
-- drop policy if exists "mp_write" on public.media_postproductions;
-- create policy "mp_write" on public.media_postproductions for all using (
--   exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod']))
-- );
-- drop policy if exists "incidents_acces" on public.incidents;
-- create policy "incidents_acces" on public.incidents for all using (
--   exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod','sec']))
--   or declare_par = auth.uid()
-- );
