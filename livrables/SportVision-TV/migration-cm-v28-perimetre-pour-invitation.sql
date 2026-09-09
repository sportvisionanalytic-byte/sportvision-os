-- Le perimetre d'un CM, interrogeable pour un utilisateur donne.
--
-- cm_clubs_autorises() lit auth.uid() : parfait dans une policy, inutilisable depuis une edge
-- function qui agit avec la cle de service pour le compte d'un appelant identifie. Cette variante
-- prend le CM en parametre. Elle ne fait que RELIRE la meme autorite, elle n'en cree pas une
-- seconde.
create or replace function public.cm_clubs_autorises_de(p_cm uuid)
returns table(club_id uuid)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select a.club_id from club_cm_affectations a
  where a.cm_id = p_cm and a.actif
    and a.date_debut <= current_date
    and (a.date_fin is null or a.date_fin >= current_date)
  union
  select c.id from clubs c
  join clients cl on cl.id = c.portail_client_id
  where cl.cm_id = p_cm;
$function$;

grant execute on function public.cm_clubs_autorises_de(uuid) to service_role;

select 'OK' as verdict;
