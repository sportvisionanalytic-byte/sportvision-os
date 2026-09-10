-- Présences : le club demande, le CM décide, la Production organise.
--
-- Décision de Fouka, 10/09/2026, en validant la refonte de la demande de présence :
--   CM SportVision  → Prévoir SportVision → présence créée → mission Production créée.
--   Club (président, communication, direction sportive) → Demander une présence → souhait du
--   club → le CM accepte ou refuse → seulement après acceptation, présence ET mission.
--
-- L'audit a trouvé :
--   • `cm_select_coverage_wish` et `cm_reject_coverage_wish` : AUCUN contrôle d'identité, et
--     exécutables par `anon`. N'importe qui pouvait accepter un souhait — donc créer une
--     présence — ou le refuser. Aucun écran ne les appelait : un souhait de club n'avait nulle
--     part où être traité.
--   • accepter un souhait créait une présence SANS mission, alors que la décision directe du CM
--     crée la mission (v126) : deux chemins pour le même geste, qui ne faisaient pas la même chose.
--   • `cm_definir_couverture` / `cm_annuler_couverture` ouvraient la décision à tout profil
--     interne (`is_staff()`), photographes compris.
--   • un souhait ne savait pas viser une séance d'entraînement, alors que les présences le savent
--     (`occurrence_ref`, référence `entrainement:<créneau>:<date>`).
--
-- Ici :
--   • `peut_planifier_presence(club)` : l'administration SportVision, ou le CM du club (affectation
--     nominative, délégation d'agence, CM responsable). Ni le président, ni les fonctions
--     transverses (secrétariat, production, compta, commercial, RH), ni les opérateurs.
--   • accepter un souhait = la décision du CM, par la même fonction (`cm_definir_couverture`) :
--     présence, mission, Production notifiée. Le type peut être précisé à l'acceptation.
--   • `coverage_wishes.occurrence_ref` : la même référence que les présences, pas un second modèle.
--   • `club_souhaits_couverture` rend l'événement demandé (libellé, date) et le motif d'un refus,
--     pour que le CM sache ce qu'il accepte et que le club sache pourquoi on a refusé.
-- Aucun souhait n'existait en base au moment de cette migration.

begin;

create or replace function public.peut_planifier_presence(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select p_club_id is not null and coalesce(
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
    or (p_club_id in (select cm_clubs_autorises())
        -- cm_clubs_autorises() ouvre TOUS les clubs aux fonctions transverses : elles lisent,
        -- elles ne décident pas d'une présence.
        and not exists (select 1 from profiles where id = auth.uid()
                         and role in ('com', 'sec', 'prod', 'compta', 'rh', 'photo', 'expert_comptable', 'auditeur'))),
    false);
$$;
revoke execute on function public.peut_planifier_presence(uuid) from public, anon;
grant execute on function public.peut_planifier_presence(uuid) to authenticated;

-- ── Un souhait peut viser une séance d'entraînement ──
alter table public.coverage_wishes add column if not exists occurrence_ref text;
alter table public.coverage_wishes drop constraint if exists coverage_wishes_one_event;
alter table public.coverage_wishes add constraint coverage_wishes_one_event
  check (num_nonnulls(match_id, calendar_event_id, occurrence_ref) = 1);
create unique index if not exists coverage_wishes_unique_active_occurrence
  on public.coverage_wishes (club_id, occurrence_ref)
  where status <> 'cancelled' and occurrence_ref is not null;

CREATE OR REPLACE FUNCTION public.create_coverage_wishes(p_club_id uuid, p_items jsonb)
 RETURNS SETOF coverage_wishes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_item jsonb;
  v_match_id uuid;
  v_calendar_id uuid;
  v_occ text;
  v_slot uuid;
  v_date date;
  v_row coverage_wishes;
  v_client_id uuid;
  v_cm_id uuid;
  v_label text;
  v_source text;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;
  -- 10/09/2026 — Le CM SportVision du club marque lui aussi un événement « À couvrir » : c'est
  -- son geste quotidien en Full Communication, et il n'est membre d'aucun club. Sa demande est
  -- tracée comme `cm_initiated` ; celle d'un dirigeant reste `club_request`.
  if exists (
    select 1 from club_members cm
    where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'actif'
      and cm.role in ('admin', 'president', 'comm', 'directeur_sportif')
  ) then
    v_source := 'club_request';
  elsif peut_operer_club(p_club_id) then
    v_source := 'cm_initiated';
  else
    raise exception 'Non autorisé à signaler une présence souhaitée pour ce club.';
  end if;
  if not exists (
    select 1 from organization_entitlements oe
    where oe.organization_id = p_club_id and oe.module_key = 'presences' and oe.actif = true
      and (oe.expires_at is null or oe.expires_at > now())
  ) then
    raise exception 'Cette fonctionnalité n''est pas incluse dans votre offre actuelle.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_match_id := nullif(v_item->>'match_id', '')::uuid;
    v_calendar_id := nullif(v_item->>'calendar_event_id', '')::uuid;
    v_occ := nullif(v_item->>'occurrence_ref', '');
    if num_nonnulls(v_match_id, v_calendar_id, v_occ) <> 1 then
      raise exception 'Chaque souhait doit référencer exactement un événement (match, calendrier ou séance d''entraînement).';
    end if;
    -- Une séance d'entraînement : la référence stable de SON occurrence, la même que celle des
    -- présences (`planned_presences.occurrence_ref`, posée par cm_definir_couverture). Rien n'est
    -- matérialisé : on vérifie que le créneau est du club, actif ce jour-là, et que la date tombe
    -- bien sur son jour.
    if v_occ is not null then
      if v_occ !~ '^entrainement:[0-9a-f-]{36}:[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'Séance d''entraînement introuvable pour ce club.';
      end if;
      v_slot := split_part(v_occ, ':', 2)::uuid;
      v_date := split_part(v_occ, ':', 3)::date;
      if not exists (
        select 1 from club_team_training_slots s join club_teams t on t.id = s.team_id
         where s.id = v_slot and t.club_id = p_club_id
           and (s.active_from is null or s.active_from <= v_date)
           and (s.active_to is null or s.active_to >= v_date)
           and s.jour = (array['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'])[extract(dow from v_date)::int + 1]
      ) then
        raise exception 'Séance d''entraînement introuvable pour ce club.';
      end if;
    end if;
    if v_match_id is not null and not exists (select 1 from club_matches where id = v_match_id and club_id = p_club_id) then
      raise exception 'Événement introuvable pour ce club.';
    end if;
    if v_calendar_id is not null and not exists (select 1 from club_calendar_events where id = v_calendar_id and club_id = p_club_id) then
      raise exception 'Événement introuvable pour ce club.';
    end if;

    -- ON CONFLICT ne peut cibler qu'UN arbitre par insert, et match_id/calendar_event_id
    -- s'excluent mutuellement (contrainte coverage_wishes_one_event) — deux branches distinctes,
    -- chacune avec l'index partiel qui la concerne réellement, plutôt qu'un double essai qui
    -- risquerait de créer une 2e ligne (exactement ce que §30/31 interdit).
    if v_occ is not null then
      insert into coverage_wishes (club_id, occurrence_ref, requested_by_user_id, requested_coverage_type, priority, note, source)
      values (
        p_club_id, v_occ, auth.uid(),
        coalesce(nullif(v_item->>'coverage_type', ''), 'photo_video'),
        coalesce(nullif(v_item->>'priority', ''), 'normale'),
        nullif(v_item->>'note', ''),
        v_source
      )
      on conflict (club_id, occurrence_ref) where status <> 'cancelled' and occurrence_ref is not null
      do update set updated_at = now()
      returning * into v_row;
    elsif v_match_id is not null then
      insert into coverage_wishes (club_id, match_id, calendar_event_id, requested_by_user_id, requested_coverage_type, priority, note, source)
      values (
        p_club_id, v_match_id, null, auth.uid(),
        coalesce(nullif(v_item->>'coverage_type', ''), 'photo_video'),
        coalesce(nullif(v_item->>'priority', ''), 'normale'),
        nullif(v_item->>'note', ''),
        v_source
      )
      on conflict (club_id, match_id) where status <> 'cancelled' and match_id is not null
      do update set updated_at = now()
      returning * into v_row;
    else
      insert into coverage_wishes (club_id, match_id, calendar_event_id, requested_by_user_id, requested_coverage_type, priority, note, source)
      values (
        p_club_id, null, v_calendar_id, auth.uid(),
        coalesce(nullif(v_item->>'coverage_type', ''), 'photo_video'),
        coalesce(nullif(v_item->>'priority', ''), 'normale'),
        nullif(v_item->>'note', ''),
        v_source
      )
      on conflict (club_id, calendar_event_id) where status <> 'cancelled' and calendar_event_id is not null
      do update set updated_at = now()
      returning * into v_row;
    end if;

    insert into audit_logs (acteur_id, action, cible_type, cible_id, details)
    values ((select id from profiles where id = auth.uid()), 'coverage_wish_created', 'coverage_wish', v_row.id, jsonb_build_object('club_id', p_club_id, 'acteur_reel', auth.uid()));

    return next v_row;
  end loop;

  -- Notification groupée (§17 : une notification utile, pas une par événement) au CM principal, ou
  -- fallback Admin/Responsable CM si aucun CM principal n'est affecté (§16 : la demande n'est
  -- jamais perdue).
  select portail_client_id into v_client_id from clubs where id = p_club_id;
  if v_client_id is not null then
    select cm_id, nom into v_cm_id, v_label from clients where id = v_client_id;
  end if;
  select c.nom into v_label from clubs c where c.id = p_club_id;
  if v_cm_id is not null then
    insert into notifications (type, titre, message, destinataire_id, lue, priorite, lien_client_id)
    values ('systeme', 'Nouveau souhait de présence', v_label || ' a signalé une présence SportVision souhaitée.', v_cm_id, false, 'normale', v_client_id);
  else
    perform notify_staff_by_role(array['admin'], 'Souhait de présence sans CM principal', v_label || ' a signalé une présence souhaitée, mais aucun CM principal n''est affecté à ce club.', 'haute', null, v_client_id);
  end if;
end;
$function$;

-- ── Décider, retirer : le CM du club ──
CREATE OR REPLACE FUNCTION public.cm_definir_couverture(p_ref text, p_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_genre text;
  v_match uuid;
  v_slot uuid;
  v_date date;
  v_evenement uuid;
  v_club uuid;
  v_client uuid;
  v_plan uuid;
  v_equipe text;
  v_heure time;
  v_lieu text;
  v_adversaire text;
  v_presence uuid;
  v_mission uuid;
begin
  if p_type not in ('photo','video','photo_video') then
    raise exception 'Type de couverture inconnu.' using errcode = '22023';
  end if;

  v_genre := split_part(p_ref, ':', 1);

  -- ── Resoudre l'evenement, et surtout SON club ────────────────────────────
  if v_genre = 'match' then
    v_match := nullif(split_part(p_ref, ':', 2),'')::uuid;
    select m.club_id, m.team, m.kickoff_time, m.lieu, m.opponent, m.match_date
      into v_club, v_equipe, v_heure, v_lieu, v_adversaire, v_date
    from club_matches m where m.id = v_match;
    if v_club is null then raise exception 'Match introuvable.' using errcode = 'P0002'; end if;

  elsif v_genre = 'entrainement' then
    v_slot := nullif(split_part(p_ref, ':', 2),'')::uuid;
    v_date := nullif(split_part(p_ref, ':', 3),'')::date;
    -- On relit l'occurrence dans le calendrier plutot que de recopier le creneau : l'heure et le
    -- lieu effectifs peuvent venir d'une exception, et c'est cette seance-la qu'on couvre.
    select t.club_id, t.name, coalesce(x.heure_debut, s.heure_debut), coalesce(vx.nom, v.nom)
      into v_club, v_equipe, v_heure, v_lieu
    from club_team_training_slots s
    join club_teams t on t.id = s.team_id
    left join club_venues v on v.id = s.venue_id
    left join club_training_exceptions x on x.slot_id = s.id and x.date_seance = v_date
    left join club_venues vx on vx.id = x.venue_id
    where s.id = v_slot;
    if v_club is null or v_date is null then
      raise exception 'Séance d''entraînement introuvable.' using errcode = 'P0002';
    end if;

  elsif v_genre = 'evenement' then
    v_evenement := nullif(split_part(p_ref, ':', 2),'')::uuid;
    select e.club_id, e.team, e.event_time, e.location, e.event_date
      into v_club, v_equipe, v_heure, v_lieu, v_date
    from club_calendar_events e where e.id = v_evenement;
    if v_club is null then raise exception 'Événement introuvable.' using errcode = 'P0002'; end if;

  else
    raise exception 'Référence d''événement non reconnue.' using errcode = '22023';
  end if;

  -- ── Le perimetre, avant toute ecriture ───────────────────────────────────
  if not peut_planifier_presence(v_club) then
    raise exception 'Seul le CM SportVision du club décide d''une présence.' using errcode = '42501';
  end if;

  select portail_client_id into v_client from clubs where id = v_club;
  if v_client is null then
    raise exception 'Ce club n''est pas encore relié à un dossier client SportVision. Contactez l''administration.'
      using errcode = '22023';
  end if;

  -- ── Trouver ou creer le plan du mois, sans jamais le montrer ─────────────
  -- `on conflict` sur la contrainte unique (client_id, mois) qui existait deja : deux presences
  -- creees en meme temps sur le meme mois ne produisent qu'UN plan, sans verrou applicatif.
  insert into monthly_production_plans (client_id, cm_id, mois, statut)
  values (v_client, auth.uid(), date_trunc('month', v_date)::date, 'brouillon')
  on conflict (client_id, mois) do update set updated_at = now()
  returning id into v_plan;

  -- ── Poser la couverture ──────────────────────────────────────────────────
  -- Le conflit est resolu par mise a jour : recliquer avec un autre type change le type, il ne
  -- cree pas une seconde couverture.
  if v_genre = 'match' then
    insert into planned_presences (plan_id, equipe, date_presence, heure_debut, lieu, adversaire,
                                   type_couverture, statut, source, match_id, demande_par)
    values (v_plan, v_equipe, v_date, v_heure, v_lieu, v_adversaire,
            p_type, 'prevu', 'cm_initiated', v_match, auth.uid())
    on conflict (match_id) where match_id is not null and statut <> 'annule'
    do update set type_couverture = excluded.type_couverture,
                  heure_debut = excluded.heure_debut,
                  lieu = excluded.lieu,
                  evenement_modifie_at = null,
                  evenement_modifie_detail = null,
                  updated_at = now()
    returning id into v_presence;

  elsif v_genre = 'entrainement' then
    insert into planned_presences (plan_id, equipe, date_presence, heure_debut, lieu,
                                   type_couverture, statut, source, occurrence_ref, demande_par)
    values (v_plan, v_equipe, v_date, v_heure, v_lieu,
            p_type, 'prevu', 'cm_initiated', p_ref, auth.uid())
    on conflict (occurrence_ref) where occurrence_ref is not null and statut <> 'annule'
    do update set type_couverture = excluded.type_couverture,
                  heure_debut = excluded.heure_debut,
                  lieu = excluded.lieu,
                  evenement_modifie_at = null,
                  evenement_modifie_detail = null,
                  updated_at = now()
    returning id into v_presence;

  else
    insert into planned_presences (plan_id, equipe, date_presence, heure_debut, lieu,
                                   type_couverture, statut, source, calendar_event_id, demande_par)
    values (v_plan, v_equipe, v_date, v_heure, v_lieu,
            p_type, 'prevu', 'cm_initiated', v_evenement, auth.uid())
    on conflict (calendar_event_id) where calendar_event_id is not null and statut <> 'annule'
    do update set type_couverture = excluded.type_couverture,
                  evenement_modifie_at = null,
                  evenement_modifie_detail = null,
                  updated_at = now()
    returning id into v_presence;
  end if;

  -- 10/09/2026 — La mission naît avec la décision : le responsable production la reçoit tout de
  -- suite, au lieu d'attendre que le CM envoie son planning du mois depuis l'OS.
  v_mission := creer_mission_depuis_presence(v_presence);

  return jsonb_build_object('ok', true, 'presence_id', v_presence, 'type', p_type,
                            'statut', case when v_mission is not null then 'mission_creee' else 'prevu' end,
                            'mission_id', v_mission);
end $function$;

CREATE OR REPLACE FUNCTION public.cm_annuler_couverture(p_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_presence record;
  v_club uuid;
  v_mission prestations;
  v_equipe_engagee boolean := false;
  v_dest uuid;
begin
  select pp.*, mpp.client_id into v_presence
  from planned_presences pp
  join monthly_production_plans mpp on mpp.id = pp.plan_id
  where (pp.match_id::text = nullif(split_part(p_ref,':',2),'') or pp.occurrence_ref = p_ref
         or pp.calendar_event_id::text = nullif(split_part(p_ref,':',2),''))
    and pp.statut <> 'annule'
  limit 1;

  if v_presence.id is null then
    return jsonb_build_object('ok', true, 'raison', 'aucune couverture à annuler');
  end if;

  select c.id into v_club from clubs c where c.portail_client_id = v_presence.client_id;
  if not peut_planifier_presence(v_club) then
    raise exception 'Seul le CM SportVision du club décide d''une présence.' using errcode = '42501';
  end if;

  if v_presence.created_prestation_id is not null then
    select * into v_mission from prestations where id = v_presence.created_prestation_id;
    v_equipe_engagee := v_mission.statut not in ('planifiée', 'annulée')
      or exists (select 1 from prestations_equipe pe
                  where pe.prestation_id = v_mission.id
                    and pe.statut in ('invitation_envoyée', 'en_attente', 'acceptée'));
    if v_equipe_engagee then
      raise exception 'Une équipe SportVision est déjà invitée ou affectée à cette mission. Signalez l''annulation au responsable production.'
        using errcode = '42501';
    end if;
  end if;

  update planned_presences set statut = 'annule', updated_at = now() where id = v_presence.id;

  -- La mission n'a pas encore d'équipe : le responsable production l'annule — c'est son geste.
  if v_mission.id is not null and v_mission.statut <> 'annulée' then
    for v_dest in select destinataires_production(v_mission.id) loop
      insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                                 source_type, source_id, lien_prestation_id, lien_client_id, expediteur_id)
      values (v_dest, 'changement_planning_cm', 'Couverture retirée par le CM',
              coalesce(v_mission.reference, 'La mission') || ' : le CM a retiré cette couverture. Mission à annuler.',
              v_mission.id, 'haute', 'prestation', v_mission.id, v_mission.id, v_presence.client_id, auth.uid());
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'presence_id', v_presence.id, 'statut', 'annule',
                            'mission_a_annuler', v_mission.id is not null);
end $function$;

-- ── Accepter un souhait = la décision du CM, par le même chemin ──
drop function if exists public.cm_select_coverage_wish(uuid);
create or replace function public.cm_select_coverage_wish(p_wish_id uuid, p_type text default null)
returns coverage_wishes
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_wish coverage_wishes;
  v_ref text;
  v_type text;
  v_res jsonb;
  v_presence uuid;
begin
  select * into v_wish from coverage_wishes where id = p_wish_id;
  if v_wish.id is null then raise exception 'Souhait introuvable.'; end if;
  if not peut_planifier_presence(v_wish.club_id) then
    raise exception 'Seul le CM SportVision du club répond à une demande de présence.' using errcode = '42501';
  end if;
  if v_wish.status not in ('wished', 'reviewing') then raise exception 'Ce souhait a déjà été traité.'; end if;

  v_ref := case when v_wish.match_id is not null then 'match:' || v_wish.match_id
                when v_wish.calendar_event_id is not null then 'evenement:' || v_wish.calendar_event_id
                else v_wish.occurrence_ref end;
  -- Une présence se fait en photo, en vidéo, ou les deux. Une demande « interview »,
  -- « communication » ou « autre » devient photo + vidéo, sauf si le CM précise le type.
  v_type := coalesce(nullif(p_type, ''),
                     case when v_wish.requested_coverage_type in ('photo', 'video', 'photo_video')
                          then v_wish.requested_coverage_type else 'photo_video' end);

  v_res := cm_definir_couverture(v_ref, v_type);
  v_presence := (v_res->>'presence_id')::uuid;

  -- La présence garde la trace de son origine : une demande du club, et qui l'a faite.
  update planned_presences
     set source = 'club_request', demande_par = coalesce(v_wish.requested_by_user_id, demande_par)
   where id = v_presence;

  update coverage_wishes
     set status = 'selected', reviewed_by = auth.uid(), reviewed_at = now(), planned_presence_id = v_presence
   where id = p_wish_id
  returning * into v_wish;

  insert into audit_logs (acteur_id, action, cible_type, cible_id, details)
  values ((select id from profiles where id = auth.uid()), 'coverage_wish_selected', 'coverage_wish', p_wish_id,
          jsonb_build_object('planned_presence_id', v_presence, 'mission_id', v_res->>'mission_id', 'type', v_type,
                             'acteur_reel', auth.uid()));
  return v_wish;
end;
$$;

CREATE OR REPLACE FUNCTION public.cm_reject_coverage_wish(p_wish_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS coverage_wishes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_wish coverage_wishes;
begin
  select * into v_wish from coverage_wishes where id = p_wish_id;
  if v_wish.id is null then raise exception 'Souhait introuvable.'; end if;
  if not peut_planifier_presence(v_wish.club_id) then
    raise exception 'Seul le CM SportVision du club répond à une demande de présence.' using errcode = '42501';
  end if;
  if v_wish.status not in ('wished', 'reviewing') then raise exception 'Ce souhait a déjà été traité.'; end if;

  update coverage_wishes set status = 'not_selected', not_selected_reason = p_reason, reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_wish_id returning * into v_wish;

  insert into audit_logs (acteur_id, action, cible_type, cible_id, details)
  values ((select id from profiles where id = auth.uid()), 'coverage_wish_not_selected', 'coverage_wish', p_wish_id, jsonb_build_object('reason', p_reason, 'acteur_reel', auth.uid()));

  return v_wish;
end;
$function$;

revoke execute on function public.cm_select_coverage_wish(uuid, text) from public, anon;
revoke execute on function public.cm_reject_coverage_wish(uuid, text) from public, anon;
grant execute on function public.cm_select_coverage_wish(uuid, text) to authenticated;
grant execute on function public.cm_reject_coverage_wish(uuid, text) to authenticated;

-- ── Lire les souhaits : l'événement demandé, et le motif d'un refus ──
drop function if exists public.club_souhaits_couverture(uuid);
create function public.club_souhaits_couverture(p_club_id uuid)
returns table (id uuid, match_id uuid, calendar_event_id uuid, occurrence_ref text, status text,
               requested_coverage_type text, priority text, note text, source text,
               created_at timestamptz, not_selected_reason text, evenement_libelle text, evenement_date date)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not peut_lire_calendrier_club(p_club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select w.id, w.match_id, w.calendar_event_id, w.occurrence_ref, w.status, w.requested_coverage_type,
         w.priority, w.note, w.source, w.created_at, w.not_selected_reason,
         coalesce(
           (select nullif(concat_ws(' — ', m.team, m.opponent), '') from club_matches m where m.id = w.match_id),
           (select e.title from club_calendar_events e where e.id = w.calendar_event_id),
           (select t.name || ' — Entraînement' from club_team_training_slots s join club_teams t on t.id = s.team_id
             where w.occurrence_ref is not null and s.id = split_part(w.occurrence_ref, ':', 2)::uuid),
           'Événement'),
         coalesce(
           (select m.match_date from club_matches m where m.id = w.match_id),
           (select e.event_date from club_calendar_events e where e.id = w.calendar_event_id),
           case when w.occurrence_ref is not null then split_part(w.occurrence_ref, ':', 3)::date end)
    from coverage_wishes w
   where w.club_id = p_club_id and w.status <> 'cancelled'
   order by w.created_at desc;
end;
$$;
revoke execute on function public.club_souhaits_couverture(uuid) from public, anon;
grant execute on function public.club_souhaits_couverture(uuid) to authenticated;

commit;
