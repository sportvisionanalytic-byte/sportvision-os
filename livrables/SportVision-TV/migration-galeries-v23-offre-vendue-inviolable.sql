-- Migration : une offre déjà vendue ne peut plus être supprimée
-- À exécuter APRÈS migration-galeries-v22-attribution-preservee.sql.
--
-- ── Ce que la v22 ne couvrait pas ──
-- La v22 a appris à media_link_save à ne plus supprimer une offre déjà vendue. C'est le bon
-- comportement, mais ça ne protège que ce chemin-là : une suppression directe en SQL, une future
-- fonction d'administration, un script de nettoyage, et `ON DELETE SET NULL` efface à nouveau
-- l'attribution de ventes réelles — en silence, et sans possibilité de reconstituer la donnée.
--
-- Une règle qu'on ne peut pas violer vaut mieux qu'une règle qu'on se rappelle de respecter.
-- `ON DELETE RESTRICT` refuse la suppression tant qu'une commande référence l'offre. Ce n'est pas
-- une gêne : une offre qui a vendu n'a aucune raison de disparaître, elle se désactive.
--
-- media_link_save reste compatible : depuis la v22, elle ne supprime que les offres sans vente.

begin;

alter table media_orders
  drop constraint if exists media_orders_offer_id_fkey;

alter table media_orders
  add constraint media_orders_offer_id_fkey
  foreign key (offer_id) references media_album_link_offers(id) on delete restrict;

comment on column media_orders.offer_id is
  'Offre choisie par l''acheteur. En ON DELETE RESTRICT : une offre qui a vendu ne peut plus être supprimée, sinon le chiffre d''affaires réellement encaissé perdrait sa ventilation sans qu''on puisse la reconstituer. Une offre qu''on ne veut plus proposer se désactive.';

-- Même raisonnement pour le lien : c'est lui qui porte l'attribution commerciale d'une vente.
alter table media_orders
  drop constraint if exists media_orders_link_id_fkey;

alter table media_orders
  add constraint media_orders_link_id_fkey
  foreign key (link_id) references media_album_links(id) on delete restrict;

comment on column media_orders.link_id is
  'Lien qui a réellement créé le paiement — pas le dernier lien consulté. En ON DELETE RESTRICT pour la même raison que offer_id : un lien qui a vendu se désactive, il ne se supprime pas.';

commit;
