-- ============================================================
-- SPORTVISION PORTAIL — Migration v5
-- La vue client_media_livrables ne remontait pas le lien externe réel (il vit sur
-- media_liens, référencé par media_livrables.lien_id) : le client voyait le nom du
-- livrable et sa date d'expiration mais n'avait rien de cliquable pour l'ouvrir.
-- Idempotente. À exécuter après migration-portail-v4.sql.
-- ============================================================

drop view if exists client_media_livrables;
create view client_media_livrables as
select
  ml.id, ml.prestation_id, ml.nom, ml.type_livrable, ml.format, ml.duree,
  ml.nb_fichiers, ml.date_validation, ml.date_expiration, ml.instructions, ml.statut,
  ml.created_at, mlien.url as lien_url
from media_livrables ml
join prestations p on p.id = ml.prestation_id
left join media_liens mlien on mlien.id = ml.lien_id
where ml.statut in ('livre','consulte')
  and exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = p.client_id);
