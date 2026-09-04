-- ============================================================================
-- migration-clubplus-v55-exclure-cm-agency-validation-affiliation.sql (03/09/2026)
-- ============================================================================
-- Demande explicite de Fouka (03/09/2026, chantier "effectifs/Smart Links/QR") : un CM
-- SportVision (y compris un CM délégué à un club via cm_agency_club_access) ne doit jamais
-- valider une affiliation joueur/parent — ce n'est pas son rôle métier et ça lui donne accès à
-- des décisions sur des données familiales dont il n'a pas besoin. Voir aussi la règle générale
-- déjà posée le même jour : coach de l'équipe OU admin Club+ valident, jamais le CM.
--
-- MAIS is_club_admin()/is_team_educateur() traitent DÉJÀ un cm_agency délégué comme un admin/coach
-- à part entière (migration-cm-delegation-droits-etendus.sql, 22/08/2026 — décision explicite et
-- toujours valable de Fouka : le CM délégué doit pouvoir tout gérer comme un admin du club pour
-- les paramètres/catégories/équipes/invitations Connect). On ne touche PAS à ces deux fonctions
-- (les casser reviendrait sur la décision du 22/08, hors périmètre de cette demande) : on ajoute
-- deux variantes strictes, qui ignorent la branche cm_agency_club_access, utilisées UNIQUEMENT
-- par les 3 RPC de validation d'affiliation (confirm_request_educateur/validate_team_membership/
-- reject_team_membership). Partout ailleurs (RLS équipes/matchs/calendrier/paramètres club),
-- is_club_admin()/is_team_educateur() restent inchangées.

create or replace function is_real_club_admin(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from club_members
    where club_id = target_club_id and user_id = auth.uid()
      and role = 'admin' and status = 'actif'
  );
$$;

create or replace function is_real_team_educateur(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from club_members cm, club_teams ct
    where ct.id = p_team_id and cm.club_id = ct.club_id and cm.user_id = auth.uid() and cm.status = 'actif'
      and (
        cm.role in ('admin', 'president')
        or (cm.role in ('coach', 'resp_equipe', 'directeur_sportif') and cm.teams @> to_jsonb(ct.name::text))
      )
  );
$$;

-- ── reject_team_membership (définition complète migration-clubplus-v14.sql, seule la clause
--    d'autorisation change : is_club_admin/is_team_educateur → is_real_*) ──
create or replace function reject_team_membership(p_request_id uuid, p_motif text default null)
returns membership_requests
language plpgsql security definer set search_path = public as $$
declare
  v_req membership_requests;
begin
  select * into v_req from membership_requests where id = p_request_id;
  if v_req.id is null then raise exception 'Demande introuvable'; end if;
  if v_req.statut in ('validee', 'refusee') then raise exception 'Cette demande a déjà été traitée'; end if;
  if not (
    (v_req.team_id is not null and is_real_team_educateur(v_req.team_id))
    or is_real_club_admin(v_req.club_id)
  ) then
    raise exception 'Non autorisé';
  end if;

  update membership_requests set statut = 'refusee', refus_motif = p_motif
  where id = p_request_id
  returning * into v_req;

  insert into membership_request_events (request_id, event_type, acted_by, note) values (p_request_id, 'refusee', auth.uid(), p_motif);
  return v_req;
end;
$$;

-- ── confirm_request_educateur (définition complète migration-clubplus-v15.sql, même changement) ──
create or replace function confirm_request_educateur(p_request_id uuid)
returns membership_requests
language plpgsql security definer set search_path = public as $$
declare
  v_req membership_requests;
begin
  select * into v_req from membership_requests where id = p_request_id;
  if v_req.id is null then raise exception 'Demande introuvable'; end if;
  if v_req.statut in ('validee', 'refusee') then raise exception 'Cette demande a déjà été traitée'; end if;
  if v_req.team_id is null or not is_real_team_educateur(v_req.team_id) then raise exception 'Non autorisé'; end if;

  update membership_requests
  set educateur_confirme_par = auth.uid(), educateur_confirme_at = now()
  where id = p_request_id
  returning * into v_req;

  insert into membership_request_events (request_id, event_type, acted_by) values (p_request_id, 'confirmee_educateur', auth.uid());
  return v_req;
end;
$$;

-- ── validate_team_membership (définition complète migration-clubplus-v15.sql, même changement) ──
create or replace function validate_team_membership(p_request_id uuid)
returns membership_requests
language plpgsql security definer set search_path = public as $$
declare
  v_req membership_requests;
  v_player player_profiles;
  v_bracket text;
  v_authorized boolean;
begin
  select * into v_req from membership_requests where id = p_request_id;
  if v_req.id is null then raise exception 'Demande introuvable'; end if;
  if v_req.statut in ('validee', 'refusee') then raise exception 'Cette demande a déjà été traitée'; end if;

  if v_req.validation_mode = 'double' then
    if v_req.educateur_confirme_at is null then
      raise exception 'Cette demande doit d''abord être confirmée par un éducateur (mode double validation)';
    end if;
    if not is_real_club_admin(v_req.club_id) then raise exception 'Seul un administrateur peut valider en mode double validation'; end if;
  elsif v_req.validation_mode = 'controle' then
    if not is_real_club_admin(v_req.club_id) then raise exception 'Seul un administrateur peut valider sur ce club'; end if;
  else
    if not (is_real_club_admin(v_req.club_id) or (v_req.team_id is not null and is_real_team_educateur(v_req.team_id))) then
      raise exception 'Non autorisé';
    end if;
  end if;

  select * into v_player from player_profiles where id = v_req.player_id;
  v_bracket := sv_age_bracket(v_player.date_naissance);

  if v_bracket <> 'majeur' then
    select bool_and(pa.statut = 'valide') into v_authorized
    from authorization_types at
    join parental_authorizations pa on pa.authorization_type_id = at.id and pa.player_id = v_player.id
    where at.code in ('creation_compte', 'acces_clubplus', 'traitement_donnees');

    if v_authorized is not true then
      update membership_requests set statut = 'autorisation_manquante' where id = p_request_id;
      raise exception 'Autorisation parentale manquante ou invalide — impossible de valider';
    end if;
  end if;

  update membership_requests
  set statut = 'validee', admin_valide_par = auth.uid(), admin_valide_at = now()
  where id = p_request_id
  returning * into v_req;

  if v_req.team_id is not null then
    insert into team_memberships (player_id, team_id, club_id, saison, statut)
    values (v_req.player_id, v_req.team_id, v_req.club_id, coalesce((select saison from clubs where id = v_req.club_id), '2026-2027'), 'active')
    on conflict (player_id, team_id, saison) do update set statut = 'active';
  end if;

  update player_profiles
  set account_status = 'actif'
  where id = v_req.player_id and account_status in ('en_attente_activation') and user_id is not null;

  insert into membership_request_events (request_id, event_type, acted_by) values (p_request_id, 'validee', auth.uid());
  return v_req;
end;
$$;

-- ============================================================================
-- VÉRIFICATION RECOMMANDÉE après exécution (à rejouer séparément) :
--
-- Avec un compte cm_agency ayant un accès délégué actif (cm_agency_club_access) sur un club de
-- test, sur une demande d'affiliation en attente de ce club :
--   select confirm_request_educateur('<request_id>');  -- attendu : exception "Non autorisé"
--   select validate_team_membership('<request_id>');   -- attendu : exception "Non autorisé"
--   select reject_team_membership('<request_id>');      -- attendu : exception "Non autorisé"
--
-- Avec un compte club_members réel (role='admin', status='actif') du même club : les 3 fonctions
-- doivent continuer à fonctionner exactement comme avant.
--
-- Vérifier aussi qu'aucune autre RLS/fonction utilisant is_club_admin()/is_team_educateur()
-- (paramètres club, invitations, matchs, calendrier...) n'a changé de comportement pour cm_agency
-- — cette migration ne touche à rien d'autre que les 3 fonctions ci-dessus.
-- ============================================================================
