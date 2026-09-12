-- v186 : arriver par le code du coach vaut acceptation (12/09/2026).
--
-- Demande de Fouka : rejoindre une équipe se valide par le coach de cette équipe ou par un
-- dirigeant du club, SAUF si la personne est arrivée par un lien ou un code généré par le coach.
--
-- La première moitié existait déjà : en mode standard, l'éducateur de l'équipe comme un
-- administrateur du club peuvent valider (validate_team_membership). La seconde manquait
-- entièrement : une demande née d'un code d'équipe attendait une validation manuelle comme les
-- autres, alors que donner le code, c'est déjà accepter la personne. La famille attendait sans
-- comprendre, et le coach devait valider deux fois la même décision.
--
-- Ce qui ne change pas : les clubs qui ont choisi un contrôle renforcé (mode « contrôle » :
-- l'administration valide ; mode « double » : l'éducateur puis l'administration) gardent la main,
-- le code ne court-circuite rien. Et pour un mineur, les autorisations parentales restent exigées.
-- Test : tests/adhesion-code-equipe.test.sql

-- L'ancienne signature à un seul argument est retirée : sans cela les deux coexistent et tout
-- appel devient ambigu (« function validate_team_membership(uuid) is not unique »), ce qui casse
-- la validation depuis Club+. Le paramètre ayant une valeur par défaut, les appels existants
-- continuent de fonctionner sans changement.
drop function if exists public.validate_team_membership(uuid);

CREATE OR REPLACE FUNCTION public.validate_team_membership(p_request_id uuid, p_par_code boolean DEFAULT false)
 RETURNS membership_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req membership_requests;
  v_player player_profiles;
  v_bracket text;
  v_authorized boolean;
begin
  select * into v_req from membership_requests where id = p_request_id;
  if v_req.id is null then raise exception 'Demande introuvable'; end if;
  if v_req.statut in ('validee', 'refusee') then raise exception 'Cette demande a déjà été traitée'; end if;

  -- ARRIVÉE PAR UN CODE D'ÉQUIPE (12/09/2026, demande de Fouka).
  --
  -- Un code d'invitation est généré par le coach ou par le club : le donner, c'est déjà accepter
  -- la personne. Lui redemander ensuite de valider la demande à la main est une formalité vide, et
  -- pendant ce temps la famille attend sans comprendre. Une demande née d'un code d'équipe valide
  -- se valide donc toute seule, et seulement dans ce cas.
  --
  -- Les deux modes de contrôle renforcé du club restent souverains : s'il a choisi que
  -- l'administration valide (mode « contrôle »), ou qu'il faut l'éducateur PUIS l'administration
  -- (mode « double »), le code ne court-circuite rien. Et pour un mineur, les autorisations
  -- parentales restent exigées plus bas, exactement comme pour une validation à la main.
  if p_par_code and v_req.validation_mode = 'standard'
     and v_req.source = 'code_equipe' and v_req.invite_code_id is not null then
    null;
  elsif v_req.validation_mode = 'double' then
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

  -- La validation d'une adhésion active le compte du joueur (account_status). Depuis le
  -- durcissement du 12/09 (v179), ce champ n'est modifiable que par un dirigeant du club : un
  -- COACH qui validait une demande, ce qui est précisément son rôle, se voyait donc répondre
  -- « Modification non autorisée sur ces champs ». Le drapeau ci-dessous dit au garde-fou que
  -- l'écriture vient de CE chemin, déjà autorisé plus haut. Il ne vit que le temps de la
  -- transaction, et aucune autre fonction ne le pose.
  perform set_config('sv.validation_adhesion', 'oui', true);

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
$function$;

-- Les trois portes d'entrée d'une demande d'adhésion tentent la validation automatique quand
-- elle est née d'un code d'équipe. Le Smart Link passe par elles, il est donc couvert aussi.
CREATE OR REPLACE FUNCTION public.request_team_membership_as_player(p_club_id uuid, p_team_id uuid, p_invite_code text DEFAULT NULL::text, p_prenom text DEFAULT NULL::text, p_nom text DEFAULT NULL::text, p_date_naissance date DEFAULT NULL::date)
 RETURNS membership_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_player player_profiles;
  v_code team_invite_codes;
  v_req membership_requests;
  v_source text;
begin
  select * into v_player from player_profiles where user_id = auth.uid();
  if v_player.id is not null and v_player.club_id <> p_club_id then
    raise exception 'Ce compte est déjà rattaché à un autre club';
  end if;
  if v_player.id is null then
    if p_prenom is null or p_nom is null or p_date_naissance is null then
      raise exception 'Prénom, nom et date de naissance requis pour une première demande';
    end if;
    if sv_age_bracket(p_date_naissance) = 'moins_14' then
      raise exception 'Un compte personnel n''est pas autorisé avant 14 ans — un parent doit inscrire l''enfant depuis son propre compte.';
    end if;
    insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
    values (p_club_id, auth.uid(), p_prenom, p_nom, p_date_naissance, 'en_attente_activation')
    returning * into v_player;
  end if;

  if p_invite_code is not null then
    select * into v_code from team_invite_codes
      where code = p_invite_code and team_id = p_team_id and actif = true
        and (expire_at is null or expire_at > now());
    if v_code.id is null then raise exception 'Code invalide ou expiré'; end if;
    v_source := 'code_equipe';
  else
    v_source := 'spontanee';
  end if;

  insert into membership_requests (club_id, team_id, requested_by_user_id, player_id, source, invite_code_id, statut, validation_mode)
  values (
    p_club_id, p_team_id, auth.uid(), v_player.id, v_source, v_code.id,
    initial_request_status(v_player.date_naissance),
    (select membership_validation_mode from clubs where id = p_club_id)
  )
  returning * into v_req;

  if sv_age_bracket(v_player.date_naissance) <> 'majeur' then
    perform bootstrap_player_authorizations(v_player.id, p_club_id);
  end if;

  insert into membership_request_events (request_id, event_type, acted_by) values (v_req.id, 'creee', auth.uid());

  -- Arrivée par un code d'équipe : la demande se valide toute seule (v186). Donner le code, c'est
  -- déjà accepter la personne. Si la validation ne peut pas aboutir — un mineur dont les
  -- autorisations parentales ne sont pas encore signées, un club en contrôle renforcé — la demande
  -- reste simplement à valider à la main, comme avant : on ne fait échouer aucune inscription.
  if v_source = 'code_equipe' then
    begin
      perform validate_team_membership(v_req.id, true);
      select * into v_req from membership_requests where id = v_req.id;
    exception when others then
      null;
    end;
  end if;
  return v_req;
end;
$function$;

CREATE OR REPLACE FUNCTION public.request_team_membership_for_child(p_club_id uuid, p_team_id uuid, p_prenom text, p_nom text, p_date_naissance date, p_invite_code text DEFAULT NULL::text)
 RETURNS membership_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_parent parent_profiles;
  v_player player_profiles;
  v_code team_invite_codes;
  v_req membership_requests;
  v_source text;
begin
  select * into v_parent from parent_profiles where user_id = auth.uid();
  if v_parent.id is null then
    insert into parent_profiles (user_id) values (auth.uid()) returning * into v_parent;
  end if;

  if p_invite_code is not null then
    select * into v_code from team_invite_codes
      where code = p_invite_code and team_id = p_team_id and actif = true
        and (expire_at is null or expire_at > now());
    if v_code.id is null then raise exception 'Code invalide ou expiré'; end if;
    v_source := 'code_equipe';
  else
    v_source := 'spontanee';
  end if;

  -- L'ENFANT EST-IL DÉJÀ CONNU DU CLUB ? (12/09/2026)
  --
  -- Cette fonction créait une fiche neuve à chaque appel, sans jamais regarder si le club en avait
  -- déjà une pour cet enfant, et posait le lien parent en « confirmé » d'office. Deux conséquences :
  -- des doublons d'effectif que le club validait sans les voir, et surtout un lien familial
  -- confirmé sans que personne ne l'ait vérifié. Le lien confirmé d'office ne se justifie que sur
  -- une fiche que le parent vient de créer lui-même.
  --
  -- Quand le club connaît déjà l'enfant (même club, même nom, même date de naissance), on ne crée
  -- rien : on rattache la demande à SA fiche, et le lien parental part EN ATTENTE. C'est le club
  -- qui tranche, depuis « Rattachements de parents à confirmer ».
  select * into v_player
    from player_profiles pp
   where pp.club_id = p_club_id
     and pp.date_naissance = p_date_naissance
     and normalize_person_name(pp.prenom) = normalize_person_name(p_prenom)
     and normalize_person_name(pp.nom) = normalize_person_name(p_nom)
   order by pp.created_at
   limit 1;

  if v_player.id is null then
    insert into player_profiles (club_id, prenom, nom, date_naissance, account_status, created_by)
    values (p_club_id, p_prenom, p_nom, p_date_naissance, 'sans_compte', auth.uid())
    returning * into v_player;

    insert into parent_player_relationships (parent_id, player_id, statut, confirmed_at)
    values (v_parent.id, v_player.id, 'confirme', now());
  else
    insert into parent_player_relationships (parent_id, player_id, statut)
    values (v_parent.id, v_player.id, 'en_attente_confirmation')
    on conflict (parent_id, player_id) do nothing;
  end if;

  insert into membership_requests (club_id, team_id, requested_by_user_id, player_id, parent_id, source, invite_code_id, statut, validation_mode)
  values (
    p_club_id, p_team_id, auth.uid(), v_player.id, v_parent.id, v_source, v_code.id,
    initial_request_status(p_date_naissance),
    (select membership_validation_mode from clubs where id = p_club_id)
  )
  returning * into v_req;

  if sv_age_bracket(p_date_naissance) <> 'majeur' then
    perform bootstrap_player_authorizations(v_player.id, p_club_id);
  end if;

  insert into membership_request_events (request_id, event_type, acted_by) values (v_req.id, 'creee', auth.uid());

  -- Arrivée par un code d'équipe : la demande se valide toute seule (v186). Donner le code, c'est
  -- déjà accepter la personne. Si la validation ne peut pas aboutir — un mineur dont les
  -- autorisations parentales ne sont pas encore signées, un club en contrôle renforcé — la demande
  -- reste simplement à valider à la main, comme avant : on ne fait échouer aucune inscription.
  if v_source = 'code_equipe' then
    begin
      perform validate_team_membership(v_req.id, true);
      select * into v_req from membership_requests where id = v_req.id;
    exception when others then
      null;
    end;
  end if;
  return v_req;
end;
$function$;

CREATE OR REPLACE FUNCTION public.request_team_membership_for_existing_child(p_player_id uuid, p_team_id uuid, p_invite_code text DEFAULT NULL::text)
 RETURNS membership_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_player player_profiles;
  v_parent parent_profiles;
  v_code team_invite_codes;
  v_req membership_requests;
  v_source text;
begin
  select * into v_player from player_profiles where id = p_player_id;
  if v_player.id is null then raise exception 'Joueur introuvable'; end if;
  if not is_confirmed_parent_of(p_player_id) then raise exception 'Non autorisé'; end if;

  select * into v_parent from parent_profiles where user_id = auth.uid();
  if v_parent.id is null then raise exception 'Profil parent introuvable'; end if;

  -- club_id dérivé du joueur existant, jamais transmis par le client — au contraire de
  -- request_team_membership_for_child (aucune fiche joueur n'existe encore à cet instant-là).
  if p_invite_code is not null then
    select * into v_code from team_invite_codes
      where code = p_invite_code and team_id = p_team_id and actif = true
        and (expire_at is null or expire_at > now());
    if v_code.id is null then raise exception 'Code invalide ou expiré'; end if;
    v_source := 'code_equipe';
  else
    v_source := 'spontanee';
  end if;

  insert into membership_requests (club_id, team_id, requested_by_user_id, player_id, parent_id, source, invite_code_id, statut, validation_mode)
  values (
    v_player.club_id, p_team_id, auth.uid(), v_player.id, v_parent.id, v_source, v_code.id,
    initial_request_status(v_player.date_naissance),
    (select membership_validation_mode from clubs where id = v_player.club_id)
  )
  returning * into v_req;

  if sv_age_bracket(v_player.date_naissance) <> 'majeur' then
    perform bootstrap_player_authorizations(v_player.id, v_player.club_id);
  end if;

  insert into membership_request_events (request_id, event_type, acted_by, note) values (v_req.id, 'creee', auth.uid(), 'via parent, enfant déjà affilié');

  -- Arrivée par un code d'équipe : la demande se valide toute seule (v186). Donner le code, c'est
  -- déjà accepter la personne. Si la validation ne peut pas aboutir — un mineur dont les
  -- autorisations parentales ne sont pas encore signées, un club en contrôle renforcé — la demande
  -- reste simplement à valider à la main, comme avant : on ne fait échouer aucune inscription.
  if v_source = 'code_equipe' then
    begin
      perform validate_team_membership(v_req.id, true);
      select * into v_req from membership_requests where id = v_req.id;
    exception when others then
      null;
    end;
  end if;
  return v_req;
end;
$function$;


-- Le garde-fou des fiches joueur reconnaît ce chemin. Tout le reste est inchangé : se retirer
-- soi-même reste possible, revenir se demande au club, et le club_id ne se change pas seul.
create or replace function public.guard_player_profile_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- Validation d'une demande d'adhésion (v186) : le droit a déjà été vérifié par
  -- validate_team_membership, qui pose ce drapeau juste avant d'activer le compte.
  if coalesce(current_setting('sv.validation_adhesion', true), '') = 'oui' then
    return new;
  end if;

  if not is_club_admin(new.club_id) then
    if new.user_id is distinct from old.user_id
       or (
         new.account_status is distinct from old.account_status
         and not (new.account_status = 'retire' and old.user_id = auth.uid())
       )
       or new.club_id is distinct from old.club_id
       or (
         new.date_naissance is distinct from old.date_naissance
         and old.user_id is distinct from auth.uid()
       )
    then
      raise exception 'Modification non autorisée sur ces champs';
    end if;
  end if;
  return new;
end $$;
