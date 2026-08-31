-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v88
-- Corrige client_mark_message_read(p_message_id) : reproduit et confirmé en réel pendant
-- l'audit complet de l'Espace particulier du 30-31/08/2026 (compte de test
-- test-audit-connect-particulier-*@sportvision-an.fr) — ouvrir /particulier/messages avec un
-- message de bienvenue non lu déclenche systématiquement un 400 "Non autorise" sur cet appel
-- (MessagesThread.tsx, useEffect de marquage automatique à l'ouverture du fil).
--
-- CAUSE : cette fonction (voir sa définition d'origine, non datée/non migrée par une migration
-- retrouvée dans ce dossier — probablement antérieure à l'Espace particulier) n'autorise QUE
-- deux chemins d'accès :
--   1. client_users (compte lié historique)
--   2. player_has_client_access (nécessite une ligne player_profiles pour auth.uid())
--
-- Or connect_resolve_beneficiary_client_id (migration-connect-v51-espace-particulier.sql) et la
-- politique RLS réelle de messages_client (mc_client_select/mc_client_insert, vérifiées en base)
-- reconnaissent QUATRE chemins supplémentaires, tous utilisés par l'Espace particulier et
-- absents de client_mark_message_read :
--   - connect_owner_client_id(auth.uid()) = client_id     (compte particulier "self", sans club)
--   - connect_access_relationships (sportif "linked" avec right_voir accordé)
--   - managed_athlete_profiles (profil "géré" — enfant sans compte propre)
--   - club_member_has_client_access (déjà présent en RLS, absent ici par la même incohérence)
--
-- Résultat avant correctif : TOUT compte particulier (self, sportif lié, ou profil géré) reçoit
-- systématiquement une erreur "Non autorise" en tentant de marquer un message comme lu — le
-- badge non-lu reste donc affiché indéfiniment pour ces trois cas, uniquement pour les comptes
-- Espace joueur affiliés à un club (player_profiles) le marquage fonctionnait déjà.
--
-- CORRECTIF : aligne strictement l'autorisation de client_mark_message_read sur celle de la RLS
-- mc_client_select (même liste de conditions OR), sans changer la signature ni le comportement
-- "best-effort" côté appelant (MessagesThread.tsx avale déjà l'erreur en try/catch).
-- ============================================================

CREATE OR REPLACE FUNCTION public.client_mark_message_read(p_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client_id uuid;
begin
  select client_id into v_client_id from messages_client where id = p_message_id and auteur_type = 'staff';

  if v_client_id is null then
    return;
  end if;

  if not (
    exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = v_client_id)
    or player_has_client_access(v_client_id)
    or club_member_has_client_access(v_client_id)
    or connect_owner_client_id(auth.uid()) = v_client_id
    or exists (
      select 1 from connect_access_relationships car
      where car.grantee_user_id = auth.uid()
        and car.status = 'acceptee'
        and car.right_voir
        and connect_owner_client_id(car.owner_user_id) = v_client_id
    )
    or exists (
      select 1 from managed_athlete_profiles map
      where map.owner_user_id = auth.uid() and map.client_id = v_client_id
    )
  ) then
    raise exception 'Non autorise';
  end if;

  update messages_client set lu = true where id = p_message_id;
end;
$function$;
