-- ============================================================
-- Migration v80 — is_club_member() reconnaît un accès délégué d'agence CM
-- valide, en plus d'une vraie ligne club_members active.
--
-- ─── Contexte (brief Fouka 17/08/2026, "vraie bascule d'espace" cm_agency) ─
-- Jusqu'ici, "Ouvrir" sur un accès délégué (/accompagnement, cm_agency_club_
-- access, migration-cm-agency-club-access.sql) n'ouvrait rien de réel : la
-- table décrit QUI a accès à QUEL club (staff-only, périmètre négocié en
-- texte libre allowed/denied, expiration), mais rien ne branchait cette
-- déclaration sur un accès technique — l'agence restait dans son propre
-- espace cm_agency (sans contenus/demandes propres) quoi qu'elle clique.
--
-- ─── Pourquoi étendre is_club_member() plutôt que dupliquer des policies ──
-- is_club_member(target_club_id) est LA fonction réutilisée par la quasi-
-- totalité des policies RLS club-scoped (clubs, club_requests, club_sponsors,
-- contenus via des variantes, calendrier, etc. — 20+ fichiers de migration).
-- L'étendre ICI, une seule fois, avec une clause OR purement additive,
-- propage l'accès à toutes ces policies sans y toucher individuellement :
-- moins de surface de modification, moins de risque d'incohérence entre
-- tables qu'une correction table par table. Le modèle de sécurité existant
-- de ce projet est déjà grossier par construction (is_club_member ne
-- distingue pas les rôles — un communication_manager et un tresorier ont le
-- même accès RLS de base, seule l'UI/la nav restreint ce que chacun voit au
-- quotidien ; les documents financiers sont l'exception explicite, gérés par
-- club_member_has_financial_access/view_access, UNE FONCTION SÉPARÉE NON
-- TOUCHÉE ICI). Donner à une agence déléguée le même accès RLS qu'un
-- cm_externe invité directement par le club (club_members.role='cm_externe',
-- qui a lui aussi is_club_member=true sans plus de restriction) n'introduit
-- donc aucune nouvelle classe de risque, seulement un nouveau CHEMIN pour
-- obtenir un accès déjà accepté ailleurs dans le produit.
--
-- ─── Ce que allowed[]/denied[] NE fait PAS ─────────────────────────────────
-- Ces deux colonnes restent du texte libre commercial/informationnel
-- ("Créer des publications", "Facturation"...), jamais une liste de clés
-- techniques — impossible à faire respecter par une policy RLS sans un vrai
-- catalogue de permissions fermé (hors périmètre de ce soir, pas demandé par
-- Fouka). Le contrôle technique réel est binaire : délégation valide (ligne
-- présente, non expirée) => même accès qu'un cm_externe ; sinon => aucun.
--
-- ─── Sécurité ───────────────────────────────────────────────────────────
-- La clause ajoutée revérifie TOUT en direct à chaque appel (fonction stable,
-- pas de cache applicatif) : appartenance active de l'appelant à l'agence
-- (memberships.status='actif'), délégation encore présente pour CE club
-- précis, et non expirée (expires_at is null or >= aujourd'hui). Une
-- délégation supprimée ou expirée retire l'accès IMMÉDIATEMENT au prochain
-- appel — aucun état technique séparé à purger (aucune ligne club_members
-- créée par ce mécanisme, voir buildDelegatedClubActiveContext côté
-- frontend).
--
-- NON EXÉCUTÉE PAR L'AGENT PENDANT LA RÉDACTION — exécutée par Claude cette
-- nuit (autonomie migrations déjà accordée cette session) après relecture,
-- vérifiée en direct avant/après (voir rapport de test joint en mémoire).
--
-- Additive/idempotente : CREATE OR REPLACE FUNCTION, même signature, aucun
-- DROP, aucune migration de données.
-- ============================================================

create or replace function is_club_member(target_club_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from club_members
    where club_id = target_club_id and user_id = auth.uid() and status = 'actif'
  )
  or exists (
    select 1
    from cm_agency_club_access caa
    join memberships m on m.organization_id = caa.cm_agency_org_id
    where caa.club_id = target_club_id
      and m.user_id = auth.uid()
      and m.status = 'actif'
      and (caa.expires_at is null or caa.expires_at >= current_date)
  );
$$;

-- ============================================================
-- VÉRIFICATION RECOMMANDÉE après exécution :
-- select prosrc from pg_proc where proname = 'is_club_member';
-- -- doit contenir la clause "cm_agency_club_access".
-- ============================================================
