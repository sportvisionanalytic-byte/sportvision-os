-- RCP Fontainebleau — le mardi des Seniors, tranché (14/09/2026).
--
-- Seniors A, B et C portaient chacune DEUX créneaux le mardi soir : 20:00-22:00 et 20:30-22:00.
-- Les trois équipes s'entraînent ensemble (Fouka) : il n'y a donc qu'UNE séance ce soir-là, et le
-- planning importé en proposait deux qui se chevauchent. Décision de Fouka : c'est 20:00-22:00.
--
-- Ce que ça évite : un joueur qui voit deux entraînements le même mardi, et un opérateur envoyé à
-- la mauvaise heure le jour où SportVision couvre la séance.
--
-- Idempotente.

delete from club_team_training_slots s
 using club_teams t
 where t.id = s.team_id
   and t.club_id = '0ab96066-2ca5-4fb1-98eb-2204771ecf8d'
   and t.name like 'Seniors%'
   and s.jour = 'mardi'
   and s.heure_debut = time '20:30';

do $$
declare n int;
begin
  select count(*) into n
    from club_team_training_slots s join club_teams t on t.id = s.team_id
   where t.club_id = '0ab96066-2ca5-4fb1-98eb-2204771ecf8d' and t.name like 'Seniors%' and s.jour = 'mardi';
  if n <> 3 then raise exception 'Attendu 3 creneaux du mardi (un par equipe Seniors), trouve %', n; end if;
end $$;

select 'OK — un seul entraînement le mardi, à 20:00, pour chacune des trois équipes Seniors.' as verdict;
