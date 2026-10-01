-- v440 — UNE CERTIFICATION NE SE DÉLIVRE PAS À SOI-MÊME (01/10/2026)
--
-- == CE QUI A ÉTÉ MESURÉ, PAR LE CHEMIN RÉEL ===================================================
--
-- Avec le jeton d'Antoine Blin (rôle `photo`, grade 0), en transaction annulée. Six écritures que
-- rien n'empêchait, et aucune ne passait par une faille : les policies les autorisaient.
--
--   1. Il s'inscrit à `cert-secretaire-complet`, réservée au Secrétariat. Mesuré : il ne peut même
--      pas LIRE cette formation (`formations_lire` lui rend 0 ligne), et il s'y inscrit quand même.
--      `fi_own_write` ne demandait qu'une chose : `collaborateur_id = auth.uid()`.
--   2. Il s'inscrit à `lead-terrain-01`, verrouillée au grade 3. Il est au grade 0.
--   4. Il passe son inscription à `statut = 'terminee'`, `quiz_passe = true`, `score_quiz = 100`,
--      sans avoir ouvert une seule leçon. Valeur relue : `terminee`.
--   5. Il insère lui-même sa ligne dans `collaborateur_certifications`. Valeur relue : 1 ligne.
--      `cc_own_insert` vérifiait que l'inscription était `terminee` — or il venait de l'écrire.
--   6. Il porte `xp_gagnes` à 9 999 sur une inscription neuve. Le garde existant ne mordait pas :
--      il ne refusait un changement que si l'ancienne valeur était DIFFÉRENTE de 0, et une
--      inscription naît à 0. Le cas qu'il devait refuser était précisément celui qu'il laissait
--      passer.
--
-- CE QUE ÇA COÛTE EN VRAI, ET POURQUOI CE N'EST PAS COSMÉTIQUE. Une formation `terminee` et une
-- certification décident de qui part en mission : l'OS lit `formation_inscriptions.statut` et
-- `collaborateur_certifications` pour dire si un collaborateur remplit les formations obligatoires
-- d'une prestation. Un badge « Responsable Production certifié » écrit à la main par son porteur,
-- c'est un opérateur envoyé seul sur un match qu'il n'a pas appris à couvrir.
--
-- == CE QU'ON NE CASSE PAS, ET C'EST MESURÉ AUSSI ==============================================
--
-- 14 inscriptions réelles sur 67 sont hors du rôle ou sous le grade de leur titulaire. Les 14
-- appartiennent à Mikael, responsable de production. Admin et prod gardent donc leur passe-droit,
-- comme dans `fi_own_read`, `fi_admin_update` et `cc_admin_manage` : cette migration ne retire une
-- ligne à personne et n'en invalide aucune.
--
-- == COMMENT LE SERVEUR GARDE LE DROIT D'ÉCRIRE CE QU'IL CALCULE =================================
--
-- `rpc_complete_formation` et `rpc_submit_quiz` sont SECURITY DEFINER et appartiennent à
-- `postgres`, qui porte BYPASSRLS : les policies ne s'appliquent pas à elles. Les TRIGGERS, si.
-- Et dans un trigger, `auth.uid()` reste celui de l'appelant : impossible d'y reconnaître « c'est
-- le serveur qui écrit ». Les deux fonctions posent donc un drapeau de transaction que le trigger
-- relit.
--
-- `coalesce(current_setting('sv.formation_serveur', true), '')`, ET PAS `current_setting(...)` NU.
-- Un réglage absent rend NULL, et `NULL = 'oui'` vaut NULL, pas `false` : un garde écrit sans ce
-- `coalesce` ne lèverait jamais, exactement dans le cas qu'il devait refuser. C'est le défaut
-- trouvé deux fois ailleurs dans cette base le même jour.
--
-- `set_config(..., true)` : local à la transaction. Il retombe au commit comme au rollback, et il
-- ne peut pas être posé par PostgREST — un client qui enverrait `sv.formation_serveur` dans ses
-- en-têtes ne toucherait qu'un réglage de session que ce code ne lit pas (le trigger lit le
-- réglage local, écrasé par celui de la fonction à chaque appel légitime).

begin;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
--  1. CETTE FORMATION M'EST-ELLE OUVERTE ?
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- La même question que `formations_lire` pose déjà en lecture, plus le grade que l'écran affiche
-- déjà sous forme de verrou. On l'écrit UNE fois, ici, et la policy l'appelle : recopier le
-- prédicat dans la policy donnerait deux versions de la même règle, et le jour où l'une change,
-- c'est la plus permissive qui gagne.
--
-- SECURITY DEFINER parce qu'elle lit `formations`, qui porte sa propre RLS : évaluée avec les
-- droits du lecteur à l'intérieur d'une policy, elle rendrait toujours faux pour la formation
-- qu'on cherche justement à refuser — et vrai pour aucune autre raison que le hasard.
-- Pas d'argument par défaut : `create or replace` avec un défaut SURCHARGE au lieu de remplacer.
create or replace function public.formation_ouverte_a_moi(p_formation_id text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  -- L'administration et la production gardent leur passe-droit : 14 inscriptions réelles en
  -- dépendent, et c'est leur travail de se former sur ce qu'elles pilotent.
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.actif and p.role in ('admin', 'prod')
  )
  or exists (
    select 1
      from public.formations f
      join public.profiles p on p.id = auth.uid()
     where f.id = p_formation_id
       and p.actif
       and f.publiee
       -- `roles` NULL = ouverte à tous, le même sens que dans `formations_lire`.
       and (f.roles is null or p.role = any (f.roles))
       -- `grade` NULL compte pour 0 : un grade inconnu n'est pas un grade élevé.
       and (f.grade_minimum is null or coalesce(p.grade, 0) >= f.grade_minimum)
  );
$$;

comment on function public.formation_ouverte_a_moi(text) is
  'v440 : on ne s''inscrit pas à une formation qu''on ne peut pas lire, ni à une formation verrouillée au-dessus de son grade. Admin et prod exceptés.';

-- ══════════════════════════════════════════════════════════════════════════════════════════════
--  2. L'INSCRIPTION
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- On remplace la policy au lieu d'en ajouter une : deux policies PERMISSIVE s'additionnent, et
-- l'ancienne aurait continué d'autoriser tout ce que la nouvelle refuse.
drop policy if exists fi_own_write on public.formation_inscriptions;
create policy fi_own_write on public.formation_inscriptions
  for insert
  with check (
    collaborateur_id = auth.uid()
    and public.formation_ouverte_a_moi(formation_id)
  );

-- ══════════════════════════════════════════════════════════════════════════════════════════════
--  3. CE QUI SE CALCULE NE SE DÉCLARE PAS
-- ══════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.protect_sensitive_formation_inscription_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  is_privileged boolean;
  -- Le drapeau posé par `rpc_complete_formation` et `rpc_submit_quiz`. `coalesce` d'abord : un
  -- réglage absent rend NULL, et une comparaison avec NULL ne lève jamais.
  v_serveur boolean := coalesce(current_setting('sv.formation_serveur', true), '') = 'oui';
begin
  if auth.role() = 'service_role' or v_serveur then
    return new;
  end if;

  select exists(select 1 from profiles where id = auth.uid() and role in ('admin','prod')) into is_privileged;
  if is_privileged then
    return new;
  end if;

  -- v440 : le garde d'origine ne refusait un changement d'XP que si l'ANCIENNE valeur n'était pas
  -- 0. Une inscription naît à 0 : il laissait donc passer le seul cas qui se présente vraiment.
  if new.xp_gagnes is distinct from old.xp_gagnes then
    raise exception 'Modification non autorisée : les XP gagnés sont attribués par SportVision, pas déclarés par le collaborateur.';
  end if;

  -- Une formation se termine par le bouton de fin de parcours, qui vérifie en base que toutes les
  -- leçons sont faites. Redescendre à `en_cours` reste permis : c'est ce que fait l'OS quand on
  -- décoche une leçon.
  if new.statut is distinct from old.statut and new.statut = 'terminee' then
    raise exception 'Une formation se termine par le bouton de fin de parcours : il vérifie que toutes les leçons sont faites. Elle ne se déclare pas terminée.';
  end if;

  if new.quiz_passe is distinct from old.quiz_passe
     or new.score_quiz is distinct from old.score_quiz
     or new.completed_at is distinct from old.completed_at
  then
    raise exception 'Modification non autorisée : le résultat du quiz et la date de fin sont écrits par le correcteur de SportVision.';
  end if;

  return new;
end;
$function$;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
--  4. LA CERTIFICATION NE S'ÉCRIT PLUS À LA MAIN
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- `cc_own_insert` vérifiait que l'inscription était `terminee` — une condition que son porteur
-- venait d'écrire lui-même. Rien de légitime n'en a besoin : `rpc_complete_functions` est
-- SECURITY DEFINER et son propriétaire porte BYPASSRLS, et `cc_admin_manage` couvre déjà
-- l'administration et la production. Vérifié : aucune Edge Function, aucun écran de l'OS et aucun
-- écran de l'application n'insère dans cette table.
drop policy if exists cc_own_insert on public.collaborateur_certifications;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
--  5. LE SERVEUR SE NOMME AVANT D'ÉCRIRE
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- Une seule ligne ajoutée à chacune des deux fonctions, en tête. Tout le reste est le corps en
-- production, relu ligne à ligne et recopié sans y toucher.

create or replace function public.rpc_complete_formation(p_inscription_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
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
  -- v440 : c'est le serveur qui écrit, et le trigger a le droit de le savoir. Local à la
  -- transaction : il retombe au commit comme au rollback.
  perform set_config('sv.formation_serveur', 'oui', true);

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

create or replace function public.rpc_submit_quiz(p_inscription_id uuid, p_answers jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
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
  -- v440 : voir `rpc_complete_formation`.
  perform set_config('sv.formation_serveur', 'oui', true);

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

commit;
