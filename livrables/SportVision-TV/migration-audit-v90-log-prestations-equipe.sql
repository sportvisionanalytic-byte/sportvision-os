-- ============================================================
-- Migration additive : étend le journal d'audit aux changements de statut de
-- prestation et d'affectation d'équipe (P0 #20 de l'audit externe du
-- 20/08/2026 — "étendre l'audit log aux actions sensibles non financières").
--
-- ── Constat ──
-- L'écran "Journal d'audit financier" (compta.audit) a déjà des boutons de
-- filtre pour 'prestations' et 'prestations_equipe' (voir filterAuditLog,
-- SportVision-OS-Full.html) — l'UI anticipait déjà ces catégories. Mais rien
-- n'écrivait dans financial_audit_log pour ces deux tables : seules les
-- actions financières (paiement, dépense, clôture...) appelaient
-- logFinancialAudit() depuis le frontend. Un changement de statut de
-- prestation ou une affectation d'équipe passait totalement inaperçu du
-- journal, alors que les boutons pour les consulter existaient déjà.
--
-- ── Ce que fait cette migration ──
-- Deux triggers AFTER (ne bloquent jamais l'opération réelle même en cas
-- d'échec du log — voir le bloc exception) :
--   - trg_log_prestation_statut : log un changement de prestations.statut.
--   - trg_log_equipe_change : log une création d'affectation
--     (prestations_equipe) et un changement de statut/rémunération dessus.
-- Utilise la table existante financial_audit_log (déjà lisible par
-- admin/compta/expert_comptable/auditeur via financial_audit_read) plutôt
-- que d'en créer une nouvelle — action/table_cible/details sont assez
-- génériques pour porter des événements non financiers.
--
-- Idempotente.
-- ============================================================

create or replace function log_prestation_statut_change()
returns trigger language plpgsql security definer as $$
begin
  if new.statut is distinct from old.statut then
    begin
      insert into financial_audit_log (acteur_id, action, table_cible, ligne_id, details)
      values (auth.uid(), 'modification', 'prestations', new.id,
        jsonb_build_object('champ','statut','avant',old.statut,'apres',new.statut,'reference',new.reference));
    exception when others then
      raise warning 'log_prestation_statut_change: échec du log (non bloquant) : %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_prestation_statut on prestations;
create trigger trg_log_prestation_statut
  after update on prestations
  for each row execute function log_prestation_statut_change();

create or replace function log_equipe_change()
returns trigger language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    begin
      insert into financial_audit_log (acteur_id, action, table_cible, ligne_id, montant_apres, details)
      values (auth.uid(), 'creation', 'prestations_equipe', new.id, new.remuneration,
        jsonb_build_object('prestation_id',new.prestation_id,'collaborateur_id',new.collaborateur_id,'fonction',new.fonction));
    exception when others then
      raise warning 'log_equipe_change (insert): échec du log (non bloquant) : %', sqlerrm;
    end;
    return new;
  end if;

  if new.statut is distinct from old.statut or new.remuneration is distinct from old.remuneration then
    begin
      insert into financial_audit_log (acteur_id, action, table_cible, ligne_id, montant_avant, montant_apres, details)
      values (auth.uid(), 'modification', 'prestations_equipe', new.id, old.remuneration, new.remuneration,
        jsonb_build_object('statut_avant',old.statut,'statut_apres',new.statut,'prestation_id',new.prestation_id,'collaborateur_id',new.collaborateur_id));
    exception when others then
      raise warning 'log_equipe_change (update): échec du log (non bloquant) : %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_equipe_change on prestations_equipe;
create trigger trg_log_equipe_change
  after insert or update on prestations_equipe
  for each row execute function log_equipe_change();

-- Le rôle prod (Responsable Production) n'était dans AUCUNE policy SELECT de financial_audit_log
-- (financial_audit_read = admin/compta/expert_comptable/auditeur uniquement) — la nouvelle section
-- "Historique" de la fiche mission (modalProdFiche) lui aurait donc été invisible malgré ce
-- correctif. Policy scopée : prod peut lire UNIQUEMENT les entrées opérationnelles (prestations/
-- prestations_equipe), jamais les catégories financières (dépenses, paiements, clôtures...) —
-- principe du moindre privilège, pas un accès large à tout le journal.
drop policy if exists financial_audit_read_prod_ops on financial_audit_log;
create policy financial_audit_read_prod_ops on financial_audit_log
  for select
  using (
    exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'prod')
    and table_cible in ('prestations', 'prestations_equipe')
  );
