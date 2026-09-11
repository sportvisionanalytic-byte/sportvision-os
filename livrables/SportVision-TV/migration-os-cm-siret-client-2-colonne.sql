-- ============================================================================================
-- migration-os-cm-siret-client-2-colonne.sql
-- Décision de Fouka (11/09/2026) : le CM SportVision ne voit pas le SIRET d'une fiche client.
-- Voir migration-os-cm-siret-client-1-lecture.sql pour le constat et la liste des lecteurs.
-- ============================================================================================
--
-- CE QUE FAIT CETTE MIGRATION. Elle retire à `authenticated` et `anon` le droit de LIRE la seule
-- colonne `clients.siret`, en leur laissant toutes les autres. La RLS filtre des lignes, pas des
-- colonnes : c'est la seule façon de fermer une colonne au CM qui garde la lecture de la fiche
-- (nom, contact, ville…). Les lecteurs autorisés passent par client_siret() (migration 1).
--
-- À EXÉCUTER DANS CET ORDRE, JAMAIS AVANT LE DÉPLOIEMENT DE L'OS :
--   1) migration-os-cm-siret-client-1-lecture.sql ;
--   2) déploiement de l'OS (SportVision-OS-Full.html du 11/09/2026 ou plus récent) ;
--   3) cette migration.
-- L'OS antérieur lit `clients(*)` (devis, factures, avoirs, contrats) et écrit dans `clients`
-- avec `return=representation` sans liste de colonnes : avec la colonne fermée, PostgREST fait
-- échouer ces requêtes ENTIÈREMENT (42501, vérifié sur `clubs` le 11/09), pour tous les rôles.
--
-- INVENTAIRE DES LECTEURS DE `clients` (11/09/2026), pour savoir ce que la fermeture touche :
--   - OS : toutes les lectures nomment leurs colonnes, sans `siret` ; les écritures demandent
--     `select=id` (commit du 11/09). La seule écriture du SIRET (création d'un client) garde
--     son droit : INSERT et UPDATE restent accordés sur la table.
--   - Club+ (app-next), Connect (app-connect, app vanilla) : aucune requête sur `clients`.
--   - Fonctions serveur : toutes lisent `clients` en clé de service (clubplus-activate,
--     stripe-webhook, send-*…), non concernées. Aucune fonction SQL SECURITY INVOKER ne lit
--     `clients.*` ni `siret` (seule sync_prestation_pole_id, qui lit pole_id).
--   - Vues qui lisent `clients` (client_cm, client_organisation, secretariat_documents,
--     v_calendar_global, v_production_missions, v_rentabilite_missions) : sans security_invoker,
--     elles lisent comme leur propriétaire, et aucune n'expose `siret`.
--   - Policies : aucune ne lit `clients.siret`. `clients` n'est pas publiée en Realtime.
--
-- PIÈGE POUR LA SUITE (à lire avant d'ajouter une colonne à `clients`) : le droit de lecture est
-- désormais accordé colonne par colonne. Une colonne AJOUTÉE plus tard ne sera PAS lisible par
-- `authenticated` tant qu'on ne l'accorde pas explicitement :
--     grant select (nouvelle_colonne) on public.clients to authenticated, anon;
-- tests/os-cm-espace-et-siret.test.sql le vérifie (toute colonne autre que siret doit rester
-- lisible). Et ne jamais écrire `select=*` ni `clients(*)` : la requête entière échouerait.
--
-- RETOUR ARRIÈRE D'URGENCE : grant select on public.clients to anon, authenticated;
--
-- Idempotente : les droits sont recalculés à partir des colonnes existantes à chaque passage.
-- Testée en transaction annulée : tests/os-cm-espace-et-siret.test.sql (avec la migration 1).
-- Vérification par le chemin réel après exécution : tests/os-cm-espace-et-siret.test.mjs.
-- ============================================================================================

begin;

set lock_timeout = '5s';

-- ── 0. Garde-fou : la migration 1 est passée ────────────────────────────────────────────────
-- Sans elle, l'Admin SportVision, la Compta et les autres lecteurs autorisés n'auraient plus
-- AUCUN chemin vers le SIRET d'un client.
do $garde$
begin
  if not exists (select 1 from pg_proc where proname = 'client_siret' and pronamespace = 'public'::regnamespace) then
    raise exception 'os-cm-siret-client-2 : exécuter d''abord migration-os-cm-siret-client-1-lecture.sql. Rien n''a été modifié.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'clients' and column_name = 'siret') then
    raise exception 'os-cm-siret-client-2 : la colonne clients.siret n''existe pas. Rien n''a été modifié.';
  end if;
end $garde$;

-- ── 1. Droits de lecture colonne par colonne ────────────────────────────────────────────────
-- On retire le droit de TABLE (qui couvre toutes les colonnes, présentes et futures), puis on
-- ré-accorde chaque colonne sauf `siret`. La liste est lue dans le catalogue au moment de
-- l'exécution : une colonne ajoutée entre l'écriture de ce fichier et son exécution est donc
-- accordée elle aussi.
do $droits$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'clients' and column_name <> 'siret';

  revoke select on public.clients from anon, authenticated;
  execute format('grant select (%s) on public.clients to anon, authenticated', cols);
  raise notice 'os-cm-siret-client-2 : clients.siret fermée en lecture à authenticated/anon';
end $droits$;

commit;
