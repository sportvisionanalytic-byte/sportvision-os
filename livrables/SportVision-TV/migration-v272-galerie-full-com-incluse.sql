-- v272 — Une galerie de club en Full Communication nait incluse, pas en vente (25/09/2026)
--
-- « J'ai voulu creer une galerie rattachee a un club, mais ca m'a mis "ce que vous vendez". Alors
-- que la c'est le pass photo pour un club, ou alors ca va directement dans les conditions du
-- club. » (Fouka)
--
-- L'ECRAN SAVAIT DEJA (v265) : creer une galerie a la main depuis l'OS pour un club en Full
-- Communication la pose en « incluse au contrat ». Mais la plupart des galeries ne sont PAS
-- creees a la main : `creer_galeries_mission` en fabrique une par equipe des qu'une mission est
-- couverte, et elle, ne connaissait pas cette regle. Quatre galeries de SF Villemomble creees
-- ce soir a 19h27 sont parties en vente alors que le club paie deja.
--
-- La regle vit maintenant aux DEUX endroits ou une galerie nait, et elle appelle la meme
-- fonction — `club_est_full_communication` — plutot que d'en recopier la logique.
--
-- SANS CLUB, RIEN NE CHANGE : une galerie de tournoi ou de club adverse reste en vente, c'est
-- precisement ce qu'on vend.
--
-- Idempotente.

CREATE OR REPLACE FUNCTION public.creer_galeries_mission(p_prestation_id uuid)
 RETURNS TABLE(album_id uuid, titre text, team_name text, cree boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
        insert into media_albums (title, club_id, team_id, mission_id, event_date, saison_id, pole_id, status, created_by, access_mode)
        values (v_titre, v_club, v_eq.team_id, p.id, p.date_prestation, v_saison, v_pole, 'draft', auth.uid(),
                case when club_est_full_communication(v_club) then 'free_members' else 'inherit' end)
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
  insert into media_albums (title, club_id, mission_id, event_date, saison_id, pole_id, structure_externe, status, created_by, access_mode)
  values (v_titre, v_club, p.id, p.date_prestation, v_saison, v_pole,
          case when v_club is null then v_client.nom end, 'draft', auth.uid(),
          case when club_est_full_communication(v_club) then 'free_members' else 'inherit' end)
  returning id into v_id;
  return query select v_id, v_titre, null::text, true;
end $function$;
