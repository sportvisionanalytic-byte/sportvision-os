-- ═══════════════════════════════════════════════════════════════════════════════
-- VAGUE A — Le tableau de bord du CM, calcule en base
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Une seule fonction plutot que dix requetes cote navigateur : le perimetre du CM est verifie une
-- fois, les compteurs ne peuvent pas diverger entre deux ecrans, et un club charge en un aller.
--
-- Hierarchie imposee par Fouka : Aujourd'hui → A faire → Cette semaine → Activite recente.
-- « A faire » ne contient que des choses REELLEMENT actionnables. Aucun chiffre inventé : quand
-- une donnee n'existe pas, le compteur vaut zero et l'interface masque le bloc plutot que
-- d'afficher « 0 / 0 », qui a l'air d'une mesure alors que ce n'est qu'une absence.

create or replace function public.cm_tableau_de_bord(p_club_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_jour text;
  v_debut date := (current_date - ((extract(isodow from current_date)::int - 1)))::date;
  v_fin date := v_debut + 6;
  v_client uuid;
  v_resultat jsonb;
begin
  if not peut_preparer_club(p_club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  v_jour := (array['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'])
              [extract(isodow from current_date)::int];
  select portail_client_id into v_client from clubs where id = p_club_id;

  select jsonb_build_object(

    -- ── Aujourd'hui ────────────────────────────────────────────────────────────
    'aujourdhui', jsonb_build_object(
      'matchs', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', m.id, 'equipe', m.team, 'adversaire', m.opponent,
                 'heure', to_char(m.kickoff_time, 'HH24:MI'), 'domicile', m.is_home,
                 'lieu', m.lieu, 'competition', m.competition,
                 -- Une couverture existe des qu'une presence non annulee pointe ce match.
                 'couverture', exists (
                   select 1 from planned_presences pp
                   where pp.match_id = m.id and coalesce(pp.statut,'prevu') <> 'annule'))
               order by m.kickoff_time nulls last)
        from club_matches m
        where m.club_id = p_club_id and m.match_date = current_date
          and coalesce(m.sport_status,'scheduled') <> 'cancelled'), '[]'::jsonb),
      'entrainements', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'equipe', t.name,
                 'debut', to_char(s.heure_debut,'HH24:MI'),
                 'fin', to_char(s.heure_fin,'HH24:MI'),
                 'lieu', v.nom)
               order by s.heure_debut)
        from club_team_training_slots s
        join club_teams t on t.id = s.team_id
        left join club_venues v on v.id = s.venue_id
        where t.club_id = p_club_id and not coalesce(t.archivee,false) and s.jour = v_jour), '[]'::jsonb)
    ),

    -- ── A faire : uniquement ce sur quoi le CM peut agir maintenant ────────────
    'a_faire', jsonb_build_object(
      'demandes_du_club', (
        select count(*) from club_requests r
        where r.club_id = p_club_id
          and coalesce(r.status,'recues') in ('recues','info_manquante','en_traitement')),
      'resultats_manquants', (
        select count(*) from club_matches m
        where m.club_id = p_club_id
          and m.match_date < current_date
          and coalesce(m.sport_status,'') <> 'cancelled'
          and nullif(btrim(coalesce(m.score,'')),'') is null),
      -- La prochaine rencontre sur laquelle personne n'a encore tranche la couverture.
      'prochaine_sans_couverture', (
        select jsonb_build_object('id', m.id, 'equipe', m.team, 'adversaire', m.opponent,
                                  'date', m.match_date, 'heure', to_char(m.kickoff_time,'HH24:MI'))
        from club_matches m
        where m.club_id = p_club_id and m.match_date >= current_date
          and coalesce(m.sport_status,'scheduled') <> 'cancelled'
          and not exists (select 1 from planned_presences pp
                          where pp.match_id = m.id and coalesce(pp.statut,'prevu') <> 'annule')
        order by m.match_date, m.kickoff_time nulls last
        limit 1),
      'equipes_sans_coach', (
        select count(*) from club_teams t
        where t.club_id = p_club_id and not coalesce(t.archivee,false)
          and nullif(btrim(coalesce(t.coach,'')),'') is null),
      'sections_mise_en_place', (
        select count(*) from club_preparation(p_club_id) cp where cp.etat <> 'complet')
    ),

    -- ── Cette semaine ─────────────────────────────────────────────────────────
    'semaine', jsonb_build_object(
      'du', v_debut, 'au', v_fin,
      'matchs', (select count(*) from club_matches m
                 where m.club_id = p_club_id and m.match_date between v_debut and v_fin
                   and coalesce(m.sport_status,'scheduled') <> 'cancelled'),
      -- Un creneau hebdomadaire vaut une seance par semaine : le compter une fois suffit tant que
      -- la projection sur la saison (vague B) n'existe pas.
      'entrainements', (select count(*) from club_team_training_slots s
                        join club_teams t on t.id = s.team_id
                        where t.club_id = p_club_id and not coalesce(t.archivee,false)),
      'presences', (select count(*) from planned_presences pp
                    join club_matches m on m.id = pp.match_id
                    where m.club_id = p_club_id and m.match_date between v_debut and v_fin
                      and coalesce(pp.statut,'prevu') <> 'annule'),
      'contenus_a_publier', case when v_client is null then 0 else (
        select count(*) from contenus c
        where c.client_id = v_client
          and coalesce(c.statut,'') not in ('publie','archive','refuse')
          and c.date_prevue::date between v_debut and v_fin) end
    ),

    -- ── Adoption : uniquement si la donnee existe reellement ──────────────────
    'adoption', jsonb_build_object(
      'coachs_total', (select count(*) from club_members cm
                       where cm.club_id = p_club_id and cm.role in ('coach','educateur')),
      'coachs_actifs', (select count(*) from club_members cm
                        where cm.club_id = p_club_id and cm.role in ('coach','educateur')
                          and cm.status = 'actif')
    )
  ) into v_resultat;

  return v_resultat;
end $function$;

comment on function public.cm_tableau_de_bord(uuid) is
  'Tableau de bord d''un club pour son CM : aujourd''hui, a faire, cette semaine, adoption. Perimetre verifie par peut_preparer_club().';

select 'OK — cm_tableau_de_bord cree' as verdict;
