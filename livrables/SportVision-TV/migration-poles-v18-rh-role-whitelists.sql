-- ============================================================================
-- migration-poles-v18-rh-role-whitelists.sql
-- Complète migration-poles-v17 : changer pole_scope_ok() ne suffisait pas —
-- vérifié en réel avec un compte RH jetable (0 client vu au lieu de 2
-- attendus). Cause exacte : les policies clients/prestations/prestations_equipe/
-- contrats/devis/factures (migration-poles-v3-rls.sql) combinent TOUJOURS
-- `role = ANY(ARRAY[...])  AND pole_scope_ok(...)` — la liste de rôles
-- explicite exclut 'rh' indépendamment de pole_scope_ok(), qui ne se déclenche
-- jamais tant que la 1ère condition échoue. Ajoute 'rh' à chaque liste de
-- rôles là où 'sec' apparaît déjà (principe validé par Fouka : "RH = sec
-- transversal"), logique interne de chaque policy INCHANGÉE sinon.
-- ============================================================================

drop policy if exists clients_write_acces on public.clients;
create policy clients_write_acces on public.clients for all using (
  (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','sec','com','compta','prod','rh'])))
  and pole_scope_ok(pole_id)
);

drop policy if exists contrats_write_acces on public.contrats;
create policy contrats_write_acces on public.contrats for all using (
  (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','sec','com','compta','rh'])))
  and client_pole_scope_ok(client_id)
);

drop policy if exists devis_acces on public.devis;
create policy devis_acces on public.devis for all using (
  (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','sec','com','compta','rh'])))
  and client_pole_scope_ok(client_id)
);

drop policy if exists factures_staff on public.factures;
create policy factures_staff on public.factures for all using (
  (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','sec','compta','rh'])))
  and client_pole_scope_ok(client_id)
);

drop policy if exists prestations_acces on public.prestations;
create policy prestations_acces on public.prestations for all using (
  (
    (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','sec','prod','compta','rh'])))
    and pole_scope_ok(pole_id)
  )
  or (exists (select 1 from prestations_equipe where prestations_equipe.prestation_id = prestations.id and prestations_equipe.collaborateur_id = auth.uid()))
  or (
    type_prestation = 'réseaux_sociaux'
    and pole_scope_ok(pole_id)
    and (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and (p.niveau_cm = 'cm_lead' or contenus_visible_par_cm(prestations.client_id, auth.uid()))))
  )
);

drop policy if exists equipe_delete on public.prestations_equipe;
create policy equipe_delete on public.prestations_equipe for delete using (
  (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod','sec','rh'])))
  and prestation_pole_scope_ok(prestation_id)
);

drop policy if exists equipe_insert on public.prestations_equipe;
create policy equipe_insert on public.prestations_equipe for insert with check (
  (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod','sec','rh'])))
  and prestation_pole_scope_ok(prestation_id)
);

drop policy if exists equipe_select on public.prestations_equipe;
create policy equipe_select on public.prestations_equipe for select using (
  (
    (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','sec','rh'])))
    and prestation_pole_scope_ok(prestation_id)
  )
  or (collaborateur_id = auth.uid())
);

drop policy if exists equipe_update on public.prestations_equipe;
create policy equipe_update on public.prestations_equipe for update using (
  (
    (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod','sec','rh'])))
    and prestation_pole_scope_ok(prestation_id)
  )
  or (collaborateur_id = auth.uid())
);

-- ROLLBACK : redéposer chaque policy ci-dessus sans 'rh' dans son array
-- (voir migration-poles-v3-rls.sql pour le corps exact pré-v18).
