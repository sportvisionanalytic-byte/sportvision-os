-- ============================================================================
-- migration-clubplus-v49-production-validee-bridge.sql
-- ============================================================================
-- Spec "Médias, Livrables & Bibliothèque" (28/08/2026) — Phase 1 : le pipeline
-- de production validée (media_liens → media_livrables, gate réel réservé
-- prod/admin, confirmé par audit du 28/08/2026) et l'affichage famille Club+
-- (club_media, tableau libre-service où n'importe quel membre actif du club
-- peut coller un lien sans validation — voir club-demandes-medias-sponsors-
-- admin.js) sont aujourd'hui deux systèmes totalement déconnectés : valider
-- un livrable côté OS ne le fait jamais apparaître dans Club+.
--
-- Décision (confirmée par Fouka le 28/08/2026) : ne PAS toucher à club_media,
-- qui reste l'espace libre du club pour partager ce qu'il veut sans passage
-- par SportVision. Cette migration ajoute le pont manquant en parallèle :
-- une vue en lecture seule exposant les livrables SportVision déjà validés
-- (statut livre/consulte, même filtre que client_media_livrables) pour les
-- clubs reliés à un client CRM (clubs.portail_client_id), sur le modèle exact
-- de client_media_livrables (migration-portail-v5.sql) déjà en prod.
--
-- Écriture : aucune, jamais. Alimentée uniquement par le flux existant
-- confirmerLivraison() (SportVision-OS-Full.html), pas de nouvelle table.
-- ============================================================================

drop view if exists club_media_livrables;
create view club_media_livrables as
select
  ml.id, cl.id as club_id, ml.prestation_id, ml.nom, ml.type_livrable, ml.format,
  ml.duree, ml.nb_fichiers, ml.date_validation, ml.date_expiration, ml.instructions,
  ml.statut, ml.created_at, mlien.url as lien_url
from media_livrables ml
join prestations p on p.id = ml.prestation_id
join clubs cl on cl.portail_client_id = p.client_id
left join media_liens mlien on mlien.id = ml.lien_id
where ml.statut in ('livre', 'consulte')
  and is_club_member(cl.id);

revoke insert, update, delete, truncate on club_media_livrables from authenticated, anon;
grant select on club_media_livrables to authenticated;
