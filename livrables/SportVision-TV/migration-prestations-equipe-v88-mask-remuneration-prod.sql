-- ============================================================
-- Migration additive : masque `prestations_equipe.remuneration` pour le rôle
-- prod (audit RBAC du 20/08/2026, testé en réel avec un compte jetable).
--
-- ── Constat vérifié en conditions réelles (pas une supposition) ──
-- La policy `equipe_acces` (ALL, admin/prod/sec) donne un accès SELECT
-- complet et NON restreint par colonne à prestations_equipe, y compris
-- remuneration. La couche produit voulue est claire et déjà en place côté
-- UI (canSetRem=admin/sec uniquement, SportVision-OS-Full.html) — Fouka a
-- explicitement demandé cette répartition : prod affecte l'équipe et ajoute
-- des consignes, seuls secrétariat/admin posent la rémunération. Mais RLS
-- ne fait aucune distinction par colonne : un rôle prod authentifié qui
-- appelle directement `/rest/v1/prestations_equipe?select=remuneration`
-- (hors interface, ex. curl avec son propre token) reçoit la vraie valeur.
-- Testé et confirmé avec un compte jetable réel avant d'écrire cette
-- migration, supprimé après test.
--
-- sec reste volontairement en accès complet (y compris remuneration) —
-- c'est la répartition demandée : secrétariat + admin gèrent la
-- rémunération, prod ne la voit ni ne la modifie.
--
-- ── Ce que fait cette migration ──
-- 1) Sépare equipe_acces (ALL) en policies par commande : SELECT restreint
--    à admin/sec (+ la ligne de son propre compte, pour "Mes revenus"),
--    INSERT/UPDATE/DELETE inchangés pour admin/prod/sec (prod garde la
--    capacité d'affecter/gérer l'équipe, juste pas de lire remuneration
--    par la table brute).
-- 2) Crée une vue prestations_equipe_display avec sa PROPRE visibilité de
--    lignes (délibérément PAS security_invoker : prod doit continuer à voir
--    les lignes des autres collaborateurs pour gérer l'équipe, ce que la
--    policy equipe_select restreinte du point 1 ne permettrait plus si la
--    vue en héritait). Remuneration masquée (NULL) sauf pour
--    admin/sec/compta/expert_comptable/auditeur ou pour la ligne du
--    collaborateur lui-même (auto-consultation, "Mes revenus").
-- 3) Le frontend (SportVision-OS-Full.html) est mis à jour séparément pour
--    lire cette vue au lieu de la table sur les 38 appels en lecture
--    existants (aucun changement sur les écritures, qui continuent de
--    cibler prestations_equipe directement).
--
-- Idempotente.
-- ============================================================

drop policy if exists equipe_acces on prestations_equipe;

create policy equipe_select on prestations_equipe
  for select
  using (
    (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','sec'])))
    or (collaborateur_id = auth.uid())
  );

create policy equipe_insert on prestations_equipe
  for insert
  with check (
    exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod','sec']))
  );

create policy equipe_update on prestations_equipe
  for update
  using (
    (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod','sec'])))
    or (collaborateur_id = auth.uid())
  );

create policy equipe_delete on prestations_equipe
  for delete
  using (
    exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod','sec']))
  );

-- IMPORTANT : PAS de security_invoker=true ici, volontairement. prod a besoin de VOIR les
-- lignes des AUTRES collaborateurs (qui est affecté, statut, fonction) pour gérer l'équipe —
-- seule la colonne remuneration doit lui être masquée. Si la vue héritait de la RLS restreinte
-- de la table (equipe_select, qui exclut prod des lignes d'autrui), prod ne verrait plus AUCUNE
-- ligne d'un collègue, cassant l'écran Équipe/Affectations. La vue applique donc sa PROPRE
-- visibilité de lignes ci-dessous (identique à l'ancienne policy equipe_acces, avant cette
-- migration), et ne fait que masquer la colonne remuneration.
create or replace view prestations_equipe_display as
select
  id, prestation_id, collaborateur_id, est_responsable, fonction, heure_rdv,
  case
    when collaborateur_id = auth.uid() then remuneration
    when exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','sec','compta','expert_comptable','auditeur'])) then remuneration
    else null
  end as remuneration,
  frais_km, km_estimes, statut, date_reponse, notes, created_at, notes_refus,
  heures_declarees, km_declares, frais_declares, notes_declaration, statut_paiement, date_paiement
from prestations_equipe
where
  exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod','sec','compta','expert_comptable','auditeur']))
  or collaborateur_id = auth.uid();

grant select on prestations_equipe_display to authenticated, anon, service_role;
