-- ============================================================================================
-- migration-os-cm-siret-client-1-lecture.sql
-- Décision de Fouka (11/09/2026) : le CM SportVision ne voit pas le SIRET. Déjà appliquée au
-- SIRET des clubs (migration-club-donnees-restreintes-*), elle vaut aussi pour la fiche client
-- du CRM de l'OS : `clients.siret`.
-- ============================================================================================
--
-- LE CONSTAT. La policy clients_cm_select_acces laisse le CM lire la fiche de ses clients, et la
-- RLS filtre des LIGNES, pas des colonnes : il lit donc aussi `clients.siret` (PostgREST, avec
-- son propre jeton : `clients?select=siret` rend la valeur). Aucun écran de l'OS ne l'affiche,
-- mais n'importe quel appel direct à l'API la rend.
--
-- LA MÉTHODE, la même que pour `clubs.siret` :
--   1) CETTE migration, purement additive : une fonction de lecture autorisée, client_siret() ;
--   2) déploiement de l'OS (SportVision-OS-Full.html), qui ne demande plus jamais `*` ni
--      `siret` sur `clients` ;
--   3) migration-os-cm-siret-client-2-colonne.sql, qui retire à `authenticated` et `anon` le
--      droit de LIRE cette seule colonne.
-- Dans cet ordre, et jamais 3 avant 2 : l'OS en ligne avant le 11/09 lit `clients(*)` pour
-- ses devis, factures, avoirs et contrats, et PATCH `clients` avec `return=representation` sans
-- liste de colonnes. Avec la colonne fermée, ces requêtes échoueraient ENTIÈREMENT (42501),
-- pour tous les rôles, direction comprise.
--
-- QUI LIT LE SIRET ENSUITE (client_siret). Inventaire du 11/09/2026 : aucun écran de l'OS, de
-- Club+ ou de Connect n'affiche `clients.siret`. Il est saisi à la création d'un client (OS) et
-- lu en clé de service par clubplus-activate (détection de doublon), qui n'est pas concernée.
-- La fonction rend donc le SIRET à ceux qui peuvent déjà MODIFIER la fiche, et aux lecteurs
-- financiers qui lisent toutes les fiches, soit exactement les policies existantes moins le CM :
--   - Admin SportVision, Secrétariat, Commercial, Compta, Responsable Production, RH, dans leur
--     pôle (= clients_write_acces) ;
--   - un responsable de pôle, pour les clients de son pôle (= clients_responsable_pole_*) ;
--   - Expert-comptable et Auditeur (= clients_finance_read).
-- Personne d'autre : jamais un compte de rôle `cm` (même responsable de pôle), ni un opérateur
-- (clients_collaborateur_missions_select lui ouvre la fiche des clients de ses missions : il en
-- lisait le SIRET sans en avoir l'usage), ni un membre Club+ (cm_externe compris), ni un compte
-- OS désactivé.
--
-- GARDE-FOU. Si une fonction client_siret existe déjà avec une autre définition (d'autres
-- sessions migrent en parallèle), la migration s'arrête avant toute modification. Rejouable : un
-- second passage reconnaît sa propre définition.
--
-- Testée en transaction annulée : tests/os-cm-espace-et-siret.test.sql.
-- Vérification par le chemin réel après exécution : tests/os-cm-espace-et-siret.test.mjs.
-- ============================================================================================

begin;

set lock_timeout = '5s';

do $garde$
declare
  v_md5 text;
begin
  select md5(pg_get_functiondef(p.oid)) into v_md5
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'client_siret';
  -- Empreinte de la définition posée ci-dessous, telle que PostgreSQL la restitue.
  if v_md5 is not null and v_md5 <> '54e51b03932864481022f6de2cff743a' then
    raise exception 'os-cm-siret-client-1 : une fonction client_siret existe déjà avec une autre définition (md5 %). Rien n''a été modifié.', v_md5;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'clients' and column_name = 'siret') then
    raise exception 'os-cm-siret-client-1 : la colonne clients.siret n''existe pas. Rien n''a été modifié.';
  end if;
end $garde$;

-- Rend le SIRET d'un client à qui en a l'usage, NULL à tous les autres (y compris quand la fiche
-- n'existe pas : on ne dit pas à un compte non autorisé si un client existe).
create or replace function public.client_siret(p_client_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select cl.siret
    from clients cl
    join profiles p on p.id = auth.uid()
   where cl.id = p_client_id
     and not public.compte_os_desactive()
     -- Jamais le CM, quel que soit le chemin qui lui ouvrirait la fiche (décision du 11/09).
     and p.role <> 'cm'
     and (   (p.role in ('admin', 'sec', 'com', 'compta', 'prod', 'rh') and public.pole_scope_ok(cl.pole_id))
          or p.role in ('expert_comptable', 'auditeur')
          or public.is_pole_responsable(cl.pole_id));
$$;

comment on function public.client_siret(uuid) is
  'SIRET d''une fiche client du CRM, pour qui en a l''usage (jamais le CM). La colonne clients.siret est fermée à authenticated par migration-os-cm-siret-client-2-colonne.sql.';

-- PostgreSQL accorde EXECUTE à PUBLIC par défaut : révoquer depuis anon seul ne suffit pas.
revoke execute on function public.client_siret(uuid) from public, anon;
grant execute on function public.client_siret(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
