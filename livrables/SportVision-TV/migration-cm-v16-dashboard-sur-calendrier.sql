-- ═══════════════════════════════════════════════════════════════════════════════
-- VAGUE B — Le tableau de bord lit le calendrier unifié, il ne le recalcule plus
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- La v14 projetait les créneaux d'entraînement dans son coin, avec sa propre règle de jour de la
-- semaine. Le calendrier unifié en a une autre. Deux projections parallèles finissent toujours par
-- diverger — un jour férié géré d'un côté et pas de l'autre, et le CM voit deux vérités.
--
-- Il n'en reste qu'une : club_calendrier(). « Aujourd'hui » et « Cette semaine » en sont des
-- lectures, pas des recalculs.

create or replace function public.cm_tableau_de_bord(p_club_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_debut date := (current_date - ((extract(isodow from current_date)::int - 1)))::date;
  v_fin date := v_debut + 6;
  v_client uuid;
  v_resultat jsonb;
begin
  if not peut_preparer_club(p_club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  select portail_client_id into v_client from clubs where id = p_club_id;

  select jsonb_build_object(

    -- ── Aujourd'hui : une lecture du calendrier unifié, jamais un second calcul ──
    'aujourdhui', jsonb_build_object(
      'matchs', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', c.ref, 'equipe', c.equipe, 'adversaire', c.adversaire,
                 'heure', to_char(c.heure_debut,'HH24:MI'), 'domicile', c.domicile,
                 'lieu', c.lieu, 'competition', c.competition,
                 'couverture', c.couverture is not null)
               order by c.heure_debut nulls last)
        from club_calendrier(p_club_id, current_date, current_date) c
        where c.genre = 'match' and c.statut <> 'cancelled'), '[]'::jsonb),
      'entrainements', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'equipe', c.equipe,
                 'debut', to_char(c.heure_debut,'HH24:MI'),
                 'fin', to_char(c.heure_fin,'HH24:MI'),
                 'lieu', c.lieu,
                 'annule', c.statut = 'annulee')
               order by c.heure_debut)
        from club_calendrier(p_club_id, current_date, current_date) c
        where c.genre = 'entrainement'), '[]'::jsonb)
    ),

    'a_faire', jsonb_build_object(
      'demandes_du_club', (
        select count(*) from club_requests r
        where r.club_id = p_club_id
          and coalesce(r.status,'recues') in ('recues','info_manquante','en_traitement')),
      'resultats_manquants', (
        select count(*) from club_matches m
        where m.club_id = p_club_id and m.match_date < current_date
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
        select count(*) from club_teams t
        where t.club_id = p_club_id and not coalesce(t.archivee,false)
          and nullif(btrim(coalesce(t.coach,'')),'') is null),
      'sections_mise_en_place', (
        select count(*) from club_preparation(p_club_id) cp where cp.etat <> 'complet')
    ),

    -- ── Cette semaine : comptée sur la MÊME source que l'écran calendrier ─────
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
          and c.date_prevue::date between v_debut and v_fin) end
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

select 'OK — le tableau de bord lit desormais club_calendrier()' as verdict;
