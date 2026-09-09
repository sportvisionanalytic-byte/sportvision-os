-- Creneaux d'entrainement SF Villemomble, saison 2026-2027 — second lot.
--
-- ATTENTION, NE PAS REJOUER CE FICHIER SEUL, pour la meme raison que le premier : il place U12D
-- sur U12 ESPOIR, ce que le lot 4 a corrige en U12 Espoir 2 apres la precision de Fouka. Le lot 4
-- fait foi. La suppression des equipes Veterans qui figurait ici a ete retiree : Fouka a demande
-- de laisser Anciens D1 et Super Veterans en place.
--
-- Suite du premier lot (data-villemomble-creneaux-2026-2027.sql), apres les arbitrages de Fouka
-- du 09/09/2026 et une relecture des photos en haute resolution.
--
-- ── Ce que la relecture a etabli ──
-- Le planning municipal ecrit les equipes FEMININES en rouge. Le « U12 » du vendredi (Ripert
-- 17h45) est en rouge, encadre de U11F et U13F : c'est une equipe feminine, pas une U12 masculine.
-- Meme constat pour U11F. Le club n'a ni U11 F ni U12 F : elles sont creees ici.
--
-- ── Correspondances deduites, chacune forcee (une seule equipe possible) ──
--   U14D2 -> U14 D1   le planning cite U14D2 et U14D4, le club a U14 D1 et U14 D4
--   U16D1 -> U16 R3   le planning cite U16D1 et U16D3, le club a U16 D3 et U16 R3
--   U15D1 -> U15 D2   le planning cite U15D1 et U15F,  le club a U15 D2 et U15 F
--   Seniors D1 -> Seniors D3   D2, R2 et F sont deja prises, D3 est la seule qui reste
--   U18D1 -> U18 D2   A=R3 et B=D2 (donne par Fouka), D2 est la seule U18 « D » du club
--   U12D  -> U12 ESPOIR   A=ELITE, B=Espoir 1, C=Espoir 2 ; entre ESPOIR et REG, seul ESPOIR
--                         peut etre un 4e groupe, « REG » designant un niveau regional
--
-- ── Ce qui n'est PAS ecrit ici, volontairement ──
--   Veterans (lundi Mimoun 20h30, jeudi Ripert 20h30) : Fouka a demande de ne pas les porter.
--   « D4 » (jeudi Mimoun 19h, cellule lue « U14D4 /D4 ») : le second code reste illisible meme
--   au zoom, le papier est plie dessus. U14 D4 y est deja rattachee.
--   « Babyfoot » (jeudi Ripert 17h30) : ce n'est pas une equipe mais un qualificatif du creneau,
--   deja porte par U6 et U7.
--
-- ── Le garde d'idempotence inclut desormais le terrain ──
-- Le mardi a 17h30, le planning pose U8AB-U9AB a Mimoun ET U8-U9 a Ripert : deux creneaux reels.
-- Le club n'ayant qu'une equipe U8 et une U9, le premier lot avait silencieusement refuse le
-- second (meme equipe, meme jour, meme heure). La cle inclut le lieu, le creneau Ripert est
-- rattrape plus bas.

begin;

-- ── Equipes retirees ──
-- Vides de tout : aucun licencie, aucun match, aucun evenement, aucun code d'invitation.
delete from public.club_teams
 where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and name in ('Anciens D1', 'Super Vétérans');

-- ── Equipes creees ──
insert into public.club_teams (club_id, name, categorie, categories, section, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid, v.name, v.categorie, array[v.categorie], v.section,
       'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'::uuid
  from (values
    ('U11 F', 'U11', 'Féminin'),
    ('U12 F', 'U12', 'Féminin'),
    ('Spécifique Gardiens', 'Gardiens', 'Mixte')
  ) as v(name, categorie, section)
 where not exists (select 1 from public.club_teams t
   where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = v.name);

commit;

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'lundi', '19:00'::time, '20:30'::time, v.id, 'Vestiaire 3-4 · Planning Ville de Villemomble : U14D2-U16D1 (Ripert)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'U14 D1'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Claude Ripert'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'lundi' and s.heure_debut = '19:00'::time
       and s.venue_id = v.id);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'lundi', '19:00'::time, '20:30'::time, v.id, 'Vestiaire 3-4 · Planning Ville de Villemomble : U14D2-U16D1 (Ripert)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'U16 R3'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Claude Ripert'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'lundi' and s.heure_debut = '19:00'::time
       and s.venue_id = v.id);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'mardi', '19:00'::time, '20:30'::time, v.id, 'Vestiaire 3-4 · Planning Ville de Villemomble : U16D3-U15D1 (Mimoun)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'U15 D2'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Alain Mimoun'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'mardi' and s.heure_debut = '19:00'::time
       and s.venue_id = v.id);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'mardi', '20:30'::time, '22:15'::time, v.id, 'Vestiaire 2-1 · Planning Ville de Villemomble : Séniors D1-Séniors D2 (Mimoun)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'Séniors D3'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Alain Mimoun'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'mardi' and s.heure_debut = '20:30'::time
       and s.venue_id = v.id);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'mardi', '17:30'::time, '19:00'::time, v.id, 'Vestiaire 4 · Planning Ville de Villemomble : U8-U9 (Ripert)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'U8'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Claude Ripert'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'mardi' and s.heure_debut = '17:30'::time
       and s.venue_id = v.id);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'mardi', '17:30'::time, '19:00'::time, v.id, 'Vestiaire 4 · Planning Ville de Villemomble : U8-U9 (Ripert)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'U9'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Claude Ripert'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'mardi' and s.heure_debut = '17:30'::time
       and s.venue_id = v.id);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'mardi', '19:00'::time, '20:30'::time, v.id, 'Vestiaire R1-R2 · Planning Ville de Villemomble : U18F-U14D2 (Ripert)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'U14 D1'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Claude Ripert'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'mardi' and s.heure_debut = '19:00'::time
       and s.venue_id = v.id);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'mercredi', '15:30'::time, '17:00'::time, v.id, 'Vestiaire 1-2 · Planning Ville de Villemomble : U13-U12B-U12C-U12D (Mimoun)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'U12 ESPOIR'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Alain Mimoun'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'mercredi' and s.heure_debut = '15:30'::time
       and s.venue_id = v.id);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'mercredi', '17:00'::time, '18:30'::time, v.id, 'Planning Ville de Villemomble : Spécifique Gardiens (Mimoun)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'Spécifique Gardiens'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Alain Mimoun'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'mercredi' and s.heure_debut = '17:00'::time
       and s.venue_id = v.id);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'mercredi', '18:30'::time, '20:00'::time, v.id, 'Vestiaire 3-4 · Planning Ville de Villemomble : U16D1-U15D1 (Mimoun)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'U16 R3'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Alain Mimoun'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'mercredi' and s.heure_debut = '18:30'::time
       and s.venue_id = v.id);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'mercredi', '18:30'::time, '20:00'::time, v.id, 'Vestiaire 3-4 · Planning Ville de Villemomble : U16D1-U15D1 (Mimoun)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'U15 D2'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Alain Mimoun'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'mercredi' and s.heure_debut = '18:30'::time
       and s.venue_id = v.id);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'mercredi', '20:00'::time, '22:15'::time, v.id, 'Vestiaire 4-1 · Planning Ville de Villemomble : U18D1 (Mimoun)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'U18 D2'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Alain Mimoun'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'mercredi' and s.heure_debut = '20:00'::time
       and s.venue_id = v.id);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'mercredi', '15:30'::time, '17:15'::time, v.id, 'Vestiaire R1-R2 · Planning Ville de Villemomble : U8-U9-U11F (Ripert)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'U11 F'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Claude Ripert'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'mercredi' and s.heure_debut = '15:30'::time
       and s.venue_id = v.id);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'mercredi', '17:00'::time, '20:00'::time, v.id, 'Planning Ville de Villemomble : Spécifique Gardiens (Pompidou)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'Spécifique Gardiens'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Parc des Sports Georges Pompidou'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'mercredi' and s.heure_debut = '17:00'::time
       and s.venue_id = v.id);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'jeudi', '19:00'::time, '20:30'::time, v.id, 'Vestiaire R1-R2 · Planning Ville de Villemomble : U18F-U14D2 (Ripert)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'U14 D1'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Claude Ripert'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'jeudi' and s.heure_debut = '19:00'::time
       and s.venue_id = v.id);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'vendredi', '19:00'::time, '20:30'::time, v.id, 'Vestiaire 3-4 · Planning Ville de Villemomble : U16D1-U16D3 (Mimoun)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'U16 R3'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Alain Mimoun'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'vendredi' and s.heure_debut = '19:00'::time
       and s.venue_id = v.id);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'vendredi', '20:30'::time, '22:00'::time, v.id, 'Vestiaire 3-4 · Planning Ville de Villemomble : U18A-U18B (Mimoun)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'U18 R3'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Alain Mimoun'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'vendredi' and s.heure_debut = '20:30'::time
       and s.venue_id = v.id);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'vendredi', '20:30'::time, '22:00'::time, v.id, 'Vestiaire 3-4 · Planning Ville de Villemomble : U18A-U18B (Mimoun)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'U18 D2'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Alain Mimoun'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'vendredi' and s.heure_debut = '20:30'::time
       and s.venue_id = v.id);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'vendredi', '17:45'::time, '19:00'::time, v.id, 'Vestiaire 3-4 · Planning Ville de Villemomble : U12-U11F-U13F (Ripert)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'U12 F'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Claude Ripert'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'vendredi' and s.heure_debut = '17:45'::time
       and s.venue_id = v.id);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'vendredi', '17:45'::time, '19:00'::time, v.id, 'Vestiaire 3-4 · Planning Ville de Villemomble : U12-U11F-U13F (Ripert)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'U11 F'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Claude Ripert'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'vendredi' and s.heure_debut = '17:45'::time
       and s.venue_id = v.id);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select t.id, 'vendredi', '20:30'::time, '22:00'::time, v.id, 'Vestiaire 3 · Planning Ville de Villemomble : Séniors D1 (Ripert)'
  from public.club_teams t, public.club_venues v
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = 'Séniors D3'
   and v.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and v.nom = 'Stade Claude Ripert'
   and not exists (select 1 from public.club_team_training_slots s
     where s.team_id = t.id and s.jour = 'vendredi' and s.heure_debut = '20:30'::time
       and s.venue_id = v.id);
