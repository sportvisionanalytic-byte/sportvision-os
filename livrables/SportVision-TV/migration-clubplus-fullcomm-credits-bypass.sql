-- ============================================================================
-- migration-clubplus-fullcomm-credits-bypass.sql
-- ============================================================================
-- Bug réel trouvé par l'audit complet du 25/08/2026 (3e occurrence de la même
-- famille que check_club_teams_limit / plafond utilisateurs clubplus-invite,
-- déjà corrigés le 23/08) : submit_club_request() compare le crédit demandé à
-- clubs.credits_balance, qui reste à 0 pour un club Full Communication (ce
-- n'est pas un plan à crédits vendu, c'est un contrat commercial, jamais
-- synchronisé sur clubs.credits_balance). V340 SC (Full Communication actif)
-- ne pouvait donc soumettre AUCUNE demande de visuel ni création Studio.
--
-- Bypass : si le club a un contrat Full Communication actif (via
-- clubs.portail_client_id -> contrats.client_id), la contrainte de solde ne
-- s'applique pas, ET credits_reserved n'est pas incrémenté (le crédit n'a
-- aucun sens pour ce type de contrat, inutile de le faire grossir sans
-- jamais être consommé/remis à zéro).
-- ============================================================================

create or replace function submit_club_request(p_club_id uuid, p_team text, p_type text, p_urgency text, p_detail text, p_credits integer)
returns club_requests
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row club_requests;
  v_name text;
  v_balance integer;
  v_reserved integer;
  v_portail_client_id uuid;
  v_is_full_comm boolean := false;
begin
  if not is_club_member(p_club_id) then
    raise exception 'Accès refusé : vous n''êtes pas membre actif de ce club.';
  end if;

  -- Verrou de la ligne club AVANT de lire le solde : ferme la fenêtre de race
  -- condition entre deux soumissions concurrentes (chacune attend son tour
  -- pour lire un solde à jour, pas un solde périmé lu avant l'écriture de
  -- l'autre transaction).
  select credits_balance, credits_reserved, portail_client_id into v_balance, v_reserved, v_portail_client_id
    from clubs where id = p_club_id for update;

  if v_portail_client_id is not null then
    select exists (
      select 1 from contrats c
      where c.client_id = v_portail_client_id
        and c.type_contrat = 'full_communication'
        and c.statut = 'actif'
    ) into v_is_full_comm;
  end if;

  if not v_is_full_comm and coalesce(p_credits, 0) > 0 and (coalesce(v_reserved,0) + p_credits) > coalesce(v_balance,0) then
    raise exception 'Crédits insuffisants : % crédits demandés, % disponibles (solde % - % déjà réservés).',
      p_credits, greatest(coalesce(v_balance,0) - coalesce(v_reserved,0), 0), coalesce(v_balance,0), coalesce(v_reserved,0);
  end if;

  select trim(coalesce(prenom,'') || ' ' || coalesce(nom,'')) into v_name
    from club_members where user_id = auth.uid() and club_id = p_club_id limit 1;

  insert into club_requests (club_id, team, type, requester_id, requester_name, status, urgency, detail, credits_reserved)
  values (p_club_id, p_team, p_type, auth.uid(), nullif(v_name, ''), 'recues', coalesce(p_urgency,'normale'), p_detail, case when v_is_full_comm then 0 else coalesce(p_credits, 0) end)
  returning * into v_row;

  if not v_is_full_comm and coalesce(p_credits, 0) > 0 then
    perform set_config('app.trusted_credit_op', 'true', true);
    update clubs set credits_reserved = credits_reserved + p_credits where id = p_club_id;
  end if;

  return v_row;
end;
$$;
