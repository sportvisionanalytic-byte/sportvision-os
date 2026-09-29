-- v366 — « auth.uid() » DANS LE CORPS N'EST PAS UNE GARDE (30/09/2026)
--
-- Suite de la v365, qui a ferme le droit d'appel. Ici on ajoute la garde INTERNE aux deux fonctions
-- d'adhesion, parce qu'elles restent ouvertes a `authenticated` — un revoke seul ne suffit donc pas
-- a decrire ce qu'elles doivent refuser.
--
-- LE DEFAUT, ET CE QU'IL APPREND. `request_team_membership_as_player` LISAIT `auth.uid()` pour
-- retrouver la fiche de la personne, mais ne l'EXIGEAIT jamais. Appelee sans session, `auth.uid()`
-- vaut null, `v_player.id is null`, et elle partait dans la branche « premiere demande » : elle
-- CREAIT une fiche. Mesure de l'audit du 30/09, avec la seule cle publique du site : inscription
-- anonyme acceptee, fiche creee dans un club reel, adhesion AUTO-VALIDEE, appartenance d'equipe
-- ACTIVE, et douze autorisations parentales fabriquees au passage.
--
-- Le plus couteux n'est pas l'oubli. C'est qu'un controle automatique cherchant la chaine
-- « auth.uid() » dans le corps concluait que la fonction etait protegee — et c'est exactement ce
-- qu'un premier balayage a conclu, ce matin, sur ces deux fonctions. C'est la meme famille que le
-- filtre sur un statut inexistant du 29/09 : une protection qu'on croit en place coute plus cher
-- qu'une protection absente. Une garde se lit a ce qu'elle REFUSE, jamais a ce qu'elle mentionne.
--
-- Le corps est repris de `pg_get_functiondef` pour ne rien perdre en recopiant : seules les lignes
-- de la garde sont ajoutees, juste apres `begin`.

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
  -- LE MOT « auth.uid() » N'EST PAS UNE GARDE (30/09/2026).
  --
  -- Cette fonction LISAIT `auth.uid()` pour retrouver la fiche de la personne, mais ne l'EXIGEAIT
  -- jamais. Appelee sans session, `auth.uid()` vaut null, `v_player.id is null`, et elle partait dans
  -- la branche « premiere demande » : elle CREAIT une fiche. Mesure d'un audit du 30/09, avec la
  -- seule cle publique du site : inscription anonyme acceptee, fiche creee dans un club reel,
  -- adhesion auto-validee, appartenance d'equipe ACTIVE, et douze autorisations parentales
  -- fabriquees au passage.
  --
  -- Le plus couteux n'est pas l'oubli : c'est qu'un controle automatique cherchant la chaine
  -- « auth.uid() » dans le corps concluait que la fonction etait protegee. Meme famille que le
  -- filtre sur un statut inexistant du 29/09. Une garde se lit a ce qu'elle REFUSE.
  if auth.uid() is null then
    raise exception 'Authentification requise.' using errcode = '42501';
  end if;
  select * into v_player from player_profiles where user_id = auth.uid();
  if v_player.id is not null and v_player.club_id <> p_club_id then
    raise exception 'Ce compte est déjà rattaché à un autre club';
  end if;
  if v_player.id is null then
    if p_prenom is null or p_nom is null or p_date_naissance is null then
      raise exception 'Prénom, nom et date de naissance requis pour une première demande';
    end if;
    -- v217 — Le refus avant 14 ans est levé : un mineur crée son compte comme un majeur.
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

  -- Les autorisations sont toujours PRÉPARÉES pour un mineur : elles ne bloquent plus, mais le
  -- parent qui rejoindra plus tard les trouve prêtes à signer, notamment le droit à l'image.
  if sv_age_bracket(v_player.date_naissance) <> 'majeur' then
    perform bootstrap_player_authorizations(v_player.id, p_club_id);
  end if;

  insert into membership_request_events (request_id, event_type, acted_by) values (v_req.id, 'creee', auth.uid());

  -- Arrivée par un code d'équipe : la demande se valide toute seule (v186). Donner le code, c'est
  -- déjà accepter la personne. Si la validation ne peut pas aboutir — un club en contrôle renforcé
  -- — la demande reste à valider à la main : on ne fait échouer aucune inscription.
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
  -- LE MOT « auth.uid() » N'EST PAS UNE GARDE (30/09/2026).
  --
  -- Cette fonction LISAIT `auth.uid()` pour retrouver la fiche de la personne, mais ne l'EXIGEAIT
  -- jamais. Appelee sans session, `auth.uid()` vaut null, `v_player.id is null`, et elle partait dans
  -- la branche « premiere demande » : elle CREAIT une fiche. Mesure d'un audit du 30/09, avec la
  -- seule cle publique du site : inscription anonyme acceptee, fiche creee dans un club reel,
  -- adhesion auto-validee, appartenance d'equipe ACTIVE, et douze autorisations parentales
  -- fabriquees au passage.
  --
  -- Le plus couteux n'est pas l'oubli : c'est qu'un controle automatique cherchant la chaine
  -- « auth.uid() » dans le corps concluait que la fonction etait protegee. Meme famille que le
  -- filtre sur un statut inexistant du 29/09. Une garde se lit a ce qu'elle REFUSE.
  if auth.uid() is null then
    raise exception 'Authentification requise.' using errcode = '42501';
  end if;
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

-- Le droit d'appel, redit : une famille CONNECTEE demande a rejoindre un club, jamais un visiteur.
revoke all on function public.request_team_membership_as_player(uuid, uuid, text, text, text, date) from public, anon;
grant execute on function public.request_team_membership_as_player(uuid, uuid, text, text, text, date) to authenticated;
revoke all on function public.request_team_membership_for_child(uuid, uuid, text, text, date, text) from public, anon;
grant execute on function public.request_team_membership_for_child(uuid, uuid, text, text, date, text) to authenticated;

notify pgrst, 'reload schema';
