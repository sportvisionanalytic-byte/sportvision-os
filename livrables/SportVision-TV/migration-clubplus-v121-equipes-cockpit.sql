-- Équipes : ce qui manque à chacune, sa fiche en un coup d'œil, et le vrai statut de ses
-- invitations.
--
-- Demande de Fouka, 10/09/2026 (priorité 2) : « Il faut pouvoir identifier immédiatement les
-- équipes qui nécessitent une action », « SportVision doit savoir immédiatement quelles équipes
-- sont réellement connectées », et un droit à l'image suivi joueur par joueur plutôt qu'un
-- « Aucun joueur dans cette équipe ».
--
-- ── Ce que pose ce fichier ──
--   1. `club_invitations.ouverte_at` et `marquer_invitation_ouverte(token)` : distinguer une
--      invitation envoyée d'une invitation que la personne a réellement ouverte. La page
--      /rejoindre l'appelle au chargement. Le jeton est le secret de l'invitation : le connaître
--      ne permet que de dire « je l'ai ouverte », rien d'autre.
--   2. `club_equipes_etat()` rend aussi le sexe de l'équipe (`club_teams.section`), pour filtrer.
--   3. `equipe_apercu(team_id)` : la fiche d'une équipe en un aller-retour — effectif, encadrement
--      et statut de chaque invitation, prochain événement, droit à l'image joueur par joueur,
--      contenus prévus, prochaine présence SportVision, inscriptions par le lien, alertes.
--      Ouverte à qui opère le club ET à l'éducateur de l'équipe (sa propre fiche).

begin;

-- ── 1. L'ouverture d'une invitation ──────────────────────────────────────────────────────────

alter table public.club_invitations add column if not exists ouverte_at timestamptz;

comment on column public.club_invitations.ouverte_at is
  'Première ouverture du lien par la personne invitée (page /rejoindre). Distingue « envoyée » de « ouverte » dans le suivi des encadrants.';

create or replace function public.marquer_invitation_ouverte(p_token text)
returns void
language sql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $$
  update club_invitations
     set ouverte_at = now()
   where token = p_token
     and ouverte_at is null
     and statut in ('preparee', 'envoyee')
     and expire_at > now();
$$;

-- Appelée depuis une page publique : la personne n'a pas encore de compte.
revoke execute on function public.marquer_invitation_ouverte(text) from public;
grant execute on function public.marquer_invitation_ouverte(text) to anon, authenticated;

-- ── 2. Le sexe de l'équipe dans son état ─────────────────────────────────────────────────────
-- Le type de retour change : il faut supprimer puis recréer. Les appelants (cm_tableau_de_bord,
-- club_sante, club_onboarding_sections) sont en PL/pgSQL, résolus à l'exécution.

drop function if exists public.club_equipes_etat(uuid);

create function public.club_equipes_etat(p_club_id uuid)
returns table (
  team_id uuid, nom text, categorie text, section text,
  joueurs integer,
  encadrant text, encadrant_statut text,
  creneaux integer,
  matchs_a_venir integer, prochain_match_date date, prochain_match_adversaire text,
  evenements integer,
  image_valides integer, image_en_attente integer, image_refus integer)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_saison text;
begin
  if not peut_operer_club(p_club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  select saison into v_saison from clubs where id = p_club_id;

  return query
  with eq as (
    select t.id, t.name, t.categorie, t.section, t.coach from club_teams t
     where t.club_id = p_club_id and not coalesce(t.archivee, false)
  ),
  effectif as (
    select tm.team_id, tm.player_id from team_memberships tm
     where tm.club_id = p_club_id and tm.statut = 'active'
       and (v_saison is null or tm.saison = v_saison)
  ),
  image as (
    select distinct on (pa.player_id) pa.player_id, pa.statut
      from parental_authorizations pa
      join authorization_types aty on aty.id = pa.authorization_type_id and aty.code = 'droit_image'
     where pa.player_id in (select player_id from effectif)
     order by pa.player_id, pa.updated_at desc
  ),
  encadrement as (
    select e.id as team_id,
           coalesce(
             (select jsonb_build_object('nom', nullif(btrim(concat_ws(' ', m.prenom, m.nom)), ''), 'statut', 'actif')
                from club_members m
               where m.club_id = p_club_id and m.status = 'actif'
                 and m.role in ('coach', 'resp_equipe', 'directeur_sportif') and m.teams ? e.name
               order by (m.role = 'coach') desc limit 1),
             (select jsonb_build_object('nom', nullif(btrim(concat_ws(' ', ci.prenom, ci.nom)), ''),
                                        'statut', case ci.statut when 'envoyee' then 'invite' else 'prepare' end)
                from club_invitations ci
               where ci.club_id = p_club_id and ci.statut in ('preparee', 'envoyee')
                 and ci.expire_at > now() and ci.role in ('coach', 'resp_equipe', 'directeur_sportif') and ci.teams ? e.name
               order by (ci.statut = 'envoyee') desc limit 1),
             case when nullif(btrim(coalesce(e.coach, '')), '') is not null
                  then jsonb_build_object('nom', btrim(e.coach), 'statut', 'renseigne') end
           ) as j
      from eq e
  )
  select e.id, e.name, e.categorie, e.section,
         (select count(*)::int from effectif f where f.team_id = e.id),
         enc.j->>'nom', coalesce(enc.j->>'statut', 'aucun'),
         (select count(*)::int from club_team_training_slots s
           where s.team_id = e.id and (s.active_to is null or s.active_to >= current_date)),
         (select count(*)::int from club_matches m
           where m.club_id = p_club_id and (m.team_id = e.id or (m.team_id is null and m.team = e.name))
             and m.match_date >= current_date and coalesce(m.sport_status, 'scheduled') <> 'cancelled'),
         (select min(m.match_date) from club_matches m
           where m.club_id = p_club_id and (m.team_id = e.id or (m.team_id is null and m.team = e.name))
             and m.match_date >= current_date and coalesce(m.sport_status, 'scheduled') <> 'cancelled'),
         (select m.opponent from club_matches m
           where m.club_id = p_club_id and (m.team_id = e.id or (m.team_id is null and m.team = e.name))
             and m.match_date >= current_date and coalesce(m.sport_status, 'scheduled') <> 'cancelled'
           order by m.match_date, m.kickoff_time nulls last limit 1),
         (select count(*)::int from club_matches m
           where m.club_id = p_club_id and (m.team_id = e.id or (m.team_id is null and m.team = e.name)))
         + (select count(*)::int from club_calendar_events ce
             where ce.club_id = p_club_id and (ce.team_id = e.id or (ce.team_id is null and ce.team = e.name))),
         (select count(*)::int from effectif f join image i on i.player_id = f.player_id
           where f.team_id = e.id and i.statut = 'valide'),
         (select count(*)::int from effectif f left join image i on i.player_id = f.player_id
           where f.team_id = e.id and (i.statut is null or i.statut in ('non_transmise','en_attente','transmise','a_verifier','incomplete','expiree'))),
         (select count(*)::int from effectif f join image i on i.player_id = f.player_id
           where f.team_id = e.id and i.statut in ('refusee','retiree'))
    from eq e
    left join encadrement enc on enc.team_id = e.id
   order by e.categorie nulls last, e.name;
end;
$$;

revoke execute on function public.club_equipes_etat(uuid) from public, anon;
grant execute on function public.club_equipes_etat(uuid) to authenticated;

-- ── 3. La fiche d'une équipe ─────────────────────────────────────────────────────────────────

create or replace function public.equipe_apercu(p_team_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_team club_teams;
  v_saison text;
  v_client uuid;
  v_joueurs jsonb;
  v_encadrement jsonb;
  v_prochain jsonb;
  v_entrainement jsonb;
  v_presence jsonb;
  v_inscriptions jsonb;
  v_contenus int;
  v_souhaits int;
  v_creneaux int;
  v_matchs int;
  v_alertes jsonb := '[]'::jsonb;
  n_total int; n_valides int; n_attente int; n_refus int;
  n_demandes int; n_inscrits int; n_invit_joueurs int;
begin
  select * into v_team from club_teams where id = p_team_id;
  if v_team.id is null then
    raise exception 'Équipe introuvable.';
  end if;
  if not (peut_operer_club(v_team.club_id) or is_team_educateur(p_team_id)) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  select saison, portail_client_id into v_saison, v_client from clubs where id = v_team.club_id;

  -- L'effectif, avec le droit à l'image de chacun (la dernière autorisation fait foi).
  with effectif as (
    select pp.id, pp.prenom, pp.nom
      from team_memberships tm
      join player_profiles pp on pp.id = tm.player_id
     where tm.team_id = p_team_id and tm.statut = 'active'
       and (v_saison is null or tm.saison = v_saison)
  ),
  image as (
    select distinct on (pa.player_id) pa.player_id, pa.statut
      from parental_authorizations pa
      join authorization_types aty on aty.id = pa.authorization_type_id and aty.code = 'droit_image'
     where pa.player_id in (select id from effectif)
     order by pa.player_id, pa.updated_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'prenom', e.prenom, 'nom', e.nom,
           'image', case when i.statut = 'valide' then 'valide'
                         when i.statut in ('refusee', 'retiree') then 'refus'
                         when i.statut is null then 'aucune'
                         else 'en_attente' end)
           order by e.nom, e.prenom), '[]'::jsonb)
    into v_joueurs
    from effectif e left join image i on i.player_id = e.id;

  select count(*),
         count(*) filter (where j->>'image' = 'valide'),
         count(*) filter (where j->>'image' in ('en_attente', 'aucune')),
         count(*) filter (where j->>'image' = 'refus')
    into n_total, n_valides, n_attente, n_refus
    from jsonb_array_elements(v_joueurs) j;

  -- L'encadrement : les comptes, puis les invitations en cours, chacune avec son vrai statut.
  select coalesce(jsonb_agg(x order by x->>'ordre', x->>'nom'), '[]'::jsonb) into v_encadrement
    from (
      select jsonb_build_object(
               'ordre', '1', 'source', 'membre', 'id', m.id,
               'nom', coalesce(nullif(btrim(concat_ws(' ', m.prenom, m.nom)), ''), 'Encadrant'),
               'role', m.role,
               'statut', case when m.status = 'actif' then 'actif' else 'suspendu' end) as x
        from club_members m
       where m.club_id = v_team.club_id and m.teams ? v_team.name
         and m.role in ('coach', 'resp_equipe', 'directeur_sportif')
      union all
      select jsonb_build_object(
               'ordre', '2', 'source', 'invitation', 'id', ci.id,
               'nom', coalesce(nullif(btrim(concat_ws(' ', ci.prenom, ci.nom)), ''), ci.email),
               'email', ci.email, 'role', ci.role,
               'statut', case when ci.expire_at <= now() then 'expiree'
                              when ci.statut = 'envoyee' and ci.ouverte_at is not null then 'ouverte'
                              else ci.statut end,
               'envoyee_at', ci.sent_at, 'ouverte_at', ci.ouverte_at)
        from club_invitations ci
       where ci.club_id = v_team.club_id and ci.teams ? v_team.name
         and ci.role in ('coach', 'resp_equipe', 'directeur_sportif')
         and ci.statut in ('preparee', 'envoyee')
    ) s(x);

  -- Le prochain événement qui n'est pas un entraînement, et le prochain entraînement.
  select to_jsonb(c) into v_prochain
    from club_calendrier(v_team.club_id, current_date, current_date + 60) c
   where (c.team_id = p_team_id or (c.team_id is null and c.equipe = v_team.name))
     and c.genre <> 'entrainement' and coalesce(c.statut, '') not in ('cancelled', 'annulee')
     and (c.date_evenement > current_date or c.heure_debut is null or c.heure_debut >= localtime)
   order by c.date_evenement, c.heure_debut nulls last
   limit 1;

  select jsonb_build_object('date', c.date_evenement, 'debut', to_char(c.heure_debut, 'HH24:MI'),
                            'fin', to_char(c.heure_fin, 'HH24:MI'), 'lieu', c.lieu) into v_entrainement
    from club_calendrier(v_team.club_id, current_date, current_date + 14) c
   where (c.team_id = p_team_id or (c.team_id is null and c.equipe = v_team.name))
     and c.genre = 'entrainement' and coalesce(c.statut, '') <> 'annulee'
   order by c.date_evenement, c.heure_debut
   limit 1;

  -- SportVision : la prochaine présence planifiée, et les souhaits de couverture en attente.
  select jsonb_build_object('date', pr.date_presence, 'heure', to_char(pr.heure_debut, 'HH24:MI'),
                            'type', pr.type_couverture, 'adversaire', pr.adversaire, 'lieu', pr.lieu)
    into v_presence
    from planned_presences pr
   where coalesce(pr.statut, 'prevu') <> 'annule' and pr.date_presence >= current_date
     and (exists (select 1 from club_matches m where m.id = pr.match_id
                   and (m.team_id = p_team_id or (m.team_id is null and m.team = v_team.name)))
          or exists (select 1 from club_calendar_events e where e.id = pr.calendar_event_id
                      and (e.team_id = p_team_id or (e.team_id is null and e.team = v_team.name))))
   order by pr.date_presence, pr.heure_debut nulls last
   limit 1;

  select count(*) into v_souhaits
    from coverage_wishes w
   where w.club_id = v_team.club_id and w.status in ('wished', 'reviewing')
     and (exists (select 1 from club_matches m where m.id = w.match_id
                   and (m.team_id = p_team_id or (m.team_id is null and m.team = v_team.name)))
          or exists (select 1 from club_calendar_events e where e.id = w.calendar_event_id
                      and (e.team_id = p_team_id or (e.team_id is null and e.team = v_team.name))));

  -- Communication : les contenus prévus rattachés à un match ou un événement de l'équipe.
  select count(*) into v_contenus
    from contenus ct
   where v_client is not null and ct.client_id = v_client
     and coalesce(ct.statut, '') not in ('publie', 'archive', 'refuse')
     and (exists (select 1 from club_matches m where m.id = ct.match_id
                   and (m.team_id = p_team_id or (m.team_id is null and m.team = v_team.name)))
          or exists (select 1 from club_calendar_events e where e.id = ct.calendar_event_id
                      and (e.team_id = p_team_id or (e.team_id is null and e.team = v_team.name))));

  -- Les inscriptions par le lien et les invitations nominatives de joueurs.
  select count(*) filter (where mr.statut in ('a_verifier', 'autorisation_manquante', 'en_attente_parent', 'pret_a_valider')),
         count(*) filter (where mr.statut = 'validee'),
         coalesce(jsonb_agg(jsonb_build_object(
           'nom', nullif(btrim(concat_ws(' ', pp.prenom, pp.nom)), ''),
           'statut', mr.statut, 'source', mr.source, 'le', mr.created_at)
           order by mr.created_at desc) filter (where mr.created_at > now() - interval '60 days'), '[]'::jsonb)
    into n_demandes, n_inscrits, v_inscriptions
    from membership_requests mr
    left join player_profiles pp on pp.id = mr.player_id
   where mr.team_id = p_team_id;

  select count(*) into n_invit_joueurs from player_invitations pi
   where pi.team_id = p_team_id and pi.statut = 'envoyee';

  select count(*) into v_creneaux from club_team_training_slots s
   where s.team_id = p_team_id and (s.active_to is null or s.active_to >= current_date);
  select count(*) into v_matchs from club_matches m
   where m.club_id = v_team.club_id and (m.team_id = p_team_id or (m.team_id is null and m.team = v_team.name));

  -- Les alertes, chacune avec l'endroit où elle se résout.
  if not exists (select 1 from jsonb_array_elements(v_encadrement) x where x->>'statut' in ('actif', 'preparee', 'envoyee', 'ouverte')) then
    v_alertes := v_alertes || jsonb_build_object('niveau', 'a_faire', 'code', 'sans_coach',
      'texte', 'Aucun encadrant rattaché ni invité', 'action', 'inviter_encadrant');
  end if;
  if n_total = 0 and v_matchs > 0 then
    v_alertes := v_alertes || jsonb_build_object('niveau', 'information', 'code', 'effectif',
      'texte', 'Effectif non renseigné, alors que l''équipe a ' || v_matchs || ' match' || case when v_matchs > 1 then 's' else '' end || ' au calendrier',
      'action', 'inviter_joueurs');
  end if;
  if n_total > 0 and n_valides < n_total then
    v_alertes := v_alertes || jsonb_build_object('niveau', 'a_faire', 'code', 'droit_image',
      'texte', (n_total - n_valides) || ' joueur' || case when n_total - n_valides > 1 then 's' else '' end || ' sans droit à l''image validé',
      'action', 'droit_image');
  end if;
  if v_creneaux = 0 then
    v_alertes := v_alertes || jsonb_build_object('niveau', 'a_faire', 'code', 'creneau',
      'texte', 'Aucun créneau d''entraînement', 'action', 'creneaux');
  end if;
  if n_demandes > 0 then
    v_alertes := v_alertes || jsonb_build_object('niveau', 'a_faire', 'code', 'demandes',
      'texte', n_demandes || ' demande' || case when n_demandes > 1 then 's' else '' end || ' d''inscription à valider',
      'action', 'demandes');
  end if;

  return jsonb_build_object(
    'equipe', jsonb_build_object('id', v_team.id, 'nom', v_team.name, 'categorie', v_team.categorie,
                                 'section', v_team.section, 'saison', v_saison, 'joueurs', n_total,
                                 'encadrants', (select count(*) from jsonb_array_elements(v_encadrement) x where x->>'statut' = 'actif'),
                                 'creneaux', v_creneaux),
    'prochain_evenement', v_prochain,
    'prochain_entrainement', v_entrainement,
    'droit_image', jsonb_build_object('total', n_total, 'valides', n_valides, 'en_attente', n_attente, 'refus', n_refus,
                                      'joueurs', v_joueurs),
    'communication', jsonb_build_object('contenus_prevus', v_contenus),
    'sportvision', jsonb_build_object('prochaine_presence', v_presence, 'souhaits', v_souhaits),
    'encadrement', v_encadrement,
    'inscriptions', jsonb_build_object('inscrits', n_inscrits, 'en_attente', n_demandes,
                                       'invitations_joueurs', n_invit_joueurs, 'recentes', v_inscriptions),
    'alertes', v_alertes
  );
end;
$$;

revoke execute on function public.equipe_apercu(uuid) from public, anon;
grant execute on function public.equipe_apercu(uuid) to authenticated;

commit;
