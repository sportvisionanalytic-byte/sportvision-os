-- Une galerie publiée doit être visible par quelqu'un (25/09/2026).
--
-- TROUVÉ EN AUDITANT, et c'est le défaut le plus lourd de la journée : 23 galeries publiées sur
-- 25, portant 2 666 photos sur 2 670, n'ont AUCUN CLUB. `media_album_list` commence par
-- `a.club_id = p_club_id` : sans club, aucune famille ne peut les atteindre. La quasi-totalité
-- des photos prises depuis le début de la saison n'a jamais pu être vue par une seule famille.
-- L'opérateur croyait avoir publié ; il avait rempli un dossier que personne n'ouvrirait jamais.
--
-- CE QUE CE TEST NE DIT PAS, ET C'EST UNE CORRECTION. Sa première version accusait l'ÉQUIPE
-- manquante. C'était faux : la v195 du 12/09 sert explicitement une galerie sans équipe à TOUTES
-- les familles du club, parce qu'une galerie sans équipe est le tournoi, le plateau, le gala, la
-- journée club — et c'est le seul moyen de couvrir plusieurs catégories d'un coup. Un test qui
-- exige une équipe pousserait à coller une équipe unique sur ces galeries-là, donc à priver de
-- photos toutes les familles sauf une. Le contraire du but.
--
-- POURQUOI LE CLUB N'EST PAS RENDU OBLIGATOIRE POUR AUTANT. Une galerie sans club est légitime :
-- un club non client, un tournoi extérieur, une vente à un joueur seul. L'OS avertit désormais au
-- moment d'enregistrer, et n'empêche rien.
--
-- CE TEST NE JUGE DONC PAS, IL COMPTE. Il échoue si des galeries publiées et pleines de photos
-- restent sans club — parce qu'à ce volume, ce n'est plus un choix, c'est un oubli.
with orphelines as (
  select a.id, a.title,
         (select count(*) from media_assets x where x.album_id = a.id) as photos
  from media_albums a
  where a.status = 'published' and a.club_id is null
),
lourdes as (
  select count(*) as nb, coalesce(sum(photos), 0) as photos from orphelines where photos > 0
),
total as (
  select count(*) as galeries, (select count(*) from media_assets) as photos from media_albums
)
select case
  when (select nb from lourdes) = 0
    then '✅ toutes les galeries publiées qui portent des photos sont rattachées à un club'
  else '❌ ' || (select nb from lourdes) || ' galerie(s) publiée(s) portant '
       || (select photos from lourdes) || ' photos sur ' || (select photos from total)
       || ' ne sont rattachées à aucun club : aucune famille ne peut les atteindre, '
       || 'et la reconnaissance n''a aucun effectif où chercher'
end as verdict;
