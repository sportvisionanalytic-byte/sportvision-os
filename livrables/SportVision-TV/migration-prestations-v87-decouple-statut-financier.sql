-- ============================================================
-- Migration additive : découple prestations.statut (opérationnel) des
-- valeurs financières (INC-021, audit externe du 20/08/2026).
--
-- ── Constat ──
-- La chaîne de transitions autorisées par validate_prestation_statut_
-- transition() (migration-prestations-transitions-statut.sql) fait
-- passer `statut` par 'livrée' → 'facturée' → 'partiellement_payée' →
-- 'payée' → 'clôturée' : des valeurs financières empruntées à la même
-- colonne que le statut opérationnel, alors que prestations.statut_
-- financier (et maintenant la table factures) suit déjà et correctement
-- ces mêmes informations séparément. Conséquence concrète, confirmée par
-- un audit externe ayant eu accès pour la première fois à de vraies
-- données via les pages /demo/<module> : une prestation peut afficher
-- statut='payée' comme si "payée" était une étape de production.
--
-- Vérifié avant d'écrire cette migration (pas une supposition) :
--   - SELECT statut, count(*) FROM prestations GROUP BY statut → une
--     seule valeur en production au 20/08/2026 : 'demande_reçue' (2
--     lignes). Aucune ligne réelle n'est actuellement dans un état
--     'facturée'/'partiellement_payée'/'payée' sur la colonne statut —
--     cette migration ne modifie donc aucune donnée existante.
--   - Aucun appel direct dans SportVision-OS-Full.html n'écrit ces
--     valeurs sur `statut` ailleurs que via _NEXT_ST (déjà corrigé côté
--     frontend le 20/08 : 'livrée' pointe maintenant directement vers
--     'clôturée').
--
-- ── Ce que fait cette migration ──
-- Retire uniquement les 4 arêtes livrée→facturée→partiellement_payée→
-- payée→clôturée de la table de transitions, et ajoute livrée→clôturée
-- directement. Ne touche PAS l'enum Postgres statut_prestation lui-même
-- (Postgres ne sait pas retirer proprement une valeur d'enum sans
-- recréer le type ; les valeurs 'facturée'/'partiellement_payée'/'payée'
-- restent des valeurs valides de l'enum, simplement plus jamais
-- atteignables par une transition autorisée à partir de maintenant).
-- Le reste de la table de transitions est copié à l'identique.
--
-- Idempotente (create or replace + drop/create trigger).
-- ============================================================

create or replace function validate_prestation_statut_transition()
returns trigger language plpgsql security definer as $$
declare
  is_known_transition boolean;
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.statut is distinct from old.statut then

    if new.statut = 'annulée' and old.statut not in ('clôturée','annulée') then
      return new;
    end if;

    is_known_transition := (
      (old.statut = 'demande_reçue' and new.statut = 'à_qualifier')
      or (old.statut = 'à_qualifier' and new.statut = 'offre_en_préparation')
      or (old.statut = 'offre_en_préparation' and new.statut = 'devis_envoyé')
      or (old.statut = 'devis_envoyé' and new.statut = 'en_attente_réponse')
      or (old.statut = 'en_attente_réponse' and new.statut = 'devis_accepté')
      or (old.statut = 'devis_accepté' and new.statut = 'en_attente_signature')
      or (old.statut = 'en_attente_signature' and new.statut = 'en_attente_acompte')
      or (old.statut = 'en_attente_acompte' and new.statut = 'documents_complets')
      or (old.statut = 'documents_complets' and new.statut = 'à_valider_production')
      or (old.statut = 'à_valider_production' and new.statut = 'confirmée')
      or (old.statut = 'confirmée' and new.statut = 'à_planifier')
      or (old.statut = 'à_planifier' and new.statut = 'planifiée')
      or (old.statut = 'planifiée' and new.statut = 'équipe_affectée')
      or (old.statut = 'équipe_affectée' and new.statut = 'prête')
      or (old.statut = 'prête' and new.statut = 'équipe_en_route')
      or (old.statut = 'équipe_en_route' and new.statut = 'arrivée_sur_place')
      or (old.statut = 'arrivée_sur_place' and new.statut = 'production_démarrée')
      or (old.statut = 'production_démarrée' and new.statut = 'production_terminée')
      or (old.statut = 'production_terminée' and new.statut = 'médias_à_transférer')
      or (old.statut = 'médias_à_transférer' and new.statut = 'médias_complets')
      or (old.statut = 'médias_complets' and new.statut = 'à_monter')
      or (old.statut = 'à_monter' and new.statut = 'montage_en_cours')
      or (old.statut = 'montage_en_cours' and new.statut = 'prêt_validation')
      or (old.statut = 'prêt_validation' and new.statut = 'à_valider_client')
      or (old.statut = 'à_valider_client' and new.statut = 'prête_à_livrer')
      or (old.statut = 'prête_à_livrer' and new.statut = 'livrée')
      -- Correctif INC-021 (20/08) : 'livrée' → 'clôturée' directement.
      -- Les anciennes arêtes livrée→facturée→partiellement_payée→payée→
      -- clôturée sont supprimées : ces 3 valeurs intermédiaires étaient
      -- financières, pas opérationnelles (voir statut_financier/factures).
      or (old.statut = 'livrée' and new.statut = 'clôturée')
      or (old.statut = 'demande_reçue' and new.statut = 'offre_en_préparation')
      or (old.statut = 'demande_reçue' and new.statut = 'devis_envoyé')
      or (old.statut = 'à_qualifier' and new.statut = 'devis_envoyé')
      or (old.statut = 'prêt_validation' and new.statut = 'livrée')
      or (old.statut = 'à_valider_production' and new.statut = 'refusée')
      or (old.statut = 'confirmée' and new.statut = 'équipe_en_route')
      or (old.statut = 'équipe_affectée' and new.statut = 'équipe_en_route')
      or (old.statut = 'planifiée' and new.statut = 'équipe_en_route')
      or (old.statut = 'prête' and new.statut = 'production_démarrée')
    );

    if not is_known_transition then
      raise exception 'Transition de statut non autorisée : % → % ne correspond à aucun enchaînement connu du workflow.', old.statut, new.statut;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_prestation_statut_transition on prestations;
create trigger trg_validate_prestation_statut_transition
  before update on prestations
  for each row execute function validate_prestation_statut_transition();
