-- ============================================================
-- Migration de correctifs — audit complet du 08/08/2026
-- (7 revues parallèles sur tout SportVision OS : RLS, écritures
-- silencieuses, Finances, Prestations/Devis/Contrats, Connect/CM,
-- Kits/Incidents/Utilisateurs, Grades/terminologie)
--
-- Ce fichier regroupe UNIQUEMENT les correctifs nécessitant une
-- modification en base (policies RLS, vue). Les correctifs purement
-- JS (SportVision-OS-Full.html) sont commités séparément.
--
-- Idempotent : DROP ... IF EXISTS avant chaque CREATE, peut être
-- rejouée sans effet de bord. À exécuter dans Supabase → SQL Editor.
-- ============================================================


-- ─── 1. frais — l'INSERT self-service n'était pas restreint ────────────────
-- Un collaborateur pouvait POSTer directement une ligne `frais` avec
-- statut='validé'/'remboursé' et un montant arbitraire, contournant
-- entièrement le circuit de validation admin/prod → compta. Corrigé :
-- l'auto-déclaration ne peut se faire que sur SA PROPRE ligne, en statut
-- 'en_attente' uniquement (le passage à validé/remboursé reste réservé à
-- frais_update, déjà correctement restreinte à admin/prod/compta).
drop policy if exists "frais_insert" on frais;
create policy "frais_insert" on frais for insert with check (
  collaborateur_id = auth.uid()
  and statut = 'en_attente'
);


-- ─── 2. materiels — DELETE/UPDATE ouverts à tout rôle, y compris photo/sec ──
-- Aucune écriture self-service légitime n'existe côté JS pour ces rôles sur
-- cette table (vérifié : tous les appels POST/PATCH sur `materiels` sont
-- dans le shell admin/prod de "Kits & Matériel"). photo/sec gardent la
-- lecture (nécessaire à leurs propres vues de kits), mais plus l'écriture.
drop policy if exists "materiels_access" on materiels;
drop policy if exists "materiels_photo_select" on materiels;
create policy "materiels_select" on materiels for select using (
  exists (select 1 from profiles where id = auth.uid())
);
create policy "materiels_write" on materiels for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod','compta'))
);


-- ─── 3. kit_compositions — for all sans filtre de rôle ──────────────────────
-- Vérifié : les seuls appels d'écriture (kitsAddMaterielSubmit,
-- kitsRetirerMateriel) sont derrière des boutons admin-only dans l'UI.
drop policy if exists "kit_comp_access" on kit_compositions;
create policy "kit_comp_select" on kit_compositions for select using (
  exists (select 1 from profiles where id = auth.uid())
);
create policy "kit_comp_write" on kit_compositions for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);


-- ─── 4. kit_controles / kit_controle_items — for all sans filtre ────────────
-- Contrairement à kit_compositions, ces deux tables ONT un usage self-service
-- légitime : le collaborateur assigné à une réservation fait lui-même son
-- contrôle "avant/après" matériel (kitsControleSubmit). La ligne kit_controles
-- est créée par admin/prod à l'attribution (collaborateur_id = photographe
-- assigné) ; c'est ensuite CE collaborateur qui la met à jour. On autorise
-- donc la lecture/mise à jour à son propriétaire, mais réserve la création et
-- la suppression à admin/prod.
drop policy if exists "kit_ctrl_access" on kit_controles;
create policy "kit_ctrl_select" on kit_controles for select using (
  exists (select 1 from profiles where id = auth.uid())
);
create policy "kit_ctrl_insert" on kit_controles for insert with check (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);
create policy "kit_ctrl_update" on kit_controles for update using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
  or collaborateur_id = auth.uid()
);
create policy "kit_ctrl_delete" on kit_controles for delete using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);

drop policy if exists "kit_ctrl_items_access" on kit_controle_items;
create policy "kit_ctrl_items_select" on kit_controle_items for select using (
  exists (select 1 from profiles where id = auth.uid())
);
create policy "kit_ctrl_items_insert" on kit_controle_items for insert with check (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);
create policy "kit_ctrl_items_update" on kit_controle_items for update using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
  or exists (
    select 1 from kit_controles kc
    where kc.id = kit_controle_items.controle_id and kc.collaborateur_id = auth.uid()
  )
);
create policy "kit_ctrl_items_delete" on kit_controle_items for delete using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);


-- ─── 5. materiel_incidents — for all sans filtre de rôle ni de propriétaire ─
-- N'importe quel collaborateur pouvait résoudre ou SUPPRIMER l'incident
-- déclaré par un collègue sur n'importe quel kit. Vérifié : à ce jour, la
-- déclaration comme la résolution d'incident ne sont accessibles que depuis
-- le shell admin/prod côté UI — pas de self-service direct depuis la vue
-- photo. Restreint donc entièrement à admin/prod, cohérent avec
-- materiel_maintenances (déjà correctement scopée de la même façon).
drop policy if exists "incidents_access" on materiel_incidents;
create policy "materiel_incidents_access" on materiel_incidents for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);


-- ─── 6. v_rentabilite_missions — comptait les prestations annulées/refusées
-- comme du chiffre d'affaires ────────────────────────────────────────────
-- Cette vue alimente Rentabilité, Compte de résultat, Budgets & prévisions
-- et le dashboard expert-comptable. Contrairement au reste de l'app (qui
-- exclut systématiquement annulée/refusée sur `prestations`), elle ne
-- filtrait pas du tout sur le statut — une mission annulée après saisie
-- d'un montant continuait de gonfler indéfiniment CA et marge affichés.
create or replace view v_rentabilite_missions
with (security_invoker = true) as
select
  p.id as prestation_id,
  p.reference,
  p.type_prestation,
  p.client_id,
  c.nom as client_nom,
  p.date_prestation,
  p.statut_financier,
  coalesce(p.montant_ht, 0) as revenu_ht,
  coalesce(re.total_remunerations, 0) as cout_remunerations,
  coalesce(fr.total_frais, 0) as cout_frais,
  coalesce(de.total_depenses, 0) as cout_depenses_directes,
  coalesce((select valeur from cost_allocations where actif = true and methode = 'forfait_par_mission' limit 1), 0)
    + coalesce(p.montant_ht, 0) * coalesce((select valeur from cost_allocations where actif = true and methode = 'pourcentage_ca' limit 1), 0) / 100.0
    as cout_indirect_alloue,
  coalesce(p.montant_ht, 0)
    - coalesce(re.total_remunerations, 0)
    - coalesce(fr.total_frais, 0)
    - coalesce(de.total_depenses, 0)
    - (coalesce((select valeur from cost_allocations where actif = true and methode = 'forfait_par_mission' limit 1), 0)
       + coalesce(p.montant_ht, 0) * coalesce((select valeur from cost_allocations where actif = true and methode = 'pourcentage_ca' limit 1), 0) / 100.0)
    as marge_nette
from prestations p
left join clients c on c.id = p.client_id
left join (
  select prestation_id, sum(remuneration) as total_remunerations
  from prestations_equipe where statut = 'acceptée'
  group by prestation_id
) re on re.prestation_id = p.id
left join (
  select prestation_id, sum(montant) as total_frais
  from frais where statut in ('validé','remboursé')
  group by prestation_id
) fr on fr.prestation_id = p.id
left join (
  select prestation_id, sum(montant_ht) as total_depenses
  from expenses where statut in ('engagee','payee','comptabilisee')
  group by prestation_id
) de on de.prestation_id = p.id
where p.statut not in ('annulée', 'refusée');
