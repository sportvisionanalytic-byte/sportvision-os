begin;
CREATE OR REPLACE FUNCTION public.preview_club_players_import(p_club_id uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
  v_strong_count int;
  v_medium_count int;
begin
  -- Le CM SportVision affecte a ce club prepare l'effectif comme son administrateur : c'est de
  -- la saisie de mise en place, aucun compte n'est cree et aucun e-mail n'est envoye.
  if not peut_preparer_club(p_club_id) then
    raise exception 'Non autorisé';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    v_prenom := trim(coalesce(v_row->>'prenom', ''));
    v_nom := trim(coalesce(v_row->>'nom', ''));
    begin
      v_date_naissance := nullif(v_row->>'date_naissance', '')::date;
    exception when others then
      v_date_naissance := null;
    end;
    v_licence := nullif(trim(coalesce(v_row->>'numero_licence', '')), '');

    if v_prenom = '' or v_nom = '' or v_date_naissance is null then
      v_results := v_results || jsonb_build_object('index', v_idx, 'categorie', 'erreur');
      continue;
    end if;

    select
      count(*) filter (where match_strength = 'forte'),
      count(*) filter (where match_strength = 'moyenne')
    into v_strong_count, v_medium_count
    from match_player_candidates(p_club_id, v_prenom, v_nom, v_date_naissance, v_licence);

    v_results := v_results || jsonb_build_object(
      'index', v_idx,
      'categorie', case
        when v_strong_count = 1 then 'existant'
        when v_strong_count > 1 then 'ambigu'
        when v_medium_count > 0 then 'a_verifier'
        else 'nouveau'
      end
    );
  end loop;

  return jsonb_build_object('resultats', v_results);
end;
$function$

;
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
        insert into team_memberships (player_id, team_id, club_id, saison, statut)
        values (v_player_id, p_team_id, p_club_id, p_saison, 'active')
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
commit;
select 'OK — gardes d import d effectif remplaces' as verdict;
