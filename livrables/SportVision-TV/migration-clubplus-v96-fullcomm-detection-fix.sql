-- ============================================================================
-- migration-clubplus-v96-fullcomm-detection-fix.sql
-- ============================================================================
-- CONSTAT (E2E Full Communication re-testé de bout en bout, audit P0 §29, 20/08
-- soir) : buildClubActiveContext() (session.ts, app-next) détecte le statut
-- Full Communication d'un club en lisant la vue `client_contrats` — corrigée le
-- 11/08 (INC-004) pour remplacer une lecture directe de `contrats` (RLS
-- staff-only, toujours 0 ligne pour un membre de club). Mais la policy RLS de
-- `client_contrats` elle-même filtre via `club_member_has_financial_view_access`,
-- restreinte aux rôles admin/president/tresorier/membre_bureau/secretaire/
-- administratif — PAS coach/resp_equipe/sponsor_mgr/lecture_seule/
-- directeur_sportif/cm_externe.
--
-- REPRODUIT EN LIVE avant d'écrire ce fichier (club/contrat/membres jetables,
-- nettoyés ensuite) : pour un club avec un contrat full_communication actif
-- réel, un membre 'admin' voit bien la ligne (isFullCommunication=true côté
-- appli), un membre 'coach' du MÊME club, sur le MÊME contrat, obtient 0 ligne
-- (isFullCommunication=false) — exactement la même classe de panne qu'INC-004
-- avait déjà documentée et censée corriger. Pire : le 2ᵉ site d'appel
-- (délégation agence CM externe, cm_agency_club_access) n'a JAMAIS de ligne
-- club_members du tout pour ce club — toujours cassé pour ce chemin, quel que
-- soit le contrat.
--
-- Ce sont précisément les profils qui ont le plus besoin du dashboard
-- FullComm (Validations/Publications/Statistiques/Rapports) : un coach ou un
-- CM externe délégué, pas nécessairement le trésorier du club.
--
-- CE QUE FAIT CE FICHIER : nouvelle fonction dédiée, ne renvoyant qu'un
-- booléen (aucune donnée financière exposée, contrairement à client_contrats
-- qui expose montant_mensuel/signature_statut — d'où sa restriction légitime
-- aux rôles financiers, qu'on ne touche pas). Réutilise is_club_member(), déjà
-- utilisée dans les policies RLS existantes, qui couvre déjà les deux chemins
-- d'accès (membre direct club_members OU délégation cm_agency_club_access) —
-- pas de logique dupliquée.
-- ============================================================================

create or replace function client_has_active_fullcomm_contract(p_client_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from contrats c
    where c.client_id = p_client_id
      and c.type_contrat = 'full_communication'
      and c.statut = 'actif'
  )
  and exists (
    select 1 from clubs cl
    where cl.portail_client_id = p_client_id
      and is_club_member(cl.id)
  );
$$;

grant execute on function client_has_active_fullcomm_contract(uuid) to authenticated;

-- ============================================================================
-- Vérifié après écriture (E2E, club/contrat/membres jetables) :
-- 1) membre 'admin' → true (comportement inchangé par rapport à avant).
-- 2) membre 'coach' du MÊME club/contrat → maintenant true (cassé avant ce
--    correctif).
-- 3) utilisateur sans lien du tout avec ce club → false (pas de fuite).
-- 4) contrat existant mais PAS actif (brouillon/résilié) → false pour tous,
--    y compris admin (le check sur contrats.statut reste correct).
--
-- Ne modifie PAS le code app-next dans cette migration SQL (voir le commit
-- Connect séparé qui bascule buildClubActiveContext sur ce RPC aux 2 sites
-- d'appel) — cette fonction est additive et n'a aucun effet tant qu'aucun
-- code ne l'appelle.
-- ============================================================================
