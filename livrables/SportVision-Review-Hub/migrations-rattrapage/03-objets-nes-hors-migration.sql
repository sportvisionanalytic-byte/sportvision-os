-- RATTRAPAGE REVIEW — objets qui existent en PRODUCTION mais qu'aucune migration du depot ne cree
-- Projet Review ffjktzmsezfrwmrtlhzo uniquement, le 12/09/2026.
--
-- Pourquoi ce fichier existe : la base Review a ete reconstruite en rejouant la chaine des
-- migrations du depot. Tout objet ne en production HORS migration (ecrit un jour dans l'editeur
-- SQL, jamais reporte dans un fichier) manque donc a Review par construction, et aucun rejeu ne
-- le fera apparaitre. Constate le 12/09 en comparant objet par objet les deux bases.
--
-- Les definitions ci-dessous sont copiees telles quelles depuis la production (lecture seule via
-- l'API Management) : aucune reecriture, aucune interpretation.
--
-- A remonter a Fouka : ces objets sont une dette cote PRODUCTION aussi. Ils ne sont dans aucun
-- fichier, donc invisibles a toute relecture de code et perdus a la prochaine reconstruction.

begin;

-- ── A. contenus : 4 colonnes de validation ──────────────────────────────────────────────────
alter table public.contenus add column if not exists valide_par uuid;
alter table public.contenus add column if not exists valide_at timestamptz;
alter table public.contenus add column if not exists commentaire_validation text;
alter table public.contenus add column if not exists publication_provider text not null default 'manuel';

-- ── B. contenus : 3 policies (responsable de pole, tutorat CM junior) ────────────────────────
drop policy if exists contenus_responsable_all on public.contenus;
create policy contenus_responsable_all on public.contenus for all
  using (exists (select 1 from profiles p
                  where p.id = auth.uid() and p.cm_niveau_autonomie = 'responsable'))
  with check (exists (select 1 from profiles p
                  where p.id = auth.uid() and p.cm_niveau_autonomie = 'responsable'));

drop policy if exists contenus_tuteur_select on public.contenus;
create policy contenus_tuteur_select on public.contenus for select
  using (exists (select 1 from cm_tutorships t
                  where t.junior_id = contenus.cm_id and t.tuteur_id = auth.uid()
                    and t.statut = 'actif'));

drop policy if exists contenus_tuteur_update on public.contenus;
create policy contenus_tuteur_update on public.contenus for update
  using (exists (select 1 from cm_tutorships t
                  where t.junior_id = contenus.cm_id and t.tuteur_id = auth.uid()
                    and t.statut = 'actif'))
  with check (exists (select 1 from cm_tutorships t
                  where t.junior_id = contenus.cm_id and t.tuteur_id = auth.uid()
                    and t.statut = 'actif'));

-- ── C. deux fonctions de declencheur (le CM principal d'un client suit son affiliation) ──────
CREATE OR REPLACE FUNCTION public.sync_client_affiliation_cm_to_client()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ BEGIN IF NEW.role_on_client = 'cm_principal' AND NEW.status = 'actif' THEN UPDATE clients SET cm_id = NEW.user_id WHERE id = NEW.client_id; END IF; IF TG_OP = 'UPDATE' AND OLD.role_on_client = 'cm_principal' AND OLD.status = 'actif' AND (NEW.role_on_client <> 'cm_principal' OR NEW.status <> 'actif') THEN UPDATE clients SET cm_id = NULL WHERE id = NEW.client_id AND cm_id = OLD.user_id; END IF; RETURN NEW; END; $function$;

CREATE OR REPLACE FUNCTION public.sync_cm_assignment_to_client()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ BEGIN IF NEW.role = 'principal' AND NEW.statut = 'actif' THEN UPDATE clients SET cm_id = NEW.cm_id WHERE id = NEW.client_id; END IF; IF TG_OP = 'UPDATE' AND OLD.role = 'principal' AND OLD.statut = 'actif' AND (NEW.role <> 'principal' OR NEW.statut <> 'actif') THEN UPDATE clients SET cm_id = NULL WHERE id = NEW.client_id AND cm_id = OLD.cm_id; END IF; RETURN NEW; END; $function$;

-- Seul ce declencheur existe en production ; sync_cm_assignment_to_client n'y est rattachee a
-- aucune table (fonction orpheline, copiee pour rester fidele a l'etat reel).
drop trigger if exists trg_sync_client_affiliation_cm_to_client on public.client_affiliations;
CREATE TRIGGER trg_sync_client_affiliation_cm_to_client
  AFTER INSERT OR UPDATE ON public.client_affiliations
  FOR EACH ROW EXECUTE FUNCTION sync_client_affiliation_cm_to_client();

commit;
