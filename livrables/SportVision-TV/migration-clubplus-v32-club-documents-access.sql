-- Migration : accès du club à ses devis/factures/contrats (module
-- "Documents" de l'Espace Club, SportVision Connect).
--
-- ─── Contexte ────────────────────────────────────────────────────────────
-- En portant tplDocsFinance() (SportVision-Club-Plus/app.html) vers Connect
-- (livrables/SportVision-Connect/app/modules/club-services-documents-
-- rapports.js), deux points vérifiés directement en base (prod, via la
-- clé service_role et le schéma OpenAPI PostgREST — pas de supposition) :
--
-- 1. Le lien club → fiche client OS à utiliser est `clubs.portail_client_id`
--    (existe depuis migration-clubplus-v12.sql, posé automatiquement par
--    les Edge Functions clubplus-activate et clubplus-onboarding), PAS
--    `clubs.client_id`. Cette dernière colonne a été ajoutée par erreur
--    (migration-clubplus-cm-bridge.sql, croyant combler un lien manquant
--    qui existait déjà) puis sa suppression a été écrite dans
--    migration-cm-club-link-fix.sql, qui explique le doublon en détail.
--    Club+ lui-même (app.html, `REAL.portailClientId`,
--    `loadRealDocuments()`) utilise déjà portail_client_id pour ce même
--    écran Documents — jamais client_id. Cette migration n'écrit ni ne lit
--    `clubs.client_id` : son sort (déjà supprimée ou pas encore) ne change
--    rien ici.
--
-- 2. Même avec `portail_client_id` renseigné, les vues client_devis /
--    client_factures / client_contrats (créées par migration-portail-v1.sql,
--    `client_contrats` redéfinie par migration-portail-v8.sql pour exposer
--    signature_statut) ne filtrent QUE via `client_users` — table qui lie
--    auth.uid() à un client_id, mais peuplée pour UNE SEULE personne par
--    club (celle qui a activé/créé le club : clubplus-activate/index.ts et
--    clubplus-onboarding/index.ts font toutes deux un upsert client_users
--    ciblant exclusivement user.id, l'utilisateur de la requête). Tout
--    autre membre du club (coach, secrétaire, autre admin invité ensuite)
--    obtient donc aujourd'hui zéro ligne sur ces 3 vues — silencieusement
--    (SELECT valide, simplement filtré à rien, pas d'erreur 403/PGRST) —
--    même quand le club est correctement lié à sa fiche client. Ce même
--    gap existe déjà tel quel dans Club+ (app.html) : ce n'est pas une
--    régression introduite par le portage vers Connect, mais un trou de
--    RLS préexistant que le portage a mis en évidence.
--
-- Cette migration étend le `where exists (...)` des 3 vues avec une branche
-- club, sur le même principe que is_club_member() / contenus_visible_par_cm()
-- déjà en place ailleurs dans le projet : tout membre ACTIF
-- (club_members.status = 'actif') d'un club dont portail_client_id
-- correspond peut désormais lire les devis/factures/contrats de ce client —
-- pas seulement l'unique personne présente dans client_users.
--
-- Aucune policy n'est ajoutée sur les tables sources (devis/contrats/
-- factures) : elles restent fail-closed comme prévu par migration-portail-
-- v1.sql (« Aucune policy client n'est ajoutée sur les tables brutes ... la
-- vue est le seul chemin d'accès ») — principe inchangé, seul le filtre des
-- vues est étendu.
--
-- À exécuter après migration-portail-v8.sql (dont ce fichier reprend la
-- définition de client_contrats avant de l'étendre) et après
-- migration-clubplus-v1.sql (club_members, is_club_member). Idempotente :
-- CREATE OR REPLACE FUNCTION, DROP VIEW IF EXISTS avant chaque CREATE VIEW.
-- Non exécutée par l'agent qui l'a écrite — à exécuter manuellement.

-- ─── 1. Fonction : le membre courant a-t-il accès à ce client via son club ? ──
-- SECURITY DEFINER : contourne le RLS de club_members/clubs lors de son
-- évaluation interne (même raisonnement que is_club_member(), cf.
-- migration-clubplus-v1.sql, pour éviter toute dépendance circulaire de
-- policy et pour fonctionner à l'intérieur d'une vue sans security_invoker).
create or replace function club_member_has_client_access(target_client_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1
    from club_members cm
    join clubs c on c.id = cm.club_id
    where cm.user_id = auth.uid()
      and cm.status = 'actif'
      and c.portail_client_id = target_client_id
  );
$$;

-- ─── 2. client_devis — ajoute la branche club ──────────────────────────
drop view if exists client_devis;
create view client_devis as
select
  d.id, d.numero, d.statut, d.client_id, d.prestation_id,
  d.lignes, d.sous_total, d.remise_pct, d.remise_montant, d.tva_pct, d.total_ht, d.total_ttc,
  d.validite_jours, d.date_envoi, d.date_expiration, d.date_acceptation, d.notes,
  d.created_at, d.updated_at
from devis d
where exists (
  select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = d.client_id
) or club_member_has_client_access(d.client_id);

-- ─── 3. client_factures — ajoute la branche club ───────────────────────
drop view if exists client_factures;
create view client_factures as
select
  f.id, f.numero, f.type_facture, f.statut, f.client_id, f.prestation_id, f.devis_id,
  f.lignes, f.montant_ht, f.tva_pct, f.montant_ttc, f.date_emission, f.date_echeance, f.pdf_url,
  f.created_at
from factures f
where exists (
  select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = f.client_id
) or club_member_has_client_access(f.client_id);

-- ─── 4. client_contrats — reprend la définition v8 (signature_statut), ajoute la branche club ──
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
) or club_member_has_client_access(c.client_id);

-- Note : ces vues restent sans security_invoker (comportement par défaut
-- Postgres, exécution avec les droits du propriétaire) — comportement
-- identique à avant, seul le `where exists (...)` change. Les privilèges
-- SELECT sur les vues elles-mêmes ne sont pas touchés par cette migration
-- (déjà correctement accordés à `authenticated` depuis migration-portail-
-- v1.sql, sinon l'espace Projet existant ne fonctionnerait pas).
