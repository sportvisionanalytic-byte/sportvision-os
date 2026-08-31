-- migration-poles-v7-roadmap-responsable-select.sql
--
-- Migration multi-pôles, Lot 8 (suite) — corrige un accès manquant trouvé en TESTANT EN RÉEL
-- (compte QA jetable, rôle fonctionnel 'photo' affecté comme Responsable du pôle Basket via
-- pole_affectations.role_pole='responsable', voir procédure de vérification du Lot 8).
--
-- Constat : getPoleMetriques() (SportVision-OS-Full.html) lit `contrats` (avec `clients`
-- embarqué pour filtrer par pole_id) pour calculer le nombre de contrats récurrents actifs
-- affiché sur la roadmap du pôle. Or `contrats_write_acces`/`clients_write_acces` (RLS
-- existante, migration-poles-v3-rls.sql) restreignent la lecture aux rôles FONCTIONNELS
-- admin/sec/com/compta(/prod pour clients) — un Responsable de pôle dont le rôle fonctionnel
-- est 'photo', 'cm' ou tout autre rôle hors de cette liste ne pouvait donc PAS lire les
-- contrats/clients de son propre pôle : la roadmap affichait silencieusement 0 partout (aucune
-- erreur PostgREST, juste un tableau vide filtré par RLS). Le cahier des charges du Lot 8 est
-- explicite : "un Responsable de pôle peut être n'importe quel rôle fonctionnel" — cet accès
-- est donc un prérequis manquant, pas une extension optionnelle.
--
-- Correctif : deux policies SELECT additives (composées en OR avec les policies existantes,
-- jamais en remplacement) qui accordent une lecture SEULE (jamais l'écriture — les policies
-- `_write_acces` existantes restent les seules à couvrir INSERT/UPDATE/DELETE) au Responsable
-- du pôle concerné, et seulement pour les lignes de CE pôle. Un Responsable Basket ne gagne
-- toujours aucun accès aux données Football, et aucun accès en écriture nouveau.
--
-- Idempotente : create or replace function, drop policy if exists suivi de create policy.
--
-- ROLLBACK :
--   drop policy if exists "clients_responsable_pole_select" on clients;
--   drop policy if exists "contrats_responsable_pole_select" on contrats;
--   drop function if exists client_pole_responsable_ok(uuid);

-- Même patron que client_pole_scope_ok() (migration-poles-v3-rls.sql) : SECURITY DEFINER,
-- contourne la RLS de `clients` en interne pour éviter toute évaluation de ses policies
-- (clients_cm_select_acces notamment) depuis une policy d'une AUTRE table (contrats) — même
-- raisonnement anti-récursion que le reste de la tranche multi-pôles.
create or replace function client_pole_responsable_ok(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_client_id is not null and is_pole_responsable((select pole_id from clients where id = p_client_id));
$$;

comment on function client_pole_responsable_ok(uuid) is 'Vrai si l''appelant est le Responsable (pole_affectations.role_pole=''responsable'') du pôle du client p_client_id. Utilisé par contrats_responsable_pole_select (Lot 8) — lecture seule, jamais l''écriture.';

drop policy if exists "contrats_responsable_pole_select" on contrats;
create policy "contrats_responsable_pole_select" on contrats for select using (
  client_pole_responsable_ok(contrats.client_id)
);

drop policy if exists "clients_responsable_pole_select" on clients;
create policy "clients_responsable_pole_select" on clients for select using (
  is_pole_responsable(clients.pole_id)
);

-- ── Vérification (à exécuter manuellement après migration) ─────────────
-- select policyname, cmd from pg_policies where tablename in ('contrats','clients')
--   and policyname like '%responsable_pole_select';
