-- « U15D1 » est un championnat, pas une equipe. Correction, puis mise de cote de U15 D2.
--
-- ── L'erreur ──
-- Ce matin (09/09/2026), en important le planning municipal, j'ai traduit « U15D1 » par l'equipe
-- « U15 D2 » du club. Le raisonnement etait : le planning cite U15D1 et U15F, le club a U15 D2 et
-- U15 F, donc U15D1 = U15 D2, une seule possibilite. Il etait faux.
--
-- ── Ce que la source federale a etabli ──
-- « U15 D1 » est le nom d'un CHAMPIONNAT, et ce championnat est joue par l'equipe U14 1 de
-- Villemomble (surclassement) : la fiche officielle montre « Villemomble Sports U14 1 » alignee en
-- U15 D1 le 19/09/2026. Aucune equipe U15 masculine n'est engagee cette saison.
-- Les deux creneaux et les deux matchs rattaches a U15 D2 portent d'ailleurs tous le libelle
-- « U15D1 » dans leurs notes : ils appartiennent a l'equipe U14 1, soit « U14 D1 » en base.
--
-- ── La lecon ──
-- Une deduction par elimination (« il ne reste qu'une equipe possible ») n'est pas une preuve.
-- Elle suppose que les deux listes decrivent la meme chose, ce qui etait faux ici : le planning
-- nomme des championnats, la base nomme des equipes.
--
-- ── Mise de cote de U15 D2 ──
-- Fouka, 09/09/2026 : « retire u15d2 pour le moment laisse de cote ». On l'ARCHIVE, on ne la
-- supprime pas : « pour le moment » n'est pas une suppression, et la desarchiver est un clic la ou
-- une suppression serait definitive. Elle est vide une fois ses creneaux et matchs rendus a U14 D1.
--
-- Fouka a aussi tranche pour les U14 : la federation en engage trois, le club n'en a que deux en
-- base, « la 3e jsp met pas pour le moment garde une seul ». Aucune equipe n'est donc creee ici.

begin;

-- 1. Les deux creneaux « U15D1 » reviennent a U14 D1.
--    Le garde `not exists` evite de poser un doublon si U14 D1 occupe deja ce creneau.
update public.club_team_training_slots s
   set team_id = (select id from public.club_teams
                   where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and name = 'U14 D1')
 where s.team_id = (select id from public.club_teams
                     where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and name = 'U15 D2')
   and s.notes like '%U15D1%'
   and not exists (
     select 1 from public.club_team_training_slots autre
      where autre.team_id = (select id from public.club_teams
                              where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and name = 'U14 D1')
        and autre.jour = s.jour
        and autre.heure_debut = s.heure_debut
        and autre.venue_id is not distinct from s.venue_id
   );

-- 2. Les deux matchs « U15D1 » aussi. Le libelle d'origine reste dans `team`, c'est la trace de ce
--    que disait le fichier du club.
update public.club_matches m
   set team_id = (select id from public.club_teams
                   where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and name = 'U14 D1')
 where m.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and m.team_id = (select id from public.club_teams
                     where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and name = 'U15 D2');

-- 3. U15 D2 est mise de cote, pas effacee.
update public.club_teams
   set archivee = true, archivee_at = now()
 where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and name = 'U15 D2';

commit;
