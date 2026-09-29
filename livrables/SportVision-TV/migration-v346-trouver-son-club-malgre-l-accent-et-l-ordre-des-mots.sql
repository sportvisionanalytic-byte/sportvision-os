-- v346 — TROUVER SON CLUB MALGRÉ L'ACCENT, LA PONCTUATION ET L'ORDRE DES MOTS (29/09/2026)
--
-- CE QUI CLOCHAIT. La recherche de club à l'inscription faisait `nom ILIKE '%saisie%'`. Trois
-- conséquences, toutes vécues par une famille qui cherche SON club :
--   - « Villemomble » ne trouve pas « VILLEMOMBLE SPORTS » si elle tape « sports villemomble » ;
--   - un accent tapé, ou pas tapé, et plus rien ne sort ;
--   - la ville n'est jamais regardée, alors que c'est souvent ce dont on se souvient.
--
-- Or il n'y a qu'une douzaine de clubs partenaires. Une famille qui ne trouve pas le sien en
-- conclut qu'il n'est pas partenaire, clique sur « mon club n'est pas dans la liste », et devient
-- une simple notification au staff au lieu d'être rattachée à son équipe. C'est le pire résultat
-- possible : le club EST partenaire, et personne ne s'en aperçoit.
--
-- CE QU'ON FAIT. La même normalisation que l'annuaire fédéral, qui a déjà été éprouvée sur 34 586
-- clubs : minuscules, sans accent, ponctuation ramenée à des espaces, et TOUS les mots de la saisie
-- doivent se retrouver — dans n'importe quel ordre, dans le nom ou dans la ville.
--
-- CE QU'ON NE CHANGE PAS : seules les organisations de type « club » et au statut actif sortent.
-- Une famille ne doit pas pouvoir énumérer les clients de SportVision, et cette fonction ne rend
-- que le nom et la ville — rien de ce qui se négocie dans un contrat.
--
-- Idempotente.

create or replace function public.organisations_partenaires_rechercher(p_q text, p_limite integer default 15)
returns table(id uuid, nom text, ville text)
language sql stable security definer set search_path to 'public','pg_temp' as $f$
  with saisie as (
    select trim(regexp_replace(lower(unaccent(coalesce(p_q, ''))), '[^a-z0-9]+', ' ', 'g')) as q
  ), mots as (
    -- Les mots d'une ou deux lettres (AS, US, FC, ES) sont des préfixes présents partout : ils
    -- n'aident pas à choisir et feraient remonter n'importe quoi.
    select m from saisie, unnest(string_to_array((select q from saisie), ' ')) m where length(m) >= 3
  )
  select o.id, o.nom, o.ville
    from organizations o
   where o.organization_type = 'club'
     and o.statut in ('actif_premium', 'actif_standard')
     and (select count(*) from mots) > 0
     and not exists (
       select 1 from mots
        where trim(regexp_replace(lower(unaccent(coalesce(o.nom,'') || ' ' || coalesce(o.ville,''))),
                                  '[^a-z0-9]+', ' ', 'g')) not like '%' || mots.m || '%')
   order by
     -- Le club dont le NOM commence par la saisie d'abord : c'est presque toujours celui-là.
     case when trim(regexp_replace(lower(unaccent(coalesce(o.nom,''))), '[^a-z0-9]+', ' ', 'g'))
               like (select q from saisie) || '%' then 0 else 1 end,
     length(o.nom), o.nom
   limit greatest(1, least(coalesce(p_limite, 15), 30));
$f$;

comment on function public.organisations_partenaires_rechercher(text, integer) is
  'v346 : recherche un club PARTENAIRE a l''inscription, sans accent, sans ponctuation, dans n''importe quel ordre de mots, nom ou ville. Ne rend que nom et ville : une famille n''a pas a enumerer les clients de SportVision.';

grant execute on function public.organisations_partenaires_rechercher(text, integer) to anon, authenticated, service_role;
