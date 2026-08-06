-- SportVision OS — Finance & Comptabilité, Immobilisations
-- La table `materiels` (migration-kits-v2.sql) a déjà valeur/date_achat —
-- pas besoin d'une nouvelle table de suivi opérationnel, juste ce qui manque
-- pour une lecture financière (durée d'amortissement + accès en lecture
-- pour l'expert-comptable/auditeur, absents des policies actuelles).

alter table materiels add column if not exists duree_amortissement_mois integer default 36;

drop policy if exists "materiels_finance_read" on materiels;
create policy "materiels_finance_read" on materiels for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('expert_comptable','auditeur'))
);
