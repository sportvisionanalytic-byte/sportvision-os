-- ═══════════════════════════════════════════════════════════════════════════════
-- Le compteur de dette doit dire la verite
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- cm_surfaces_heritees() ne reconnaissait qu'une convention de nommage, `cm_perim_%`. Les policies
-- de fermeture posees le 09/09 s'appellent `cm_hors_perimetre_%` : le compteur affichait donc
-- encore 86 surfaces ouvertes alors qu'une bonne partie venait d'etre fermee.
--
-- Un indicateur de dette faux est pire que pas d'indicateur : on croit avoir travaille pour rien,
-- ou on croit avoir fini alors que non. Il reconnait desormais TOUTE policy restrictive qui borne
-- un CM cloisonne, quel que soit son nom.

create or replace function public.cm_surfaces_heritees()
returns table(surface text, operation text, deja_cloisonnee boolean)
language sql
stable
set search_path to 'public'
as $function$
  select p.tablename::text,
         p.cmd::text,
         exists (
           select 1 from pg_policies r
           where r.tablename = p.tablename
             and r.permissive = 'RESTRICTIVE'
             -- La marque d'une policy qui borne le CM : elle interroge est_cm_cloisonne().
             and coalesce(r.qual,'')||coalesce(r.with_check,'') ilike '%est_cm_cloisonne()%'
         )
  from pg_policies p
  where coalesce(p.qual,'')||coalesce(p.with_check,'') ilike '%is_staff()%'
  order by 3, 1, 2;
$function$;

select count(*) filter (where not deja_cloisonnee) as encore_ouvertes,
       count(*) filter (where deja_cloisonnee) as fermees,
       count(*) as total
from cm_surfaces_heritees();
