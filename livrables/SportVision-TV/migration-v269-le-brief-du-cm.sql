-- v269 — Le CM écrit un brief, la Production le reçoit (25/09/2026)
--
-- DEMANDE DE FOUKA : « Quand le community manager prévoit une couverture SportVision, il faut
-- qu'il puisse mettre un brief à envoyer au responsable production, directement. »
--
-- CE QUI EXISTAIT : `planned_presences.notes` était là, et personne ne l'écrivait ni ne le lisait.
-- `cm_definir_couverture` ne transportait qu'une référence d'événement et un type de couverture.
-- Le CM décidait « photo + vidéo sur ce match » et n'avait aucun moyen de dire POURQUOI ni QUOI —
-- le sponsor à cadrer, le joueur qui fait ses débuts, le partenaire à saluer. Il fallait un appel
-- téléphonique, ou rien.
--
-- LE BRIEF NE VA PAS DANS `description_besoin`. Ce champ est généré et réécrit à chaque match
-- ajouté à la mission : un texte écrit à la main y serait effacé au prochain regroupement, sans
-- que personne comprenne pourquoi. Il a donc sa colonne, `prestations.brief_cm`.
--
-- UNE MISSION REGROUPE PLUSIEURS MATCHS, et le CM a pu écrire une consigne sur chacun. On les
-- rassemble en nommant l'équipe concernée : sans ça, on ne saurait pas à quel match « filmer le
-- capitaine » se rapporte.
--
-- RECLIQUER N'EFFACE PAS. Changer le type de couverture après coup ne remplace le brief que si un
-- nouveau texte arrive : `coalesce(excluded.notes, planned_presences.notes)`.
--
-- Idempotente.

CREATE OR REPLACE FUNCTION public.cm_definir_couverture(p_ref text, p_type text, p_brief text DEFAULT NULL::text)
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
  v_brief text;
begin
  v_brief := nullif(btrim(coalesce(p_brief, '')), '');
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
                                   type_couverture, statut, source, match_id, demande_par, notes)
    values (v_plan, v_equipe, v_date, v_heure, v_lieu, v_adversaire,
            p_type, 'prevu', 'cm_initiated', v_match, auth.uid(), v_brief)
    on conflict (match_id) where match_id is not null and statut <> 'annule'
    do update set type_couverture = excluded.type_couverture,
                  -- Recliquer pour changer le type ne doit pas effacer le brief deja ecrit :
                  -- on ne remplace que si un nouveau texte arrive.
                  notes = coalesce(excluded.notes, planned_presences.notes),
                  heure_debut = excluded.heure_debut,
                  lieu = excluded.lieu,
                  evenement_modifie_at = null,
                  evenement_modifie_detail = null,
                  updated_at = now()
    returning id into v_presence;

  elsif v_genre = 'entrainement' then
    insert into planned_presences (plan_id, equipe, date_presence, heure_debut, lieu,
                                   type_couverture, statut, source, occurrence_ref, demande_par, notes)
    values (v_plan, v_equipe, v_date, v_heure, v_lieu,
            p_type, 'prevu', 'cm_initiated', p_ref, auth.uid(), v_brief)
    on conflict (occurrence_ref) where occurrence_ref is not null and statut <> 'annule'
    do update set type_couverture = excluded.type_couverture,
                  -- Recliquer pour changer le type ne doit pas effacer le brief deja ecrit :
                  -- on ne remplace que si un nouveau texte arrive.
                  notes = coalesce(excluded.notes, planned_presences.notes),
                  heure_debut = excluded.heure_debut,
                  lieu = excluded.lieu,
                  evenement_modifie_at = null,
                  evenement_modifie_detail = null,
                  updated_at = now()
    returning id into v_presence;

  else
    insert into planned_presences (plan_id, equipe, date_presence, heure_debut, lieu,
                                   type_couverture, statut, source, calendar_event_id, demande_par, notes)
    values (v_plan, v_equipe, v_date, v_heure, v_lieu,
            p_type, 'prevu', 'cm_initiated', v_evenement, auth.uid(), v_brief)
    on conflict (calendar_event_id) where calendar_event_id is not null and statut <> 'annule'
    do update set type_couverture = excluded.type_couverture,
                  -- Recliquer pour changer le type ne doit pas effacer le brief deja ecrit :
                  -- on ne remplace que si un nouveau texte arrive.
                  notes = coalesce(excluded.notes, planned_presences.notes),
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
-- Le brief du CM voyage jusqu'a la mission, et la Production est prevenue.
alter table public.prestations add column if not exists brief_cm text;
comment on column public.prestations.brief_cm is
  'Les consignes ecrites par le CM au moment de decider la couverture, rassemblees depuis les '
  'presences de la mission. Distinct de description_besoin, qui est genere et reecrit a chaque '
  'ajout de match : un brief ecrit a la main ne doit jamais etre efface par un recalcul.';

create or replace function public.rafraichir_mission_regroupee(p_mission uuid)
returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  v record;
  v_type_lib text;
begin
  select count(*) as n,
         count(*) filter (where pp.match_id is not null) as nb_matchs,
         min(pp.heure_debut) as heure,
         case when count(distinct pp.type_couverture) = 1 then min(pp.type_couverture) else 'photo_video' end as couverture,
         string_agg(nullif(pp.equipe, ''), ', ' order by pp.heure_debut nulls last, pp.equipe) as equipes,
         string_agg(concat_ws(' contre ', nullif(pp.equipe, ''), nullif(pp.adversaire, ''))
                      || coalesce(' (' || to_char(pp.heure_debut, 'HH24:MI') || ')', ''),
                    ' ; ' order by pp.heure_debut nulls last, pp.equipe) as liste,
         -- LE BRIEF DU CM (25/09/2026). Une mission regroupe plusieurs matchs, et le CM a pu
         -- ecrire une consigne sur chacun : on les rassemble en nommant l'equipe concernee, sinon
         -- on ne saurait pas a quel match « filmer le capitaine » se rapporte.
         string_agg(
           case when nullif(btrim(pp.notes), '') is not null
                then coalesce(nullif(pp.equipe, '') || ' — ', '') || btrim(pp.notes) end,
           E'\n' order by pp.heure_debut nulls last, pp.equipe) as brief
    into v
    from planned_presences pp
   where pp.created_prestation_id = p_mission and pp.statut <> 'annule';
  if v.n = 0 then
    return;
  end if;
  v_type_lib := case v.couverture when 'photo' then 'photo' when 'video' then 'vidéo' else 'photo + vidéo' end;

  perform set_config('sv.ecriture_systeme', 'regroupement_mission', true);
  update prestations
     set heure_debut = v.heure,
         couverture = v.couverture,
         equipes = v.equipes,
         brief_cm = v.brief,
         description_besoin = 'Couverture ' || v_type_lib || ' — '
           || case when v.n > 1
                   then v.n || case when v.nb_matchs = v.n then ' matchs' else ' événements' end || ' au même endroit : '
                   else '' end
           || v.liste
   where id = p_mission;
  perform set_config('sv.ecriture_systeme', '', true);
end;
$function$;
