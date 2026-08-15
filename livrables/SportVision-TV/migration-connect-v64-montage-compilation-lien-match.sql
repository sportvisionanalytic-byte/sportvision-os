-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v64
-- Ajoute un 2e mode de livraison pour "Montage Compilation" (migration-connect-v63,
-- montage-compilation) : le client peut fournir directement le LIEN de son/ses match(s) complet(s)
-- au lieu de rushs déjà pré-découpés — SportVision fait alors lui-même le repérage/découpe des
-- temps forts avant montage, d'où un tarif différent (par nombre de matchs, pas par durée).
--
-- Prix donnés par Fouka (verbatim) : "40€ pour 1 match, 55€ pour 2 matchs, 80€ pour 4 matchs en
-- lien, et pour plus de matchs sur devis, livraison expresse." Le prix pour 3 matchs (absent de
-- la citation) a été confirmé séparément à 70€.
--
-- Les deux modes coexistent sur la MÊME offre catalogue (pas une offre séparée — décision de
-- Fouka) :
--   - 'rushs_decoupes' (existant, v63) : durée déclarée (prestations.duree_rush_minutes),
--     tarif_palier (catalogue_offres.tarif_palier).
--   - 'lien_match' (nouveau, ce fichier) : nombre de matchs déclaré (prestations.
--     nombre_matchs_lien) + lien(s) fourni(s) (prestations.lien_match_url), tarif_lien_match
--     (catalogue_offres.tarif_lien_match).
--
-- NON EXÉCUTÉE — à relire puis exécuter par Fouka dans Supabase → SQL Editor. Idempotente
-- (add column if not exists, UPDATE inconditionnel sur tarif_lien_match — sans effet si déjà à
-- cette valeur, à rejouer sans risque). Ne modifie ni ne redéfinit connect_agent_discount()/
-- catalogue_offres.tarif_palier/prix_ht existants (v57, v63).
-- ============================================================


-- ────────────────────────────────────────────────────────────────────────
-- 1. TARIF PAR NOMBRE DE MATCHS (catalogue_offres) — mode "lien_match"
-- ────────────────────────────────────────────────────────────────────────
--
-- Structure : [{"nb_matchs": n, "prix_ht": montant}, ...], triée croissant par nb_matchs. Le prix
-- HT applicable est celui de la ligne dont nb_matchs == prestations.nombre_matchs_lien EXACTEMENT
-- (pas un palier "à partir de", un vrai tarif par palier fixe : 1/2/3/4). Si nombre_matchs_lien
-- dépasse le nb_matchs maximum de la liste (aujourd'hui 4), AUCUNE ligne ne correspond : la
-- prestation reste NON auto-chiffrée (create-checkout-session refuse le paiement avec un message
-- explicite tant que le staff n'a pas fixé montant_ttc manuellement) — c'est le cas "sur devis,
-- livraison expresse" annoncé au client, cohérent avec le fonctionnement déjà en place pour toute
-- offre `tarif_type='sur_devis'` du catalogue (mêmes garde-fous, même écran d'attente).
alter table catalogue_offres add column if not exists tarif_lien_match jsonb;

comment on column catalogue_offres.tarif_lien_match is
  'Tarif par nombre de matchs fournis en lien (mode "lien_match" de Montage Compilation). '
  'Structure : [{"nb_matchs": n, "prix_ht": montant}, ...]. Aucune ligne au-delà du nb_matchs max '
  '= sur devis (staff chiffre manuellement, create-checkout-session refuse tant que montant_ttc '
  'n''est pas renseigné). NULL = offre sans ce mode alternatif.';


-- ────────────────────────────────────────────────────────────────────────
-- 2. CHOIX DU CLIENT (prestations) — déclaratif, saisi à la commande
-- ────────────────────────────────────────────────────────────────────────
alter table prestations add column if not exists mode_livraison_montage text
  check (mode_livraison_montage in ('rushs_decoupes', 'lien_match'));

comment on column prestations.mode_livraison_montage is
  'Montage Compilation uniquement (migration-connect-v63/v64) : ''rushs_decoupes'' (durée '
  'déclarée, voir duree_rush_minutes) ou ''lien_match'' (nombre de matchs + lien, voir '
  'nombre_matchs_lien/lien_match_url). NULL pour toute autre prestation du catalogue.';

alter table prestations add column if not exists nombre_matchs_lien integer;

comment on column prestations.nombre_matchs_lien is
  'Nombre de matchs fournis en lien par le client — mode_livraison_montage = ''lien_match'' '
  'uniquement. NULL sinon.';

alter table prestations add column if not exists lien_match_url text;

comment on column prestations.lien_match_url is
  'Lien(s) vers le(s) match(s) complet(s), collé(s) par le client (texte libre, un ou plusieurs '
  'liens) — mode_livraison_montage = ''lien_match'' uniquement. NULL sinon.';


-- ────────────────────────────────────────────────────────────────────────
-- 3. TARIFS — "Montage Compilation" (slug déjà créé par v63, ON CONFLICT DO NOTHING sur l'insert
--    donc pas rejoué ici : simple UPDATE, sans risque d'écraser une offre différente)
-- ────────────────────────────────────────────────────────────────────────
update catalogue_offres
set tarif_lien_match = jsonb_build_array(
  jsonb_build_object('nb_matchs', 1, 'prix_ht', 40.00),
  jsonb_build_object('nb_matchs', 2, 'prix_ht', 55.00),
  jsonb_build_object('nb_matchs', 3, 'prix_ht', 70.00),
  jsonb_build_object('nb_matchs', 4, 'prix_ht', 80.00)
)
where slug = 'montage-compilation';

-- ============================================================
-- FIN. Résumé des actions manuelles requises après relecture :
--
--   1. Exécuter ce fichier entier dans Supabase → SQL Editor (idempotent).
--
--   2. Ces 4 tarifs (40/55/70/80€ HT pour 1/2/3/4 matchs) sont ceux donnés par Fouka — pas des
--      valeurs provisoires comme le prix "rushs découpés" de v63. Si un ajustement est
--      nécessaire plus tard, un seul endroit :
--        update catalogue_offres
--        set tarif_lien_match = jsonb_build_array(
--          jsonb_build_object('nb_matchs', 1, 'prix_ht', <...>),
--          jsonb_build_object('nb_matchs', 2, 'prix_ht', <...>),
--          jsonb_build_object('nb_matchs', 3, 'prix_ht', <...>),
--          jsonb_build_object('nb_matchs', 4, 'prix_ht', <...>)
--        )
--        where slug = 'montage-compilation';
--
--   3. Redéployer les mêmes 3 Edge Functions que v63 (encore modifiées par ce chantier) :
--        connect-player-prestations, create-checkout-session
--      (stripe-webhook n'est PAS retouché par cette migration-ci — le webhook ne connaît que le
--      montant final déjà calculé par create-checkout-session, pas le mode de livraison choisi.)
--
--   4. Aucun nouveau secret, aucun nouveau Price Stripe requis — paiement ponctuel comme le reste
--      du catalogue.
-- ============================================================
