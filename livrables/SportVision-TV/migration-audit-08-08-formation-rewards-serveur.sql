-- ============================================================
-- Migration — XP et certifications de formation calculés côté serveur
-- (chantier laissé ouvert par les corrections du 08/08/2026 sur le
-- module Formation : le montant d'XP et l'octroi de certification
-- restent aujourd'hui décidés par le CLIENT JS — un appel direct à
-- l'API REST peut s'auto-attribuer n'importe quel montant d'XP ou
-- déclencher n'importe quelle certification, même sans avoir terminé
-- la formation. Risque déjà documenté comme "résiduel accepté" dans
-- migration-connect-v1-securite-hardening.sql (item 5) et
-- migration-formation-fix-trigger-xp-gagnes.sql : "le calcul réel des
-- XP mérite à terme une RPC dédiée".
--
-- Cette migration ferme ce risque pour la complétion de formation et
-- le bonus de quiz : le montant d'XP et les métadonnées de
-- certification sont désormais lus depuis une table de référence
-- server-side (formation_rewards), jamais acceptés depuis le client.
--
-- Ce qui N'EST PAS couvert (limite assumée, à traiter séparément si
-- besoin) : la CORRECTION du quiz (quelle réponse est la bonne) reste
-- calculée côté client depuis FORMATION_QUIZ_CATALOG, qui contient les
-- bonnes réponses en clair dans le JS envoyé au navigateur — un
-- utilisateur techniquement averti peut donc toujours se déclarer
-- "quiz réussi" sans l'être. Fermer complètement ce point demanderait
-- de déplacer les questions/réponses en base avec une RPC de
-- correction dédiée (les questions ne doivent jamais être envoyées au
-- client avec leur bonne réponse) — chantier plus lourd, hors du
-- périmètre XP/certification traité ici. Ce que cette migration ferme
-- réellement : même en mentant sur le résultat du quiz, le MONTANT du
-- bonus n'est plus falsifiable (toujours 30% du XP réel de la
-- formation côté serveur, jamais une valeur arbitraire).
--
-- Idempotent (create or replace / on conflict). À exécuter dans
-- Supabase → SQL Editor.
-- ============================================================


-- ─── 1. Table de référence : XP/leçons/certification par formation ─────────
-- Reflète FORMATIONS_CATALOG (SportVision-OS-Full.html) fusionné avec les
-- formations personnalisées publiées (formations_custom, qui REMPLACENT
-- entièrement l'entrée intégrée de même id — voir _mergeCustomFormations()),
-- exactement comme le fait le client aujourd'hui. Extrait le 08/08/2026 —
-- si le catalogue est modifié côté JS (XP, leçons, nouvelle certification),
-- cette table doit être régénérée pour rester la source de vérité.
--
-- Note découverte en générant cette extraction : FORMATIONS_CATALOG avait
-- une virgule surnuméraire créant une entrée "trou" invisible en usage
-- normal (Array.map/filter sautent les trous silencieusement) — corrigée
-- dans SportVision-OS-Full.html le même jour (108 formations réelles, pas
-- 109). Découverte séparée : la formation personnalisée cert-photo-video-
-- complet (créée le 2026-08-01, AVANT les complétions de Mikael Athanase
-- Ruffine le 2026-08-03) remplace la version intégrée et n'a pas de
-- certification — formations_custom n'a d'ailleurs aucune colonne
-- certification, donc AUCUNE formation créée ou éditée via l'admin ne peut
-- structurellement en délivrer une. Mikael a néanmoins déjà une
-- certification "Certification Photographe-Vidéaste Sportif Complet" en
-- base (backfillée manuellement plus tôt le 08/08, avant cette découverte,
-- sur la base des données intégrées désormais périmées) : à toi de décider
-- si tu la retires ou si tu la laisses (il a bien terminé les 96 leçons,
-- seule la métadonnée "certification" a disparu avec l'édition du 01/08) —
-- volontairement non modifiée ici, ce n'est pas à moi de trancher.
drop table if exists formation_rewards;
create table formation_rewards (
  formation_id text primary key,
  total_lecons integer not null default 0,
  xp integer not null default 0,
  certification_id text,
  certification_nom text,
  certification_badge text,
  certification_validite_mois integer,
  updated_at timestamptz not null default now()
);

insert into formation_rewards (formation_id, total_lecons, xp, certification_id, certification_nom, certification_badge, certification_validite_mois) values
('sv-culture', 10, 25, null, null, null, null),
('sv-securite', 10, 25, null, null, null, null),
('sv-comportement', 9, 25, null, null, null, null),
('photo-bases', 13, 45, null, null, null, null),
('cert-photo-video-complet', 96, 900, null, null, null, null),
('cert-responsable-production-complet', 73, 340, 'cert-responsable-production-complet', 'Certification Responsable Production Complet', '🧭', 24),
('cert-commercial-complet', 72, 340, 'cert-commercial-complet', 'Certification Commercial SportVision Complet', '📈', 24),
('cert-secretaire-complet', 84, 430, 'cert-secretaire-complet', 'Certification Secrétaire SportVision Complet', '📋', 24),
('photo-sony-a7', 31, 35, 'photo-sony-a7', 'Certification Opérateur Sony A7 IV', '📸', 24),
('sec-crm-05', 28, 80, 'sec-crm-05', 'CERT-SEC-05 — Gestion du portefeuille client SportVision', '🗂️', 18),
('cm-sport-01', 28, 115, 'cm-sport-01', 'CERT-CM — Community management sportif', '📱', 18),
('content-sport-01', 11, 45, 'content-sport-01', 'CERT-VERT — Contenus verticaux sportifs', '🎬', 18),
('design-sport-01', 11, 55, 'design-sport-01', 'CERT-VISUEL — Création graphique sportive niveau 1', '🎨', 18),
('mont-capcut-01', 19, 55, 'mont-capcut-01', 'CERT-CAPCUT — Montage sportif CapCut', '✂️', 24),
('fusion-motion-sport-01', 32, 115, 'fusion-motion-sport-01', 'CERT-FUSION-MOTION — Motion designer sportif DaVinci Resolve', '✨', 24),
('photo-ret-01', 32, 100, 'photo-ret-01', 'CERT-RET — Retouche photo sportive professionnelle', '🖼️', 24),
('photo-ret-adv-01', 20, 125, 'photo-ret-adv-01', 'CERT-RET2 — Retouche sportive avancée', '🖌️', 24),
('lead-terrain-01', 26, 90, 'lead-terrain-01', 'CERT-LEAD — Responsable de prestation terrain', '🚩', 12),
('prod-tournoi-01', 24, 135, 'prod-tournoi-01', 'CERT-TOURNOI — Production de tournoi sportif', '🏆', 12),
('stab-gimbal-01', 8, 70, 'stab-gimbal-01', 'CERT-STAB — Opérateur stabilisateur SportVision', '⚖️', 18),
('light-acc-01', 12, 80, 'light-acc-01', 'CERT-LIGHT-ACC — Lumière et accessoires SportVision', '💡', 18),
('pv-avance-01', 18, 50, 'pv-avance-01', 'Badge : Workflow Pro', '🗂️', 24),
('pv-avance-02', 19, 65, 'pv-avance-02', 'Badge : Culling Express', '🖼️', 24),
('pv-avance-03', 17, 65, 'pv-avance-03', 'Badge : Rush Selector', '🎞️', 24),
('pv-avance-04', 16, 80, 'pv-avance-04', 'Badge : CapCut Operator', '✂️', 24),
('pv-avance-05', 17, 65, 'pv-avance-05', 'Badge : Story Builder', '📖', 24),
('pv-avance-06', 16, 80, 'pv-avance-06', 'Badge : Rhythm Editor', '🎵', 24),
('pv-avance-07', 20, 65, 'pv-avance-07', 'Badge : Sound Designer', '🎧', 24),
('pv-avance-08', 16, 95, 'pv-avance-08', 'Badge : Motion CapCut', '🎛️', 24),
('pv-avance-09', 16, 80, 'pv-avance-09', 'Badge : Color Match', '🎨', 24),
('pv-avance-10', 16, 65, 'pv-avance-10', 'Badge : Social Finisher', '💬', 24),
('pv-avance-11', 16, 95, 'pv-avance-11', 'Badge : Action Shooter', '🏃', 24),
('pv-avance-12', 13, 65, 'pv-avance-12', 'Badge : Coverage Planner', '📝', 24),
('pv-avance-13', 16, 80, 'pv-avance-13', 'Badge : Interview Ready', '🎙️', 24),
('pv-avance-14', 16, 95, 'pv-avance-14', 'Badge : Sports Photo Pro', '📸', 24),
('pv-avance-15', 17, 110, 'pv-avance-15', 'Badge : Media Day Crew', '🗓️', 24),
('pv-avance-16', 16, 80, 'pv-avance-16', 'Badge : Player Portrait', '🌟', 24),
('pv-avance-17', 14, 65, 'pv-avance-17', 'Badge : Content Bank', '🗃️', 24),
('pv-avance-18', 15, 80, 'pv-avance-18', 'Badge : Matchday Designer', '🖌️', 24),
('pv-avance-19', 16, 80, 'pv-avance-19', 'Badge : Motion Matchday', '🎬', 24),
('pv-avance-20', 16, 65, 'pv-avance-20', 'Badge : Quality Controller', '✅', 24),
('pv-avance-21', 15, 180, 'pv-avance-21', 'Badge : Photographe-Vidéaste Avancé', '🏆', 24),
('sec-avance-01', 19, 45, 'sec-avance-01', 'Badge : Vision 360°', '🧭', 24),
('sec-avance-02', 12, 60, 'sec-avance-02', 'Badge : Onboarding sécurisé', '🔐', 24),
('sec-avance-03', 11, 60, 'sec-avance-03', 'Badge : Pipeline maîtrisé', '📊', 24),
('sec-avance-04', 11, 60, 'sec-avance-04', 'Badge : Dossier ponctuel complet', '📁', 24),
('sec-avance-05', 11, 60, 'sec-avance-05', 'Badge : Gestion Club+', '🏟️', 24),
('sec-avance-06', 11, 60, 'sec-avance-06', 'Badge : Coordination récurrente', '🔄', 24),
('sec-avance-07', 11, 70, 'sec-avance-07', 'Badge : Contrats maîtrisés', '✍️', 24),
('sec-avance-08', 11, 70, 'sec-avance-08', 'Badge : Suivi financier sécurisé', '💳', 24),
('sec-avance-09', 11, 60, 'sec-avance-09', 'Badge : Communication automatisée', '📨', 24),
('sec-avance-10', 11, 60, 'sec-avance-10', 'Badge : Agenda synchronisé', '📅', 24),
('sec-avance-11', 11, 60, 'sec-avance-11', 'Badge : Gestion documentaire', '🗄️', 24),
('sec-avance-12', 11, 70, 'sec-avance-12', 'Badge : Réflexes sécurité', '🛡️', 24),
('sec-avance-13', 11, 60, 'sec-avance-13', 'Badge : Agenda avancé', '🕐', 24),
('sec-avance-14', 11, 70, 'sec-avance-14', 'Badge : Onboarding RH', '🧑‍💼', 24),
('sec-avance-15', 17, 130, 'sec-avance-15', 'Badge : Secrétaire opérationnelle', '🏅', 24),
('cm-avance-01', 17, 45, 'cm-avance-01', 'Badge : CM Vision 360°', '🧭', 24),
('cm-avance-02', 13, 60, 'cm-avance-02', 'Badge : Accès sécurisé', '🔐', 24),
('cm-avance-03', 15, 70, 'cm-avance-03', 'Badge : Stratège social media', '🔍', 24),
('cm-avance-04', 13, 70, 'cm-avance-04', 'Badge : Studio Canva', '🎨', 24),
('cm-avance-05', 12, 70, 'cm-avance-05', 'Badge : Architecte éditorial', '🗓️', 24),
('cm-avance-06', 14, 70, 'cm-avance-06', 'Badge : Chef de contenu', '🎬', 24),
('cm-avance-07', 13, 60, 'cm-avance-07', 'Badge : Plume SportVision', '✍️', 24),
('cm-avance-08', 14, 90, 'cm-avance-08', 'Badge : Monteur social', '✂️', 24),
('cm-avance-09', 11, 80, 'cm-avance-09', 'Badge : Multi-plateformes', '📱', 24),
('cm-avance-10', 12, 70, 'cm-avance-10', 'Badge : Publication maîtrisée', '⏰', 24),
('cm-avance-11', 14, 70, 'cm-avance-11', 'Badge : Community Care', '💬', 24),
('cm-avance-12', 14, 80, 'cm-avance-12', 'Badge : Data Social', '📈', 24),
('cm-avance-13', 14, 80, 'cm-avance-13', 'Badge : CM Terrain', '🏟️', 24),
('cm-avance-14', 15, 80, 'cm-avance-14', 'Badge : Lead Community Manager', '👑', 24),
('cm-avance-15', 16, 160, 'cm-avance-15', 'Badge : Community Manager certifié', '🏅', 24),
('prod-avance-01', 15, 60, 'prod-avance-01', 'Badge : Pilotage 360°', '🧭', 24),
('prod-avance-02', 16, 80, 'prod-avance-02', 'Badge : Planificateur expert', '📅', 24),
('prod-avance-03', 16, 80, 'prod-avance-03', 'Badge : Préproduction maîtrisée', '📋', 24),
('prod-avance-04', 14, 80, 'prod-avance-04', 'Badge : Manager terrain', '🧑‍🤝‍🧑', 24),
('prod-avance-05', 13, 70, 'prod-avance-05', 'Badge : Gestionnaire de parc', '🎒', 24),
('prod-avance-06', 14, 90, 'prod-avance-06', 'Badge : Chef de terrain', '🏟️', 24),
('prod-avance-07', 14, 80, 'prod-avance-07', 'Badge : Data Workflow', '💾', 24),
('prod-avance-08', 14, 90, 'prod-avance-08', 'Badge : Quality Controller', '✅', 24),
('prod-avance-09', 14, 80, 'prod-avance-09', 'Badge : Postproduction Lead', '🎬', 24),
('prod-avance-10', 14, 70, 'prod-avance-10', 'Badge : Delivery Manager', '📤', 24),
('prod-avance-11', 16, 90, 'prod-avance-11', 'Badge : Incident Commander', '🚨', 24),
('prod-avance-12', 14, 80, 'prod-avance-12', 'Badge : Production Analyst', '📈', 24),
('prod-avance-13', 14, 80, 'prod-avance-13', 'Badge : Production sécurisée', '🛡️', 24),
('prod-avance-14', 14, 90, 'prod-avance-14', 'Badge : Lead Production', '👔', 24),
('prod-avance-15', 16, 190, 'prod-avance-15', 'Badge : Responsable Production certifié', '🏆', 24),
('cm-complet-01', 22, 45, 'cm-complet-01', 'Badge : Pilote éditorial', '🧭', 24),
('cm-complet-02', 18, 70, 'cm-complet-02', 'Badge : Relation client pro', '🤝', 24),
('cm-complet-03', 18, 70, 'cm-complet-03', 'Badge : Auditeur social media', '🔍', 24),
('cm-complet-04', 17, 80, 'cm-complet-04', 'Badge : Stratège social media', '🎯', 24),
('cm-complet-05', 17, 80, 'cm-complet-05', 'Badge : Design system club', '🎨', 24),
('cm-complet-06', 18, 80, 'cm-complet-06', 'Badge : Planificateur éditorial', '🗓️', 24),
('cm-complet-07', 18, 90, 'cm-complet-07', 'Badge : Coordinateur terrain', '🎥', 24),
('cm-complet-08', 16, 70, 'cm-complet-08', 'Badge : Copywriter sportif', '✍️', 24),
('cm-complet-09', 17, 90, 'cm-complet-09', 'Badge : Canva expert', '🖼️', 24),
('cm-complet-10', 18, 140, 'cm-complet-10', 'Badge : Monteur CapCut expert', '✂️', 24),
('cm-complet-11', 16, 90, 'cm-complet-11', 'Badge : Expert Instagram', '📸', 24),
('cm-complet-12', 17, 90, 'cm-complet-12', 'Badge : Expert TikTok', '🎵', 24),
('cm-complet-13', 17, 80, 'cm-complet-13', 'Badge : Expert Meta Business Suite', '📘', 24),
('cm-complet-14', 16, 60, 'cm-complet-14', 'Badge : Expert multi-plateforme', '▶️', 24),
('cm-complet-15', 16, 140, 'cm-complet-15', 'Badge : Expert Metricool', '📊', 24),
('cm-complet-16', 17, 70, 'cm-complet-16', 'Badge : Modérateur communauté', '💬', 24),
('cm-complet-17', 17, 80, 'cm-complet-17', 'Badge : Expert événementiel', '🏆', 24),
('cm-complet-18', 18, 90, 'cm-complet-18', 'Badge : Analyste performance', '📈', 24),
('cm-complet-19', 17, 80, 'cm-complet-19', 'Badge : Réflexes sécurité CM', '🛡️', 24),
('cm-complet-20', 16, 70, 'cm-complet-20', 'Badge : Lead Community Manager', '👑', 24),
('cm-complet-21', 15, 160, 'cm-complet-21', 'Badge : Community Manager SportVision certifié', '🎓', 24);

alter table formation_rewards enable row level security;
drop policy if exists "formation_rewards_read" on formation_rewards;
create policy "formation_rewards_read" on formation_rewards for select using (
  exists (select 1 from profiles where id = auth.uid())
);
-- Pas de policy d'écriture self-service : cette table n'est mise à jour que
-- par une future admin-régénération (rejouer cette migration) ou en direct
-- par un admin via le SQL Editor, jamais depuis l'app.


-- ─── 2. RPC : complétion de formation (statut + XP + certification) ────────
-- Remplace la fin de toggleFormLesson() (PATCH direct sur formation_
-- inscriptions avec xp_gagnes fourni par le client, puis POST xp_events/
-- collaborateur_certifications avec des montants/métadonnées fournis par
-- le client). Tout est maintenant recalculé et réécrit ici à partir de
-- formation_rewards, jamais accepté en paramètre.
create or replace function rpc_complete_formation(p_inscription_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
    where id = p_inscription_id and collaborateur_id = v_uid;
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
$$;

grant execute on function rpc_complete_formation(uuid) to authenticated;


-- ─── 3. RPC : bonus XP de quiz ──────────────────────────────────────────────
-- Remplace la fin de soumettreQuiz() (montant du bonus recalculé ici, jamais
-- accepté du client). Le résultat du quiz (score/pass) reste rapporté par le
-- client — voir la limite assumée en tête de fichier — mais le MONTANT du
-- bonus, lui, est désormais fixe et recalculé serveur (30% du XP réel de la
-- formation), jamais falsifiable.
create or replace function rpc_quiz_bonus(p_inscription_id uuid, p_score integer, p_pass boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_insc formation_inscriptions%rowtype;
  v_reward formation_rewards%rowtype;
  v_role text;
  v_bonus integer := 0;
  v_already_passed boolean;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  select * into v_insc from formation_inscriptions
    where id = p_inscription_id and collaborateur_id = v_uid;
  if not found then
    raise exception 'Inscription introuvable ou non autorisée.';
  end if;

  v_already_passed := coalesce(v_insc.quiz_passe, false);

  select * into v_reward from formation_rewards where formation_id = v_insc.formation_id;
  if not found then
    raise exception 'Formation inconnue côté serveur (formation_rewards non à jour).';
  end if;

  update formation_inscriptions set score_quiz = p_score, quiz_passe = p_pass
    where id = p_inscription_id;

  select role into v_role from profiles where id = v_uid;
  if v_role = 'photo' and p_pass and not v_already_passed then
    v_bonus := round(v_reward.xp * 0.3);
    if v_bonus > 0 then
      insert into xp_events (collaborateur_id, montant, type, source_id, source_type, description, attribue_par)
      values (v_uid, v_bonus, 'bonus', p_inscription_id, 'formation_inscriptions', 'Quiz réussi', v_uid);
      update profiles set xp = coalesce(xp,0) + v_bonus where id = v_uid;
    end if;
  end if;

  return jsonb_build_object('score_saved', true, 'bonus_xp', v_bonus);
end;
$$;

grant execute on function rpc_quiz_bonus(uuid, integer, boolean) to authenticated;
