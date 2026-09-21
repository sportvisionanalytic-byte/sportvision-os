-- Les trois fonctions de rattachement posent enfin la saison (21/09/2026)
--
-- Suite de la v248. Corps repris tel quel des fonctions en place, à une ligne près : `saison_id`
-- est désormais écrit à côté du libellé, via saison_id_pour(). Sans lui, l'espace Photos d'un
-- joueur fraîchement validé lui répondait « Rejoignez votre club et votre équipe » — ce qu'il
-- venait exactement de faire — et ne lui montrait ni galerie ni Pass Photo.
--
-- Les trois chemins sont couverts : validate_team_membership (le joueur accepte, le club valide),
-- import_club_players (import d'un effectif) et renew_season_membership (passage de saison).

CREATE OR REPLACE FUNCTION public.import_club_players(p_club_id uuid, p_team_id uuid, p_saison text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row jsonb;
  v_idx int := 0;
  v_results jsonb := '[]'::jsonb;
  v_prenom text;
  v_nom text;
  v_date_naissance date;
  v_licence text;
  v_maillot text;
  v_player_id uuid;
  v_strong_count int;
  v_status text;
begin
  -- Le CM SportVision affecte a ce club prepare l'effectif comme son administrateur : c'est de
  -- la saisie de mise en place, aucun compte n'est cree et aucun e-mail n'est envoye.
  if not peut_preparer_club(p_club_id) then
    raise exception 'Seul un administrateur du club peut importer un effectif';
  end if;
  if p_team_id is not null and not exists (select 1 from club_teams where id = p_team_id and club_id = p_club_id) then
    raise exception 'Équipe introuvable pour ce club';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    begin
      v_prenom := trim(coalesce(v_row->>'prenom', ''));
      v_nom := trim(coalesce(v_row->>'nom', ''));
      v_date_naissance := nullif(v_row->>'date_naissance', '')::date;
      v_licence := nullif(trim(coalesce(v_row->>'numero_licence', '')), '');
      v_maillot := nullif(trim(coalesce(v_row->>'numero_maillot', '')), '');

      if v_prenom = '' or v_nom = '' or v_date_naissance is null then
        v_results := v_results || jsonb_build_object('index', v_idx, 'statut', 'erreur', 'message', 'Prénom, nom et date de naissance sont obligatoires.');
        continue;
      end if;

      select count(*) filter (where match_strength = 'forte')
      into v_strong_count
      from match_player_candidates(p_club_id, v_prenom, v_nom, v_date_naissance, v_licence);

      v_player_id := null;
      if v_strong_count = 1 then
        select pc.player_id into v_player_id
        from match_player_candidates(p_club_id, v_prenom, v_nom, v_date_naissance, v_licence) pc
        where pc.match_strength = 'forte';
        v_status := 'existant';
      else
        insert into player_profiles (club_id, prenom, nom, date_naissance, numero_licence, numero_maillot, account_status, created_by)
        values (p_club_id, v_prenom, v_nom, v_date_naissance, v_licence, v_maillot, 'sans_compte', auth.uid())
        returning id into v_player_id;
        v_status := 'nouveau';
      end if;

      if p_team_id is not null then
        insert into team_memberships (player_id, team_id, club_id, saison, saison_id, statut)
    values (v_player_id, p_team_id, p_club_id, p_saison, saison_id_pour(p_saison), 'active')
        on conflict (player_id, team_id, saison) do update set statut = 'active';
      end if;

      v_results := v_results || jsonb_build_object('index', v_idx, 'statut', v_status, 'player_id', v_player_id);
    exception when others then
      v_results := v_results || jsonb_build_object('index', v_idx, 'statut', 'erreur', 'message', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('resultats', v_results);
end;
$function$

;
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

  -- v217 (14/09/2026, décision de Fouka) — Les trois autorisations parentales obligatoires
  -- (creation_compte, acces_clubplus, traitement_donnees) ne bloquent plus la validation : un
  -- mineur rejoint son équipe comme un majeur. Elles restent préparées et signables, et le droit à
  -- l'image, lui, n'a jamais bloqué. Pour rétablir l'ancienne règle, il suffit de remettre
  -- `obligatoire = true` sur ces trois lignes et de restaurer ce bloc.
  -- v_bracket et v_authorized restent déclarés : d'autres lectures s'y appuient en aval.
  v_authorized := true;

  update membership_requests
  set statut = 'validee', admin_valide_par = auth.uid(), admin_valide_at = now()
  where id = p_request_id
  returning * into v_req;

  if v_req.team_id is not null then
    insert into team_memberships (player_id, team_id, club_id, saison, saison_id, statut)
    values (v_req.player_id, v_req.team_id, v_req.club_id, coalesce((select saison from clubs where id = v_req.club_id), '2026-2027'),
      saison_id_pour(coalesce((select saison from clubs where id = v_req.club_id), '2026-2027')),
      'active')
    on conflict (player_id, team_id, saison) do update set statut = 'active';
  end if;

  update player_profiles
  set account_status = 'actif'
  where id = v_req.player_id and account_status in ('en_attente_activation') and user_id is not null;

  insert into membership_request_events (request_id, event_type, acted_by) values (p_request_id, 'validee', auth.uid());
  return v_req;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.renew_season_membership(p_membership_id uuid, p_action text, p_new_team_id uuid DEFAULT NULL::uuid, p_to_saison text DEFAULT NULL::text)
 RETURNS team_memberships
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_old team_memberships;
  v_new team_memberships;
  v_target_team uuid;
begin
  select * into v_old from team_memberships where id = p_membership_id;
  if v_old.id is null then raise exception 'Rattachement introuvable'; end if;
  if not peut_basculer_saison(v_old.club_id) then raise exception 'Non autorisé'; end if;
  if p_action not in ('renouvele', 'deplace', 'archive', 'mis_en_attente', 'quitte_club') then
    raise exception 'Action invalide';
  end if;

  if p_action in ('renouvele', 'deplace') then
    if p_to_saison is null or p_to_saison = '' then raise exception 'Saison de destination requise'; end if;
    v_target_team := case when p_action = 'deplace' then p_new_team_id else v_old.team_id end;
    if v_target_team is null then raise exception 'Équipe de destination requise'; end if;

    update team_memberships set statut = 'archivee' where id = p_membership_id;

    insert into team_memberships (player_id, team_id, club_id, saison, saison_id, statut)
    values (v_old.player_id, v_target_team, v_old.club_id, p_to_saison, saison_id_pour(p_to_saison), 'active')
    on conflict (player_id, team_id, saison) do update set statut = 'active'
    returning * into v_new;
  else
    update team_memberships
    set statut = case p_action
      when 'archive' then 'archivee'
      when 'mis_en_attente' then 'en_attente_renouvellement'
      when 'quitte_club' then 'quittee_club'
    end
    where id = p_membership_id
    returning * into v_new;
  end if;

  insert into season_membership_renewals (club_id, from_saison, to_saison, player_id, from_team_membership_id, action, new_team_id, processed_by)
  values (v_old.club_id, v_old.saison, coalesce(p_to_saison, v_old.saison), v_old.player_id, v_old.id, p_action, v_target_team, auth.uid());

  return v_new;
end;
$function$

;
