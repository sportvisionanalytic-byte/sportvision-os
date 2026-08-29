-- =====================================================================
-- migration-audit-final-indexes.sql
-- Audit final autonome (29/08) — indexes manquants sur colonnes filtrées
-- fréquemment côté application (objectivé par grep des patterns
-- `?xxx_id=eq.` / `&statut=eq.` dans sbFetch() sur SportVision-OS-Full.html)
--
-- Non destructif : uniquement des CREATE INDEX IF NOT EXISTS.
-- Chaque index cible une colonne dont la fréquence de filtrage réelle a
-- été vérifiée dans le code (pas d'index ajouté "au hasard").
-- =====================================================================

-- Vérification AVANT : aucun de ces index ne doit exister
-- select indexname from pg_indexes where schemaname='public' and indexname in (
--   'idx_prestations_equipe_collaborateur_id','idx_prestations_equipe_prestation_id',
--   'idx_plannings_hebdo_statut','idx_prestations_client_id','idx_prestations_statut',
--   'idx_kit_reservations_prestation_id','idx_kit_reservations_kit_id','idx_kit_reservations_collaborateur_id',
--   'idx_devis_client_id','idx_contenus_statut','idx_client_affiliations_status','idx_clubs_portail_client_id'
-- );
-- -> résultat attendu et confirmé le 29/08 : 0 ligne

-- prestations_equipe.collaborateur_id : filtré 16x (vue prestations_equipe_display
-- + table directe) — colonne FK sans index, la plus utilisée de tout l'audit
CREATE INDEX IF NOT EXISTS idx_prestations_equipe_collaborateur_id
  ON public.prestations_equipe (collaborateur_id);

-- prestations_equipe.prestation_id : filtré 7x (vue + table directe)
CREATE INDEX IF NOT EXISTS idx_prestations_equipe_prestation_id
  ON public.prestations_equipe (prestation_id);

-- plannings_hebdo.statut : filtré 4x, colonne d'état sans index
CREATE INDEX IF NOT EXISTS idx_plannings_hebdo_statut
  ON public.plannings_hebdo (statut);

-- prestations.client_id : table centrale, FK sans index malgré 3 filtrages directs
CREATE INDEX IF NOT EXISTS idx_prestations_client_id
  ON public.prestations (client_id);

-- prestations.statut : filtré 2x, colonne d'état sans index sur table centrale
CREATE INDEX IF NOT EXISTS idx_prestations_statut
  ON public.prestations (statut);

-- kit_reservations : 3 FK filtrées et sans index
CREATE INDEX IF NOT EXISTS idx_kit_reservations_prestation_id
  ON public.kit_reservations (prestation_id);
CREATE INDEX IF NOT EXISTS idx_kit_reservations_kit_id
  ON public.kit_reservations (kit_id);
CREATE INDEX IF NOT EXISTS idx_kit_reservations_collaborateur_id
  ON public.kit_reservations (collaborateur_id);

-- devis.client_id : filtré 3x, FK sans index
CREATE INDEX IF NOT EXISTS idx_devis_client_id
  ON public.devis (client_id);

-- contenus.statut : filtré 3x, colonne d'état sans index
CREATE INDEX IF NOT EXISTS idx_contenus_statut
  ON public.contenus (statut);

-- client_affiliations.status : filtré 2x, colonne d'état sans index
CREATE INDEX IF NOT EXISTS idx_client_affiliations_status
  ON public.client_affiliations (status);

-- clubs.portail_client_id : filtré 7x (chargement de l'espace club),
-- FK sans aucun index — la seule colonne indexée de `clubs` avant cette
-- migration était stripe_customer_id / stripe_subscription_id
CREATE INDEX IF NOT EXISTS idx_clubs_portail_client_id
  ON public.clubs (portail_client_id);

-- Vérification APRÈS (à exécuter manuellement si besoin) :
-- select indexname from pg_indexes where schemaname='public' and indexname like 'idx_%'
--   and tablename in ('prestations_equipe','plannings_hebdo','prestations','kit_reservations','devis','contenus','client_affiliations','clubs')
-- order by tablename, indexname;
