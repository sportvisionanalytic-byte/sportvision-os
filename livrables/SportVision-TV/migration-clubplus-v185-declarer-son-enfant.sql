-- v185 : déclarer son enfant ne crée plus un doublon, ni un lien familial confirmé d'office
-- (12/09/2026).
--
-- Dernière porte laissée ouverte par l'audit du cloisonnement. « Inscrire mon enfant dans ce
-- club » créait une fiche joueur NEUVE à chaque appel, sans jamais regarder si le club en avait
-- déjà une, et posait le lien parent-enfant en « confirmé » sans que personne ne le vérifie.
--
-- Deux conséquences. Des doublons d'effectif, que le club validait sans les voir. Et surtout :
-- une personne pouvait se déclarer parent confirmé d'un enfant que le club connaît déjà, en
-- saisissant simplement son prénom, son nom et sa date de naissance — les trois mêmes
-- informations qui servaient à l'autre faille fermée ce jour (rattachement d'une fiche sans code).
--
-- Désormais : si le club connaît déjà l'enfant, aucune fiche n'est créée, la demande porte sur la
-- sienne, et le lien parental part EN ATTENTE de confirmation. C'est le club qui tranche, depuis
-- l'écran « Rattachements de parents à confirmer ». Le lien confirmé d'office ne subsiste que
-- pour une fiche que le parent vient de créer lui-même, ce qui est sa fiche à lui.
-- Test : tests/declarer-son-enfant.test.sql

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
  return v_req;
end;
$function$;
