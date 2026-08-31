-- ============================================================================
-- migration-poles-v17-rh-acces-transversal-metier.sql
-- Fouka précise (31/08/2026, suite à migration-poles-v14/v15/v16) : la
-- Secrétaire générale / RH ne doit pas se limiter à la visibilité staff — elle
-- doit voir/gérer prestations, clients, devis, contrats, factures, etc. sur
-- TOUS les pôles, comme le fait déjà 'sec' sur SON pôle. Autrement dit : RH =
-- 'sec' transversal (tous pôles), pas un rôle strictement RH-only.
--
-- pole_scope_ok() est la fonction racine réutilisée par client_pole_scope_ok()
-- et prestation_pole_scope_ok() (migration-poles-v3-rls.sql), donc par TOUTES
-- les policies clients/prestations/contrats/devis/factures/equipe déjà
-- scopées cette nuit. Un seul changement ici suffit à propager l'accès
-- transversal RH à l'ensemble de ces tables, sans toucher aux ~10 policies
-- une par une. Réutilise is_admin_or_rh() (migration-poles-v14) au lieu de
-- redéfinir l'exception admin en dur une deuxième fois.
--
-- Volontairement INCHANGÉ : pole_finance_access_ok() (Finance/rémunération)
-- et kit_pole_scope_ok()/kit_reservation_pole_scope_ok() (Matériel) restent
-- admin-only -- 'sec' lui-même n'a ni Finance ni Kits dans sa nav aujourd'hui,
-- RH n'en a donc pas non plus par cohérence ("RH = sec transversal").
-- ============================================================================

create or replace function public.pole_scope_ok(p_pole_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select is_admin_or_rh()
    or p_pole_id = any (get_my_pole_ids());
$function$;

-- ROLLBACK : restaurer pole_scope_ok() avec le exists(...role='admin') en dur
-- (voir migration-poles-v3-rls.sql pour le corps exact pré-v17).
