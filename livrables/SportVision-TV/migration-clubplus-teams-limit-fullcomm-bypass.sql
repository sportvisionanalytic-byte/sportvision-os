-- ============================================================================
-- migration-clubplus-teams-limit-fullcomm-bypass.sql
-- ============================================================================
-- Bug réel trouvé le 23/08/2026 : V340 SC (Full Communication actif, entitlements
-- débloqués par migration-clubplus-fullcomm-auto-entitlements.sql) ne pouvait
-- toujours pas créer une 2e équipe — "Plafond d'équipes atteint pour ce plan
-- (1 équipe(s) maximum)". check_club_teams_limit() plafonne selon `clubs.plan`
-- ('free'→1, 'club'→2, sinon illimité) mais ne connaît absolument rien des
-- contrats Full Communication (`clubs.plan` reste 'free' pour ce club, jamais
-- mis à jour — Full Communication est un contrat commercial, pas un plan
-- Club+ vendu par abonnement, même logique que buildClubActiveContext/
-- isFullCommunication côté app-next). Même famille de trou que les
-- entitlements : un pont jamais construit entre "contrat Full Communication
-- actif" et cette limite précise, pas une régression.
-- ============================================================================

create or replace function check_club_teams_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_plan text;
  v_portail_client_id uuid;
  v_is_full_comm boolean := false;
  v_max_teams int;
  v_current_count int;
begin
  select plan, portail_client_id into v_plan, v_portail_client_id from clubs where id = new.club_id;

  if v_portail_client_id is not null then
    select exists (
      select 1 from contrats c
      where c.client_id = v_portail_client_id
        and c.type_contrat = 'full_communication'
        and c.statut = 'actif'
    ) into v_is_full_comm;
  end if;

  if v_is_full_comm then
    return new; -- Full Communication : aucun plafond d'équipes, tout est inclus
  end if;

  v_max_teams := case v_plan
    when 'free' then 1
    when 'club' then 2
    else null -- 'performance' et tout plan non reconnu : pas de plafond posé ici
  end;

  if v_max_teams is not null then
    select count(*) into v_current_count from club_teams where club_id = new.club_id;
    if v_current_count >= v_max_teams then
      raise exception 'Plafond d''équipes atteint pour ce plan (% équipe(s) maximum). Passez à une formule supérieure pour créer davantage d''équipes.', v_max_teams
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;
