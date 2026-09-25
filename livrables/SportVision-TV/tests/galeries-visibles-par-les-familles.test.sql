-- Une galerie publiée doit être visible par quelqu'un (25/09/2026).
--
-- TROUVÉ EN AUDITANT, et c'est le défaut le plus lourd de la journée : 23 galeries publiées sur
-- 36, portant 2 685 photos sur 2 698, n'avaient NI club NI équipe. Elles étaient donc invisibles
-- pour toutes les familles — `media_album_list` filtre sur club_id et team_id — et la
-- reconnaissance ne pouvait pas démarrer non plus, faute d'équipe où trouver des joueurs.
--
-- Autrement dit : la quasi-totalité des photos prises depuis le début de la saison n'a jamais
-- pu être vue par une seule famille. Rien ne le signalait. L'opérateur croyait avoir publié, et
-- il avait rempli un dossier que personne n'ouvrirait jamais.
--
-- POURQUOI CE N'EST PAS UNE ERREUR DE SAISIE À INTERDIRE. Laisser une galerie sans équipe est
-- légitime : un tournoi, un club non client, une vente à un joueur seul. L'OS avertit désormais
-- au moment d'enregistrer, mais n'empêche rien.
--
-- CE TEST NE JUGE DONC PAS, IL COMPTE. Il échoue si des galeries publiées et pleines de photos
-- restent sans équipe — parce qu'à ce volume, ce n'est plus un choix, c'est un oubli.
with orphelines as (
  select a.id, a.title,
         (select count(*) from media_assets x where x.album_id = a.id) as photos
  from media_albums a
  where a.status = 'published' and a.team_id is null
),
lourdes as (
  select count(*) as nb, coalesce(sum(photos), 0) as photos from orphelines where photos > 0
),
total as (
  select count(*) as galeries, (select count(*) from media_assets) as photos from media_albums
)
select case
  when (select nb from lourdes) = 0
    then '✅ toutes les galeries publiées qui portent des photos sont rattachées à une équipe'
  else '❌ ' || (select nb from lourdes) || ' galerie(s) publiée(s) portant '
       || (select photos from lourdes) || ' photos sur ' || (select photos from total)
       || ' ne sont rattachées à aucune équipe : aucune famille ne les voit, et la '
       || 'reconnaissance ne peut pas y tourner'
end as verdict;
