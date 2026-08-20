-- ============================================================================
-- migration-clubplus-v92-credits-guard.sql
-- ============================================================================
-- CONSTAT (trouvé et vérifié EN LIVE par un agent dédié à la certification E2E
-- Club+→OS, 20/08 nuit) : submit_club_request() (RPC appelée par app-next pour
-- soumettre une "demande de visuel" et réserver des crédits) n'a AUCUN garde-
-- fou côté serveur empêchant de réserver plus de crédits que le club n'en a
-- de disponibles. Le seul contrôle existant est côté client (app-next/src/
-- app/(app)/[clubId]/requests/new/page.tsx:100-101) — un simple appel direct
-- à la RPC (contournant le formulaire) suffit à casser le solde.
--
-- REPRODUIT EN LIVE avant d'écrire ce fichier (club/user jetables, nettoyés
-- ensuite, résidu vérifié à zéro) : appel submit_club_request(p_credits:100)
-- contre un club à credits_balance=10/credits_reserved=2 → a réussi, laissant
-- credits_reserved=102 pour un solde de 10. Exploitable par n'importe quel
-- membre de club (pas besoin de rôle admin), et crée aussi un risque de race
-- condition sur deux soumissions légitimes simultanées (lecture du solde puis
-- écriture, sans verrou entre les deux).
--
-- CE QUE FAIT CE FICHIER :
--   - Redéfinit submit_club_request() avec EXACTEMENT la même signature et le
--     même type de retour (CREATE OR REPLACE, aucun changement d'appel côté
--     app-next nécessaire).
--   - Verrouille la ligne clubs (SELECT ... FOR UPDATE) avant de lire le
--     solde, pour fermer la race condition en plus du dépassement.
--   - Rejette la demande (exception, même style que le garde is_club_member
--     déjà présent) si credits_reserved + p_credits > credits_balance.
--   - Ne touche à rien d'autre : le comportement pour une demande dans la
--     limite du solde disponible est identique à avant.
-- ============================================================================

create or replace function public.submit_club_request(
  p_club_id uuid, p_team text, p_type text, p_urgency text, p_detail text, p_credits integer
)
returns club_requests
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_row club_requests;
  v_name text;
  v_balance integer;
  v_reserved integer;
begin
  if not is_club_member(p_club_id) then
    raise exception 'Accès refusé : vous n''êtes pas membre actif de ce club.';
  end if;

  -- Verrou de la ligne club AVANT de lire le solde : ferme la fenêtre de race
  -- condition entre deux soumissions concurrentes (chacune attend son tour
  -- pour lire un solde à jour, pas un solde périmé lu avant l'écriture de
  -- l'autre transaction).
  select credits_balance, credits_reserved into v_balance, v_reserved
    from clubs where id = p_club_id for update;

  if coalesce(p_credits, 0) > 0 and (coalesce(v_reserved,0) + p_credits) > coalesce(v_balance,0) then
    raise exception 'Crédits insuffisants : % crédits demandés, % disponibles (solde % - % déjà réservés).',
      p_credits, greatest(coalesce(v_balance,0) - coalesce(v_reserved,0), 0), coalesce(v_balance,0), coalesce(v_reserved,0);
  end if;

  select trim(coalesce(prenom,'') || ' ' || coalesce(nom,'')) into v_name
    from club_members where user_id = auth.uid() and club_id = p_club_id limit 1;

  insert into club_requests (club_id, team, type, requester_id, requester_name, status, urgency, detail, credits_reserved)
  values (p_club_id, p_team, p_type, auth.uid(), nullif(v_name, ''), 'recues', coalesce(p_urgency,'normale'), p_detail, coalesce(p_credits, 0))
  returning * into v_row;

  if coalesce(p_credits, 0) > 0 then
    perform set_config('app.trusted_credit_op', 'true', true);
    update clubs set credits_reserved = credits_reserved + p_credits where id = p_club_id;
  end if;

  return v_row;
end;
$function$;

-- ============================================================================
-- Vérifié après écriture (E2E, club/user jetables, nettoyés, résidu à zéro) :
-- 1) même appel qu'avant (credits <= disponible) → toujours accepté, résultat
--    identique à l'ancien comportement.
-- 2) appel avec credits > disponible → rejeté avec le message d'erreur ci-
--    dessus, AUCUNE ligne club_requests créée, credits_reserved inchangé.
-- ============================================================================
