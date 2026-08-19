-- ============================================================
-- EXÉCUTÉE — vérifié en base réelle le 19/08/2026 (audit pré-lancement) :
-- fonction club_member_has_financial_view_access existe déjà en base. Cet
-- en-tête disait à tort "NON EXÉCUTÉE" ; ne pas relancer cette migration
-- sur la base de cette mention obsolète.
-- ============================================================
--
-- SPORTVISION CLUB+ — Migration v41 : Secrétaire et Administratif passent en
-- LECTURE SEULE sur les documents financiers du club (devis/factures/contrats).
-- CLUB-PLUS-PRODUCT-BIBLE.md §10 : "Documents : Voir/télécharger selon
-- permission ; signer uniquement si autorisé" (Secrétaire), "Factures selon
-- délégation" (Administratif) — brief Fouka 17/08/2026, chantier "Voir/Agir".
--
-- ── Constat (vérifié en lisant le code — pas d'accès réseau direct à la base
--    depuis ce worktree, voir ci-dessous) ─────────────────────────────────
-- club_member_has_financial_access(target_client_id) (migration-connect-v41-
-- decisions-produit-11-08.sql, colonnes reprises à l'identique par
-- migration-clubplus-v39 pour client_factures) ne laisse passer QUE
-- ('admin','president','tresorier','membre_bureau') — Secrétaire
-- ('secretaire') et Administratif ('administratif', ajouté par
-- migration-clubplus-v40, PAS ENCORE EXÉCUTÉE au moment d'écrire ceci) en
-- sont exclus. Le front-end (app-next, src/lib/permissions.ts §
-- canViewClubFinancialDocuments) a été ouvert en lecture à ces 2 rôles pour
-- corriger le bug prioritaire du chantier (NAV_CLUB_SECRETAIRE et
-- NAV_CLUB_ADMINISTRATIF pointent toutes deux vers /documents, qui tombait
-- sur "Accès refusé" pour ces rôles) — mais SANS cette migration, ils
-- passeraient le nouveau garde frontend pour retomber sur "Aucun document
-- pour le moment" (RLS renvoie [] pour eux) : même symptôme trompeur que
-- celui déjà corrigé par migration-connect-v41 pour Communication/Éducateur.
-- Cette migration ferme cet écart.
--
-- Pas de curl en direct exécuté pour vérifier (agent isolé dans un worktree
-- sans .env — SUPABASE_URL/SUPABASE_SECRET_KEY absents de ce contexte) :
-- vérification faite en lisant le SQL déjà exécuté du dépôt à la place
-- (migration-connect-v41-decisions-produit-11-08.sql lignes 35-46 et
-- migration-clubplus-v39-visibilite-facture-partielle-support-reponse.sql
-- lignes 178-192, qui contiennent la définition littérale de la fonction et
-- des 3 vues) — Fouka : merci de confirmer par un select rapide sur
-- pg_proc/information_schema.views avant d'exécuter si un doute subsiste.
--
-- ── Décision : nouvelle fonction séparée, pas de modification de
--    club_member_has_financial_access() ────────────────────────────────
-- club_member_has_financial_access() reste inchangée à l'identique (encore
-- utilisée ailleurs pour des besoins write-adjacent/liste de rôles bureau,
-- voir migration-connect-v49-club-members-bureau-select.sql qui cite la même
-- liste de rôles pour une policy différente — club_members en lecture,
-- jamais élargie ici : Secrétaire/Administratif ne doivent toujours pas lire
-- les lignes club_members des autres membres, seulement les 3 documents
-- financiers). club_member_has_financial_view_access() ci-dessous est un
-- pur ELARGISSEMENT EN LECTURE : aucune RPC d'écriture (client_decide_devis,
-- client_sign_contrat) ne dépend de cette fonction ou de ces vues —
-- client_decide_devis vérifie exclusivement client_users (Espace Projet,
-- migration-devis-cgv-execution-anticipee-11-08.sql), jamais club_members ;
-- client_sign_contrat est neutralisée depuis migration-connect-v32-revoke-
-- client-sign-contrat-bypass.sql (lève une exception, plus aucun effet). Un
-- club (bureau y compris) n'a d'ailleurs aujourd'hui aucune action de
-- décision de devis/signature exposée côté Connect (app-next,
-- billing/page.tsx : allowDevisDecision={false} pour tout club, décision
-- produit antérieure, commit 28f74c6) — cette migration ne change donc rien
-- au comportement d'écriture, seulement à ce qui est VISIBLE.
--
-- Idempotente : chaque étape peut être rejouée sans erreur.

-- ── 1. Nouvelle fonction de lecture élargie ──────────────────────────────
create or replace function club_member_has_financial_view_access(target_client_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1
    from club_members cm
    join clubs c on c.id = cm.club_id
    where cm.user_id = auth.uid()
      and cm.status = 'actif'
      and cm.role in ('admin','president','tresorier','membre_bureau','secretaire','administratif')
      and c.portail_client_id = target_client_id
  );
$$;

-- ── 2. Vues redéfinies à l'identique (mêmes colonnes que la dernière
--    définition connue), seule la fonction appelée dans la branche club
--    change (club_member_has_financial_access -> club_member_has_financial_
--    view_access). client_factures reprend sa version la plus récente
--    (migration-clubplus-v39.sql, avec montant_paye) ; client_devis et
--    client_contrats reprennent celle de migration-connect-v41-decisions-
--    produit-11-08.sql (colonnes CGV/exécution anticipée pour client_devis,
--    inchangées depuis). ──────────────────────────────────────────────────

drop view if exists client_devis;
create view client_devis as
select
  d.id, d.numero, d.statut, d.client_id, d.prestation_id,
  d.lignes, d.sous_total, d.remise_pct, d.remise_montant, d.tva_pct, d.total_ht, d.total_ttc,
  d.validite_jours, d.date_envoi, d.date_expiration, d.date_acceptation, d.notes,
  d.cgv_version_acceptee, d.cgv_acceptee_le,
  d.execution_anticipee_demandee, d.execution_anticipee_demandee_le,
  p.date_prestation,
  d.created_at, d.updated_at
from devis d
left join prestations p on p.id = d.prestation_id
where exists (
  select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = d.client_id
) or club_member_has_financial_view_access(d.client_id);

drop view if exists client_factures;
create view client_factures as
select
  f.id, f.numero, f.type_facture, f.statut, f.client_id, f.prestation_id, f.devis_id,
  f.lignes, f.montant_ht, f.tva_pct, f.montant_ttc, f.montant_paye, f.date_emission,
  f.date_echeance, f.pdf_url, f.created_at
from factures f
where exists (
  select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = f.client_id
) or club_member_has_financial_view_access(f.client_id);

drop view if exists client_contrats;
create view client_contrats as
select
  c.id, c.type_contrat, c.statut,
  c.signature_statut, c.signature_demandee_at, c.signature_confirmee_at,
  c.client_id, c.prestation_id, c.montant_mensuel, c.frequence, c.date_debut, c.date_fin,
  c.created_at, c.updated_at
from contrats c
where exists (
  select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = c.client_id
) or club_member_has_financial_view_access(c.client_id);

-- Note : ces 3 vues restent sans security_invoker (comportement par défaut,
-- exécution avec les droits du propriétaire) — comportement déjà en place
-- avant cette migration, non modifié ici.

-- ============================================================
-- VÉRIFICATION RECOMMANDÉE après exécution (à rejouer séparément) :
--
-- select proname from pg_proc where proname = 'club_member_has_financial_view_access';
--
-- -- Un membre 'secretaire' d'un club relié (portail_client_id non null) doit
-- -- désormais voir les lignes de client_devis/client_factures/client_contrats
-- -- de son club (test via un compte réel, pas le service role qui bypass RLS).
--
-- -- club_member_has_financial_access() (bureau strict) doit rester inchangée :
-- select prosrc from pg_proc where proname = 'club_member_has_financial_access';
-- ============================================================
