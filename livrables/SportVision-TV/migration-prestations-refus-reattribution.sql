-- ============================================================================
-- migration-prestations-refus-reattribution.sql
-- ============================================================================
-- Spec Prestations/Missions (28/08/2026), section 9 : "Un refus renvoie
-- automatiquement la mission dans « À attribuer »." Confirmé par audit du
-- 28/08/2026 : repondreInvitation() (SportVision-OS-Full.html) fait déjà
-- avancer prestations.statut planifiée→équipe_affectée à l'acceptation, mais
-- AUCUN chemin retour n'existe au refus — et le trigger serveur
-- validate_prestation_statut_transition() n'autorise strictement AUCUNE
-- transition arrière aujourd'hui (vérifié en lisant sa définition complète).
--
-- Cette migration ajoute UNE seule arête supplémentaire à
-- validate_prestation_statut_transition(), purement additive (create or
-- replace, ne retire aucune arête existante) : équipe_affectée → planifiée.
-- C'est la seule transition arrière nécessaire pour ce cas (repondreInvitation
-- ne fait avancer que depuis 'planifiée', donc c'est le seul état dont il faut
-- pouvoir revenir).
--
-- DÉCOUVERTE EN TESTANT (compte de test jetable réel, pas une simulation) :
-- il existe un DEUXIÈME trigger, protect_prestation_operational_fields(), qui
-- restreint séparément quelles transitions de statut un simple collaborateur
-- affecté (non admin/sec/prod/compta) a le droit de déclencher lui-même. Sa
-- liste `is_valid_transition` ne contenait PAS 'planifiée'→'équipe_affectée'
-- — la transition que repondreInvitation() est censée déclencher
-- automatiquement à l'acceptation d'une mission (commentaire du 28/08/2026
-- dans le code, "il reçoit, il accepte"). Conséquence réelle : ce PATCH
-- échouait silencieusement pour tout compte photographe/vidéaste non staff
-- depuis son introduction (le `.catch(()=>{})` du code avalait l'erreur) —
-- confirmé avec un compte de test jetable réel avant ce correctif. Cette
-- migration ajoute donc AUSSI les deux arêtes nécessaires à
-- protect_prestation_operational_fields() : planifiée→équipe_affectée
-- (acceptation, corrige un bug silencieux préexistant) et
-- équipe_affectée→planifiée (refus, le nouveau besoin).
-- ============================================================================

create or replace function validate_prestation_statut_transition()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
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
      -- Ajout 28/08/2026 (migration-prestations-refus-reattribution.sql) :
      -- un opérateur qui refuse une mission déjà à 'équipe_affectée' (et
      -- qu'aucun autre opérateur n'est resté 'acceptée' dessus, vérifié côté
      -- JS avant ce PATCH) doit pouvoir revenir en attribution.
      or (old.statut = 'équipe_affectée' and new.statut = 'planifiée')
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

-- ── Second trigger : droits du collaborateur affecté (non staff) ───────────
-- Voir le commentaire de tête : ajoute planifiée→équipe_affectée (corrige un
-- bug silencieux préexistant, l'acceptation d'une mission n'avançait jamais
-- réellement le statut pour un compte non staff) et équipe_affectée→planifiée
-- (nouveau : le refus renvoie en attribution).
create or replace function protect_prestation_operational_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  is_privileged boolean;
  is_valid_transition boolean;
begin
  if auth.uid() is null then
    return new;
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin','sec','prod','compta')
  ) into is_privileged;

  if is_privileged then
    return new;
  end if;

  if new.lieu is distinct from old.lieu
     or new.adresse_complete is distinct from old.adresse_complete
     or new.contact_sur_place is distinct from old.contact_sur_place
     or new.telephone_sur_place is distinct from old.telephone_sur_place
     or new.date_prestation is distinct from old.date_prestation
     or new.heure_debut is distinct from old.heure_debut
     or new.heure_fin is distinct from old.heure_fin
     or new.heure_rdv is distinct from old.heure_rdv
     or new.type_prestation is distinct from old.type_prestation
     or new.reference is distinct from old.reference
     or new.description_besoin is distinct from old.description_besoin
     or new.livrables_demandes is distinct from old.livrables_demandes
     or new.notes_internes is distinct from old.notes_internes
     or new.sport is distinct from old.sport
     or new.equipes is distinct from old.equipes
     or new.responsable_prod_id is distinct from old.responsable_prod_id
     or new.responsable_prestation_id is distinct from old.responsable_prestation_id
  then
    raise exception 'Modification non autorisée : le lieu, l''horaire et les informations de mission d''une prestation sont réservés au secrétariat/à la production.';
  end if;

  if new.statut is distinct from old.statut then
    is_valid_transition := (
      (old.statut = 'planifiée' and new.statut = 'équipe_affectée')
      or (old.statut = 'équipe_affectée' and new.statut = 'planifiée')
      or (old.statut = 'confirmée' and new.statut = 'équipe_en_route')
      or (old.statut = 'équipe_affectée' and new.statut = 'équipe_en_route')
      or (old.statut = 'planifiée' and new.statut = 'équipe_en_route')
      or (old.statut = 'prête' and new.statut = 'équipe_en_route')
      or (old.statut = 'prête' and new.statut = 'production_démarrée')
      or (old.statut = 'équipe_en_route' and new.statut = 'arrivée_sur_place')
      or (old.statut = 'arrivée_sur_place' and new.statut = 'production_démarrée')
      or (old.statut = 'production_démarrée' and new.statut = 'production_terminée')
      or (old.statut = 'production_terminée' and new.statut = 'médias_à_transférer')
      or (old.statut = 'médias_à_transférer' and new.statut = 'médias_complets')
    );
    if not is_valid_transition then
      raise exception 'Modification non autorisée : ce changement de statut n''est pas ouvert au collaborateur affecté (réservé au secrétariat/à la production).';
    end if;
  end if;

  return new;
end;
$$;
