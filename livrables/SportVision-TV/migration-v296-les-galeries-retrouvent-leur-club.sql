-- v296 — 27/09/2026 : 2 723 photos d'enfants n'appartenaient à aucun club
--
-- TROUVÉ EN CHERCHANT POURQUOI LES COMPTES DE DÉMONSTRATION TOMBENT SUR UN ÉCRAN VIDE. Cinq des
-- huit ne voyaient aucune galerie. Ce n'était pas un défaut de droits : les 24 galeries publiées
-- n'avaient NI club, NI équipe, NI mission, alors que 23 nomment leur club dans leur titre.
--
--     Villemomble Cup U10 - AS Bondy / Creil / Créteil / …        13
--     rc argenteuil vs Villemomble, Noisy plateau, FC 93 plateau…  5   -> Villemomble  18
--     Amiens U11/U10/U9 VS RCP Fontainebleau, Mortmant, Joinville  5   -> Fontainebleau 5
--     Stade de l'est                                               1   -> indéterminé
--
-- CE QUE ÇA COÛTAIT, mesuré :
--   • `media_album_list` filtre sur `a.club_id = p_club_id`. Avec NULL, aucune famille et aucun
--     membre du club ne voyait ces galeries dans l'app, dans Connect ni dans Club+.
--   • `can_access_media` compare `me.club_id = v_album.club_id` pour un Pass de périmètre club.
--     NULL = NULL est faux : le Pass Photo ne pouvait RIEN déverrouiller. 3 343 photos en ligne,
--     0 Pass vendu.
--   • La saison manquait aussi sur les 24, et c'est une seconde condition du même test
--     (`me.saison_id is null or me.saison_id = v_album.saison_id`). Poser le club sans la saison
--     n'aurait rien débloqué, et on aurait cherché longtemps.
--
-- DÉCISION DE FOUKA (27/09) : rattacher au club, SANS équipe. Une galerie de club est visible par
-- toutes les familles du club, ce qui est sans risque ici : chaque famille ne voit que SES photos
-- après achat du Pass et identification, jamais celles des autres. Rattacher une ÉQUIPE aurait
-- demandé de deviner — « Villemomble Cup U10 » ne dit pas lequel des U10 — et deviner enverrait
-- les photos d'une équipe aux familles d'une autre.
--
-- « Stade de l'est » reste sans club : son titre ne nomme personne. Elle continue de se vendre par
-- son lien, comme aujourd'hui.
--
-- Le club se déduit du titre, et un seul titre ne nomme qu'un seul club — vérifié avant d'écrire :
-- aucune galerie ne cite Villemomble ET Fontainebleau.
--
-- Idempotent.

-- 1. Le club, depuis le titre.
update media_albums a
   set club_id = c.id, updated_at = now()
  from clubs c
 where a.club_id is null
   and (
     (c.nom = 'SF Villemomble'    and lower(unaccent(a.title)) like '%villemomble%')
     or (c.nom = 'RCP Fontainebleau' and lower(unaccent(a.title)) like '%fontainebleau%')
   );

-- 2. La saison, sans quoi le Pass reste bloqué par sa borne de saison.
update media_albums a
   set saison_id = s.id, updated_at = now()
  from saisons s
 where a.saison_id is null
   and coalesce(a.event_date, a.published_at::date, current_date) between s.date_debut and s.date_fin;

-- 3. Les photos suivent leur galerie. Le trigger media_assets_set_club ne s'applique qu'au dépôt :
-- les 2 723 photos déjà en place gardent le club qu'elles avaient, c'est-à-dire aucun.
update media_assets x
   set club_id = a.club_id
  from media_albums a
 where a.id = x.album_id
   and x.club_id is distinct from a.club_id;
