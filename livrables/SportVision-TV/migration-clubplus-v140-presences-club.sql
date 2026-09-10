-- La page Présences de Club+ lit les vraies présences (11/09/2026).
--
-- Première mission réelle : le CM de Villemomble ouvre Présences et lit « Aucune présence
-- programmée » alors que la carte du menu affiche « 8 prévues ». La page lisait `club_presences`
-- (migration-connect-v17), une table que plus rien n'alimente depuis que la décision du CM crée
-- des `planned_presences` (v126) — elle est vide. La carte, elle, lisait la bonne source par
-- cm_tableau_de_bord, réservé au CM.
--
-- club_presences_sportvision(club) : les présences décidées pour le club, lisibles par qui lit son
-- calendrier (CM, dirigeants, membres) — leur événement, leur date, leur type, l'opérateur confirmé
-- (prénom et initiale), et un statut dans le vocabulaire de la page :
--   cancelled  présence retirée, ou mission annulée / refusée ;
--   completed  mission produite (production terminée et au-delà) ;
--   scheduled  sinon.

begin;

create or replace function public.club_presences_sportvision(p_club_id uuid)
returns table (id uuid, event_label text, event_date date, heure time, kind text, type_couverture text,
               operator_name text, status text, mission_reference text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not peut_lire_calendrier_club(p_club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select pp.id,
         case when pp.occurrence_ref is not null then 'Entraînement ' || coalesce(pp.equipe, '')
              else coalesce(nullif(concat_ws(' contre ', nullif(pp.equipe, ''), nullif(pp.adversaire, '')), ''), 'Événement') end,
         pp.date_presence,
         pp.heure_debut,
         case when pp.match_id is not null then 'match' when pp.occurrence_ref is not null then 'training' else 'event' end,
         pp.type_couverture,
         (select string_agg(pr.prenom || coalesce(' ' || left(pr.nom, 1) || '.', ''), ', ' order by pr.prenom)
            from prestations_equipe e join profiles pr on pr.id = e.collaborateur_id
           where e.prestation_id = pp.created_prestation_id and e.statut = 'acceptée'),
         case when pp.statut = 'annule' or m.statut::text in ('annulée', 'refusée') then 'cancelled'
              when m.statut::text in ('production_terminée', 'médias_à_transférer', 'médias_complets', 'à_monter', 'montage_en_cours',
                                      'prêt_validation', 'à_valider_client', 'prête_à_livrer', 'livrée', 'clôturée') then 'completed'
              else 'scheduled' end,
         m.reference
    from planned_presences pp
    join monthly_production_plans mp on mp.id = pp.plan_id
    join clubs c on c.portail_client_id = mp.client_id and c.id = p_club_id
    left join prestations m on m.id = pp.created_prestation_id
   order by pp.date_presence, pp.heure_debut nulls last, pp.equipe;
end;
$$;
revoke execute on function public.club_presences_sportvision(uuid) from public, anon;
grant execute on function public.club_presences_sportvision(uuid) to authenticated;

commit;
