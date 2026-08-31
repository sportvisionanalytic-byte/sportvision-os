-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v90
-- CRITIQUE — corrige un contournement d'autorisation (IDOR) sur client_mark_message_read,
-- introduit par migration-connect-v88-fix-client-mark-message-read-particulier.sql (30/08/2026).
--
-- Trouvé et EXPLOITÉ en réel pendant l'audit "repasse fraîche" du 31/08/2026 (deux comptes de
-- test particuliers distincts A et B, aucun lien entre eux — B a réussi à marquer comme lu un
-- message staff appartenant à A via un appel RPC direct, hors UI) :
--
--   supabase.rpc('client_mark_message_read', { p_message_id: <message d'un autre client> })
--   → aucune erreur, `lu` passe bien à true en base pour B, alors que B n'a aucun droit sur ce
--     client_id.
--
-- CAUSE : la fonction (v88) vérifie l'autorisation avec
--   if not ( cond1 or cond2 or ... or connect_owner_client_id(auth.uid()) = v_client_id or ... )
--   then raise exception 'Non autorise'; end if;
--
-- connect_owner_client_id(auth.uid()) renvoie NULL (pas d'exception, juste NULL) pour tout
-- appelant sans ligne player_profiles NI connect_profile_settings.client_id résolue (cas réel :
-- un compte flambant neuf, ou tout compte qui n'a encore jamais ouvert /messages ni /particulier
-- pour déclencher connect_resolve_beneficiary_client_id). `NULL = v_client_id` s'évalue à NULL
-- (jamais false) — dès que TOUTES les autres conditions valent false pour cet appelant (ce qui
-- est le cas général pour un compte sans aucun lien avec le client ciblé), le OR global devient
-- NULL au lieu de false. En PL/pgSQL, `if not (NULL) then ... end if;` = `if NULL then` : une
-- condition NULL est traitée comme FAUSSE dans un IF — le bloc `raise exception` ne s'exécute
-- JAMAIS dans ce cas précis, et l'exécution tombe directement dans le `update ... set lu = true`
-- SANS AUCUNE vérification d'autorisation. Cette même expression, utilisée telle quelle en RLS
-- (USING/WITH CHECK), aurait été sûre : Postgres traite un qual RLS NULL comme "ligne invisible"
-- (fail-closed) — c'est le fait de la réutiliser dans un `if not (...)` PL/pgSQL, où NULL est
-- fail-OPEN, qui introduit la faille. Recherché en base (pg_proc) : aucune autre fonction du
-- schéma public ne combine ce même piège (if not (...) + connect_owner_client_id) — un seul
-- endroit à corriger.
--
-- IMPACT réel : n'importe quel compte authentifié sans client_id résolu peut faire disparaître
-- silencieusement le badge "non lu" de N'IMPORTE QUEL message staff de N'IMPORTE QUEL autre
-- client Connect (id de message devinable/énumérable par force brute d'UUID v4 en pratique
-- négligeable, mais un id de message peut aussi fuiter par un autre canal — capture réseau,
-- lien partagé, etc.). Aucune lecture de contenu ni écriture de message n'est possible par ce
-- biais (colonne `lu` uniquement) — pas d'exfiltration de données, mais un contournement
-- d'autorisation réel et vérifié, à corriger indépendamment de la gravité de l'impact.
--
-- CORRECTIF : force l'expression d'autorisation à un booléen strict avec COALESCE(..., false)
-- AVANT de la nier — plus aucune valeur NULL ne peut atteindre le NOT. Signature, comportement
-- best-effort côté appelant (MessagesThread.tsx avale déjà l'erreur) et toutes les branches
-- d'autorisation elles-mêmes inchangés.
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

  if not coalesce(
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
    ),
    false
  ) then
    raise exception 'Non autorise';
  end if;

  update messages_client set lu = true where id = p_message_id;
end;
$function$;
