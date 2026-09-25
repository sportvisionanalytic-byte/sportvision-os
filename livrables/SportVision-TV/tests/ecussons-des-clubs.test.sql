-- Un club, le sien comme celui d'en face, doit avoir son écusson (25/09/2026).
--
-- SIGNALÉ PAR FOUKA : « il y a écrit SV » sur les cartes du calendrier, puis « je vois toujours
-- pas nos logos à nous ».
--
-- Deux causes, toutes deux corrigées. Le code fabriquait « SV » à partir de « SF Villemomble »,
-- c'est-à-dire notre propre sigle à la place de celui d'un client. Et aucun club n'avait
-- d'écusson en base : l'application n'avait rien à afficher.
--
-- CE QUE CE TEST SURVEILLE, et pourquoi chaque point compte :
--
--   1. Chaque club réel a son écusson. Sans lui, la carte retombe sur des initiales, ce qui est
--      le symptôme d'origine.
--   2. `clubs.ecusson_url` et `organizations.logo_url` disent la même chose. L'application lit
--      le club dans `organizations` puis l'écusson par club_identite : si les deux divergent,
--      l'écusson dépend de l'écran qui le demande, et personne ne comprend pourquoi.
--   3. Les adversaires de la saison ont le leur. Ils viennent de l'annuaire fédéral, et un
--      adversaire non enrichi affiche un blason neutre au lieu de son blason.
--   4. Les écussons sont chez NOUS. Un chemin pointant sur le serveur de la source ferait
--      dépendre l'affichage d'un tiers et consommerait sa bande passante à chaque ouverture.
with clubs_sans as (
  select count(*) as n from clubs where coalesce(trim(ecusson_url), '') = ''
),
desaccord as (
  select count(*) as n
  from clubs c join organizations o on o.legacy_club_id = c.id
  where coalesce(c.ecusson_url, '') <> coalesce(o.logo_url, '')
),
adversaires as (
  select count(distinct m.opponent_club_slug) as total,
         count(distinct m.opponent_club_slug) filter (where f.logo_url is not null) as avec
  from club_matches m
  left join federation_clubs f on f.slug = m.opponent_club_slug
  where m.opponent_club_slug is not null
),
heberges as (
  -- Les deux cotes, et c'est la lecon : la premiere version de ce test ne regardait que `clubs`
  -- et affirmait « tous heberges chez nous » alors que 59 adversaires sur 130 pointaient encore
  -- sur le serveur de la source. Un test qui ne couvre pas ce qu'il pretend couvrir est pire que
  -- pas de test : il donne une reponse fausse avec l'autorite d'une mesure.
  select
    (select count(*) from clubs
      where ecusson_url is not null and ecusson_url not like '%/federation-logos/%')
    + (select count(*) from federation_clubs
        where slug in (select distinct opponent_club_slug from club_matches
                        where opponent_club_slug is not null)
          and logo_url is not null and logo_url not like '%/federation-logos/%')
    as n
)
select case
  when (select n from clubs_sans) > 0
    then '❌ ' || (select n from clubs_sans) || ' club(s) sans écusson : l''application retombera '
         || 'sur des initiales'
  when (select n from desaccord) > 0
    then '❌ ' || (select n from desaccord) || ' club(s) où clubs.ecusson_url et '
         || 'organizations.logo_url ne disent pas la même chose'
  when (select n from heberges) > 0
    then '❌ ' || (select n from heberges) || ' écusson(s) servis depuis un serveur tiers au lieu '
         || 'du nôtre'
  when (select avec from adversaires) < (select total from adversaires)
    then '❌ ' || ((select total from adversaires) - (select avec from adversaires))
         || ' adversaire(s) sur ' || (select total from adversaires) || ' sans écusson'
  else '✅ ' || (select count(*) from clubs) || ' clubs et ' || (select total from adversaires)
       || ' adversaires ont leur écusson, tous hébergés chez nous'
end as verdict;
