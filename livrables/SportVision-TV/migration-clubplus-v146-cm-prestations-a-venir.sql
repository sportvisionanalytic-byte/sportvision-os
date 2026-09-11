-- v146 : le CM voit les prochaines venues de SportVision dans ses clubs (11/09/2026).
--
-- Trouvé en balayant l'OS : l'accueil CM a une carte « Prestations à venir (14 j) » et un bloc
-- « Prochaines prestations », mais aucune policy de `prestations` ne concerne le rôle cm. Les
-- deux restaient à 0 pour tous les CM, y compris celui de Villemomble, la veille de deux missions.
--
-- On n'ouvre PAS la table aux CM : elle porte prix, statut financier, notes internes. Cette
-- fonction rend ce dont un CM a besoin pour préparer sa communication (quand, où, quoi, pour quel
-- club) et rien d'autre. Périmètre : les clubs du CM (cm_clubs_autorises, la même règle que
-- partout ailleurs), plus les clients dont il est le référent. Réservée au rôle cm.
-- Test : tests/cm-prestations-a-venir.test.sql

create or replace function public.cm_prestations_a_venir(p_jours integer default 14)
returns table (
  prestation_id uuid, reference text, type_prestation text, date_prestation date,
  heure_debut time, lieu text, statut text, club_nom text
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.id, p.reference, p.type_prestation, p.date_prestation, p.heure_debut, p.lieu, p.statut::text,
         coalesce((select c.nom from clubs c where c.portail_client_id = p.client_id limit 1), cl.nom)
    from prestations p
    join clients cl on cl.id = p.client_id
   where exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'cm')
     and p.date_prestation between current_date and current_date + least(greatest(coalesce(p_jours, 14), 0), 60)
     and p.statut not in ('annulée', 'refusée')
     and (cl.cm_id = auth.uid()
          or p.client_id in (select c.portail_client_id from clubs c where c.id in (select cm_clubs_autorises())))
   order by p.date_prestation, p.heure_debut nulls last;
$$;

revoke execute on function public.cm_prestations_a_venir(integer) from public, anon;
grant execute on function public.cm_prestations_a_venir(integer) to authenticated;
