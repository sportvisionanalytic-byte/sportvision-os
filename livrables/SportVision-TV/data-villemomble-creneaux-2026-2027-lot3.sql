-- Creneaux d'entrainement SF Villemomble, saison 2026-2027 — troisieme lot.
--
-- Regle donnee par Fouka le 09/09/2026 : la ou le planning municipal n'ecrit que « U13 », sans
-- distinguer de groupe, toutes les equipes U13 partagent le creneau.
--
-- U13 F en est exclue volontairement : le planning marque les feminines d'un F et les imprime en
-- rouge, et elle a deja ses deux creneaux propres (mercredi Ripert 19h, vendredi Ripert 17h45).
-- Les inclure ici la ferait s'entrainer deux fois au meme moment a deux endroits.

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'mercredi', '15:30'::time, '17:00'::time, v.id, 'Vestiaire 1-2 · Planning Ville de Villemomble : U13-U12B-U12C-U12D (Mimoun)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'U13 Avenir'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Alain Mimoun'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'mercredi' and s.heure_debut = '15:30'::time
       and s.venue_id = v.id);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'mercredi', '15:30'::time, '17:00'::time, v.id, 'Vestiaire 1-2 · Planning Ville de Villemomble : U13-U12B-U12C-U12D (Mimoun)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'U13 ESPOIR'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Alain Mimoun'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'mercredi' and s.heure_debut = '15:30'::time
       and s.venue_id = v.id);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'vendredi', '17:30'::time, '19:00'::time, v.id, 'Vestiaire 1-2 · Planning Ville de Villemomble : U10A-U11A-U12A-U13 (Mimoun)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'U13 Avenir'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Alain Mimoun'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'vendredi' and s.heure_debut = '17:30'::time
       and s.venue_id = v.id);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'vendredi', '17:30'::time, '19:00'::time, v.id, 'Vestiaire 1-2 · Planning Ville de Villemomble : U10A-U11A-U12A-U13 (Mimoun)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'U13 ESPOIR'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Alain Mimoun'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'vendredi' and s.heure_debut = '17:30'::time
       and s.venue_id = v.id);
