-- v142 : une mission regroupée compte pour UNE présence (11/09/2026).
--
-- Retour de Fouka sur Villemomble : quatre matchs cochés le même jour au même stade forment une
-- seule mission (v133), mais la carte « prévues / réalisées » du CM et la rentabilité du mois en
-- comptaient quatre. Huit présences affichées pour deux déplacements réels (SV-2026-0268,
-- SV-2026-0274).
--
-- La présence SportVision, c'est le déplacement : une mission. Chaque match garde sa ligne dans
-- planned_presences (la couverture reste décidée match par match), mais on compte
-- distinct coalesce(created_prestation_id, id) : les lignes d'une même mission comptent une fois,
-- une présence pas encore transformée en mission compte pour elle-même.
--
-- Seuls les trois comptages changent ; le reste des deux fonctions est recopié tel quel.
-- Test : tests/presences-comptees-par-mission.test.sql

CREATE OR REPLACE FUNCTION public.cm_tableau_de_bord(p_club_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_debut date := (current_date - ((extract(isodow from current_date)::int - 1)))::date;
  v_fin date := v_debut + 6;
  v_mois_debut date := date_trunc('month', current_date)::date;
  v_mois_fin date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  v_client uuid;
  v_resultat jsonb;
begin
  if not peut_preparer_club(p_club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  select portail_client_id into v_client from clubs where id = p_club_id;

  select jsonb_build_object(

    'aujourdhui', jsonb_build_object(
      'matchs', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', c.ref, 'equipe', c.equipe, 'adversaire', c.adversaire,
                 'heure', to_char(c.heure_debut,'HH24:MI'), 'domicile', c.domicile,
                 'lieu', c.lieu, 'competition', c.competition,
                 'couverture', c.couverture is not null,
                 'type_couverture', c.type_couverture)
               order by c.heure_debut nulls last)
        from club_calendrier(p_club_id, current_date, current_date) c
        where c.genre = 'match' and c.statut <> 'cancelled'), '[]'::jsonb),
      'entrainements', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'equipe', c.equipe,
                 'debut', to_char(c.heure_debut,'HH24:MI'),
                 'fin', to_char(c.heure_fin,'HH24:MI'),
                 'lieu', c.lieu,
                 'annule', c.statut = 'annulee',
                 'couverture', c.couverture is not null)
               order by c.heure_debut)
        from club_calendrier(p_club_id, current_date, current_date) c
        where c.genre = 'entrainement'), '[]'::jsonb),
      'autres', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'genre', c.genre, 'titre', c.titre, 'equipe', c.equipe,
                 'heure', to_char(c.heure_debut,'HH24:MI'), 'lieu', c.lieu,
                 'couverture', c.couverture is not null)
               order by c.heure_debut nulls last)
        from club_calendrier(p_club_id, current_date, current_date) c
        where c.genre not in ('match', 'entrainement')), '[]'::jsonb),
      'publications', case when v_client is null then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object('id', ct.id, 'titre', ct.titre, 'statut', ct.statut,
                                            'plateforme', ct.plateforme,
                                            'heure', to_char(ct.date_prevue, 'HH24:MI'))
               order by ct.date_prevue)
        from contenus ct
        where ct.client_id = v_client and ct.date_prevue::date = current_date
          and coalesce(ct.statut, '') not in ('archive', 'refuse')), '[]'::jsonb) end
    ),

    'a_faire', jsonb_build_object(
      'demandes_du_club', (
        select count(*) from club_requests r
        where r.club_id = p_club_id
          and coalesce(r.status,'recues') in ('recues','info_manquante','en_traitement')),
      'demandes_urgentes', (
        select count(*) from club_requests r
        where r.club_id = p_club_id and r.urgency = 'haute'
          and coalesce(r.status,'recues') in ('recues','info_manquante','en_traitement')),
      'resultats_manquants', (
        select count(*) from club_matches m
        where m.club_id = p_club_id and m.match_date < current_date
          and coalesce(m.sport_status,'') <> 'cancelled'
          and nullif(btrim(coalesce(m.score,'')),'') is null),
      'resultats_recents', (
        select count(*) from club_matches m
        where m.club_id = p_club_id and m.match_date between current_date - 3 and current_date - 1
          and coalesce(m.sport_status,'') <> 'cancelled'
          and nullif(btrim(coalesce(m.score,'')),'') is null),
      'prochaine_sans_couverture', (
        select jsonb_build_object('id', m.id, 'equipe', m.team, 'adversaire', m.opponent,
                                  'date', m.match_date, 'heure', to_char(m.kickoff_time,'HH24:MI'))
        from club_matches m
        where m.club_id = p_club_id and m.match_date >= current_date
          and coalesce(m.sport_status,'scheduled') <> 'cancelled'
          and not exists (select 1 from planned_presences pp
                          where pp.match_id = m.id and coalesce(pp.statut,'prevu') <> 'annule')
        order by m.match_date, m.kickoff_time nulls last limit 1),
      'equipes_sans_coach', (
        select count(*) from club_equipes_etat(p_club_id) e where e.encadrant_statut = 'aucun'),
      'sections_mise_en_place', (
        select count(*) from club_onboarding_sections(p_club_id) s where s.etat = 'incomplet'),
      'invitations_preparees', (
        select count(*) from club_invitations ci
        where ci.club_id = p_club_id and ci.statut = 'preparee' and ci.expire_at > now()),
      'invitations_en_attente', (
        select count(*) from club_invitations ci
        where ci.club_id = p_club_id and ci.statut = 'envoyee' and ci.expire_at > now()),
      'joueurs_sans_droit_image', (
        select coalesce(sum(e.joueurs - e.image_valides), 0) from club_equipes_etat(p_club_id) e),
      'contenus_a_valider', case when v_client is null then 0 else (
        select count(*) from contenus ct
        where ct.client_id = v_client
          and ct.statut in ('a_valider_interne','a_valider_client','a_valider_tuteur','corrections')) end,
      'contenus_a_valider_proches', case when v_client is null then 0 else (
        select count(*) from contenus ct
        where ct.client_id = v_client
          and ct.statut in ('a_valider_interne','a_valider_client','a_valider_tuteur','corrections')
          and ct.date_prevue::date <= current_date + 2) end,
      'souhaits_couverture', (
        select count(*) from coverage_wishes w
        where w.club_id = p_club_id and w.status in ('wished','reviewing'))
    ),

    'semaine', jsonb_build_object(
      'du', v_debut, 'au', v_fin,
      'matchs', (select count(*) from club_calendrier(p_club_id, v_debut, v_fin) c
                 where c.genre = 'match' and c.statut <> 'cancelled'),
      'entrainements', (select count(*) from club_calendrier(p_club_id, v_debut, v_fin) c
                        where c.genre = 'entrainement' and c.statut <> 'annulee'),
      'presences', (select count(*) from club_calendrier(p_club_id, v_debut, v_fin) c
                    where c.couverture is not null),
      'contenus_a_publier', case when v_client is null then 0 else (
        select count(*) from contenus c
        where c.client_id = v_client
          and coalesce(c.statut,'') not in ('publie','archive','refuse')
          and c.date_prevue::date between v_debut and v_fin) end,
      'demandes', (select count(*) from club_requests r
                   where r.club_id = p_club_id
                     and coalesce(r.status,'recues') in ('recues','info_manquante','en_traitement'))
    ),

    -- Le mois Full Communication, pour la carte de la barre latérale du CM.
    'mois', jsonb_build_object(
      'presences_prevues', (
        select count(distinct coalesce(pr.created_prestation_id, pr.id)) from planned_presences pr
        where coalesce(pr.statut,'prevu') <> 'annule'
          and pr.date_presence between v_mois_debut and v_mois_fin
          and (exists (select 1 from club_matches m where m.id = pr.match_id and m.club_id = p_club_id)
               or exists (select 1 from club_calendar_events e where e.id = pr.calendar_event_id and e.club_id = p_club_id))),
      'presences_realisees', (
        select count(distinct coalesce(pr.created_prestation_id, pr.id)) from planned_presences pr
        where coalesce(pr.statut,'prevu') <> 'annule'
          and pr.date_presence between v_mois_debut and least(v_mois_fin, current_date - 1)
          and (exists (select 1 from club_matches m where m.id = pr.match_id and m.club_id = p_club_id)
               or exists (select 1 from club_calendar_events e where e.id = pr.calendar_event_id and e.club_id = p_club_id))),
      'contenus_produits', case when v_client is null then 0 else (
        select count(*) from contenus ct
        where ct.client_id = v_client and ct.statut in ('pret','valide','programme','publie')
          and coalesce(ct.date_publication, ct.updated_at)::date between v_mois_debut and v_mois_fin) end
    ),

    'adoption', jsonb_build_object(
      'clubplus_total', (select count(*) from club_members cm
                         where cm.club_id = p_club_id and cm.role in ('coach','educateur')),
      'clubplus_actifs', (select count(*) from club_members cm
                          where cm.club_id = p_club_id and cm.role in ('coach','educateur')
                            and cm.status = 'actif'),
      'connect_total', (select count(*) from player_profiles pp
                        where pp.club_id = p_club_id
                          and coalesce(pp.account_status,'sans_compte') <> 'retire'),
      'connect_actifs', (select count(*) from player_profiles pp
                         where pp.club_id = p_club_id and pp.account_status = 'actif')
    )
  ) into v_resultat;

  return v_resultat;
end $function$;

CREATE OR REPLACE FUNCTION public.rentabilite_club_mois(p_club_id uuid, p_mois date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_client uuid;
  v_debut date := date_trunc('month', p_mois)::date;
  v_fin date := (date_trunc('month', p_mois) + interval '1 month - 1 day')::date;
  v_abonnement numeric; v_ponctuel numeric; v_presences int; v_missions int;
  v_remu numeric; v_km numeric; v_frais numeric;
begin
  select portail_client_id into v_client from clubs where id = p_club_id;
  if not peut_voir_couts_client(v_client) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  select coalesce(sum(ct.montant_mensuel), 0) into v_abonnement
    from contrats ct
   where ct.client_id = v_client and ct.statut = 'actif' and ct.montant_mensuel is not null
     and (ct.date_debut is null or ct.date_debut <= v_fin) and (ct.date_fin is null or ct.date_fin >= v_debut);

  select coalesce(sum(p.montant_ht), 0) into v_ponctuel
    from prestations p
   where p.client_id = v_client and p.date_prestation between v_debut and v_fin
     and p.statut not in ('annulée', 'refusée') and p.source <> 'planning_mensuel_cm';

  select count(distinct coalesce(pr.created_prestation_id, pr.id)) into v_presences from planned_presences pr
   where coalesce(pr.statut, 'prevu') <> 'annule' and pr.date_presence between v_debut and v_fin
     and (exists (select 1 from club_matches m where m.id = pr.match_id and m.club_id = p_club_id)
          or exists (select 1 from club_calendar_events e where e.id = pr.calendar_event_id and e.club_id = p_club_id)
          or pr.occurrence_ref in (select 'entrainement:' || s.id || ':' || to_char(pr.date_presence, 'YYYY-MM-DD')
                                     from club_team_training_slots s join club_teams t on t.id = s.team_id
                                    where t.club_id = p_club_id));

  select coalesce(sum(pe.remuneration), 0), coalesce(sum(pe.frais_km), 0)
    into v_remu, v_km
    from prestations p
    left join prestations_equipe pe on pe.prestation_id = p.id and pe.statut = 'acceptée'
   where p.client_id = v_client and p.date_prestation between v_debut and v_fin
     and p.statut not in ('annulée', 'refusée');
  select count(distinct p.id) into v_missions from prestations p
   where p.client_id = v_client and p.date_prestation between v_debut and v_fin and p.statut not in ('annulée', 'refusée');

  select coalesce(sum(f.montant), 0) into v_frais
    from frais f join prestations p on p.id = f.prestation_id
   where p.client_id = v_client and p.date_prestation between v_debut and v_fin
     and f.statut in ('validé', 'remboursé');

  return jsonb_build_object(
    'mois', to_char(v_debut, 'YYYY-MM'),
    'revenus_abonnement', v_abonnement,
    'revenus_ponctuels', v_ponctuel,
    'revenus_total', v_abonnement + v_ponctuel,
    'presences', v_presences,
    'missions', v_missions,
    'remunerations', v_remu,
    'deplacements', v_km + v_frais,
    'cout_production', v_remu + v_km + v_frais,
    'marge_estimee', v_abonnement + v_ponctuel - (v_remu + v_km + v_frais)
  );
end;
$function$;
