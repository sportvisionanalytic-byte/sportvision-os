-- RCP Fontainebleau : supprimer les équipes « catégorie » qui doublonnent les équipes réelles,
-- sans perdre leurs créneaux d'entraînement (13/09/2026, demande de Fouka).
--
-- CE QU'ON A TROUVÉ. Trois catégories portaient à la fois une équipe générique et des équipes
-- lettrées :
--   • « Senior » (4 créneaux, 0 match) à côté de Seniors A, B et C (91 matchs, aucun créneau) ;
--   • « U10 » (1 créneau) à côté de U10A, U10B, U10C ;
--   • « U11 » (1 créneau) à côté de U11A, U11B, U11C.
--
-- Les autres équipes sans lettre — U6, U7, U8, U9, U15, U17, Féminine, Gardiens de but, Vétérans —
-- n'ont AUCUNE équipe lettrée en face : ce sont de vraies équipes, on n'y touche pas.
--
-- CE QU'ON FAIT. Les créneaux de l'équipe générique sont recopiés sur chacune des équipes
-- lettrées de sa catégorie, sans doublon (un créneau identique déjà présent n'est pas recréé),
-- puis l'équipe générique est supprimée.
--
-- POINT LAISSÉ À FOUKA. Les seniors ont DEUX créneaux le mardi, 20:00 et 20:30. Rien ne dit
-- lequel appartient à quelle équipe : les deux sont donc posés sur A, B et C, et il faudra
-- retirer celui qui ne correspond pas à chacune. Mieux vaut un créneau en trop, visible et
-- corrigeable, qu'un horaire perdu.
--
-- À jouer une fois. Relancer ne recrée rien (anti-doublon sur jour + horaires).

with generiques as (
  select t.id, t.name,
         case t.name when 'Senior' then 'Seniors' else t.name end as prefixe
    from club_teams t
    join clubs c on c.id = t.club_id
   where c.nom = 'RCP Fontainebleau' and t.name in ('Senior', 'U10', 'U11')
),
cibles as (
  select g.id as source_id, t.id as cible_id
    from generiques g
    join club_teams t on t.club_id = (select id from clubs where nom = 'RCP Fontainebleau')
   where t.name ~ ('^' || g.prefixe || ' ?[ABC]$')
)
insert into club_team_training_slots (team_id, jour, heure_debut, heure_fin)
select c.cible_id, s.jour, s.heure_debut, s.heure_fin
  from cibles c
  join club_team_training_slots s on s.team_id = c.source_id
 where not exists (
   select 1 from club_team_training_slots x
    where x.team_id = c.cible_id and x.jour = s.jour
      and x.heure_debut = s.heure_debut and x.heure_fin = s.heure_fin
 );

delete from club_teams t
 using clubs c
 where c.id = t.club_id and c.nom = 'RCP Fontainebleau'
   and t.name in ('Senior', 'U10', 'U11');
