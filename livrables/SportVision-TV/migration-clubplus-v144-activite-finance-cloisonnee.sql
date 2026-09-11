-- v144 : le fil d'activité ne montre l'argent qu'à ceux qui ont le droit de le voir (11/09/2026).
--
-- Trouvé en balayant l'OS. Le fil d'activité recopie chaque mouvement financier avec son montant
-- (fanout_financial_audit_to_activity_log) : rémunération d'un opérateur, prix d'une mission,
-- facture, avoir, commission, provision d'impôt. La policy actlog_staff_select le rendait lisible
-- par admin, secrétariat, comptabilité, commercial et Production, sans autre condition.
-- Résultat : le commercial lisait toutes les rémunérations et toute la finance, la Production
-- celles de tous les pôles. Contraire à la frontière du 10/09 (v129).
--
-- Règle, sur les seules lignes « finance » :
--   • admin, secrétariat, comptabilité (et expert-comptable, auditeur) : tout, comme avant ;
--   • Production : les lignes d'une mission (prix, rémunérations) qu'elle a le droit de chiffrer,
--     c'est-à-dire peut_voir_couts_mission, la même règle que partout ailleurs ;
--   • tous les autres : rien.
-- Les autres catégories (recrutement, signature…) ne sont pas touchées.
-- Policy RESTRICTIVE : elle s'ajoute aux policies existantes sans en élargir aucune.
-- Test : tests/activite-finance-cloisonnee.test.sql

drop policy if exists actlog_finance_cloisonnee on public.activity_log;
create policy actlog_finance_cloisonnee on public.activity_log
  as restrictive for select to authenticated
  using (
    categorie is distinct from 'finance'
    or exists (select 1 from profiles p where p.id = auth.uid()
                and p.role in ('admin', 'sec', 'compta', 'expert_comptable', 'auditeur'))
    or (entity_type = 'prestations' and peut_voir_couts_mission(entity_id))
    or (entity_type = 'prestations_equipe'
        and peut_voir_couts_mission((select pe.prestation_id from prestations_equipe pe where pe.id = entity_id)))
  );
