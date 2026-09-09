-- Detacher les matchs U14 D4 : deux equipes federales, une seule equipe en base.
--
-- ── Ce qui s'est passe ──
-- La regle de la v9 (« si la competition nomme exactement une equipe du club, c'est elle qui
-- joue ») est juste pour Anciens D1 et Super Veterans. Elle est FAUSSE pour U14 D4 : la
-- federation y engage DEUX equipes de Villemomble, U14 2 en poule E et U14 3 en poule C. Le club
-- n'ayant qu'une equipe « U14 D4 » en base, la regle y a verse les deux calendriers : 52 matchs
-- pour une equipe U14, soit deux saisons dans une.
--
-- Ma garde ne verifiait que l'unicite du cote SportVision (une seule equipe du club porte ce nom),
-- pas du cote federal (une seule equipe du club joue cette competition). C'est la seconde qui
-- manquait.
--
-- ── Ce qu'on fait ──
-- On rend ces matchs a l'etat non rattache. Un calendrier vide est visiblement incomplet ; un
-- calendrier qui melange deux equipes a l'air juste et ne l'est pas. Le second est pire.
--
-- Les matchs gardent leur libelle federal dans `team` (« U14 2 », « U14 3 ») : le jour ou Fouka
-- dira laquelle de ses equipes joue la poule E et laquelle la poule C, le rattachement se fera
-- en deux lignes.
--
-- Les deux matchs U14 D4 venant du fichier Excel du club ne sont PAS touches : ils portent le
-- libelle du club, pas celui de la federation, et leur rattachement n'a jamais ete ambigu.

begin;

update public.club_matches
   set team_id = null
 where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and provider = 'SPORTCORICO'
   and team in ('U14 2', 'U14 3');

commit;
