-- ============================================================================
-- migration-securite-v100-formation-xp-lock.sql
-- ============================================================================
-- Suite de l'audit SECURITY DEFINER (migration-securite-v97) : rpc_complete_
-- formation() et rpc_submit_quiz() lisent formation_inscriptions sans verrou
-- avant de décider d'attribuer de l'XP (statut/quiz_passe) — même classe de
-- bug que submit_club_request, mais sur de l'XP de formation, pas de l'argent
-- réel (sévérité mineure, corrigé pour cohérence avec le reste de la nuit).
-- Deux appels concurrents (double-clic) sur la même inscription pouvaient
-- tous deux lire l'ancien état et attribuer l'XP/le bonus deux fois.
-- Correctif : ajoute `for update` sur la lecture initiale, aucune autre
-- logique modifiée.
-- ============================================================================

create or replace function rpc_complete_formation(p_inscription_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  v_insc formation_inscriptions%rowtype;
  v_reward formation_rewards%rowtype;
  v_done_count integer;
  v_role text;
  v_xp_gagnes integer := 0;
  v_num_cert text;
  v_certified boolean := false;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  select * into v_insc from formation_inscriptions
    where id = p_inscription_id and collaborateur_id = v_uid for update;
  if not found then
    raise exception 'Inscription introuvable ou non autorisée.';
  end if;

  if v_insc.statut = 'terminee' then
    return jsonb_build_object('already_done', true, 'xp_gagnes', coalesce(v_insc.xp_gagnes,0));
  end if;

  select * into v_reward from formation_rewards where formation_id = v_insc.formation_id;
  if not found then
    raise exception 'Formation inconnue côté serveur (formation_rewards non à jour).';
  end if;

  select count(*) into v_done_count from formation_progression
    where inscription_id = p_inscription_id;
  if v_done_count < v_reward.total_lecons then
    raise exception 'Toutes les leçons ne sont pas encore terminées (% / %).', v_done_count, v_reward.total_lecons;
  end if;

  select role into v_role from profiles where id = v_uid;
  if v_role = 'photo' then
    v_xp_gagnes := v_reward.xp;
  end if;

  update formation_inscriptions set
    statut = 'terminee',
    progression_pct = 100,
    xp_gagnes = v_xp_gagnes,
    completed_at = now()
  where id = p_inscription_id;

  if v_xp_gagnes > 0 then
    insert into xp_events (collaborateur_id, montant, type, source_id, source_type, description, attribue_par)
    values (v_uid, v_xp_gagnes, 'formation', p_inscription_id, 'formation_inscriptions', 'Formation terminée', v_uid);
    update profiles set xp = coalesce(xp,0) + v_xp_gagnes where id = v_uid;
  end if;

  if v_reward.certification_id is not null then
    v_num_cert := 'CERT-' || extract(year from now())::text || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    insert into collaborateur_certifications (
      collaborateur_id, code_certification, nom, badge, formation_id, inscription_id,
      date_obtention, date_expiration, statut, numero_certificat
    ) values (
      v_uid, v_reward.certification_id, v_reward.certification_nom, v_reward.certification_badge,
      v_insc.formation_id, p_inscription_id,
      now(), now() + make_interval(months => v_reward.certification_validite_mois),
      'active', v_num_cert
    )
    on conflict (collaborateur_id, code_certification) do nothing;
    v_certified := true;
  end if;

  return jsonb_build_object('already_done', false, 'xp_gagnes', v_xp_gagnes, 'certified', v_certified);
end;
$function$;

create or replace function rpc_submit_quiz(p_inscription_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  v_insc formation_inscriptions%rowtype;
  v_reward formation_rewards%rowtype;
  v_role text;
  v_custom_count integer;
  v_total integer := 0;
  v_correct integer := 0;
  v_pos integer := 0;
  v_given integer;
  v_correct_index integer;
  v_row record;
  v_results jsonb := '[]'::jsonb;
  v_score integer;
  v_pass boolean;
  v_already_passed boolean;
  v_bonus integer := 0;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  select * into v_insc from formation_inscriptions
    where id = p_inscription_id and collaborateur_id = v_uid for update;
  if not found then
    raise exception 'Inscription introuvable ou non autorisée.';
  end if;

  v_already_passed := coalesce(v_insc.quiz_passe, false);

  select count(*) into v_custom_count from formations_quiz_custom where formation_id = v_insc.formation_id;

  for v_row in (
    (select reponse_correcte as correct_index from formations_quiz_custom
      where formation_id = v_insc.formation_id and v_custom_count > 0
      order by ordre)
    union all
    (select correct_index from formation_quiz_questions
      where formation_id = v_insc.formation_id and v_custom_count = 0
      order by q_index)
  )
  loop
    v_correct_index := v_row.correct_index;
    v_given := nullif(p_answers ->> v_pos, '')::integer;
    if v_given is not null and v_given = v_correct_index then
      v_correct := v_correct + 1;
    end if;
    v_results := v_results || jsonb_build_object(
      'q_index', v_pos, 'correct_index', v_correct_index,
      'given', v_given, 'ok', coalesce(v_given = v_correct_index, false)
    );
    v_total := v_total + 1;
    v_pos := v_pos + 1;
  end loop;

  if v_total = 0 then
    raise exception 'Aucun quiz pour cette formation.';
  end if;

  v_score := round(v_correct::numeric / v_total * 100);
  v_pass := v_score >= 70;

  update formation_inscriptions set score_quiz = v_score, quiz_passe = v_pass
    where id = p_inscription_id;

  select * into v_reward from formation_rewards where formation_id = v_insc.formation_id;
  select role into v_role from profiles where id = v_uid;
  if found and v_role = 'photo' and v_pass and not v_already_passed then
    v_bonus := round(v_reward.xp * 0.3);
    if v_bonus > 0 then
      insert into xp_events (collaborateur_id, montant, type, source_id, source_type, description, attribue_par)
      values (v_uid, v_bonus, 'bonus', p_inscription_id, 'formation_inscriptions', 'Quiz réussi', v_uid);
      update profiles set xp = coalesce(xp,0) + v_bonus where id = v_uid;
    end if;
  end if;

  return jsonb_build_object(
    'score', v_score, 'pass', v_pass, 'correct', v_correct, 'total', v_total,
    'bonus_xp', v_bonus, 'results', v_results
  );
end;
$function$;
