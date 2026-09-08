-- ═══════════════════════════════════════════════════════════════════════════════
-- VAGUE C — Le geste : « SportVision sera présent »
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Un seul appel depuis l'interface. Le CM ne voit jamais le plan mensuel, son identifiant, ni le
-- mois de production : il designe un evenement du calendrier par sa reference et choisit un type
-- de couverture. Tout le reste est du travail de plomberie qui n'a pas a remonter a l'ecran.
--
-- Les references acceptees sont exactement celles que club_calendrier() produit :
--   match:<uuid>
--   entrainement:<slot_id>:<AAAA-MM-JJ>
--   evenement:<uuid>
--
-- Idempotence : garantie par les index uniques partiels de la v20, pas par un bouton desactive.
-- Deux requetes simultanees, l'une des deux perd sur l'index et retombe sur la mise a jour.

begin;

create or replace function public.cm_definir_couverture(p_ref text, p_type text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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

  return jsonb_build_object('ok', true, 'presence_id', v_presence, 'type', p_type, 'statut', 'prevu');
end $function$;

-- ── Retirer la couverture ────────────────────────────────────────────────────
-- On ne supprime pas la ligne : l'historique de ce qui a ete demande puis annule a de la valeur,
-- et la Production doit pouvoir le constater plutot que de voir une demande disparaitre.
create or replace function public.cm_annuler_couverture(p_ref text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_presence record; v_club uuid;
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

  if v_presence.statut = 'mission_creee' then
    raise exception 'Une équipe SportVision est déjà affectée à cette couverture. Signalez l''annulation à la production.'
      using errcode = '42501';
  end if;

  update planned_presences set statut = 'annule', updated_at = now() where id = v_presence.id;
  return jsonb_build_object('ok', true, 'presence_id', v_presence.id, 'statut', 'annule');
end $function$;

grant execute on function public.cm_definir_couverture(text, text) to authenticated;
grant execute on function public.cm_annuler_couverture(text) to authenticated;

commit;

select 'OK — le geste de couverture est en place' as verdict;
