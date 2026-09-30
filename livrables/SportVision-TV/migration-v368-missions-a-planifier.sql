-- v368 : UNE PRESTATION VENDUE MAIS PAS ENCORE PLANIFIEE ETAIT INVISIBLE (30/09/2026)
--
-- Fouka : « j'ai ecrit une mission, et mon responsable production ne voit pas la prestation qui a
-- ete prise, pour qu'il puisse affecter ».
--
-- CE N'ETAIT PAS UN PROBLEME DE DROITS, et c'est ce qui rendait le defaut difficile a voir :
-- mesure avec l'identite du responsable, `is_staff()` vrai, `pole_scope_ok()` vrai, et les deux
-- missions du 3 octobre BIEN PRESENTES dans `v_production_missions`. La base les lui donnait.
--
-- LE DEFAUT ETAIT DANS LE RANGEMENT. Le `CASE` de cette vue ne nomme que dix-neuf statuts sur
-- trente-trois ; les quatorze autres tombent dans « autres », et le cockpit de l'OS n'affiche
-- JAMAIS ce groupe — il en dessine sept, « autres » n'en fait pas partie. Une mission qui y tombe
-- n'apparait donc nulle part, sans erreur, sans compteur, sans rien a comprendre.
--
-- Parmi ces quatorze : `demande_reçue`, `à_qualifier`, `à_valider_production`, `devis_accepté`,
-- `documents_complets`, `confirmée`, `à_planifier`. C'est-a-dire EXACTEMENT les etats d'une
-- prestation vendue et pas encore planifiee, le moment ou la Production doit s'en saisir pour
-- affecter une equipe.
--
-- CE QU'ON N'Y MET PAS, et c'est deliberе : `offre_en_préparation`, `devis_envoyé`,
-- `en_attente_réponse`, `en_attente_signature`, `en_attente_acompte`, `partiellement_payée`,
-- `refusée`, `annulée`. Ce sont des etats commerciaux ou financiers : la Production n'a rien a y
-- faire, et les lui montrer gonflerait un compteur d'actions avec des missions ou il n'y a rien a
-- faire — le defaut que le cockpit evite deja pour la post-production.

create or replace view public.v_production_missions as
 SELECT p.id AS prestation_id,
    p.reference,
    p.statut,
    p.couverture,
    p.date_prestation,
    p.heure_debut,
    p.heure_rdv,
    p.lieu,
    p.pole_id,
    p.responsable_prod_id,
    p.deadline_photo_at,
    p.deadline_video_at,
    c.nom AS client_nom,
        CASE
            WHEN p.statut = ANY (ARRAY['clôturée'::statut_prestation, 'payée'::statut_prestation, 'facturée'::statut_prestation]) THEN 'terminees'::text
            WHEN p.statut = 'annulée'::statut_prestation THEN 'annulees'::text
            WHEN (EXISTS ( SELECT 1
               FROM media_liens ml
              WHERE ml.prestation_id = p.id AND ml.statut = 'correction_demandee'::text)) THEN 'corrections'::text
            WHEN p.statut = ANY (ARRAY['prêt_validation'::statut_prestation, 'à_valider_client'::statut_prestation, 'prête_à_livrer'::statut_prestation, 'livrée'::statut_prestation]) THEN 'a_verifier'::text
            WHEN p.statut = ANY (ARRAY['équipe_en_route'::statut_prestation, 'arrivée_sur_place'::statut_prestation, 'production_démarrée'::statut_prestation]) THEN 'terrain'::text
            WHEN p.statut = ANY (ARRAY['production_terminée'::statut_prestation, 'médias_à_transférer'::statut_prestation, 'médias_complets'::statut_prestation, 'à_monter'::statut_prestation, 'montage_en_cours'::statut_prestation]) THEN 'post_production'::text
            WHEN (EXISTS ( SELECT 1
               FROM prestations_equipe pe
              WHERE pe.prestation_id = p.id AND (pe.statut = ANY (ARRAY['invitation_envoyée'::statut_affectation, 'en_attente'::statut_affectation])))) THEN 'attente_acceptation'::text
            WHEN p.statut = ANY (ARRAY['demande_reçue'::statut_prestation, 'à_qualifier'::statut_prestation, 'à_valider_production'::statut_prestation, 'devis_accepté'::statut_prestation, 'documents_complets'::statut_prestation, 'confirmée'::statut_prestation, 'à_planifier'::statut_prestation]) THEN 'a_planifier'::text
            WHEN p.statut = ANY (ARRAY['planifiée'::statut_prestation, 'équipe_affectée'::statut_prestation, 'prête'::statut_prestation]) THEN 'a_venir'::text
            ELSE 'autres'::text
        END AS groupe,
    ( SELECT min(pe.created_at) AS min
           FROM prestations_equipe pe
          WHERE pe.prestation_id = p.id AND (pe.statut = ANY (ARRAY['invitation_envoyée'::statut_affectation, 'en_attente'::statut_affectation]))) AS invitation_depuis,
    ( SELECT string_agg((COALESCE(pr.prenom, ''::text) || ' '::text) || COALESCE(pr.nom, ''::text), ', '::text) AS string_agg
           FROM prestations_equipe pe
             JOIN profiles pr ON pr.id = pe.collaborateur_id
          WHERE pe.prestation_id = p.id AND pe.statut = 'acceptée'::statut_affectation) AS operateurs,
    ( SELECT max(mso.arrive_at) AS max
           FROM mission_suivi_operateur mso
          WHERE mso.prestation_id = p.id) AS arrive_at,
    ( SELECT max(mso.livre_at) AS max
           FROM mission_suivi_operateur mso
          WHERE mso.prestation_id = p.id) AS livre_at,
    ( SELECT count(*) AS count
           FROM media_liens ml
          WHERE ml.prestation_id = p.id AND ml.type_media = 'photo'::text AND ml.categorie = 'final'::text) AS nb_photos,
    ( SELECT count(*) AS count
           FROM media_liens ml
          WHERE ml.prestation_id = p.id AND ml.type_media = 'video'::text AND ml.categorie = 'final'::text) AS nb_montages,
    ( SELECT count(*) AS count
           FROM media_liens ml
          WHERE ml.prestation_id = p.id AND ml.categorie = 'rushs'::text) AS nb_rushs,
    (EXISTS ( SELECT 1
           FROM media_liens ml
          WHERE ml.prestation_id = p.id AND ml.transfert_confirme IS TRUE)) AS transfert_confirme,
    ( SELECT kt.nom
           FROM kit_reservations kr
             JOIN kits kt ON kt.id = kr.kit_id
          WHERE kr.prestation_id = p.id AND (kr.statut <> ALL (ARRAY['retourné'::statut_kit, 'en_contrôle'::statut_kit]))
         LIMIT 1) AS kit_nom,
    ( SELECT kr.date_retour_prevue
           FROM kit_reservations kr
          WHERE kr.prestation_id = p.id AND (kr.statut <> ALL (ARRAY['retourné'::statut_kit, 'en_contrôle'::statut_kit]))
         LIMIT 1) AS kit_retour_prevu,
    (EXISTS ( SELECT 1
           FROM incidents i
          WHERE i.prestation_id = p.id AND i.cloture = false)) AS incident_ouvert,
    p.deadline_photo_at IS NOT NULL AND p.deadline_photo_at < now() AND (p.couverture = ANY (ARRAY['photo'::text, 'photo_video'::text])) AND NOT (EXISTS ( SELECT 1
           FROM media_liens ml
          WHERE ml.prestation_id = p.id AND ml.type_media = 'photo'::text AND ml.categorie = 'final'::text AND ml.statut = 'valide'::text)) OR p.deadline_video_at IS NOT NULL AND p.deadline_video_at < now() AND (p.couverture = ANY (ARRAY['video'::text, 'photo_video'::text])) AND NOT (EXISTS ( SELECT 1
           FROM media_liens ml
          WHERE ml.prestation_id = p.id AND ml.type_media = 'video'::text AND ml.categorie = 'final'::text AND ml.statut = 'valide'::text)) AS livraison_en_retard,
    (p.couverture = ANY (ARRAY['photo'::text, 'photo_video'::text])) AND p.deadline_photo_at IS NULL OR (p.couverture = ANY (ARRAY['video'::text, 'photo_video'::text])) AND p.deadline_video_at IS NULL AS echeance_manquante,
    mission_cloture_manquant(p.id) AS cloture_manquant,
    ( SELECT mp.operateur_confirme AND mp.brief_rempli AND mp.lieu_horaire_ok AND mp.kit_ok AND mp.pas_incident_ouvert
           FROM v_mission_prete mp
          WHERE mp.prestation_id = p.id) AS mission_prete
   FROM prestations p
     LEFT JOIN clients c ON c.id = p.client_id
  WHERE is_staff() AND pole_scope_ok(p.pole_id);;
