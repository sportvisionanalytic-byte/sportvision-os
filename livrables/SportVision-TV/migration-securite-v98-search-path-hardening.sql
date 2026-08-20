-- ============================================================================
-- migration-securite-v98-search-path-hardening.sql
-- ============================================================================
-- Suite de l'audit systématique des 148 fonctions SECURITY DEFINER (20/08,
-- voir migration-securite-v97 pour les 4 failles actives déjà corrigées).
-- 64 fonctions restantes n'ont pas de `search_path` explicite — une fonction
-- SECURITY DEFINER sans search_path fixé hérite du search_path de la SESSION
-- APPELANTE, pas d'un chemin garanti ; un rôle qui pourrait créer un objet
-- (fonction/table/vue) portant le même nom qu'un objet référencé sans
-- qualification de schéma dans le corps de la fonction pourrait le faire
-- s'exécuter à la place de l'original, avec les privilèges du DEFINER —
-- vecteur d'escalade de privilèges classique sur Postgres.
--
-- ALTER FUNCTION ... SET search_path NE MODIFIE AUCUNE LIGNE DE CODE, AUCUNE
-- LOGIQUE — pur ajout de métadonnée de configuration sur la fonction déjà
-- existante. Liste générée directement depuis pg_proc (toutes les fonctions
-- SECURITY DEFINER du schéma public sans search_path au moment de l'audit),
-- pas saisie à la main — aucun risque d'oubli ou de faute de frappe sur les
-- signatures.
-- ============================================================================

alter function accept_club_invitation(p_club_id uuid) set search_path = public;
alter function check_echeances_depenses() set search_path = public;
alter function client_valider_contenu(p_contenu_id uuid, p_decision text, p_commentaire text) set search_path = public;
alter function club_member_has_client_access(target_client_id uuid) set search_path = public;
alter function club_member_has_financial_access(target_client_id uuid) set search_path = public;
alter function club_member_has_financial_view_access(target_client_id uuid) set search_path = public;
alter function connect_os_account_detail(p_user_id uuid) set search_path = public;
alter function connect_os_accounts_list() set search_path = public;
alter function contenus_protect_cm_id_reassignment() set search_path = public;
alter function contenus_valider_transition_statut() set search_path = public;
alter function contenus_visible_par_cm(p_client_id uuid, p_uid uuid) set search_path = public;
alter function credit_organization(p_organization_id uuid, p_amount integer, p_label text) set search_path = public;
alter function decline_club_invitation(p_club_id uuid) set search_path = public;
alter function enqueue_notification(p_event_type text, p_template_key text, p_channel text, p_idempotency_key text, p_recipient_email text, p_recipient_phone text, p_recipient_user_id uuid, p_recipient_client_id uuid, p_entity_type text, p_entity_id uuid, p_payload jsonb, p_scheduled_at timestamp with time zone) set search_path = public;
alter function get_my_role() set search_path = public;
alter function handle_new_user() set search_path = public;
alter function handle_user_invited() set search_path = public;
alter function is_club_admin(target_club_id uuid) set search_path = public;
alter function is_club_member(target_club_id uuid) set search_path = public;
alter function is_confirmed_parent_of(p_player_id uuid) set search_path = public;
alter function is_family_of_team(p_team_id uuid) set search_path = public;
alter function is_media_visible_to_family(p_media_ref_type text, p_media_ref_id uuid) set search_path = public;
alter function is_org_admin(p_organization_id uuid) set search_path = public;
alter function is_org_member(p_org_id uuid) set search_path = public;
alter function is_own_player(p_player_id uuid) set search_path = public;
alter function is_staff() set search_path = public;
alter function is_team_educateur(p_team_id uuid) set search_path = public;
alter function log_equipe_change() set search_path = public;
alter function log_prestation_statut_change() set search_path = public;
alter function media_has_unauthorized_tagged_player(p_media_ref_type text, p_media_ref_id uuid) set search_path = public;
alter function media_ref_club_id(p_media_ref_type text, p_media_ref_id uuid) set search_path = public;
alter function notify_client_members(p_client_id uuid, p_category text, p_title text, p_body text, p_target_href text) set search_path = public;
alter function notify_media_livraison_envoyee() set search_path = public;
alter function parent_visible_to_club_admin(target_parent_id uuid) set search_path = public;
alter function player_has_client_access(target_client_id uuid) set search_path = public;
alter function protect_client_cm_assignment() set search_path = public;
alter function protect_prestation_operational_fields() set search_path = public;
alter function protect_sensitive_affectation_fields() set search_path = public;
alter function protect_sensitive_client_user_fields() set search_path = public;
alter function protect_sensitive_club_fields() set search_path = public;
alter function protect_sensitive_club_match_fields() set search_path = public;
alter function protect_sensitive_club_member_fields() set search_path = public;
alter function protect_sensitive_club_request_fields() set search_path = public;
alter function protect_sensitive_formation_inscription_fields() set search_path = public;
alter function protect_sensitive_incident_fields() set search_path = public;
alter function protect_sensitive_kit_reservation_fields() set search_path = public;
alter function protect_sensitive_membership_fields() set search_path = public;
alter function protect_sensitive_ppr_fields() set search_path = public;
alter function protect_sensitive_prestation_fields() set search_path = public;
alter function protect_sensitive_profile_fields() set search_path = public;
alter function protect_sensitive_request_fields() set search_path = public;
alter function protect_sensitive_retractation_fields() set search_path = public;
alter function protect_sensitive_team_project_draft_fields() set search_path = public;
alter function resolve_player_client_id(p_player_id uuid) set search_path = public;
alter function send_prestation_reminders() set search_path = public;
alter function submit_request(p_organization_id uuid, p_type text, p_urgency text, p_detail text, p_credits integer) set search_path = public;
alter function sync_client_cm_principal() set search_path = public;
alter function sync_client_to_organization() set search_path = public;
alter function sync_client_user_to_membership() set search_path = public;
alter function sync_club_member_to_membership() set search_path = public;
alter function sync_club_to_organization() set search_path = public;
alter function trg_notify_contenu_a_valider() set search_path = public;
alter function trg_notify_facture_statut() set search_path = public;
alter function validate_prestation_statut_transition() set search_path = public;

-- ============================================================================
-- Vérifié après écriture : requête sur pg_proc confirmant 0 fonction SECURITY
-- DEFINER restante sans search_path dans le schéma public. Spot-check
-- fonctionnel sur is_staff()/is_club_member()/resolve_player_client_id()
-- (appelées des centaines de fois par nuit par le reste du système) :
-- comportement identique avant/après pour un appel réel.
-- ============================================================================
