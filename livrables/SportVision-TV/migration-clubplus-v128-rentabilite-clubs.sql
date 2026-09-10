-- La rentabilité du mois, club par club, là où la Production travaille.
--
-- v127 a posé `rentabilite_club_mois(club, mois)`, affichée dans la fiche client de l'OS. Mais la
-- Production n'ouvre pas les fiches clients — ce n'est pas son menu. Or c'est elle qui doit
-- apprendre à arbitrer (« sur ce club, deux opérateurs à 80 € détruisent la marge », Fouka,
-- 10/09/2026). Cette lecture rend tous les clubs d'un mois en un appel, pour son tableau de bord.

begin;

create or replace function public.rentabilite_clubs_mois(p_mois date)
returns table (club_id uuid, club_nom text, detail jsonb)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not exists (select 1 from profiles where id = auth.uid()
                  and role in ('admin', 'prod', 'compta', 'sec', 'expert_comptable', 'auditeur')) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select c.id, c.nom, rentabilite_club_mois(c.id, p_mois)
    from clubs c
   where c.portail_client_id is not null
   order by c.nom;
end;
$$;

revoke execute on function public.rentabilite_clubs_mois(date) from public, anon;
grant execute on function public.rentabilite_clubs_mois(date) to authenticated;

commit;
