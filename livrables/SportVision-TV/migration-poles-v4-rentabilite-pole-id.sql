-- migration-poles-v4-rentabilite-pole-id.sql
--
-- Migration multi-pôles (Football + Basket), Lot 4 — Navigation/Dashboard.
-- Ajoute p.pole_id à v_rentabilite_missions (vue centrale de CA/marge,
-- utilisée par loadAdminDash() et loadComptaResultat()) — nécessaire au
-- comparatif Football/Basket du dashboard Direction, et servira aussi de
-- base à la ventilation finance du Lot 6.
--
-- Additif pur (une colonne de plus, source jointe déjà présente via
-- prestations.pole_id, migration-poles-v2). Aucune autre colonne/logique de
-- la vue touchée — copie exacte de la définition actuelle (vérifiée en
-- direct le 31/08/2026 via pg_get_viewdef) + p.pole_id ajouté au SELECT.
--
-- Idempotente (CREATE OR REPLACE VIEW). Rollback : réexécuter cette même
-- définition sans la ligne finale "p.pole_id AS pole_id" (la définition
-- d'origine complète est reconstituable en retirant uniquement cette
-- ligne — placée en DERNIÈRE position du SELECT, comme l'exige Postgres
-- pour un CREATE OR REPLACE VIEW qui ajoute une colonne sans toucher aux
-- colonnes existantes : les nouvelles colonnes ne peuvent être ajoutées
-- qu'en fin de liste, jamais insérées entre deux colonnes déjà exposées).

create or replace view v_rentabilite_missions as
select
  p.id as prestation_id,
  p.reference,
  p.type_prestation,
  p.client_id,
  c.nom as client_nom,
  p.date_prestation,
  p.statut_financier,
  coalesce(p.montant_ht, 0::numeric) as revenu_ht,
  coalesce(re.total_remunerations, 0::numeric) as cout_remunerations,
  coalesce(fr.total_frais, 0::numeric) as cout_frais,
  coalesce(de.total_depenses, 0::numeric) as cout_depenses_directes,
  coalesce((select cost_allocations.valeur from cost_allocations where cost_allocations.actif = true and cost_allocations.methode = 'forfait_par_mission'::text limit 1), 0::numeric)
    + coalesce(p.montant_ht, 0::numeric) * coalesce((select cost_allocations.valeur from cost_allocations where cost_allocations.actif = true and cost_allocations.methode = 'pourcentage_ca'::text limit 1), 0::numeric) / 100.0
    as cout_indirect_alloue,
  coalesce(p.montant_ht, 0::numeric)
    - coalesce(re.total_remunerations, 0::numeric)
    - coalesce(fr.total_frais, 0::numeric)
    - coalesce(de.total_depenses, 0::numeric)
    - (coalesce((select cost_allocations.valeur from cost_allocations where cost_allocations.actif = true and cost_allocations.methode = 'forfait_par_mission'::text limit 1), 0::numeric)
       + coalesce(p.montant_ht, 0::numeric) * coalesce((select cost_allocations.valeur from cost_allocations where cost_allocations.actif = true and cost_allocations.methode = 'pourcentage_ca'::text limit 1), 0::numeric) / 100.0)
    as marge_nette,
  p.pole_id
from prestations p
  left join clients c on c.id = p.client_id
  left join (
    select prestations_equipe.prestation_id, sum(prestations_equipe.remuneration) as total_remunerations
    from prestations_equipe
    where prestations_equipe.statut = 'acceptée'::statut_affectation
    group by prestations_equipe.prestation_id
  ) re on re.prestation_id = p.id
  left join (
    select frais.prestation_id, sum(frais.montant) as total_frais
    from frais
    where frais.statut = any (array['validé'::text, 'remboursé'::text])
    group by frais.prestation_id
  ) fr on fr.prestation_id = p.id
  left join (
    select expenses.prestation_id, sum(expenses.montant_ht) as total_depenses
    from expenses
    where expenses.statut = any (array['engagee'::text, 'payee'::text, 'comptabilisee'::text])
    group by expenses.prestation_id
  ) de on de.prestation_id = p.id
where (p.statut <> all (array['annulée'::statut_prestation, 'refusée'::statut_prestation]))
  and is_staff()
  and not (exists (select 1 from profiles where profiles.id = auth.uid() and (profiles.role = any (array['sec'::text, 'prod'::text]))));
