-- Migration : Galeries — aucune limite artificielle sur les offres d'un lien
-- À exécuter APRÈS migration-galeries-v15-devis-multi-offres.sql.
--
-- ── Le défaut ──
-- La v14 posait `unique (link_id, product_id)`, avec ce raisonnement : deux fois le même produit
-- sur un lien, ce sont deux prix pour la même chose, et le visiteur ne saurait pas choisir.
--
-- Ce raisonnement était faux. Depuis que l'OFFRE porte son propre quota, son propre prix et son
-- propre libellé, le produit du catalogue n'est plus qu'un TYPE : « sélection de photos ». Un même
-- produit « Pack photos » doit pouvoir servir autant de fois qu'on veut sur un lien :
--
--     5 photos  →  5 €
--    10 photos  →  8 €
--    20 photos  → 12 €
--    35 photos  → 18 €
--    60 photos  → 25 €
--
-- Avec la contrainte, il aurait fallu créer cinq produits au catalogue pour un seul tournoi, puis
-- cinq autres au tournoi suivant avec d'autres quantités. Le catalogue serait devenu un dépotoir,
-- et le nombre d'offres proposables aurait dépendu du nombre de produits créés à l'avance —
-- exactement la limite qu'on ne veut pas.
--
-- Ce qui distingue deux offres n'est pas leur produit, c'est leur quota, leur prix et leur nom,
-- qui vivent tous sur l'offre. On supprime donc la contrainte.
--
-- ── Ce qui reste vrai ──
--   * aucun tarif, aucun quota, aucun nombre d'offres n'est écrit dans le code ;
--   * une offre à 0 € est valide (price >= 0) : une galerie peut être offerte ;
--   * `album_complet` reste facultatif : un lien peut ne vendre que des sélections ;
--   * un lien peut n'avoir aucune offre : c'est une galerie de consultation.

begin;

alter table media_album_link_offers
  drop constraint if exists malo_unique_produit;

comment on column media_album_link_offers.product_id is
  'Le TYPE d''offre au catalogue (sélection de photos, album complet), pas la formule elle-même. Le même produit peut servir à autant d''offres qu''on veut sur un lien : ce sont photos_allowance, price_override_cents et label qui les distinguent.';

comment on column media_album_link_offers.photos_allowance is
  'Nombre de photos que l''acheteur pourra choisir. Saisi dans l''OS, sans aucune valeur imposée : 17 veut dire 17. null pour un album complet, ou pour hériter du quota du produit.';

commit;
