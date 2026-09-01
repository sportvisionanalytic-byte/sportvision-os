-- ============================================================================
-- migration-poles-v25-rh-ne-peut-pas-nommer-responsable.sql
-- Prépare la nomination d'un Responsable de pôle directement depuis l'OS
-- (invitation ou fiche collaborateur, demande de Fouka le 31/08/2026).
-- Nommer un Responsable donne un accès en écriture large (migration-poles-
-- v23/v24) — restreint cette action à l'admin uniquement : rh garde la main
-- sur l'affectation/désaffectation de pôle ('membre'), mais ne peut jamais
-- élever quelqu'un au rang de Responsable via un accès direct à
-- pole_affectations (RLS, pas juste un bouton caché côté UI).
-- ============================================================================

drop policy if exists pole_affectations_rh_all on public.pole_affectations;
create policy pole_affectations_rh_all on public.pole_affectations
  for all
  using (exists (select 1 from profiles where id = auth.uid() and role = 'rh'))
  with check (
    exists (select 1 from profiles where id = auth.uid() and role = 'rh')
    and role_pole = 'membre'
  );

-- ROLLBACK : recréer pole_affectations_rh_all sans la contrainte role_pole='membre'
-- (voir migration-poles-v14-separation-collaborateurs.sql pour le corps exact pré-v25).
