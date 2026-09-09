-- Les créneaux « U15D1 » ne sont pas ceux de U14 D1. Retour en arrière sur la v7.
--
-- ── Ce que le chevauchement a révélé ──
-- U14 D1 se retrouvait avec deux séances le mardi à 19h : « U14D2 » au stade Ripert et « U15D1 »
-- au stade Mimoun. Une équipe ne peut pas être à deux endroits en même temps ; l'une des deux
-- attributions est donc fausse, et ce n'est pas une question d'interprétation.
--
--   « U14D2 » → U14 D1 : solide. Le club a une U14 D1, et la fiche fédérale confirme que son
--   équipe U14 n°1 est engagée en championnat U14 D2. Trois créneaux cohérents (lundi, mardi,
--   jeudi), tous au stade Ripert.
--
--   « U15D1 » → U14 D1 : c'est ma déduction de la v7, et elle était fragile. Je m'étais appuyé
--   sur le fait que la fédération engage l'équipe U14 n°1 en championnat U15 D1 (surclassement),
--   pour en conclure que le créneau municipal libellé « U15D1 » lui revenait. Jouer un
--   championnat et occuper le créneau que la mairie nomme d'après ce championnat sont deux
--   choses différentes — le planning municipal est établi en amont, et peut encore réserver pour
--   une équipe U15 qui n'existe plus.
--
-- ── Ce qu'on fait, et ce qu'on ne fait pas ──
-- Les deux créneaux « U15D1 » (mardi et mercredi, stade Mimoun) retournent à « U15 D2 », leur
-- équipe avant la v7. Elle est archivée, donc ces créneaux sortent du calendrier : c'est
-- exactement ce que Fouka demandait en disant « retire U15 D2 pour le moment, laisse de côté ».
--
-- Les MATCHS du championnat U15 D1 restent sur U14 D1. Eux sont établis par la fiche fédérale,
-- qui dit noir sur blanc quelle équipe est alignée : aucun conflit horaire ne les contredit.
--
-- `team_id` est NOT NULL : on ne peut pas « détacher » un créneau. Le rendre à son équipe
-- d'origine est la seule opération qui n'invente rien.

begin;

update public.club_team_training_slots s
   set team_id = (select id from public.club_teams
                   where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and name = 'U15 D2')
  from public.club_teams t
 where t.id = s.team_id
   and t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and t.name = 'U14 D1'
   and s.notes like '%U15D1%';

commit;
