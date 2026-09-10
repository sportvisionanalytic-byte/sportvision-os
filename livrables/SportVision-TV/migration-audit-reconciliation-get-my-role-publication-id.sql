-- ============================================================================
-- migration-audit-reconciliation-get-my-role-publication-id.sql
-- Audit préparation environnement Review (10/09/2026) — reconstruction schéma
-- ============================================================================
-- CONTEXTE : en rejouant chronologiquement les 551 migrations du dépôt sur un
-- projet Supabase Review neuf (test de reconstruction, aucune donnée réelle),
-- deux objets utilisés par plusieurs migrations n'ont jamais été trouvés créés
-- dans AUCUN fichier migration-*.sql versionné :
--
--   - la fonction public.get_my_role() (utilisée par
--     migration-calendrier-global-v1.sql et migration-poles-v22-*)
--   - la colonne contenus.publication_external_id (utilisée par
--     migration-contenu-multireseaux.sql)
--
-- Vérification faite en base réelle (Supabase Management API,
-- pg_get_functiondef / information_schema.columns) : CES DEUX OBJETS
-- EXISTENT EN PRODUCTION, correctement configurés. Même dérive base/code que
-- les cas déjà documentés le 29/08 et le 10/09 (cm_pool_clubplus_general) :
-- créés directement (SQL Editor ou script non committé) sans jamais laisser
-- de fichier migration-*.sql dans ce dépôt.
--
-- RISQUE que ce fichier corrige : sur une base reconstruite depuis les
-- migrations versionnées (environnement Review), migration-calendrier-global-v1.sql
-- et migration-contenu-multireseaux.sql échoueraient à l'exécution, cassant
-- en cascade le Calendrier global (admin) et le module de publication
-- multi-réseaux des contenus.
--
-- Ce fichier est un NO-OP sur la production (les deux objets y sont déjà,
-- vérifié avant écriture) : il sert uniquement à rendre l'état actuel de la
-- base reproductible depuis les migrations versionnées.
-- ============================================================================

create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select role from profiles where id = auth.uid();
$function$;

alter table contenus add column if not exists publication_external_id text;
