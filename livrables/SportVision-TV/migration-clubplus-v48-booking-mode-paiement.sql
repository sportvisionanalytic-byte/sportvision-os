-- ============================================================
-- SPORTVISION CLUB+ — Migration v48
-- Suite de migration-clubplus-v47-club-logo-storage.sql. Idempotente.
--
-- Portée (19/08/2026, audit pré-lancement) : réintroduit un choix de mode
-- de paiement (carte/espèces) dans le tunnel de réservation Club+, sur
-- demande explicite de Fouka — décision consciente de revenir sur le
-- retrait du 09/08/2026 (reserver.html, vitrine publique, non-authentifié)
-- documenté dans src/components/services/tunnel/types.ts. Portée
-- volontairement limitée à Club+ (club_bookings) : le tunnel générique
-- Espace Projet (`prestations`, NewServiceTunnel.tsx) n'est pas touché ici,
-- pas demandé ce soir.
--
-- Simple préférence déclarative du club au moment de la demande (comme
-- team/adresse/heure, déjà en texte libre non contraignant) — ne
-- déclenche aucun paiement réel, aucune intégration Stripe : le règlement
-- effectif reste géré séparément par le staff (devis/facture), comme pour
-- toute autre demande.
--
-- EXÉCUTÉE le 19/08/2026 (audit pré-lancement, agent autonome).
-- ============================================================

alter table club_bookings add column if not exists mode_paiement text
  check (mode_paiement is null or mode_paiement in ('carte', 'especes'));

-- ────────────────────────────────────────────────────────────────────────
-- Vérification post-migration (à exécuter manuellement, lecture seule)
-- ────────────────────────────────────────────────────────────────────────
-- select column_name from information_schema.columns where table_name='club_bookings' and column_name='mode_paiement';
