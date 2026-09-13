-- RCP Fontainebleau — deux créneaux impossibles, corrigés (14/09/2026).
--
-- CE QUI A ÉTÉ TROUVÉ, en relisant le planning importé avant l'ouverture du club :
--
-- U13A et U14A portaient CHACUNE deux créneaux le vendredi 17:00-18:30, l'un sur le terrain T2,
-- l'autre sur le T3. Une équipe ne s'entraîne pas sur deux terrains à la même heure : le planning
-- municipal disait « U13A et U14A » sur deux terrains, et l'import a dupliqué la ligne pour chaque
-- équipe au lieu de la répartir. Sur le calendrier du club, chaque joueur aurait vu deux séances
-- le même vendredi.
--
-- CE QU'ON FAIT, ET CE QU'ON NE FAIT PAS. On garde UNE séance par équipe — le doublon est
-- certainement faux. On ne devine PAS quel terrain revient à quelle équipe : le document source ne
-- le dit pas. La note porte les deux terrains, à répartir par le club.
--
-- CE QUI RESTE À TRANCHER PAR FOUKA (non modifié ici) : Seniors A, B et C portent chacune DEUX
-- créneaux le mardi, à 20:00 ET à 20:30, sans lieu ni source. Les deux ne peuvent pas être vrais.
-- Il faut supprimer le mauvais, et seul le planning de la mairie le dit.
--
-- Idempotente : rejouer ne change rien une fois les doublons supprimés.

-- Une seule ligne par équipe : on garde celle du T3 et on réécrit sa note, puis on supprime l'autre.
update club_team_training_slots
   set notes = 'Terrains T2 et T3 — créneau partagé U13A/U14A, terrain à répartir par le club'
 where id in ('70752f79-5036-4803-bedf-7f78a76c8275', 'ec6c559d-0e37-47ad-b80a-5467cd3ccc1c');

delete from club_team_training_slots
 where id in ('445cb1fe-0cac-45c4-9dc7-8892764deb67', '6a35bfb3-0823-4f5e-854b-9233eea91efe');

-- Vérification : plus aucune équipe du club avec deux créneaux au même jour et à la même heure.
do $$
declare n int;
begin
  select count(*) into n from (
    select 1 from club_team_training_slots s
      join club_teams t on t.id = s.team_id
     where t.club_id = '0ab96066-2ca5-4fb1-98eb-2204771ecf8d'
     group by s.team_id, s.jour, s.heure_debut having count(*) > 1
  ) x;
  if n > 0 then raise exception 'Il reste % creneau(x) en double', n; end if;
end $$;

select 'OK — doublons du vendredi supprimés ; les Seniors du mardi restent à trancher.' as verdict;
