-- Migration : exclure sec/prod de la vue v_rentabilite_missions (marge/CA)
-- À exécuter dans Supabase → SQL Editor.
-- EXÉCUTÉE — appliquée en base réelle le 28/08/2026 (refonte interfaces
-- Secrétaire ET Responsable Production, les deux specs excluent explicitement
-- la rentabilité/marge de ces deux rôles : "Finance globale : Non" (tableau
-- permissions Secrétaire, §32) et "Le coût n'a pas besoin d'être affiché au
-- Responsable Production" + "Aucune finance stratégique" (§35/§36 Production).
--
-- La vue actuelle (dernière définition : migration-audit-25-08-corrections-
-- batch1.sql:94) filtre uniquement par `is_staff()`, qui inclut
-- ('admin','sec','prod','photo','cm','compta','com') — donc masquer le
-- bouton/onglet côté UI (SportVision-OS-Full.html) ne suffit pas : n'importe
-- quel compte 'sec' ou 'prod' authentifié peut aujourd'hui lire revenu_ht/
-- marge_nette directement via GET /rest/v1/v_rentabilite_missions, y compris
-- des agrégats globaux (ex. loadSecRapports, prod.rapports) sans passer par
-- aucun écran restreint. Cette migration ajoute une exclusion explicite de
-- ces deux rôles, sans toucher aux autres (photo/cm/com/compta/admin
-- continuent d'avoir exactement le même accès qu'avant — hors périmètre de
-- cette refonte, non auditée ici, à ne pas modifier sans un audit dédié).
--
-- Propriété : la vue redevient vide (0 ligne) pour sec/prod au lieu de
-- renvoyer des montants — comportement volontairement silencieux (pas
-- d'erreur 403) pour ne pas casser les écrans existants qui l'appellent déjà
-- (ex. loadClientRentabilite dans la fiche client, partagée admin/sec) :
-- l'admin continue de voir les vrais chiffres, la secrétaire voit "Aucune
-- mission chiffrée pour ce client" — message déjà géré par le code existant
-- pour le cas "liste vide", donc aucun changement de comportement visible
-- côté UI au-delà de la disparition des montants pour ce rôle.

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
  (coalesce((select cost_allocations.valeur from cost_allocations where cost_allocations.actif = true and cost_allocations.methode = 'forfait_par_mission' limit 1), 0::numeric)
    + (coalesce(p.montant_ht, 0::numeric) * coalesce((select cost_allocations.valeur from cost_allocations where cost_allocations.actif = true and cost_allocations.methode = 'pourcentage_ca' limit 1), 0::numeric) / 100.0)
  ) as cout_indirect_alloue,
  ((((coalesce(p.montant_ht, 0::numeric) - coalesce(re.total_remunerations, 0::numeric)) - coalesce(fr.total_frais, 0::numeric)) - coalesce(de.total_depenses, 0::numeric))
    - (coalesce((select cost_allocations.valeur from cost_allocations where cost_allocations.actif = true and cost_allocations.methode = 'forfait_par_mission' limit 1), 0::numeric)
      + (coalesce(p.montant_ht, 0::numeric) * coalesce((select cost_allocations.valeur from cost_allocations where cost_allocations.actif = true and cost_allocations.methode = 'pourcentage_ca' limit 1), 0::numeric) / 100.0))
  ) as marge_nette
from prestations p
  left join clients c on c.id = p.client_id
  left join (
    select prestation_id, sum(remuneration) as total_remunerations
    from prestations_equipe where statut = 'acceptée' group by prestation_id
  ) re on re.prestation_id = p.id
  left join (
    select prestation_id, sum(montant) as total_frais
    from frais where statut = any (array['validé','remboursé']) group by prestation_id
  ) fr on fr.prestation_id = p.id
  left join (
    select prestation_id, sum(montant_ht) as total_depenses
    from expenses where statut = any (array['engagee','payee','comptabilisee']) group by prestation_id
  ) de on de.prestation_id = p.id
where p.statut <> all (array['annulée','refusée']::statut_prestation[])
  and is_staff()
  and not exists (select 1 from profiles where id = auth.uid() and role in ('sec','prod'));

-- Vérification (à exécuter manuellement après migration) :
-- Se connecter en tant que compte 'sec' ou 'prod' réel et vérifier que
-- GET /rest/v1/v_rentabilite_missions renvoie [] quel que soit le filtre.
