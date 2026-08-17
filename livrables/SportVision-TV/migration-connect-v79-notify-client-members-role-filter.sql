-- ============================================================
-- EXÉCUTÉE par Claude le 17/08/2026 (API Management Supabase, demande
-- explicite de Fouka "vasy" sur les 4 findings de l'audit complet Club+).
-- Vérifiée en direct : prosrc confirmé, test positif/négatif réalisé sur un
-- club/2 comptes de test isolés (coach ne reçoit rien, admin reçoit la
-- notification), toutes les données de test supprimées après coup.
--
-- Migration v79 — notify_client_members() : filtre par rôle pour les
-- catégories financières (payments, contracts).
--
-- ─── Constat (audit complet Club+, 17/08/2026) ────────────────────────────
-- notify_client_members() (migration-connect-v16-member-notifications.sql)
-- notifie TOUT club_member actif du club, quel que soit son rôle, y compris
-- pour les notifications de facture (trg_notify_facture_statut, catégorie
-- 'payments'). CLUB-PLUS-PRODUCT-BIBLE.md §21 : "Catégories adaptées au
-- rôle ; ne pas montrer un filtre Finance au Coach." — un Coach ou un CM
-- externe reçoit aujourd'hui "Facture en retard" dans sa cloche alors que
-- rien dans son interface ne lui permet d'agir dessus.
--
-- Réutilise le même rôle-scope que club_member_has_financial_view_access()
-- (migration-clubplus-v41-secretaire-administratif-lecture-financiere.sql,
-- exécutée et vérifiée en direct le 17/08/2026) : ce sont exactement les
-- rôles qui peuvent déjà VOIR les documents financiers (client_devis/
-- client_factures/client_contrats) — cohérent d'y limiter aussi les
-- notifications qui en parlent, plutôt que d'inventer une deuxième liste.
--
-- Portée volontairement limitée aux catégories 'payments' et 'contracts' :
-- les autres catégories (content, requests, services, calendar, users,
-- system) n'ont aujourd'hui aucun trigger qui appelle notify_client_members
-- avec elles pour un motif financier — pas de raison de les restreindre.
--
-- Additive/idempotente : CREATE OR REPLACE FUNCTION, même signature, aucune
-- migration de données, aucun DROP.
-- ============================================================

create or replace function notify_client_members(
  p_client_id uuid, p_category text, p_title text, p_body text, p_target_href text
)
returns void language plpgsql security definer as $$
begin
  insert into member_notifications (user_id, category, title, body, target_href)
  select cu.id, p_category, p_title, p_body, p_target_href
  from client_users cu where cu.client_id = p_client_id;

  insert into member_notifications (user_id, category, title, body, target_href)
  select cm.user_id, p_category, p_title, p_body, p_target_href
  from club_members cm
  join clubs c on c.id = cm.club_id
  where c.portail_client_id = p_client_id
    and cm.status = 'actif'
    and (
      p_category not in ('payments', 'contracts')
      or cm.role in ('admin', 'president', 'tresorier', 'membre_bureau', 'secretaire', 'administratif')
    );
end;
$$;

-- ============================================================
-- VÉRIFICATION RECOMMANDÉE après exécution :
-- select prosrc from pg_proc where proname = 'notify_client_members';
-- -- doit contenir la clause "p_category not in ('payments', 'contracts')".
-- ============================================================
