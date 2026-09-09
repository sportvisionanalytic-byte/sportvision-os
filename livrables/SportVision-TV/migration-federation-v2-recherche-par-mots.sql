-- La recherche de club doit chercher des MOTS, pas une sous-chaine.
--
-- Constate immediatement apres la v1 (09/09/2026) : « Villemomble » trouvait bien
-- « villemomble-sports », mais « SF Villemomble » — le nom exact du club dans le CRM SportVision —
-- ne trouvait RIEN. La v1 faisait un like '%sf villemomble%', et aucun club ne s'appelle ainsi.
--
-- C'est le cas d'usage central, pas un cas limite : on cherche toujours depuis le nom qu'on a
-- sous la main (fiche client, e-mail, bouche a oreille), jamais depuis le libelle officiel de la
-- federation. « SF Villemomble », « Villemomble SF », « Villemomble Sports Football » doivent
-- tous mener au meme club.
--
-- Regle retenue : on decoupe la saisie en mots, on ignore ceux de moins de trois lettres (« sf »,
-- « as », « us », « fc » sont des prefixes de club presents partout, ils n'aident pas a choisir),
-- et on exige que TOUS les mots restants soient presents, dans n'importe quel ordre. Si la saisie
-- ne contient aucun mot d'au moins trois lettres, on ne renvoie rien plutot que tout.

create or replace function public.federation_clubs_rechercher(p_q text, p_limite int default 15)
returns table (
  source text, slug text, nom text, ville text, departement text,
  sport text, affiliation_number text, logo_url text, enrichi boolean, score int
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
    select array_remove(array_agg(m) filter (where length(m) >= 3), null) as utiles,
           (select q from saisie) as q
      from saisie, unnest(string_to_array((select q from saisie), ' ')) as m
  )
  select f.source, f.slug, f.nom, f.ville, f.departement,
         f.sport, f.affiliation_number, f.logo_url,
         f.enrichi_at is not null as enrichi,
         -- Le nom exact d'abord, puis celui qui commence par la saisie, puis les autres. A score
         -- egal, le nom le plus court gagne : « villemomble sports » avant
         -- « villemomble sports section vb ».
         case when f.recherche = m.q then 0
              when f.recherche like m.q || '%' then 1
              else 2 end as score
    from public.federation_clubs f, mots m
   where cardinality(m.utiles) > 0
     and f.recherche like all (select '%' || u || '%' from unnest(m.utiles) as u)
   order by score, length(f.recherche), f.recherche
   limit greatest(1, least(coalesce(p_limite, 15), 50));
$function$;

comment on function public.federation_clubs_rechercher(text, int) is
  'Recherche un club dans l''annuaire par son nom. Tous les mots d''au moins trois lettres doivent être présents, dans n''importe quel ordre : « SF Villemomble » comme « Villemomble Sports » mènent à villemomble-sports. Les mots de une ou deux lettres (SF, AS, US, FC) sont ignorés — ils sont partout et n''aident pas à choisir. Classement : correspondance exacte, puis préfixe, puis nom le plus court.';
