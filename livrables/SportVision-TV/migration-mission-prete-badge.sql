-- Migration : vue de préparation "Mission prête" (badge auto)
-- À exécuter dans Supabase → SQL Editor.
-- EXÉCUTÉE — appliquée en base réelle le 28/08/2026 (refonte interface
-- Responsable Production, §23 "Suivi avant mission" : badge PRÊTE automatique
-- quand la checklist opérationnelle est remplie, pour éviter de relire
-- chaque fiche mission avant le week-end).
--
-- Définitions retenues (choix explicites, documentés pour ne pas les
-- redécider sans le vouloir) :
--   - opérateur_confirme : au moins une ligne prestations_equipe au statut
--     'acceptée' pour cette prestation.
--   - brief_rempli : prestations.description_besoin non vide. Pas de colonne
--     "brief envoyé" dédiée dans ce schéma (recherché, absente) — le
--     contenu réellement saisi est le signal le plus fiable disponible,
--     plus honnête qu'une case à cocher qui pourrait être cochée sans
--     contenu réel.
--   - lieu_horaire_ok : lieu ET (heure_debut OU date_prestation) renseignés.
--   - kit_ok : soit AUCUN opérateur confirmé n'a besoin de kit (tous ont
--     profiles.materiel_personnel renseigné, colonne ajoutée par
--     migration-profiles-zone-materiel-portfolio.sql), soit chaque opérateur
--     sans matériel personnel a au moins une ligne kit_reservations pour
--     cette prestation (n'importe quel statut : la simple existence d'une
--     réservation suffit à ce stade, son cycle de vie détaillé — sorti/
--     retourné/etc., statut_kit — reste géré par le module Matériel).
--   - pas_incident_ouvert : aucun incidents.cloture=false pour cette
--     prestation.
-- "Mission prête" = les 5 conditions vraies en même temps.
--
-- Vue en lecture seule (pas de colonne stockée sur prestations : recalculée
-- à chaque lecture, jamais obsolète — même principe que statut_affichage de
-- secretariat_documents). Idempotente (create or replace view).

create or replace view v_mission_prete as
select
  p.id as prestation_id,
  exists(
    select 1 from prestations_equipe pe
    where pe.prestation_id = p.id and pe.statut = 'acceptée'
  ) as operateur_confirme,
  (p.description_besoin is not null and length(trim(p.description_besoin)) > 0) as brief_rempli,
  (p.lieu is not null and length(trim(p.lieu)) > 0
    and (p.heure_debut is not null or p.date_prestation is not null)) as lieu_horaire_ok,
  not exists(
    select 1
    from prestations_equipe pe
    join profiles pr on pr.id = pe.collaborateur_id
    where pe.prestation_id = p.id
      and pe.statut = 'acceptée'
      and (pr.materiel_personnel is null or length(trim(pr.materiel_personnel)) = 0)
      and not exists(
        select 1 from kit_reservations kr
        where kr.prestation_id = p.id and kr.collaborateur_id = pe.collaborateur_id
      )
  ) as kit_ok,
  not exists(
    select 1 from incidents i where i.prestation_id = p.id and i.cloture = false
  ) as pas_incident_ouvert
from prestations p
where is_staff();

comment on view public.v_mission_prete is
  'Checklist de préparation par mission (Responsable Production, badge PRÊTE). 5 colonnes booléennes calculées, jamais stockées. "Prête" = les 5 vraies : select * from v_mission_prete where operateur_confirme and brief_rempli and lieu_horaire_ok and kit_ok and pas_incident_ouvert.';

revoke insert, update, delete, truncate on public.v_mission_prete from authenticated, anon;
grant select on public.v_mission_prete to authenticated;

-- Vérification (à exécuter manuellement après migration) :
-- select prestation_id, operateur_confirme, brief_rempli, lieu_horaire_ok, kit_ok, pas_incident_ouvert
-- from v_mission_prete limit 20;
