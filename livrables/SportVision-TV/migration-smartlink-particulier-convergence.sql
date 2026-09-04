-- Smart Link × parcours "particulier" (04/09/2026, décision produit Fouka suite au finding D11 de
-- l'audit transversal) : "il ne faut surtout pas étendre managed_athlete_profiles pour en faire un
-- deuxième système d'affiliation club... une personne/un enfant doit rester une identité canonique
-- unique... PERSON ≠ GUARDIAN RELATIONSHIP ≠ CLUB MEMBERSHIP ≠ TEAM MEMBERSHIP ≠ PERSONAL PROFILE."
--
-- managed_athlete_profiles reste EXACTEMENT ce qu'il est (fiche déclarative personnelle, aucune
-- colonne ajoutée, jamais touché par cette migration) — le mode "particulier" continue de
-- fonctionner sans club (Fouka §20). Ce qui manquait : un chemin qui, au moment où un Smart Link
-- est utilisé, fait converger l'identité vers player_profiles (déjà la personne canonique côté
-- club, déjà multi-club depuis ce soir) plutôt que de créer une seconde identité déconnectée.
--
-- Réutilise sans dupliquer : match_player_candidates() (moteur fort/moyenne déjà construit pour
-- l'import CSV, migration-clubplus-v56) — sa logique de correspondance est extraite dans
-- find_player_match_candidates() (même corps exact, sans le garde-fou is_club_admin qui n'a plus
-- lieu d'être pour un parent agissant sur son propre Smart Link) ; match_player_candidates()
-- devient un simple appelant qui garde son garde-fou admin intact, comportement inchangé.
-- redeem_invite_code() (déjà existante) reste le seul point de consommation atomique du code.
-- parent_player_relationships / membership_requests / validate_team_membership (déjà construits,
-- déjà vérifiés en réel ce soir) restent le seul vrai mécanisme d'affiliation — jamais recréé.

create or replace function find_player_match_candidates(
  p_club_id uuid, p_prenom text, p_nom text, p_date_naissance date, p_numero_licence text default null
)
returns table(player_id uuid, match_strength text, existing_prenom text, existing_nom text, existing_date_naissance date)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  return query
  select
    pp.id,
    case
      when p_numero_licence is not null and pp.numero_licence is not null and pp.numero_licence = p_numero_licence then 'forte'
      when p_date_naissance is not null and pp.date_naissance = p_date_naissance then 'forte'
      else 'moyenne'
    end as match_strength,
    pp.prenom,
    pp.nom,
    pp.date_naissance
  from player_profiles pp
  where pp.club_id = p_club_id
    and normalize_person_name(pp.prenom) = normalize_person_name(p_prenom)
    and normalize_person_name(pp.nom) = normalize_person_name(p_nom);
end;
$function$;

create or replace function match_player_candidates(
  p_club_id uuid, p_prenom text, p_nom text, p_date_naissance date, p_numero_licence text default null
)
returns table(player_id uuid, match_strength text, existing_prenom text, existing_nom text, existing_date_naissance date)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not is_club_admin(p_club_id) then
    raise exception 'Non autorisé';
  end if;

  return query select * from find_player_match_candidates(p_club_id, p_prenom, p_nom, p_date_naissance, p_numero_licence);
end;
$function$;

-- Point d'entrée unique du "Qui rejoint [équipe] ?" — appelé une fois le bénéficiaire choisi
-- (soi-même / un profil "club" déjà affilié ailleurs / un profil "particulier" géré / un tout
-- nouvel enfant). Ne consomme le code qu'à cet instant précis (Fouka §15 : un simple passage par
-- login/signup ne doit jamais consommer le lien). Ne fusionne jamais automatiquement sur un match
-- ambigu (Fouka §9/§18) : renvoie match_ambigu=true et statut='a_verifier' sans rien créer côté
-- membership, à charge du client d'afficher un choix explicite plutôt qu'un merge silencieux.
drop function if exists connect_join_club_via_smart_link(text, text, uuid, text, text, date, text);

create or replace function connect_join_club_via_smart_link(
  p_code text,
  p_kind text,
  p_ref_id uuid default null,
  p_prenom text default null,
  p_nom text default null,
  p_date_naissance date default null,
  p_relation_type text default 'parent'
)
-- "resolved_player_id" (pas "player_id") : RETURNS TABLE déclare des paramètres OUT implicites en
-- PL/pgSQL — un OUT nommé player_id rendait TOUTE référence nue à player_id dans le corps de cette
-- fonction ambiguë (colonne de table vs paramètre OUT), y compris dans des listes de colonnes
-- INSERT/ON CONFLICT — trouvé en testant en conditions réelles, pas en relisant le code.
returns table(membership_request_id uuid, resolved_player_id uuid, statut text, match_ambigu boolean, club_nom text, team_nom text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_redeem record;
  v_source player_profiles;
  v_prenom text;
  v_nom text;
  v_dob date;
  v_player_id uuid;
  v_strong_count int;
  v_total_count int;
  v_parent_profile_id uuid;
  v_existing_req membership_requests;
  v_req membership_requests;
  v_ambigu boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;
  if p_kind not in ('self', 'club', 'managed', 'new') then
    raise exception 'Type de bénéficiaire invalide.';
  end if;

  select * into v_redeem from redeem_invite_code(p_code);

  if p_kind = 'club' then
    select * into v_source from player_profiles where id = p_ref_id;
    if v_source.id is null then
      raise exception 'Profil introuvable.';
    end if;
    if not (
      v_source.user_id = auth.uid()
      or exists (
        select 1 from parent_player_relationships ppr
        join parent_profiles pf on pf.id = ppr.parent_id
        where ppr.player_id = v_source.id and pf.user_id = auth.uid() and ppr.statut = 'confirme'
      )
    ) then
      raise exception 'Non autorisé sur ce profil.';
    end if;
    v_prenom := v_source.prenom;
    v_nom := v_source.nom;
    v_dob := v_source.date_naissance;
  elsif p_kind = 'managed' then
    if not exists (select 1 from managed_athlete_profiles where id = p_ref_id and owner_user_id = auth.uid()) then
      raise exception 'Profil introuvable.';
    end if;
    if p_prenom is null or p_nom is null or p_date_naissance is null then
      raise exception 'Prénom, nom et date de naissance sont nécessaires pour rejoindre un club.';
    end if;
    v_prenom := p_prenom; v_nom := p_nom; v_dob := p_date_naissance;
  else
    -- 'self' ou 'new' : identité fournie directement par l'appelant.
    if p_prenom is null or p_nom is null or p_date_naissance is null then
      raise exception 'Prénom, nom et date de naissance sont obligatoires.';
    end if;
    v_prenom := p_prenom; v_nom := p_nom; v_dob := p_date_naissance;
  end if;

  -- Idempotence : déjà une fiche pour cette personne dans CE club précis (multi-club existant, ou
  -- rappel/double-clic sur le même Smart Link) → jamais une 2e ligne player_profiles pour le même
  -- club (même personne+club).
  if p_kind = 'self' then
    select id into v_player_id from player_profiles where user_id = auth.uid() and club_id = v_redeem.club_id;
  end if;

  if v_player_id is null then
    select count(*) filter (where match_strength = 'forte'), count(*)
      into v_strong_count, v_total_count
      from find_player_match_candidates(v_redeem.club_id, v_prenom, v_nom, v_dob);

    if v_strong_count = 1 then
      select fpc.player_id into v_player_id
      from find_player_match_candidates(v_redeem.club_id, v_prenom, v_nom, v_dob) fpc
      where fpc.match_strength = 'forte';
    elsif v_strong_count > 1 or (v_strong_count = 0 and v_total_count > 0) then
      -- Homonyme réel (2+ matches forts) ou nom qui matche sans date de naissance fiable pour
      -- trancher : jamais d'auto-merge, on remonte l'ambiguïté au lieu de créer quoi que ce soit.
      v_ambigu := true;
    end if;
  end if;

  if v_ambigu then
    return query select null::uuid, null::uuid, 'a_verifier'::text, true, c.nom, t.name
      from clubs c left join club_teams t on t.id = v_redeem.team_id where c.id = v_redeem.club_id;
    return;
  end if;

  if v_player_id is null then
    insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
    values (v_redeem.club_id, case when p_kind = 'self' then auth.uid() else null end, v_prenom, v_nom, v_dob, 'en_attente_activation')
    returning id into v_player_id;
  end if;

  if p_kind <> 'self' then
    select id into v_parent_profile_id from parent_profiles where user_id = auth.uid();
    if v_parent_profile_id is null then
      -- connect_profile_settings n'a pas de prenom/nom (vérifié avant d'écrire cette requête) —
      -- parent_profiles.prenom/nom restent nuls ici, comme le fait déjà accept_parent_invitation()
      -- quand l'invitation elle-même n'en fournit pas.
      insert into parent_profiles (user_id) values (auth.uid()) returning id into v_parent_profile_id;
    end if;
    insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
    values (v_parent_profile_id, v_player_id, coalesce(p_relation_type, 'parent'), 'confirme', now())
    on conflict (parent_id, player_id) do update set statut = 'confirme', confirmed_at = now();
  end if;

  select * into v_existing_req from membership_requests mr
    where mr.player_id = v_player_id and mr.team_id is not distinct from v_redeem.team_id and mr.club_id = v_redeem.club_id
      and mr.statut not in ('refusee')
    order by mr.created_at desc limit 1;

  if v_existing_req.id is not null then
    v_req := v_existing_req;
  else
    insert into membership_requests (club_id, team_id, player_id, source, statut, validation_mode, invite_code_id)
    values (v_redeem.club_id, v_redeem.team_id, v_player_id, 'code_equipe', 'pret_a_valider', 'standard', v_redeem.invite_code_id)
    returning * into v_req;
  end if;

  return query select v_req.id, v_player_id, v_req.statut, false, c.nom, t.name
    from clubs c left join club_teams t on t.id = v_redeem.team_id where c.id = v_redeem.club_id;
end;
$function$;

revoke all on function connect_join_club_via_smart_link(text, text, uuid, text, text, date, text) from public;
grant execute on function connect_join_club_via_smart_link(text, text, uuid, text, text, date, text) to authenticated;
