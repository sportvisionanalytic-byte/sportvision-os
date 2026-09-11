-- v147 : « résultats à renseigner » compte comme le Match Center (11/09/2026).
--
-- Trouvé en balayant Club+ : le tableau de bord du CM annonçait 49 résultats à renseigner à
-- Villemomble, le Match Center 50. Deux règles différentes pour la même question.
--   • le tableau de bord ne comptait que les matchs sans score. Or depuis le 10/09 un score
--     publié par la fédération ne clôt pas le match (il manque buteurs, homme du match) : le
--     Match Center le garde « à renseigner » jusqu'à la confirmation du club (statut « recu ») ;
--   • il comptait en revanche un match reporté ou annulé par le club (statut « reportee » /
--     « annulee »), que le Match Center range à part.
-- On aligne sur la règle du Match Center (lib/matches/etat.ts) : passé, pas annulé par la
-- fédération, et pas encore confirmé, reporté ou annulé par le club.
-- Seules ces deux conditions changent ; le reste de la fonction est recopié tel quel.
-- Test : tests/resultats-a-renseigner.test.sql

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
          and coalesce(m.status,'a_venir') not in ('recu','reportee','annulee')),
      'resultats_recents', (
        select count(*) from club_matches m
        where m.club_id = p_club_id and m.match_date between current_date - 3 and current_date - 1
          and coalesce(m.sport_status,'') <> 'cancelled'
          and coalesce(m.status,'a_venir') not in ('recu','reportee','annulee')),
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
      'presences', nb_presences_club(p_club_id, v_debut, v_fin),
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
      'presences_prevues', nb_presences_club(p_club_id, v_mois_debut, v_mois_fin),
      'presences_realisees', nb_presences_club(p_club_id, v_mois_debut, least(v_mois_fin, current_date - 1)),
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
