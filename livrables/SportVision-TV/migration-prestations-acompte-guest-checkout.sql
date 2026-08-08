-- Migration : acompte obligatoire en ligne (1ère réservation) + préférence
-- de paiement du solde, depuis le tunnel de réservation public (reserver.html).
--
-- Contexte (2026-08-08) : sur les 3 offres à tarif fixe (Match photo, Match
-- vidéo, Pack complet), un visiteur qui réserve pour la première fois doit
-- désormais régler un acompte de 30% par carte (Stripe) avant confirmation
-- définitive — sans quoi rien ne garantit la venue d'une équipe. Un client
-- déjà connu (a déjà un paiement "reussi" en base) n'y est pas obligé.
--
-- Le solde restant (après la prestation) peut lui être réglé par carte ou en
-- espèces sur place : le client choisit sa préférence dès la réservation.
--
-- `prestations.mode_paiement` existe déjà (migration-prestations-paiement.sql)
-- mais sert exclusivement au STAFF pour enregistrer comment un paiement a
-- RÉELLEMENT été encaissé (virement/espèces/chèque/carte), après coup, via
-- l'OS. La réutiliser ici pour une simple PRÉFÉRENCE exprimée par le client
-- avant tout encaissement créerait une confusion comptable (un mode_paiement
-- rempli pourrait laisser croire qu'un paiement a eu lieu). D'où une colonne
-- séparée, sans ambiguïté.
--
-- Idempotente : peut être rejouée sans erreur.
-- À exécuter dans Supabase → SQL Editor

alter table prestations
  add column if not exists preference_paiement_solde text
    check (preference_paiement_solde is null or preference_paiement_solde in ('carte', 'especes'));

comment on column prestations.preference_paiement_solde is
  'Préférence exprimée par le client au moment de la réservation pour le règlement du SOLDE restant (pas l''acompte, toujours par carte en ligne). Ne reflète pas un paiement réellement effectué — voir mode_paiement pour ça.';
