-- v356 — DEUX FICHES POUR UN SEUL CLUB, ET C'EST LA VIDE QUI ÉTAIT AFFICHÉE (29/09/2026)
--
-- Le test `ecussons-des-clubs` signalait « 2 adversaires sur 143 sans écusson : as-bondy, cs-meaux ».
-- Ce n'était pas un manque d'enrichissement : le club EST enrichi, sous un autre identifiant.
--
--   as-bondy   → fiche vide (nom null, pas de logo)   |  bondy-as                   → « Bondy AS », logo
--   cs-meaux   → fiche vide                            |  cs-meaux-academy-football  → « CS Meaux Academy Football », logo
--
-- Cinq matchs réels pointaient sur les fiches vides, quatorze et cinq sur les fiches pleines. Le
-- même adversaire s'affichait donc avec son écusson dans certains matchs et sans dans d'autres, ce
-- qui ressemble à un bug d'affichage alors que c'est un doublon de données.
--
-- VÉRIFIÉ AVANT DE FUSIONNER, parce qu'un mauvais écusson sur un vrai match se voit tout de suite :
-- l'annuaire fédéral ne contient qu'UN seul club de Meaux, « CS Meaux Academy Football ». Et
-- « AS Bondy » / « Bondy AS » sont le même club, à l'ordre des mots près. C'est d'ailleurs la cause :
-- l'identifiant est dérivé du NOM, et la même équipe est écrite dans les deux ordres selon la
-- source. Une fiche par graphie.
--
-- CE QUE CETTE MIGRATION NE FAIT PAS, ET IL FAUT LE DIRE. Elle répare le passé, elle n'empêche pas
-- le retour : la synchronisation fédérale continuera de fabriquer une fiche vide à la prochaine
-- graphie inédite. La vraie correction est la normalisation de l'identifiant dans
-- `federation-sync-matchs`, qui est un changement de code à décider à part — on est en gel
-- fonctionnel. Le test, lui, reste le garde-fou : il redeviendra rouge, et c'est ce qu'on veut.
-- « Une correction de données ne se défend pas » (leçon du 27/09) : ici c'est assumé, pas ignoré.

-- 1. Les matchs suivent la fiche pleine.
update club_matches set opponent_club_slug = 'bondy-as'                  where opponent_club_slug = 'as-bondy';
update club_matches set opponent_club_slug = 'cs-meaux-academy-football' where opponent_club_slug = 'cs-meaux';

-- 2. Les fiches vides n'ont plus d'objet. On ne supprime QUE celles qui sont vraiment vides et que
--    plus rien ne cite : une fiche sans nom ET sans logo ne peut rien apporter à personne.
delete from federation_clubs f
 where f.slug in ('as-bondy', 'cs-meaux', 'meaux-cs')
   and f.nom is null and f.logo_url is null
   and not exists (select 1 from club_matches m where m.opponent_club_slug = f.slug);

notify pgrst, 'reload schema';
