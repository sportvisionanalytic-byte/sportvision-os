-- RATTRAPAGE DES ÉCHÉANCES (02/10/2026) — données, pas structure. Voir v460 pour la règle.
--
-- Les 10 prestations de la base n'avaient aucune échéance : personne ne les saisissait. La v460
-- pose la règle (24 h après la fin de la prestation, le délai annoncé partout depuis le 19/08),
-- mais un déclencheur ne s'applique qu'aux écritures à venir. Ce fichier fait repasser le
-- déclencheur sur les lignes existantes, sans rien forcer : il ne touche qu'aux colonnes NULLES,
-- laisse les missions sans couverture tranquilles, et ne modifie aucune autre donnée.
--
-- CE QUE ÇA DÉCLENCHE, MESURÉ AVANT DE LE LANCER, règle de retard corrigée (v461) :
--   22 notifications au prochain passage du cron, sur 5 missions — SV-2026-0274, 3121, 3843,
--   3846 et 3957. Ce sont exactement les cinq missions que l'audit du 01/10 a trouvées ouvertes
--   depuis septembre. L'alerte est donc vraie, et c'est la première fois qu'elle peut partir.
--   Les trois missions clôturées et la mission à venir ne déclenchent rien.
--
-- Ce n'est volontairement pas dans la migration : poser une échéance sur une mission de septembre
-- la rend immédiatement en retard, donc écrit à de vraies personnes. Ça se mesure, ça s'annonce,
-- et ça ne se glisse pas dans un fichier de structure.

update public.prestations
   set date_prestation = date_prestation
 where couverture is not null
   and (deadline_photo_at is null or deadline_video_at is null);
