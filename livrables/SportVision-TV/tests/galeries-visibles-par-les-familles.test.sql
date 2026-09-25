-- Une galerie publiée doit être atteignable par quelqu'un (25/09/2026).
--
-- DEUX VERSIONS FAUSSES DE CE TEST ONT PRÉCÉDÉ CELLE-CI, LE MÊME JOUR. Elles méritent d'être
-- écrites, parce que l'erreur était la même : juger la visibilité sur un seul chemin.
--
--   1. « Sans ÉQUIPE, personne ne voit la galerie. » Faux : la v195 du 12/09 sert explicitement
--      une galerie sans équipe à toutes les familles du club — c'est le tournoi, le plateau, la
--      journée club, et le seul moyen de couvrir plusieurs catégories d'un coup.
--
--   2. « Sans CLUB, personne ne voit la galerie. » Faux aussi, et c'est l'erreur la plus lourde :
--      23 galeries publiées n'ont aucun club, et ce sont justement celles que SportVision VEND —
--      Amiens, Joinville, RC Argenteuil, la Villemomble Cup. Des équipes qui ne sont pas clientes.
--      Elles se vendent PAR UN LIEN, pas par la liste d'un club. Les 23 en ont un, actif, et ces
--      liens totalisaient 2 116 vues au moment d'écrire ces lignes.
--
-- LA RÈGLE JUSTE EST DONC : une galerie publiée pleine de photos doit être atteignable par AU
-- MOINS UN chemin — rattachée à un club, ses familles la trouvent dans leur espace ; ou porteuse
-- d'un lien actif, elle se vend à qui le reçoit. Aucun des deux, et personne ne la verra jamais.
--
-- CE TEST NE JUGE PAS LE CHOIX DU CHEMIN. Il échoue seulement quand il n'y en a aucun.
with atteignables as (
  select a.id,
         a.club_id is not null as par_le_club,
         exists (
           select 1 from media_album_links l
           where l.album_id = a.id and l.is_enabled
             and (l.expires_at is null or l.expires_at > now())
         ) as par_un_lien,
         (select count(*) from media_assets x where x.album_id = a.id) as photos
  from media_albums a
  where a.status = 'published'
),
perdues as (
  select count(*) as nb, coalesce(sum(photos), 0) as photos
  from atteignables
  where photos > 0 and not par_le_club and not par_un_lien
),
total as (
  select count(*) as galeries, coalesce(sum(photos), 0) as photos
  from atteignables where photos > 0
)
select case
  when (select nb from perdues) = 0
    then '✅ les ' || (select galeries from total) || ' galeries publiées qui portent des photos ('
         || (select photos from total) || ') sont atteignables, par leur club ou par un lien actif'
  else '❌ ' || (select nb from perdues) || ' galerie(s) publiée(s) portant '
       || (select photos from perdues) || ' photos ne sont rattachées à aucun club ET n''ont '
       || 'aucun lien actif : personne ne peut les atteindre, par aucun chemin'
end as verdict;
