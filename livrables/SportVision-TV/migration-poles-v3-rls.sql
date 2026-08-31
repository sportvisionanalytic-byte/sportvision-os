-- migration-poles-v3-rls.sql
--
-- Migration multi-pôles (Football + Basket), Lot 3 — RLS.
-- À exécuter APRÈS migration-poles-v1-fondations.sql ET
-- migration-poles-v2-backfill-football.sql, une fois leur bon déroulement
-- vérifié (voir plan de migration §Vérification, points A et C).
--
-- C'est la migration la plus sensible de la tranche : elle réécrit 10
-- policies RLS existantes sur clients/prestations/prestations_equipe/
-- factures/contrats/devis pour y ajouter un scoping par pôle. Toutes les
-- définitions ci-dessous ont été VÉRIFIÉES EN DIRECT CONTRE LA PROD
-- (pg_policies.qual/with_check, 31/08/2026) avant écriture — aucune n'est
-- déduite par lecture de fichiers de migration, pour éviter tout risque de
-- policy fantôme (une ancienne policy non réellement DROP en prod
-- coexistant avec une nouvelle créerait une composition OR involontaire,
-- silencieusement plus permissive que prévu).
--
-- Principe de composition : chaque policy est réécrite en ET-composant
-- pole_scope_ok(...) avec sa condition de rôle actuelle EXISTANTE —
-- jamais en l'élargissant. Aucun compte ne gagne un droit qu'il n'avait
-- pas ; seule une restriction cross-pôle est ajoutée. Les branches déjà
-- scopées à l'affectation individuelle (collaborateur_id = auth.uid()) et
-- les policies "finance_read"/"commissions_read" (audit transverse,
-- expert_comptable/auditeur, ou self-scopées) sont volontairement laissées
-- INTACTES — non touchées par cette migration.
--
-- Idempotente : create or replace function, drop policy if exists suivi de
-- create policy.
--
-- ROLLBACK : la section tout en bas de ce fichier (commentée) redéfinit
-- verbatim les 10 policies dans leur état exact d'avant cette migration
-- (mêmes chaînes que celles vérifiées en direct ci-dessus) — à décommenter
-- et exécuter en cas de problème, sans avoir besoin de retrouver l'état
-- via git.

-- ── Fonctions helper ─────────────────────────────────────────────────────
create or replace function get_my_pole_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(pole_id), '{}'::uuid[])
  from pole_affectations
  where user_id = auth.uid() and actif = true;
$$;

create or replace function is_pole_responsable(p_pole_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from pole_affectations
    where pole_id = p_pole_id and user_id = auth.uid() and role_pole = 'responsable' and actif = true
  );
$$;

-- Point d'entrée unique réutilisé par toutes les policies ci-dessous : un
-- seul endroit à faire évoluer si la règle change (même philosophie que
-- contenus_visible_par_cm(), déjà réutilisée ainsi dans ce repo). Bypass
-- admin toujours vrai (le Fondateur/Admin voit tous les pôles, exigence
-- non négociable du cahier des charges).
create or replace function pole_scope_ok(p_pole_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
    or p_pole_id = any (get_my_pole_ids());
$$;

comment on function pole_scope_ok(uuid) is 'Vrai si l''appelant est admin (bypass global) ou affecté (pole_affectations.actif=true) au pôle p_pole_id. Utilisé par les policies RLS clients/prestations/prestations_equipe/factures/contrats/devis (migration-poles-v3) pour isoler Football/Basket sans jamais élargir un accès existant.';

-- CORRECTIF appliqué le 31/08/2026, avant toute diffusion de cette migration
-- (trouvé en testant en réel avec un compte jetable, jamais vu en prod) :
-- une première version de equipe_select/update/insert/delete interrogeait
-- `prestations` via une sous-requête CLASSIQUE (pas security definer) pour
-- vérifier pole_scope_ok(p.pole_id) — ça déclenche l'évaluation RLS de
-- prestations_acces, dont une branche interroge à son tour
-- prestations_equipe (collaborateur_id=auth.uid()) : boucle infinie
-- ("infinite recursion detected in policy for relation prestations",
-- Postgres 42P17). Ce cycle n'existait pas avant cette migration (les
-- anciennes policies equipe_* n'interrogeaient jamais `prestations`).
-- Correction : deux fonctions SECURITY DEFINER supplémentaires, qui
-- contournent la RLS en interne (comme pole_scope_ok le fait déjà pour
-- profiles/pole_affectations) au lieu d'une sous-requête classique —
-- casse le cycle à la racine plutôt que de le déplacer.
create or replace function prestation_pole_scope_ok(p_prestation_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select pole_scope_ok(pole_id) from prestations where id = p_prestation_id;
$$;

-- Même principe pour factures/contrats/devis : centralise aussi le
-- fail-open "client_id is null" (au lieu de le répéter dans 3 policies),
-- et évite par précaution tout risque de cycle futur si clients/factures/
-- contrats/devis venaient à se référencer mutuellement dans une policy.
create or replace function client_pole_scope_ok(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_client_id is null or pole_scope_ok((select pole_id from clients where id = p_client_id));
$$;

-- ── clients ───────────────────────────────────────────────────────────
drop policy if exists "clients_write_acces" on clients;
create policy "clients_write_acces" on clients for all using (
  (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','sec','com','compta','prod'])))
  and pole_scope_ok(clients.pole_id)
);

drop policy if exists "clients_cm_select_acces" on clients;
create policy "clients_cm_select_acces" on clients for select using (
  pole_scope_ok(clients.pole_id)
  and (
    (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead'))
    or contenus_visible_par_cm(clients.id, auth.uid())
  )
);

-- ── prestations ───────────────────────────────────────────────────────
drop policy if exists "prestations_acces" on prestations;
create policy "prestations_acces" on prestations for all using (
  (
    (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','sec','prod','compta'])))
    and pole_scope_ok(prestations.pole_id)
  )
  or (exists (select 1 from prestations_equipe where prestations_equipe.prestation_id = prestations.id and prestations_equipe.collaborateur_id = auth.uid()))
  or (
    prestations.type_prestation = 'réseaux_sociaux'
    and pole_scope_ok(prestations.pole_id)
    and (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and (p.niveau_cm = 'cm_lead' or contenus_visible_par_cm(prestations.client_id, auth.uid()))))
  )
);

-- ── prestations_equipe ────────────────────────────────────────────────
drop policy if exists "equipe_select" on prestations_equipe;
create policy "equipe_select" on prestations_equipe for select using (
  (
    (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','sec'])))
    and prestation_pole_scope_ok(prestations_equipe.prestation_id)
  )
  or (prestations_equipe.collaborateur_id = auth.uid())
);

drop policy if exists "equipe_update" on prestations_equipe;
create policy "equipe_update" on prestations_equipe for update using (
  (
    (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod','sec'])))
    and prestation_pole_scope_ok(prestations_equipe.prestation_id)
  )
  or (prestations_equipe.collaborateur_id = auth.uid())
);

drop policy if exists "equipe_insert" on prestations_equipe;
create policy "equipe_insert" on prestations_equipe for insert with check (
  (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod','sec'])))
  and prestation_pole_scope_ok(prestation_id)
);

drop policy if exists "equipe_delete" on prestations_equipe;
create policy "equipe_delete" on prestations_equipe for delete using (
  (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod','sec'])))
  and prestation_pole_scope_ok(prestations_equipe.prestation_id)
);

-- ── factures ──────────────────────────────────────────────────────────
-- fail-open sur client_id is null (factures orphelines éventuelles) : ne
-- doit jamais retirer un accès déjà possible aujourd'hui — géré par
-- client_pole_scope_ok() elle-même.
drop policy if exists "factures_staff" on factures;
create policy "factures_staff" on factures for all using (
  (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','sec','compta'])))
  and client_pole_scope_ok(factures.client_id)
);

-- ── contrats ──────────────────────────────────────────────────────────
drop policy if exists "contrats_write_acces" on contrats;
create policy "contrats_write_acces" on contrats for all using (
  (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','sec','com','compta'])))
  and client_pole_scope_ok(contrats.client_id)
);

drop policy if exists "contrats_cm_select_acces" on contrats;
create policy "contrats_cm_select_acces" on contrats for select using (
  client_pole_scope_ok(contrats.client_id)
  and (
    (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead'))
    or contenus_visible_par_cm(contrats.client_id, auth.uid())
  )
);

-- ── devis ─────────────────────────────────────────────────────────────
drop policy if exists "devis_acces" on devis;
create policy "devis_acces" on devis for all using (
  (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','sec','com','compta'])))
  and client_pole_scope_ok(devis.client_id)
);

-- ══════════════════════════════════════════════════════════════════════
-- ROLLBACK — décommenter et exécuter en cas de problème (redéfinition
-- verbatim de l'état exact d'avant cette migration, vérifié en direct le
-- 31/08/2026 avant d'écrire ce fichier) :
-- ══════════════════════════════════════════════════════════════════════

-- drop policy if exists "clients_write_acces" on clients;
-- create policy "clients_write_acces" on clients for all using (
--   exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','sec','com','compta','prod']))
-- );
--
-- drop policy if exists "clients_cm_select_acces" on clients;
-- create policy "clients_cm_select_acces" on clients for select using (
--   (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead'))
--   or contenus_visible_par_cm(id, auth.uid())
-- );
--
-- drop policy if exists "prestations_acces" on prestations;
-- create policy "prestations_acces" on prestations for all using (
--   (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','sec','prod','compta'])))
--   or (exists (select 1 from prestations_equipe where prestations_equipe.prestation_id = prestations.id and prestations_equipe.collaborateur_id = auth.uid()))
--   or (
--     type_prestation = 'réseaux_sociaux'
--     and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and (p.niveau_cm = 'cm_lead' or contenus_visible_par_cm(prestations.client_id, auth.uid())))
--   )
-- );
--
-- drop policy if exists "equipe_select" on prestations_equipe;
-- create policy "equipe_select" on prestations_equipe for select using (
--   (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','sec'])))
--   or (collaborateur_id = auth.uid())
-- );
--
-- drop policy if exists "equipe_update" on prestations_equipe;
-- create policy "equipe_update" on prestations_equipe for update using (
--   (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod','sec'])))
--   or (collaborateur_id = auth.uid())
-- );
--
-- drop policy if exists "equipe_insert" on prestations_equipe;
-- create policy "equipe_insert" on prestations_equipe for insert with check (
--   exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod','sec']))
-- );
--
-- drop policy if exists "equipe_delete" on prestations_equipe;
-- create policy "equipe_delete" on prestations_equipe for delete using (
--   exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod','sec']))
-- );
--
-- drop policy if exists "factures_staff" on factures;
-- create policy "factures_staff" on factures for all using (
--   exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','sec','compta']))
-- );
--
-- drop policy if exists "contrats_write_acces" on contrats;
-- create policy "contrats_write_acces" on contrats for all using (
--   exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','sec','com','compta']))
-- );
--
-- drop policy if exists "contrats_cm_select_acces" on contrats;
-- create policy "contrats_cm_select_acces" on contrats for select using (
--   (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead'))
--   or contenus_visible_par_cm(client_id, auth.uid())
-- );
--
-- drop policy if exists "devis_acces" on devis;
-- create policy "devis_acces" on devis for all using (
--   exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','sec','com','compta']))
-- );
--
-- drop function if exists client_pole_scope_ok(uuid);
-- drop function if exists prestation_pole_scope_ok(uuid);
-- drop function if exists pole_scope_ok(uuid);
-- drop function if exists is_pole_responsable(uuid);
-- drop function if exists get_my_pole_ids();
