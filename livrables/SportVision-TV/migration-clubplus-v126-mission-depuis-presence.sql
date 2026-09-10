-- Une présence SportVision décidée crée sa fiche mission chez le responsable production.
--
-- Demande de Fouka, 10/09/2026 : « pour les présences SportVision, il faut que ça crée une fiche
-- mission chez le responsable production, qui lui va affecter. »
--
-- ── Avant ──
-- Le CM décidait une présence (`cm_definir_couverture`) : elle restait « prévue » dans un plan
-- mensuel invisible. La mission (`prestations`) ne naissait que lorsque le CM ouvrait l'OS et
-- envoyait son planning du mois (`generate_missions_from_plan`). Jusque-là, la production ne voyait
-- rien — une présence décidée le lundi pour le samedi pouvait n'arriver chez elle qu'après le match.
--
-- ── Maintenant ──
--   • Décider une présence crée AUSSITÔT la mission, statut « planifiée » (prête à affecter), avec
--     date, heure, lieu, équipe, adversaire et type de couverture. Elle est adressée au responsable
--     production du pôle du club s'il est seul, sinon à toute la production (`destinataires_
--     production`, la règle existante), avec une notification « Nouvelle mission à affecter ».
--   • Changer le type de couverture met la mission à jour et prévient le responsable.
--   • Retirer une présence dont la mission n'a pas encore d'équipe : la présence est annulée et le
--     responsable prévenu. Annuler la mission elle-même reste son geste — la règle de production
--     réserve ce statut au secrétariat et à la production, et on ne la contourne pas.
--   • Une fois une équipe invitée ou affectée, le retrait reste refusé au CM (décision antérieure) :
--     c'est au responsable production de décider.
--   • `generate_missions_from_plan` reste valable : il ignore les présences qui ont déjà leur mission.

begin;

-- ── Le responsable production d'un client : l'unique profil production actif de son pôle ──
create or replace function public.responsable_production_du_client(p_client_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select case when count(*) = 1 then (array_agg(p.id))[1] end
    from clients c
    join pole_affectations pa on pa.pole_id = c.pole_id and pa.actif
    join profiles p on p.id = pa.user_id and p.role = 'prod' and coalesce(p.actif, true)
   where c.id = p_client_id;
$$;
revoke execute on function public.responsable_production_du_client(uuid) from public, anon, authenticated;

-- ── La mission, depuis une présence ──
-- Outil interne : appelé par cm_definir_couverture, jamais par l'API.
create or replace function public.creer_mission_depuis_presence(p_presence_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_pp planned_presences;
  v_client uuid;
  v_club_nom text;
  v_discipline text;
  v_mission prestations;
  v_resp uuid;
  v_type text;
  v_libelle text;
  v_dest uuid;
begin
  select * into v_pp from planned_presences where id = p_presence_id;
  if v_pp.id is null or v_pp.statut = 'annule' then
    return null;
  end if;
  select mpp.client_id into v_client from monthly_production_plans mpp where mpp.id = v_pp.plan_id;
  select c.nom, c.discipline into v_club_nom, v_discipline from clubs c where c.portail_client_id = v_client limit 1;

  v_libelle := concat_ws(' · ', v_club_nom,
                         concat_ws(' contre ', nullif(v_pp.equipe, ''), nullif(v_pp.adversaire, '')),
                         to_char(v_pp.date_presence, 'DD/MM') || coalesce(' ' || to_char(v_pp.heure_debut, 'HH24:MI'), ''),
                         case v_pp.type_couverture when 'photo' then 'Photo' when 'video' then 'Vidéo'
                                                   when 'photo_video' then 'Photo + vidéo' end);

  -- Déjà une mission : on la tient à jour du type de couverture, et on prévient.
  if v_pp.created_prestation_id is not null then
    select * into v_mission from prestations where id = v_pp.created_prestation_id;
    if v_mission.id is not null and v_mission.couverture is distinct from v_pp.type_couverture
       and v_mission.statut not in ('annulée', 'clôturée') then
      update prestations set couverture = v_pp.type_couverture where id = v_mission.id;
      for v_dest in select destinataires_production(v_mission.id) loop
        insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                                   source_type, source_id, lien_prestation_id, lien_client_id, expediteur_id)
        values (v_dest, 'changement_planning_cm', 'Type de couverture modifié',
                v_libelle || ' — le CM a changé le type de couverture.', v_mission.id, 'normale',
                'prestation', v_mission.id, v_mission.id, v_client, auth.uid());
      end loop;
    end if;
    return v_pp.created_prestation_id;
  end if;

  v_type := case when v_pp.match_id is not null then 'match'
                 when v_pp.occurrence_ref is not null then 'entrainement'
                 else 'evenement' end;
  v_resp := responsable_production_du_client(v_client);

  insert into prestations (client_id, date_prestation, heure_debut, lieu, equipes, sport,
                           type_prestation, statut, source, planned_presence_id, match_id,
                           calendar_event_id, couverture, responsable_prod_id, created_by,
                           description_besoin, notes_internes)
  values (v_client, v_pp.date_presence, v_pp.heure_debut, v_pp.lieu, v_pp.equipe, v_discipline,
          v_type, 'planifiée', 'planning_mensuel_cm', v_pp.id, v_pp.match_id,
          v_pp.calendar_event_id, v_pp.type_couverture, v_resp, auth.uid(),
          'Couverture ' || coalesce(case v_pp.type_couverture when 'photo' then 'photo' when 'video' then 'vidéo'
                                                              when 'photo_video' then 'photo + vidéo' end, '')
            || coalesce(' — ' || nullif(v_pp.equipe, ''), '') || coalesce(' contre ' || nullif(v_pp.adversaire, ''), ''),
          'Créée automatiquement le ' || to_char(now() at time zone 'Europe/Paris', 'DD/MM/YYYY à HH24:MI')
            || ' depuis la couverture décidée par le CM dans Club+.')
  returning * into v_mission;

  update planned_presences
     set statut = 'mission_creee', created_prestation_id = v_mission.id, updated_at = now()
   where id = v_pp.id;

  for v_dest in select destinataires_production(v_mission.id) loop
    insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                               source_type, source_id, lien_prestation_id, lien_client_id, expediteur_id)
    values (v_dest, 'nouvelle_mission', 'Nouvelle mission à affecter',
            v_libelle || ' — présence décidée par le CM, équipe à affecter.', v_mission.id, 'haute',
            'prestation', v_mission.id, v_mission.id, v_client, auth.uid());
  end loop;

  return v_mission.id;
end;
$$;
revoke execute on function public.creer_mission_depuis_presence(uuid) from public, anon, authenticated;

-- ── La décision de couverture crée la mission ──
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
  if not (v_club in (select cm_clubs_autorises()) or is_staff()) then
    raise exception 'Ce club ne vous est pas confié.' using errcode = '42501';
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

-- ── Retirer une couverture ──
create or replace function public.cm_annuler_couverture(p_ref text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
  if not (v_club in (select cm_clubs_autorises()) or is_staff()) then
    raise exception 'Ce club ne vous est pas confié.' using errcode = '42501';
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

commit;
