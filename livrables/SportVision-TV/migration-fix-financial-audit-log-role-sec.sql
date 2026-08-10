-- ── Fix régression QA du 10/08 (audit visuel post-fusion nocturne) ──────────
-- Le commit d549fc6e ("trace secConfirmerPaye dans le journal d'audit
-- financier") a ajouté un appel logFinancialAudit(...) dans secConfirmerPaye
-- (SportVision-OS-Full.html ~17624), déclenché depuis l'écran Relances par le
-- rôle 'sec' (bouton "Payé" conditionnel, encaissement confirmé côté
-- secrétariat). Mais la policy RLS "financial_audit_insert" définie dans
-- migration-finance-lot0.sql (~197) n'autorise que role in ('admin','compta').
--
-- Constat en test réel (compte QA jetable, rôle sec) : le PATCH sur
-- prestations.statut_financier='payée' réussit bien, mais l'insert dans
-- financial_audit_log échoue silencieusement avec une erreur RLS 42501 (le
-- code intercepte l'erreur et se contente d'un console.error, donc rien ne
-- casse visuellement — mais le journal d'audit financier reste incomplet
-- pour tout encaissement confirmé par le secrétariat).
--
-- Le rôle 'sec' a déjà le droit d'écrire directement sur prestations pour
-- cette action (PATCH statut_financier) ; il est donc cohérent qu'il puisse
-- aussi tracer cette même action dans le journal d'audit, au même titre que
-- comptaConfirmerImpaye/majStatutFinancier pour compta.
--
-- Cette migration ne fait qu'élargir la policy d'INSERT à 'sec', sans
-- toucher à la policy de lecture (financial_audit_read reste réservée à
-- admin/compta/expert_comptable/auditeur — 'sec' n'a pas d'écran pour
-- consulter ce journal).

drop policy if exists "financial_audit_insert" on financial_audit_log;
create policy "financial_audit_insert" on financial_audit_log for insert with check (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta','sec'))
);
