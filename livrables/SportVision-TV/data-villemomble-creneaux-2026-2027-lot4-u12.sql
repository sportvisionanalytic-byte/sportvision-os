-- Recalage de la serie U12, SF Villemomble, saison 2026-2027.
--
-- Fouka, le 09/09/2026 : « U12 REG est la A normalement, la D est la derniere ».
--
-- La regle generale qu'il avait donnee (A=ELITE, B=ESPOIR 1, C=ESPOIR 2, D=Avenir) vaut pour les
-- U10 et les U11, qui ont exactement ces quatre equipes. Les U12 en ont cinq et aucune « Avenir ».
-- Sa precision les remet dans l'ordre :
--
--   U12A -> U12 REG        l'equipe regionale, tete de categorie
--   U12B -> U12 ELITE
--   U12C -> U12 Espoir 1
--   U12D -> U12 Espoir 2   « la derniere »
--   U12 ESPOIR -> aucune lettre
--
-- Que « U12 ESPOIR » soit precisement celle qui reste sans creneau confirme ce qu'on soupconnait :
-- c'est un doublon de saisie de l'import Excel, a cote de « U12 Espoir 1 » et « U12 Espoir 2 ».
-- Elle n'est PAS supprimee ici : une suppression d'equipe se decide, elle ne se deduit pas.
--
-- Deux deplacements suffisent, dans cet ordre. Aucun creneau n'est cree ni detruit, les lignes
-- changent seulement d'equipe, et les notes gardent le libelle municipal d'origine qui reste vrai.
-- Les creneaux de U12 Espoir 1 et U12 Espoir 2 (mercredi 15h30) ne bougent pas : B et C avant,
-- C et D maintenant, meme cellule du planning dans les deux cas.

begin;

-- 1. Les trois creneaux « U12A » passent de U12 ELITE a U12 REG.
update public.club_team_training_slots s
   set team_id = (select id from public.club_teams
                   where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and name = 'U12 REG')
 where s.team_id = (select id from public.club_teams
                     where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and name = 'U12 ELITE')
   and s.notes like '%U12A%';

-- 2. Le creneau « U12D » (mercredi 15h30) passe de U12 ESPOIR a U12 ELITE, qui devient le B.
update public.club_team_training_slots s
   set team_id = (select id from public.club_teams
                   where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and name = 'U12 ELITE')
 where s.team_id = (select id from public.club_teams
                     where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and name = 'U12 ESPOIR');

commit;
