-- ============================================================================================
-- migration-os-cm-perimetre-clients.sql
-- Blocage n° 2 de l'audit Review du 11/09/2026 : l'espace du CM affilié est vide dans l'OS
-- (Accueil, Mes structures, Planning à 0 pour Camille, CM affectée à SV Demo FC).
-- ============================================================================================
--
-- CE QUE L'AUDIT A ATTRIBUÉ À TORT À `profiles.niveau_cm` NUL. Le code de l'OS traite un palier
-- nul comme un CM ordinaire : `clients?select=…` directement, la RLS décidant du périmètre
-- (_cmVisibleClients, loadCmClients, loadCmDash). Mesuré le 11/09 en production : « chris fouka »,
-- CM de rôle `cm` au palier nul, voit bien ses 3 clubs dans Accueil, Mes structures et Planning.
--
-- LA VRAIE CAUSE. Les deux policies qui ouvrent au CM la fiche et le contrat d'un client exigent
-- AUSSI que le client soit dans un pôle du CM :
--     clients_cm_select_acces  : pole_scope_ok(pole_id) AND (…)
--     contrats_cm_select_acces : client_pole_scope_ok(client_id) AND (…)
-- Un CM sans affectation de pôle (Camille, dans Review : aucune ligne pole_affectations) ne voit
-- donc AUCUN client, alors que la direction lui a confié le club et que cm_clubs_autorises() —
-- l'autorité unique du périmètre CM depuis le 08/09 — le lui donne. « Mes structures » (clients)
-- et « Planning » (contrats Full Communication) restent vides ; « Mes clubs » (cm_mes_clubs, qui
-- lit l'affectation) ne l'est pas. Deux listes de clubs autorisés pour un même CM : exactement ce
-- que la règle du 08/09 interdit. Les plans et présences (mpp_cm_affecte_select,
-- pp_cm_affecte_select) suivent déjà cm_client_autorise(), sans condition de pôle.
--
-- CE QUE FAIT CETTE MIGRATION. Deux policies PERMISSIVE de lecture, réservées aux comptes de
-- rôle `cm` (est_cm_cloisonne()), qui ouvrent la fiche et les contrats d'un client DONT LE CLUB est
-- dans cm_clubs_autorises() (via cm_client_autorise(), la fonction qu'utilisent déjà les plans de
-- production). Elles ne font qu'AJOUTER des lignes, et seulement celles du périmètre officiel :
--   - aucun autre rôle n'est touché (est_cm_cloisonne() est faux pour eux) ;
--   - un CM ne voit toujours pas un club qui ne lui est pas confié ;
--   - les branches « larges » de contenus_visible_par_cm (responsable CM, paliers Club+ Studio et
--     Événement) restent bornées au pôle par les policies existantes, inchangées ;
--   - le SIRET reste fermé au CM (migration-os-cm-siret-client-*), les montants des missions aussi
--     (prestations n'a aucune policy CM).
-- Un compte OS désactivé n'a plus aucun club (cm_clubs_autorises) et la policy restrictive
-- compte_os_desactive_bloque s'applique toujours.
--
-- GARDE-FOU. Les deux policies reposent sur le sens actuel de est_cm_cloisonne() et de
-- cm_client_autorise() (production du 11/09/2026). Si l'une a changé depuis, la migration
-- s'arrête avant toute modification. Idempotente : les policies sont recréées à l'identique.
--
-- Indépendante des migrations SIRET : peut s'exécuter avant ou après elles.
-- Testée en transaction annulée : tests/os-cm-espace-et-siret.test.sql (rouge sans elle).
-- Vérification par le chemin réel après exécution : tests/os-cm-espace-et-siret.test.mjs.
-- ============================================================================================

begin;

set lock_timeout = '5s';

do $garde$
declare
  attendu constant jsonb := '{"est_cm_cloisonne": "a641cf3d990f44ae0aff36c856b9a468",
                              "cm_client_autorise": "38a5386a6752f744332ca5afb692f258"}';
  f text;
  v_md5 text;
begin
  for f in select jsonb_object_keys(attendu) loop
    select md5(pg_get_functiondef(p.oid)) into v_md5
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f;
    if v_md5 is distinct from attendu ->> f then
      raise exception 'os-cm-perimetre-clients : % a changé depuis le 11/09/2026 (md5 %). Relire la migration. Rien n''a été modifié.', f, v_md5;
    end if;
  end loop;
end $garde$;

drop policy if exists clients_cm_club_affecte_select on public.clients;
create policy clients_cm_club_affecte_select on public.clients
  for select to authenticated
  using (public.est_cm_cloisonne() and public.cm_client_autorise(id));

comment on policy clients_cm_club_affecte_select on public.clients is
  'Le CM lit la fiche client d''un club que cm_clubs_autorises() lui confie, quel que soit son pôle (audit Review du 11/09/2026).';

drop policy if exists contrats_cm_club_affecte_select on public.contrats;
create policy contrats_cm_club_affecte_select on public.contrats
  for select to authenticated
  using (public.est_cm_cloisonne() and public.cm_client_autorise(client_id));

comment on policy contrats_cm_club_affecte_select on public.contrats is
  'Le CM lit les contrats d''un club que cm_clubs_autorises() lui confie, quel que soit son pôle (audit Review du 11/09/2026).';

commit;
