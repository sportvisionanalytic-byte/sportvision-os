-- v315 — 28/09/2026 : le coach peut enfin marquer ses joueurs sur les photos
--
-- POURQUOI C'EST LE CHANTIER QUI RAPPORTE LE PLUS. Mesure en production : **5 646 photos prêtes,
-- 0 marquage**. Tant que rien ne relie une photo à un enfant, une famille qui paie le Pass voit ses
-- quatre photos d'aperçu et plus rien. Les trois moyens de créer ce lien :
--
--   reconnaissance faciale   moteur non choisi, 0 photo de référence, et aveugle aux photos de dos
--   numéro de maillot        construit le 27/09, mais il faut relever les numéros à la main
--   LE COACH                 reconnaît ses joueurs de dos, de loin, flous — sans aucun modèle
--
-- Le coach est le seul qui sait qui est qui sans rien calculer. Et tout était déjà là sauf une
-- ligne : `media_rattacher_joueur` fonctionne, `media_joueurs_de_galerie` liste les joueurs
-- rattachables, `media_club_voit_la_galerie` sait quelles galeries il a le droit de voir. Seul
-- `peut_marquer_galerie` ne reconnaissait que le staff SportVision.
--
-- LA NOUVELLE FRONTIÈRE EST CELLE QUI EXISTAIT DÉJÀ : on marque là où on a le droit de VOIR. Pas
-- une règle de plus à tenir à jour — la même, réutilisée. Un coach reste donc borné à ses équipes
-- (v155), et un club ne touche jamais aux galeries d'un autre.
--
-- CE QUE ÇA DONNE COMME POUVOIR, et il faut le dire franchement : un marquage humain vaut `valide`,
-- donc il OUVRE la photo à la famille de l'enfant marqué. Se tromper de joueur montre la photo d'un
-- enfant à la mauvaise famille. C'est précisément pour ça qu'on l'ouvre au coach et pas à n'importe
-- qui : il est celui qui ne se trompe pas. Et le garde-fou de la v309 tient toujours — on ne peut
-- rattacher qu'un joueur du CLUB de la galerie, jamais celui d'un autre club.
--
-- Idempotent.

create or replace function public.peut_marquer_galerie(p_album_id uuid)
returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $f$
  -- Le staff SportVision, avec la nuance de l'operateur terrain borne a SES prestations.
  select (media_upload_staff()
          and (not est_operateur_terrain() or photographe_voit_album(p_album_id)))
  -- v315 : ou le club lui-meme, dans les galeries qu'il a le droit de voir. Meme regle que la
  -- lecture (v303), donc le cloisonnement du coach sur ses equipes s'applique sans etre recopie.
      or public.media_club_voit_la_galerie(p_album_id);
$f$;

comment on function public.peut_marquer_galerie(uuid) is
  'v315 : le staff SportVision, ou le club dans les galeries qu''il voit. On marque la ou on a le droit de voir — le cloisonnement du coach (v155) s''applique via media_club_voit_la_galerie.';
