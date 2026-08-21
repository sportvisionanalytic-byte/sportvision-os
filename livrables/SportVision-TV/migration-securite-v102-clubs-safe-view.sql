-- ============================================================================
-- migration-securite-v102-clubs-safe-view.sql
-- ============================================================================
-- Trouvé par l'audit pré-lancement du 21/08 (agent Club+, INC-046) : la
-- policy RLS `clubs_member_select` (`is_club_member(id)`) autorise la lecture
-- de la ligne `clubs` ENTIÈRE à tout membre actif, sans distinction de rôle.
-- Testé et confirmé en direct : un `coach` (rôle "zéro finance" côté produit)
-- et même un CM externe délégué (`cm_agency_club_access`, scope limité à
-- contenus/demandes) peuvent lire `stripe_customer_id`/`stripe_subscription_id`
-- /`subscription_status`/`credits_balance`/`credits_reserved`/`credits_monthly`
-- via un simple GET REST. Écriture déjà bloquée (testé), donc pas de fraude
-- possible — fuite de confidentialité uniquement.
--
-- RLS filtre des LIGNES, pas des colonnes : impossible de faire varier
-- l'accès à une colonne par rôle du membre via une seule policy sur la table
-- de base sans casser la lecture légitime des rôles financiers (admin,
-- president, tresorier, membre_bureau, secretaire, administratif). Solution
-- retenue : une VUE additive, `security_invoker = true` (PG15+, le vrai
-- appelant — pas le propriétaire de la vue — voit sa propre RLS s'appliquer,
-- volontairement l'inverse du problème qui avait causé INC-036 sur les vues
-- client_*), qui masque les colonnes sensibles à `null` pour qui n'a pas le
-- droit financier. Réutilise `club_member_has_financial_view_access()`
-- (déjà utilisée pour `client_contrats`/`client_factures`), qui ne couvre
-- QUE la liste blanche de rôles bureau via `club_members` direct — un CM
-- externe délégué via `cm_agency_club_access` en est donc exclu, exactement
-- le comportement voulu ici.
--
-- N'ALTÈRE PAS `clubs` ni sa policy existante (zéro risque de régression sur
-- les lectures/écritures déjà en place). Additive et idempotente
-- (create or replace view). Migration du code frontend vers cette vue pour
-- les écrans qui n'ont pas besoin des champs financiers : NON FAITE cette
-- nuit (nécessite d'auditer chaque point d'appel `clubs.*` dans app-next,
-- risque de régression trop élevé pour un correctif à l'aveugle en fin de
-- nuit) — cette migration ne fait qu'ajouter la capacité, la bascule
-- frontend est un chantier séparé à mener avec des tests par écran.
-- ============================================================================

create or replace view clubs_safe
with (security_invoker = true) as
select
  id,
  nom,
  ville,
  discipline,
  saison,
  plan,
  engagement,
  pilot_mode,
  case when club_member_has_financial_view_access(portail_client_id) then credits_balance else null end as credits_balance,
  case when club_member_has_financial_view_access(portail_client_id) then credits_monthly else null end as credits_monthly,
  case when club_member_has_financial_view_access(portail_client_id) then credits_reserved else null end as credits_reserved,
  created_at,
  updated_at,
  logo_url,
  ecusson_url,
  portail_client_id,
  role_permissions,
  membership_validation_mode,
  case when club_member_has_financial_view_access(portail_client_id) then stripe_customer_id else null end as stripe_customer_id,
  case when club_member_has_financial_view_access(portail_client_id) then stripe_subscription_id else null end as stripe_subscription_id,
  case when club_member_has_financial_view_access(portail_client_id) then subscription_status else null end as subscription_status,
  requires_result_verification,
  adresse,
  instagram_handle,
  siret,
  couleur_primaire,
  couleur_secondaire
from clubs;

grant select on clubs_safe to authenticated;
-- Jamais d'écriture sur cette vue : ce n'est pas son rôle (toute écriture réelle continue de
-- passer par `clubs` directement, gouvernée par ses policies existantes, ou par les RPC dédiées).
revoke insert, update, delete, truncate on clubs_safe from authenticated, anon;

-- ============================================================================
-- Vérifié après exécution : SELECT sur clubs_safe avec un rôle admin/tresorier
-- de club renvoie les champs financiers normalement ; avec un rôle coach ou
-- un CM externe délégué (cm_agency_club_access), les 6 champs financiers
-- reviennent `null`, tous les autres champs restent visibles normalement.
-- La table clubs elle-même et sa policy RLS existante restent inchangées.
-- ============================================================================
