-- ============================================================================
-- migration-poles-v27-mon-pole-commercial-communication-production.sql
-- Enrichit "Mon pôle" (migration-poles-v23) avec 3 nouvelles sections
-- demandées explicitement par Fouka : Commercial, Communication, Production.
-- Toutes les policies ci-dessous réutilisent les helpers SECURITY DEFINER
-- déjà créés cette nuit (client_pole_responsable_ok, is_pole_responsable_of_
-- prestation) — zéro nouvelle fonction sauf pour planned_presences (pas de
-- client_id direct, jointure au plan mensuel parent).
-- ============================================================================

-- ── Commercial : journal de contacts/relances du pipeline ─────────────────
create policy client_contacts_responsable_pole_all on public.client_contacts
  for all
  using (client_pole_responsable_ok(client_id))
  with check (client_pole_responsable_ok(client_id));

-- ── Communication : contenus (calendrier éditorial, publications) ────────
-- client_id nullable sur contenus (contenus internes sans client) : un
-- Responsable ne gère que les contenus rattachés à un client de son pôle.
create policy contenus_responsable_pole_all on public.contenus
  for all
  using (client_id is not null and client_pole_responsable_ok(client_id))
  with check (client_id is not null and client_pole_responsable_ok(client_id));

-- ── Communication : plans de production mensuels Full Com ────────────────
create policy mpp_responsable_pole_all on public.monthly_production_plans
  for all
  using (client_pole_responsable_ok(client_id))
  with check (client_pole_responsable_ok(client_id));

-- ── Communication : présences prévues (calendrier éditorial détaillé) ────
-- Pas de client_id direct -- dérivé du plan mensuel parent. La sous-requête
-- vers monthly_production_plans est sûre (pas de cycle : ce n'est pas
-- monthly_production_plans qui interroge planned_presences en retour).
create policy pp_responsable_pole_all on public.planned_presences
  for all
  using (exists (
    select 1 from monthly_production_plans mpp
    where mpp.id = planned_presences.plan_id and client_pole_responsable_ok(mpp.client_id)
  ))
  with check (exists (
    select 1 from monthly_production_plans mpp
    where mpp.id = planned_presences.plan_id and client_pole_responsable_ok(mpp.client_id)
  ));

-- ── Production : incidents (lecture + clôture pour tout le pôle, pas
-- seulement ceux qu'on a soi-même déclarés) ────────────────────────────────
create policy incidents_responsable_pole_all on public.incidents
  for all
  using (is_pole_responsable_of_prestation(prestation_id))
  with check (is_pole_responsable_of_prestation(prestation_id));

-- ── Production : post-production (écriture -- la lecture est déjà ouverte
-- à tout profil authentifié, mp_read) ──────────────────────────────────────
create policy mp_responsable_pole_write on public.media_postproductions
  for all
  using (is_pole_responsable_of_prestation(prestation_id))
  with check (is_pole_responsable_of_prestation(prestation_id));

-- ============================================================================
-- ROLLBACK (documenté, non exécuté) :
--   drop policy client_contacts_responsable_pole_all on public.client_contacts;
--   drop policy contenus_responsable_pole_all on public.contenus;
--   drop policy mpp_responsable_pole_all on public.monthly_production_plans;
--   drop policy pp_responsable_pole_all on public.planned_presences;
--   drop policy incidents_responsable_pole_all on public.incidents;
--   drop policy mp_responsable_pole_write on public.media_postproductions;
-- Aucune donnée existante modifiée (policies additives uniquement).
-- ============================================================================
