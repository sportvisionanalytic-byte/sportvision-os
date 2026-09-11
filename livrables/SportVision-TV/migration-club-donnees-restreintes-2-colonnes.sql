-- ============================================================================================
-- migration-club-donnees-restreintes-2-colonnes.sql
-- Décisions de Fouka du 11/09/2026 (voir migration-club-donnees-restreintes-1-lectures.sql).
-- ============================================================================================
--
-- CE QUE FAIT CETTE MIGRATION. Elle retire à `authenticated` et `anon` le droit de LIRE quatre
-- colonnes, en leur laissant toutes les autres :
--   clubs.siret, clubs.stripe_customer_id, clubs.stripe_subscription_id, club_members.telephone.
-- La RLS filtre des lignes, pas des colonnes : c'est la seule façon de fermer une colonne à un
-- membre qui garde le droit de lire la ligne (nom, logo, rôle, équipe…). Les lecteurs autorisés
-- passent par club_donnees_restreintes() et club_membres_coordonnees() (migration 1).
--
-- À EXÉCUTER DANS CET ORDRE, JAMAIS AVANT LE DÉPLOIEMENT DES ÉCRANS :
--   1) migration-club-donnees-restreintes-1-lectures.sql ;
--   2) déploiement de Club+ (app-next) et de l'OS (SportVision-OS-Full.html) ;
--   3) cette migration.
-- La version de Club+ antérieure au 11/09/2026 lit `clubs.siret` en construisant la session de
-- CHAQUE membre : avec cette migration, sa requête échouerait (42501) et plus personne n'entrerait
-- dans son club.
--
-- CE QUI RESTE INCHANGÉ.
--   - service_role (fonctions serveur, webhook Stripe) et les fonctions SECURITY DEFINER : elles
--     lisent la table comme son propriétaire. Les droits d'ÉCRITURE : UPDATE reste accordé par
--     table ; un PATCH sans `return=representation` ou avec `select=id` fonctionne toujours.
--   - Les vues sans security_invoker qui lisent ces tables (club_media_livrables,
--     secretariat_documents, v_media_orders_a_expedier) : elles lisent comme leur propriétaire et
--     n'exposent aucune de ces quatre colonnes (inventaire du 11/09/2026).
--
-- PIÈGE POUR LA SUITE (à lire avant d'ajouter une colonne à `clubs` ou `club_members`) : le droit
-- de lecture est désormais accordé colonne par colonne. Une colonne AJOUTÉE plus tard ne sera PAS
-- lisible par `authenticated` tant qu'on ne l'accorde pas explicitement :
--     grant select (nouvelle_colonne) on public.clubs to authenticated, anon;
-- tests/club-donnees-restreintes.test.mjs vérifie que toute colonne autre que les quatre fermées
-- reste lisible : il échoue si on l'oublie.
--
-- Idempotente : les droits sont recalculés à partir des colonnes existantes à chaque passage.
-- Testée en transaction annulée : tests/club-donnees-restreintes.test.sql (avec la migration 1).
-- Vérification par le chemin réel après exécution : tests/club-donnees-restreintes.test.mjs.
-- ============================================================================================

begin;

set lock_timeout = '5s';

-- ── 0. Garde-fou : la migration 1 est passée ────────────────────────────────────────────────
-- Sans elle, les lecteurs autorisés (Owner Club+, Président, Trésorier, CM pour l'annuaire…)
-- n'auraient plus AUCUN chemin vers ces données.
do $garde$
begin
  if not exists (select 1 from pg_proc where proname = 'club_donnees_restreintes' and pronamespace = 'public'::regnamespace)
     or not exists (select 1 from pg_proc where proname = 'club_membres_coordonnees' and pronamespace = 'public'::regnamespace) then
    raise exception 'club-donnees-restreintes-2 : exécuter d''abord migration-club-donnees-restreintes-1-lectures.sql. Rien n''a été modifié.';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public'
         and ((table_name = 'clubs' and column_name in ('siret', 'stripe_customer_id', 'stripe_subscription_id'))
           or (table_name = 'club_members' and column_name = 'telephone'))) <> 4 then
    raise exception 'club-donnees-restreintes-2 : les colonnes attendues ont changé. Rien n''a été modifié.';
  end if;
end $garde$;


-- ── 1. Droits de lecture colonne par colonne ────────────────────────────────────────────────
-- On retire le droit de TABLE (qui couvre toutes les colonnes, présentes et futures), puis on
-- ré-accorde chaque colonne sauf celles que les décisions ferment. La liste est lue dans le
-- catalogue au moment de l'exécution : une colonne ajoutée entre l'écriture de ce fichier et son
-- exécution est donc accordée elle aussi.
do $droits$
declare
  t record;
  cols text;
begin
  for t in select * from (values
             ('clubs',        array['siret', 'stripe_customer_id', 'stripe_subscription_id']),
             ('club_members', array['telephone'])) v(nom, fermees)
  loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns
     where table_schema = 'public' and table_name = t.nom and column_name <> all (t.fermees);

    execute format('revoke select on public.%I from anon, authenticated', t.nom);
    execute format('grant select (%s) on public.%I to anon, authenticated', cols, t.nom);
    raise notice 'club-donnees-restreintes-2 : % — lecture fermée à authenticated/anon pour %', t.nom, t.fermees;
  end loop;
end $droits$;

commit;
