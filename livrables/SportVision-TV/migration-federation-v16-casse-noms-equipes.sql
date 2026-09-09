-- Uniformisation de la casse des noms d'equipes de SF Villemomble.
--
-- Fouka, 09/09/2026 : « oui uniforme ».
--
-- L'ecran Equipes alignait « U10 ELITE » et « U10 ESPOIR 1 » en capitales a cote de
-- « U12 Espoir 1 » et « U12 Espoir 2 » en minuscules : deux conventions dans la meme liste, pour
-- des equipes de meme nature. Ca se voit, et ca donne l'impression d'une saisie bacle plutot que
-- d'un effectif tenu.
--
-- ── Ce qu'on change, et ce qu'on ne change pas ──
-- Seuls les mots ELITE et ESPOIR passent en capitale initiale : ce sont des mots francais ecrits
-- en majuscules par accident d'import, pas des sigles.
--
-- On NE touche PAS :
--   REG        abreviation de « regional », elle a un sens tel quel
--   D1 D2 D3 R2 R3   des divisions, leur forme est celle de la federation
--   F          suffixe feminin, deja uniforme partout
--   « Séniors », « Anciens D1 », « Super Vétérans », « Spécifique Gardiens »   deja coherents
--
-- Renommer est sans risque pour les rattachements : matchs, creneaux et correspondances de source
-- pointent tous sur l'identifiant de l'equipe, jamais sur son nom. Verifie avant d'ecrire.

begin;

update public.club_teams
   set name = replace(replace(name, 'ELITE', 'Élite'), 'ESPOIR', 'Espoir')
 where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and name ~ 'ELITE|ESPOIR';

commit;
