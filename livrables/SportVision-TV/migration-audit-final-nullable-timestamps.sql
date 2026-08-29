-- =====================================================================
-- migration-audit-final-nullable-timestamps.sql
-- Audit final autonome (29/08) — cohérence NOT NULL + updated_at
--
-- Partie A : colonnes qui ne devraient logiquement jamais être NULL,
-- vérifiées vides de NULL en pratique avant la contrainte (DO block
-- défensif qui lève une exception si un NULL existe — migration donc
-- rejouable et sûre même si des données ont été ajoutées entre-temps).
--
-- Partie B : ajout de `updated_at` (+ trigger réutilisant la fonction
-- déjà existante `update_updated_at_generic()`) sur 4 tables métier
-- clairement mutables qui en étaient dépourvues, alors que la grande
-- majorité des autres tables sans updated_at sont des tables de logs/
-- événements immuables (activity_log, notifications, historique, xp_events,
-- etc.) pour lesquelles l'absence d'updated_at est normale et n'a PAS été
-- touchée ici (cf. rapport, section "Non modifié volontairement").
-- =====================================================================

-- ---------------------------------------------------------------------
-- Partie A : NOT NULL sur colonnes toujours attendues
-- ---------------------------------------------------------------------

-- prestations_equipe.prestation_id / collaborateur_id : une affectation
-- d'équipe sans prestation ni collaborateur n'a pas de sens métier.
-- Seul point d'insertion dans le code (SportVision-OS-Full.html, ligne
-- ~12623) fournit toujours ces deux valeurs. 0 ligne NULL en base au 29/08.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.prestations_equipe WHERE prestation_id IS NULL OR collaborateur_id IS NULL) THEN
    RAISE EXCEPTION 'prestations_equipe: des lignes avec prestation_id/collaborateur_id NULL existent, migration abandonnée';
  END IF;
END $$;
ALTER TABLE public.prestations_equipe ALTER COLUMN prestation_id SET NOT NULL;
ALTER TABLE public.prestations_equipe ALTER COLUMN collaborateur_id SET NOT NULL;

-- statut : colonnes avec DEFAULT déjà en place côté schéma, donc un INSERT
-- sans valeur explicite prend toujours le défaut — NOT NULL est donc sans
-- risque de casser un flux d'insertion existant.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.prestations_equipe WHERE statut IS NULL) THEN
    RAISE EXCEPTION 'prestations_equipe.statut: NULL existant, migration abandonnée';
  END IF;
END $$;
ALTER TABLE public.prestations_equipe ALTER COLUMN statut SET NOT NULL; -- default 'invitation_envoyée'

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.factures WHERE statut IS NULL) THEN
    RAISE EXCEPTION 'factures.statut: NULL existant, migration abandonnée';
  END IF;
END $$;
ALTER TABLE public.factures ALTER COLUMN statut SET NOT NULL; -- default 'brouillon'

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.media_livrables WHERE statut IS NULL) THEN
    RAISE EXCEPTION 'media_livrables.statut: NULL existant, migration abandonnée';
  END IF;
END $$;
ALTER TABLE public.media_livrables ALTER COLUMN statut SET NOT NULL; -- default 'a_preparer'

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.paiements WHERE statut IS NULL) THEN
    RAISE EXCEPTION 'paiements.statut: NULL existant, migration abandonnée';
  END IF;
END $$;
ALTER TABLE public.paiements ALTER COLUMN statut SET NOT NULL; -- default 'en_attente'

-- ---------------------------------------------------------------------
-- Partie B : updated_at manquant sur tables métier mutables
-- ---------------------------------------------------------------------

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_generic();

ALTER TABLE public.client_affiliations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS trg_client_affiliations_updated_at ON public.client_affiliations;
CREATE TRIGGER trg_client_affiliations_updated_at BEFORE UPDATE ON public.client_affiliations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_generic();

ALTER TABLE public.kit_reservations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS trg_kit_reservations_updated_at ON public.kit_reservations;
CREATE TRIGGER trg_kit_reservations_updated_at BEFORE UPDATE ON public.kit_reservations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_generic();

ALTER TABLE public.prestations_equipe ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS trg_prestations_equipe_updated_at ON public.prestations_equipe;
CREATE TRIGGER trg_prestations_equipe_updated_at BEFORE UPDATE ON public.prestations_equipe
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_generic();

-- Vérification APRÈS (à exécuter manuellement si besoin) :
-- select table_name, is_nullable from information_schema.columns
--   where table_schema='public' and table_name in ('prestations_equipe','factures','media_livrables','paiements')
--   and column_name in ('statut','prestation_id','collaborateur_id');
-- select table_name, column_name from information_schema.columns
--   where table_schema='public' and column_name='updated_at'
--   and table_name in ('profiles','client_affiliations','kit_reservations','prestations_equipe');
