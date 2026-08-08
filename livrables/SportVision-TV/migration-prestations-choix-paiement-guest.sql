-- Migration : choix de paiement (carte ou espèces) depuis le tunnel de
-- réservation public (reserver.html), sans compte.
--
-- Contexte (2026-08-08, décision fondateur) : sur les 3 offres à tarif fixe
-- (Match photo, Match vidéo, Pack complet), le visiteur choisit librement au
-- moment de réserver comment il règle : la totalité en ligne par carte
-- (Stripe, immédiat), ou en espèces sur place le jour de la prestation.
-- Dans les deux cas, la réservation est confirmée tout de suite — aucun
-- acompte, aucune condition bloquante.
--
-- `prestations.mode_paiement` existe déjà (migration-prestations-paiement.sql)
-- mais sert exclusivement au STAFF pour enregistrer comment un paiement a
-- RÉELLEMENT été encaissé (virement/espèces/chèque/carte), après coup, via
-- l'OS. La réutiliser ici pour un simple CHOIX exprimé par le client avant
-- tout encaissement créerait une confusion comptable (un mode_paiement rempli
-- pourrait laisser croire qu'un paiement a eu lieu alors que le client a
-- seulement dit "espèces"). D'où une colonne séparée, sans ambiguïté.
--
-- Idempotente : peut être rejouée sans erreur.
-- À exécuter dans Supabase → SQL Editor

alter table prestations
  add column if not exists mode_paiement_choisi text
    check (mode_paiement_choisi is null or mode_paiement_choisi in ('carte', 'especes'));

comment on column prestations.mode_paiement_choisi is
  'Choix exprimé par le client au moment de la réservation (carte = paiement immédiat en ligne, especes = réglé sur place). Ne reflète pas un paiement réellement effectué — voir mode_paiement pour ça.';
