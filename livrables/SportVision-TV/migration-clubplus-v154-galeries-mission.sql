-- v154 : les galeries d'une mission, créées d'un clic (11/09/2026).
--
-- Demande de Fouka : quand une prestation se termine, le photographe dépose le lien de ses photos,
-- la Production les télécharge et les verse dans la galerie ; la galerie doit être rattachée au
-- bon club et à la bonne équipe, sans mélange, pour arriver dans Club+ (le coach de l'équipe) et
-- dans Connect (les familles de l'équipe). Décisions : une galerie par équipe ; pour une prestation
-- ponctuelle sans club, une galerie rattachée à la prestation ; la Production peut ensuite changer
-- le rattachement (fiche galerie, inchangée).
--
-- Audit : media_albums porte déjà club_id, team_id, mission_id, saison_id, pole_id,
-- structure_externe ; aucune des galeries existantes n'était reliée à sa mission, faute d'outil.
-- Les équipes d'une mission se lisent là où la présence a été décidée (planned_presences →
-- club_matches / séances / événements), et en dernier recours dans le champ « équipes » saisi.
-- Test : tests/galeries-mission.test.sql

create or replace function public.equipes_de_mission(p_prestation_id uuid)
returns table (team_id uuid, team_name text, adversaires text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with club as (
    select k.id from prestations p join clubs k on k.portail_client_id = p.client_id where p.id = p_prestation_id limit 1
  ), par_presence as (
    select coalesce(m.team_id, (select t.id from club_teams t where t.club_id = m.club_id and t.name = m.team limit 1)) as team_id,
           m.opponent as adversaire
      from planned_presences pp join club_matches m on m.id = pp.match_id
     where pp.created_prestation_id = p_prestation_id and coalesce(pp.statut, 'prevu') <> 'annule'
    union all
    select s.team_id, null
      from planned_presences pp
      join club_team_training_slots s on pp.occurrence_ref like 'entrainement:' || s.id || ':%'
     where pp.created_prestation_id = p_prestation_id and coalesce(pp.statut, 'prevu') <> 'annule'
    union all
    select e.team_id, null
      from planned_presences pp join club_calendar_events e on e.id = pp.calendar_event_id
     where pp.created_prestation_id = p_prestation_id and coalesce(pp.statut, 'prevu') <> 'annule'
  ), par_nom as (
    -- Mission créée à la main : les équipes saisies (« U10 A, U10 B »), retrouvées dans le club.
    select t.id, null::text
      from prestations p
      cross join lateral unnest(string_to_array(coalesce(p.equipes, ''), ',')) as n(nom)
      join club_teams t on t.club_id = (select id from club) and lower(t.name) = lower(btrim(n.nom))
     where p.id = p_prestation_id and not exists (select 1 from par_presence where team_id is not null)
  ), toutes as (
    select team_id, adversaire from par_presence where team_id is not null
    union all select * from par_nom
  )
  select t.id, t.name, string_agg(distinct nullif(btrim(x.adversaire), ''), ', ')
    from toutes x join club_teams t on t.id = x.team_id
   group by t.id, t.name
   order by t.name;
$$;
revoke execute on function public.equipes_de_mission(uuid) from public, anon;
grant execute on function public.equipes_de_mission(uuid) to authenticated;

create or replace function public.creer_galeries_mission(p_prestation_id uuid)
returns table (album_id uuid, titre text, team_name text, cree boolean)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  p prestations;
  v_client clients;
  v_club uuid;
  v_saison uuid;
  v_pole uuid;
  v_date text;
  v_eq record;
  v_id uuid;
  v_titre text;
begin
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  select role into v_role from profiles where id = auth.uid();
  select * into p from prestations where id = p_prestation_id;
  if p.id is null then
    raise exception 'Mission introuvable.' using errcode = 'P0002';
  end if;
  -- Les mêmes personnes que celles qui créent une galerie à la main (malbums_prod_insert), dans
  -- leur pôle pour la Production.
  if not (v_role = 'admin' or (v_role = 'prod' and coalesce(prestation_pole_scope_ok(p.id), false))) then
    raise exception 'Seules l''Administration et la Production du pôle créent les galeries d''une mission.' using errcode = '42501';
  end if;

  select * into v_client from clients where id = p.client_id;
  select k.id into v_club from clubs k where k.portail_client_id = p.client_id limit 1;
  select s.id into v_saison from saisons s
   where p.date_prestation between s.date_debut and s.date_fin order by s.date_debut limit 1;
  v_pole := coalesce(p.pole_id, v_client.pole_id);
  v_date := to_char(p.date_prestation, 'DD/MM/YYYY');

  if v_club is not null and exists (select 1 from equipes_de_mission(p.id)) then
    -- Une galerie par équipe. Jamais deux pour la même équipe de la même mission.
    for v_eq in select * from equipes_de_mission(p.id) loop
      select a.id into v_id from media_albums a where a.mission_id = p.id and a.team_id = v_eq.team_id limit 1;
      if v_id is not null then
        return query select v_id, (select title from media_albums where id = v_id), v_eq.team_name, false;
      else
        v_titre := v_eq.team_name || coalesce(' — vs ' || v_eq.adversaires, '') || ' — ' || v_date;
        insert into media_albums (title, club_id, team_id, mission_id, event_date, saison_id, pole_id, status, created_by)
        values (v_titre, v_club, v_eq.team_id, p.id, p.date_prestation, v_saison, v_pole, 'draft', auth.uid())
        returning id into v_id;
        return query select v_id, v_titre, v_eq.team_name, true;
      end if;
      v_id := null;
    end loop;
    return;
  end if;

  -- Sans équipe identifiable (prestation ponctuelle, client sans club, mission sans équipe) : une
  -- galerie de la prestation. La Production la rattache à une équipe ensuite si besoin.
  select a.id into v_id from media_albums a where a.mission_id = p.id limit 1;
  if v_id is not null then
    return query select v_id, (select title from media_albums where id = v_id), null::text, false;
    return;
  end if;
  v_titre := coalesce(v_client.nom, 'Prestation') || ' — ' || coalesce(nullif(p.type_prestation, ''), 'prestation') || ' — ' || v_date;
  insert into media_albums (title, club_id, mission_id, event_date, saison_id, pole_id, structure_externe, status, created_by)
  values (v_titre, v_club, p.id, p.date_prestation, v_saison, v_pole,
          case when v_club is null then v_client.nom end, 'draft', auth.uid())
  returning id into v_id;
  return query select v_id, v_titre, null::text, true;
end $$;
revoke execute on function public.creer_galeries_mission(uuid) from public, anon;
grant execute on function public.creer_galeries_mission(uuid) to authenticated;
