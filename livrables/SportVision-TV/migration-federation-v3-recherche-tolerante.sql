-- La recherche classe par nombre de mots retrouves, au lieu de tout exiger.
--
-- La v2 exigeait que TOUS les mots d'au moins trois lettres soient presents. Ca reglait
-- « SF Villemomble », mais ca cassait sur « villemomble sports football » : le slug est
-- « villemomble-sports », le mot « football » n'y figure pas, et la recherche ne rendait rien.
--
-- Or c'est exactement ainsi qu'on tape le nom d'un club de foot. Exiger la totalite des mots punit
-- l'utilisateur d'en avoir dit trop, ce qui est l'inverse du comportement attendu : plus on est
-- precis, plus on devrait etre servi.
--
-- Regle retenue : au moins un mot doit correspondre, et le classement met devant les clubs qui en
-- retrouvent le plus. « villemomble sports football » remonte donc « villemomble sports » (deux
-- mots sur trois) avant « villemomble handball » (un seul).

create or replace function public.federation_clubs_rechercher(p_q text, p_limite int default 15)
returns table (
  source text, slug text, nom text, ville text, departement text,
  sport text, affiliation_number text, logo_url text, enrichi boolean,
  mots_trouves int, mots_demandes int, score int
)
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $function$
  with saisie as (
    -- Meme normalisation que la colonne `recherche` : minuscules, sans accent, ponctuation
    -- ramenee a des espaces. Les deux doivent rester identiques, sinon « Séniors » ne trouverait
    -- jamais « seniors ».
    select trim(regexp_replace(lower(unaccent(coalesce(p_q, ''))), '[^a-z0-9]+', ' ', 'g')) as q
  ),
  mots as (
    -- Les mots de une ou deux lettres (SF, AS, US, FC, ES) sont des prefixes de club presents
    -- partout : ils n'aident pas a choisir et feraient remonter n'importe quoi.
    select (select q from saisie) as q,
           array_remove(array_agg(m) filter (where length(m) >= 3), null) as utiles
      from saisie, unnest(string_to_array((select q from saisie), ' ')) as m
  ),
  trouves as (
    select f.*,
           (select count(*) from unnest(m.utiles) as u where f.recherche like '%' || u || '%')::int as n,
           cardinality(m.utiles) as total,
           m.q
      from public.federation_clubs f, mots m
     where cardinality(m.utiles) > 0
       and exists (select 1 from unnest(m.utiles) as u where f.recherche like '%' || u || '%')
  )
  select t.source, t.slug, t.nom, t.ville, t.departement,
         t.sport, t.affiliation_number, t.logo_url,
         t.enrichi_at is not null as enrichi,
         t.n as mots_trouves, t.total as mots_demandes,
         case when t.recherche = t.q then 0
              when t.recherche like t.q || '%' then 1
              else 2 end as score
    from trouves t
   -- D'abord le plus de mots retrouves, puis la correspondance exacte ou par prefixe, puis le nom
   -- le plus court : « villemomble sports » avant « villemomble sports section vb ».
   order by t.n desc,
            case when t.recherche = t.q then 0 when t.recherche like t.q || '%' then 1 else 2 end,
            length(t.recherche), t.recherche
   limit greatest(1, least(coalesce(p_limite, 15), 50));
$function$;

comment on function public.federation_clubs_rechercher(text, int) is
  'Recherche un club dans l''annuaire par son nom. Les mots de moins de trois lettres (SF, AS, US, FC) sont ignorés : ils sont partout et n''aident pas à choisir. Au moins un mot doit correspondre, et le classement fait remonter les clubs qui en retrouvent le plus, puis la correspondance exacte ou par préfixe, puis le nom le plus court. « SF Villemomble », « Villemomble SF » et « villemomble sports football » mènent tous à villemomble-sports.';
