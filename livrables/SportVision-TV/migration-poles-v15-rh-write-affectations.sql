-- ============================================================================
-- migration-poles-v15-rh-write-affectations.sql
-- Complète migration-poles-v14 : la RH doit pouvoir réaffecter un collaborateur
-- existant (rendre flexible, changer de pôle) depuis la fiche collaborateur
-- (nouvelle section "Pôle(s)", modalModifierPolesCollaborateur() dans l'OS).
-- pole_affectations n'avait jusqu'ici qu'une policy d'écriture admin-only
-- (pole_affectations_admin_all) — ajoute l'équivalent pour 'rh', cohérent avec
-- is_admin_or_rh() (migration-poles-v14).
-- ============================================================================

create policy pole_affectations_rh_all on public.pole_affectations
  for all
  using (exists (select 1 from profiles where id = auth.uid() and role = 'rh'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'rh'));

-- ROLLBACK : drop policy pole_affectations_rh_all on public.pole_affectations;
