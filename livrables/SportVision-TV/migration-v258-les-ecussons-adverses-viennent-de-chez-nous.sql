-- v258 — Les écussons des adversaires sont servis depuis chez nous (25/09/2026)
--
-- SUITE DE LA v256, qui avait fait ce travail pour les trois clubs de SportVision et pas pour
-- leurs adversaires. Mon propre test de vérification ne regardait que `clubs`, et il a donc
-- affirmé « tous hébergés chez nous » alors que 59 des 130 adversaires pointaient encore sur le
-- serveur de SportCorico. Un test qui ne couvre pas ce qu'il prétend couvrir est pire que pas de
-- test : il donne une réponse fausse avec l'autorité d'une mesure.
--
-- POURQUOI RAPATRIER. L'application affiche ces écussons sur chaque carte de match du calendrier
-- d'une saison. Les servir depuis un tiers, c'est faire dépendre l'affichage de sa disponibilité
-- et de son bon vouloir, et consommer sa bande passante à chaque ouverture, chez chaque famille.
-- C'est aussi la convention que `federation-club-fiche` documente lui-même : un chemin contenant
-- « /federation-logos/ » est traité comme la copie locale et n'est jamais écrasé par la source.
--
-- LES FICHIERS SONT DÉJÀ DÉPOSÉS dans le seau `federation-logos` avant cette migration : 58 par
-- boucle, plus un rattrapé à la main — une ligne sans retour chariot final avait été sautée, ce
-- que seule la comparaison des deux listes a révélé.
--
-- Cette migration ne fait que réécrire les adresses. Elle est idempotente : les clubs déjà
-- rapatriés portent déjà le bon chemin et ne bougent pas.

update federation_clubs f
set logo_url = 'https://lulgezzpvrlbftbykzrc.supabase.co/storage/v1/object/public/federation-logos/'
               || f.slug || '.' ||
               case
                 when f.logo_url ilike '%.png'  then 'png'
                 when f.logo_url ilike '%.webp' then 'webp'
                 else 'jpg'
               end
where f.slug in (select distinct opponent_club_slug from club_matches where opponent_club_slug is not null)
  and f.logo_url is not null
  and f.logo_url not like '%/federation-logos/%';

select
  count(*) as adversaires,
  count(*) filter (where logo_url like '%/federation-logos/%') as chez_nous,
  count(*) filter (where logo_url not like '%/federation-logos/%') as chez_le_tiers
from federation_clubs
where slug in (select distinct opponent_club_slug from club_matches where opponent_club_slug is not null)
  and logo_url is not null;
