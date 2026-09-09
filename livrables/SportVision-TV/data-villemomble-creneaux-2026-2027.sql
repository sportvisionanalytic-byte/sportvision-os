-- Creneaux d'entrainement SF Villemomble, saison 2026-2027.
--
-- ATTENTION, NE PAS REJOUER CE FICHIER SEUL.
-- Il porte la premiere correspondance U12 (U12A -> U12 ELITE), corrigee depuis : le lot 4
-- (data-villemomble-creneaux-2026-2027-lot4-u12.sql) fait foi et place U12A sur U12 REG.
-- Rejouer ce fichier recreerait les creneaux U12 a l'ancienne adresse, et un nouveau passage du
-- lot 4 les deplacerait par-dessus ceux qui existent deja, donc en double. L'etat correct est
-- celui qui est en base ; ce fichier ne vaut plus que comme trace du raisonnement.
--
-- Source : le planning papier du Service des Sports de la Ville de Villemomble, photographie
-- et transmis par Fouka le 09/09/2026 (transcription figee dans
-- context/import/villemomble/planning-entrainements-2026-2027.json).
--
-- Le planning municipal designe les equipes par une lettre de niveau (U10A, U10B...) la ou le
-- club les nomme ELITE / ESPOIR 1 / ESPOIR 2 / Avenir. La correspondance A=ELITE, B=ESPOIR 1,
-- C=ESPOIR 2, D=Avenir a ete donnee par Fouka le 09/09/2026, elle n'est pas deduite.
--
-- Les codes que le planning cite et que le club n'a pas en equipe (U14D2, U15D1, U16D1, U18D1,
-- U18A, U18B, Seniors D1, U11F, U12D) sont DELIBEREMENT absents de ce script : les inventer
-- rattacherait de vrais creneaux a de fausses equipes. Ils attendent un arbitrage.
--
-- active_from / active_to restent nuls : les bornes 01/07/2026-30/06/2027 sont celles de la
-- saison, pas celles des entrainements, et Fouka a demande de ne pas confondre les deux.
--
-- Idempotent : chaque insertion est gardee par un not exists sur (equipe, jour, heure_debut).


insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '2c27f083-8d6d-40b9-8a41-82907355fe8f'::uuid, 'lundi', '17:30'::time, '19:00'::time, '11b9b2b1-17f0-4534-ac42-f8ca7cb07d76'::uuid, 'Vestiaire 2-1 · Planning Ville de Villemomble : U10B-U10A-U11A-U12A (Mimoun)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '2c27f083-8d6d-40b9-8a41-82907355fe8f'::uuid and s.jour = 'lundi' and s.heure_debut = '17:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '3da51a71-5412-4c51-ac6c-ca860f29ad4b'::uuid, 'lundi', '17:30'::time, '19:00'::time, '11b9b2b1-17f0-4534-ac42-f8ca7cb07d76'::uuid, 'Vestiaire 2-1 · Planning Ville de Villemomble : U10B-U10A-U11A-U12A (Mimoun)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '3da51a71-5412-4c51-ac6c-ca860f29ad4b'::uuid and s.jour = 'lundi' and s.heure_debut = '17:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select 'bf2aa817-f4b3-4137-9ee0-22f572dcf34d'::uuid, 'lundi', '17:30'::time, '19:00'::time, '11b9b2b1-17f0-4534-ac42-f8ca7cb07d76'::uuid, 'Vestiaire 2-1 · Planning Ville de Villemomble : U10B-U10A-U11A-U12A (Mimoun)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = 'bf2aa817-f4b3-4137-9ee0-22f572dcf34d'::uuid and s.jour = 'lundi' and s.heure_debut = '17:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '7a63c8ca-7a59-46d8-84ae-958fcd047fd1'::uuid, 'lundi', '17:30'::time, '19:00'::time, '11b9b2b1-17f0-4534-ac42-f8ca7cb07d76'::uuid, 'Vestiaire 2-1 · Planning Ville de Villemomble : U10B-U10A-U11A-U12A (Mimoun)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '7a63c8ca-7a59-46d8-84ae-958fcd047fd1'::uuid and s.jour = 'lundi' and s.heure_debut = '17:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '624b33c3-684f-4f81-a7e2-51696eaef823'::uuid, 'lundi', '19:00'::time, '20:30'::time, '11b9b2b1-17f0-4534-ac42-f8ca7cb07d76'::uuid, 'Vestiaire 3-4 · Planning Ville de Villemomble : U14D4-U14D4 (Mimoun)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '624b33c3-684f-4f81-a7e2-51696eaef823'::uuid and s.jour = 'lundi' and s.heure_debut = '19:00'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '962da624-5167-4d81-9b1b-f95336599c53'::uuid, 'lundi', '17:30'::time, '19:00'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire R1-R2 · Planning Ville de Villemomble : U10C-U10D-U11C-U11D (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '962da624-5167-4d81-9b1b-f95336599c53'::uuid and s.jour = 'lundi' and s.heure_debut = '17:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select 'cd1b93f4-9afe-421e-968f-4fe8bc3c5e9c'::uuid, 'lundi', '17:30'::time, '19:00'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire R1-R2 · Planning Ville de Villemomble : U10C-U10D-U11C-U11D (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = 'cd1b93f4-9afe-421e-968f-4fe8bc3c5e9c'::uuid and s.jour = 'lundi' and s.heure_debut = '17:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select 'df0aa84c-f43d-43c4-91c8-898bb812e0ab'::uuid, 'lundi', '17:30'::time, '19:00'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire R1-R2 · Planning Ville de Villemomble : U10C-U10D-U11C-U11D (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = 'df0aa84c-f43d-43c4-91c8-898bb812e0ab'::uuid and s.jour = 'lundi' and s.heure_debut = '17:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select 'd84b6da3-c1e8-4388-86ba-4c27a1bbe20a'::uuid, 'lundi', '17:30'::time, '19:00'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire R1-R2 · Planning Ville de Villemomble : U10C-U10D-U11C-U11D (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = 'd84b6da3-c1e8-4388-86ba-4c27a1bbe20a'::uuid and s.jour = 'lundi' and s.heure_debut = '17:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select 'af23f49a-4b90-44b6-82af-0f829e89c947'::uuid, 'lundi', '20:30'::time, '22:15'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire R1-R2 · Planning Ville de Villemomble : Séniors F-U18R3 (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = 'af23f49a-4b90-44b6-82af-0f829e89c947'::uuid and s.jour = 'lundi' and s.heure_debut = '20:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '91e347ff-2393-4c48-95a1-833c44d51fb4'::uuid, 'lundi', '20:30'::time, '22:15'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire R1-R2 · Planning Ville de Villemomble : Séniors F-U18R3 (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '91e347ff-2393-4c48-95a1-833c44d51fb4'::uuid and s.jour = 'lundi' and s.heure_debut = '20:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '3c22910f-c21e-4353-acef-294d42e24057'::uuid, 'mardi', '17:30'::time, '19:00'::time, '11b9b2b1-17f0-4534-ac42-f8ca7cb07d76'::uuid, 'Vestiaire 1-2 · Planning Ville de Villemomble : U8A-U8B-U9A-U9B (Mimoun)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '3c22910f-c21e-4353-acef-294d42e24057'::uuid and s.jour = 'mardi' and s.heure_debut = '17:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select 'a8455145-a8fc-4c99-80d7-e5d595b393b0'::uuid, 'mardi', '17:30'::time, '19:00'::time, '11b9b2b1-17f0-4534-ac42-f8ca7cb07d76'::uuid, 'Vestiaire 1-2 · Planning Ville de Villemomble : U8A-U8B-U9A-U9B (Mimoun)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = 'a8455145-a8fc-4c99-80d7-e5d595b393b0'::uuid and s.jour = 'mardi' and s.heure_debut = '17:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '1dc5aff3-2c62-4538-bbaa-bc72b185c763'::uuid, 'mardi', '19:00'::time, '20:30'::time, '11b9b2b1-17f0-4534-ac42-f8ca7cb07d76'::uuid, 'Vestiaire 3-4 · Planning Ville de Villemomble : U16D3-U15D1 (Mimoun)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '1dc5aff3-2c62-4538-bbaa-bc72b185c763'::uuid and s.jour = 'mardi' and s.heure_debut = '19:00'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '75d72a9d-d39d-4cda-970a-cb812e58f3b5'::uuid, 'mardi', '20:30'::time, '22:15'::time, '11b9b2b1-17f0-4534-ac42-f8ca7cb07d76'::uuid, 'Vestiaire 2-1 · Planning Ville de Villemomble : Séniors D1-Séniors D2 (Mimoun)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '75d72a9d-d39d-4cda-970a-cb812e58f3b5'::uuid and s.jour = 'mardi' and s.heure_debut = '20:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '3c22910f-c21e-4353-acef-294d42e24057'::uuid, 'mardi', '17:30'::time, '19:00'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire 4 · Planning Ville de Villemomble : U8-U9 (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '3c22910f-c21e-4353-acef-294d42e24057'::uuid and s.jour = 'mardi' and s.heure_debut = '17:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select 'a8455145-a8fc-4c99-80d7-e5d595b393b0'::uuid, 'mardi', '17:30'::time, '19:00'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire 4 · Planning Ville de Villemomble : U8-U9 (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = 'a8455145-a8fc-4c99-80d7-e5d595b393b0'::uuid and s.jour = 'mardi' and s.heure_debut = '17:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '940e1708-95e7-4fd1-95cb-0d7e0fc5778e'::uuid, 'mardi', '19:00'::time, '20:30'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire R1-R2 · Planning Ville de Villemomble : U18F-U14D2 (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '940e1708-95e7-4fd1-95cb-0d7e0fc5778e'::uuid and s.jour = 'mardi' and s.heure_debut = '19:00'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '434d8081-f467-46c8-aa50-e2bc6b5d30ed'::uuid, 'mardi', '20:30'::time, '22:15'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire 4 · Planning Ville de Villemomble : Séniors R2 (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '434d8081-f467-46c8-aa50-e2bc6b5d30ed'::uuid and s.jour = 'mardi' and s.heure_debut = '20:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '4a9ca417-be4d-4fc2-9f06-849eb1e7948f'::uuid, 'mardi', '18:00'::time, '19:00'::time, '3a33119e-9df0-43eb-ab5f-1e505c3e044f'::uuid, 'Planning Ville de Villemomble : U6-U7 (Pompidou)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '4a9ca417-be4d-4fc2-9f06-849eb1e7948f'::uuid and s.jour = 'mardi' and s.heure_debut = '18:00'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select 'f31f3391-85e0-481e-9d73-7441cf4a6534'::uuid, 'mardi', '18:00'::time, '19:00'::time, '3a33119e-9df0-43eb-ab5f-1e505c3e044f'::uuid, 'Planning Ville de Villemomble : U6-U7 (Pompidou)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = 'f31f3391-85e0-481e-9d73-7441cf4a6534'::uuid and s.jour = 'mardi' and s.heure_debut = '18:00'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '434d8081-f467-46c8-aa50-e2bc6b5d30ed'::uuid, 'mardi', '20:00'::time, '22:00'::time, '3a33119e-9df0-43eb-ab5f-1e505c3e044f'::uuid, 'Vestiaire 4 · Planning Ville de Villemomble : Séniors R2 (Pompidou)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '434d8081-f467-46c8-aa50-e2bc6b5d30ed'::uuid and s.jour = 'mardi' and s.heure_debut = '20:00'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '2c27f083-8d6d-40b9-8a41-82907355fe8f'::uuid, 'mercredi', '13:45'::time, '15:15'::time, '11b9b2b1-17f0-4534-ac42-f8ca7cb07d76'::uuid, 'Vestiaire 3-4 · Planning Ville de Villemomble : U10B-U10C-U10D (Mimoun)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '2c27f083-8d6d-40b9-8a41-82907355fe8f'::uuid and s.jour = 'mercredi' and s.heure_debut = '13:45'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '962da624-5167-4d81-9b1b-f95336599c53'::uuid, 'mercredi', '13:45'::time, '15:15'::time, '11b9b2b1-17f0-4534-ac42-f8ca7cb07d76'::uuid, 'Vestiaire 3-4 · Planning Ville de Villemomble : U10B-U10C-U10D (Mimoun)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '962da624-5167-4d81-9b1b-f95336599c53'::uuid and s.jour = 'mercredi' and s.heure_debut = '13:45'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select 'cd1b93f4-9afe-421e-968f-4fe8bc3c5e9c'::uuid, 'mercredi', '13:45'::time, '15:15'::time, '11b9b2b1-17f0-4534-ac42-f8ca7cb07d76'::uuid, 'Vestiaire 3-4 · Planning Ville de Villemomble : U10B-U10C-U10D (Mimoun)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = 'cd1b93f4-9afe-421e-968f-4fe8bc3c5e9c'::uuid and s.jour = 'mercredi' and s.heure_debut = '13:45'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '836ea257-5913-4d87-a57f-3a2fae18382b'::uuid, 'mercredi', '15:30'::time, '17:00'::time, '11b9b2b1-17f0-4534-ac42-f8ca7cb07d76'::uuid, 'Vestiaire 1-2 · Planning Ville de Villemomble : U13-U12B-U12C-U12D (Mimoun)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '836ea257-5913-4d87-a57f-3a2fae18382b'::uuid and s.jour = 'mercredi' and s.heure_debut = '15:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select 'df4222e4-1b63-488b-a5e7-9b4470b4fb70'::uuid, 'mercredi', '15:30'::time, '17:00'::time, '11b9b2b1-17f0-4534-ac42-f8ca7cb07d76'::uuid, 'Vestiaire 1-2 · Planning Ville de Villemomble : U13-U12B-U12C-U12D (Mimoun)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = 'df4222e4-1b63-488b-a5e7-9b4470b4fb70'::uuid and s.jour = 'mercredi' and s.heure_debut = '15:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '984d72c0-6818-461f-8734-ea4a5c340d5c'::uuid, 'mercredi', '15:30'::time, '17:00'::time, '11b9b2b1-17f0-4534-ac42-f8ca7cb07d76'::uuid, 'Vestiaire 1-2 · Planning Ville de Villemomble : U13-U12B-U12C-U12D (Mimoun)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '984d72c0-6818-461f-8734-ea4a5c340d5c'::uuid and s.jour = 'mercredi' and s.heure_debut = '15:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select 'cac70ad1-6f1e-42bb-9c72-95cedff8c74b'::uuid, 'mercredi', '13:45'::time, '15:30'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire V3 · Planning Ville de Villemomble : U11B-U11C-U11D (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = 'cac70ad1-6f1e-42bb-9c72-95cedff8c74b'::uuid and s.jour = 'mercredi' and s.heure_debut = '13:45'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select 'df0aa84c-f43d-43c4-91c8-898bb812e0ab'::uuid, 'mercredi', '13:45'::time, '15:30'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire V3 · Planning Ville de Villemomble : U11B-U11C-U11D (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = 'df0aa84c-f43d-43c4-91c8-898bb812e0ab'::uuid and s.jour = 'mercredi' and s.heure_debut = '13:45'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select 'd84b6da3-c1e8-4388-86ba-4c27a1bbe20a'::uuid, 'mercredi', '13:45'::time, '15:30'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire V3 · Planning Ville de Villemomble : U11B-U11C-U11D (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = 'd84b6da3-c1e8-4388-86ba-4c27a1bbe20a'::uuid and s.jour = 'mercredi' and s.heure_debut = '13:45'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '3c22910f-c21e-4353-acef-294d42e24057'::uuid, 'mercredi', '15:30'::time, '17:15'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire R1-R2 · Planning Ville de Villemomble : U8-U9-U11F (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '3c22910f-c21e-4353-acef-294d42e24057'::uuid and s.jour = 'mercredi' and s.heure_debut = '15:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select 'a8455145-a8fc-4c99-80d7-e5d595b393b0'::uuid, 'mercredi', '15:30'::time, '17:15'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire R1-R2 · Planning Ville de Villemomble : U8-U9-U11F (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = 'a8455145-a8fc-4c99-80d7-e5d595b393b0'::uuid and s.jour = 'mercredi' and s.heure_debut = '15:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '3da51a71-5412-4c51-ac6c-ca860f29ad4b'::uuid, 'mercredi', '17:30'::time, '19:00'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire V3-V4 · Planning Ville de Villemomble : U10A-U11A-U12A (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '3da51a71-5412-4c51-ac6c-ca860f29ad4b'::uuid and s.jour = 'mercredi' and s.heure_debut = '17:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select 'bf2aa817-f4b3-4137-9ee0-22f572dcf34d'::uuid, 'mercredi', '17:30'::time, '19:00'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire V3-V4 · Planning Ville de Villemomble : U10A-U11A-U12A (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = 'bf2aa817-f4b3-4137-9ee0-22f572dcf34d'::uuid and s.jour = 'mercredi' and s.heure_debut = '17:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '7a63c8ca-7a59-46d8-84ae-958fcd047fd1'::uuid, 'mercredi', '17:30'::time, '19:00'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire V3-V4 · Planning Ville de Villemomble : U10A-U11A-U12A (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '7a63c8ca-7a59-46d8-84ae-958fcd047fd1'::uuid and s.jour = 'mercredi' and s.heure_debut = '17:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select 'b061a73d-650f-4a10-a8e7-35ce7bca8fa6'::uuid, 'mercredi', '19:00'::time, '20:30'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire R1-R2 · Planning Ville de Villemomble : U15F-U13F (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = 'b061a73d-650f-4a10-a8e7-35ce7bca8fa6'::uuid and s.jour = 'mercredi' and s.heure_debut = '19:00'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '5ff9913a-d820-4e00-96a4-62402b53ce04'::uuid, 'mercredi', '19:00'::time, '20:30'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire R1-R2 · Planning Ville de Villemomble : U15F-U13F (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '5ff9913a-d820-4e00-96a4-62402b53ce04'::uuid and s.jour = 'mercredi' and s.heure_debut = '19:00'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select 'af23f49a-4b90-44b6-82af-0f829e89c947'::uuid, 'mercredi', '20:30'::time, '22:15'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire R1-R2 · Planning Ville de Villemomble : Séniors F-U18R3 (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = 'af23f49a-4b90-44b6-82af-0f829e89c947'::uuid and s.jour = 'mercredi' and s.heure_debut = '20:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '91e347ff-2393-4c48-95a1-833c44d51fb4'::uuid, 'mercredi', '20:30'::time, '22:15'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire R1-R2 · Planning Ville de Villemomble : Séniors F-U18R3 (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '91e347ff-2393-4c48-95a1-833c44d51fb4'::uuid and s.jour = 'mercredi' and s.heure_debut = '20:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '434d8081-f467-46c8-aa50-e2bc6b5d30ed'::uuid, 'mercredi', '20:00'::time, '22:00'::time, '3a33119e-9df0-43eb-ab5f-1e505c3e044f'::uuid, 'Vestiaire 4 · Planning Ville de Villemomble : Séniors R2 (Pompidou)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '434d8081-f467-46c8-aa50-e2bc6b5d30ed'::uuid and s.jour = 'mercredi' and s.heure_debut = '20:00'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '3c22910f-c21e-4353-acef-294d42e24057'::uuid, 'jeudi', '17:30'::time, '19:00'::time, '11b9b2b1-17f0-4534-ac42-f8ca7cb07d76'::uuid, 'Vestiaire 1-2 · Planning Ville de Villemomble : U8A-U8B (Mimoun)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '3c22910f-c21e-4353-acef-294d42e24057'::uuid and s.jour = 'jeudi' and s.heure_debut = '17:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '624b33c3-684f-4f81-a7e2-51696eaef823'::uuid, 'jeudi', '19:00'::time, '20:30'::time, '11b9b2b1-17f0-4534-ac42-f8ca7cb07d76'::uuid, 'Vestiaire 3-4 · Planning Ville de Villemomble : U14D4-D4 (Mimoun)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '624b33c3-684f-4f81-a7e2-51696eaef823'::uuid and s.jour = 'jeudi' and s.heure_debut = '19:00'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '75d72a9d-d39d-4cda-970a-cb812e58f3b5'::uuid, 'jeudi', '20:30'::time, '22:15'::time, '11b9b2b1-17f0-4534-ac42-f8ca7cb07d76'::uuid, 'Vestiaire 2-1 · Planning Ville de Villemomble : Séniors D2 (Mimoun)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '75d72a9d-d39d-4cda-970a-cb812e58f3b5'::uuid and s.jour = 'jeudi' and s.heure_debut = '20:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '4a9ca417-be4d-4fc2-9f06-849eb1e7948f'::uuid, 'jeudi', '17:30'::time, '19:00'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire 3 · Planning Ville de Villemomble : Babyfoot-U6-U7 (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '4a9ca417-be4d-4fc2-9f06-849eb1e7948f'::uuid and s.jour = 'jeudi' and s.heure_debut = '17:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select 'f31f3391-85e0-481e-9d73-7441cf4a6534'::uuid, 'jeudi', '17:30'::time, '19:00'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire 3 · Planning Ville de Villemomble : Babyfoot-U6-U7 (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = 'f31f3391-85e0-481e-9d73-7441cf4a6534'::uuid and s.jour = 'jeudi' and s.heure_debut = '17:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '940e1708-95e7-4fd1-95cb-0d7e0fc5778e'::uuid, 'jeudi', '19:00'::time, '20:30'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire R1-R2 · Planning Ville de Villemomble : U18F-U14D2 (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '940e1708-95e7-4fd1-95cb-0d7e0fc5778e'::uuid and s.jour = 'jeudi' and s.heure_debut = '19:00'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select 'af23f49a-4b90-44b6-82af-0f829e89c947'::uuid, 'jeudi', '20:30'::time, '22:00'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire 3-4 · Planning Ville de Villemomble : Vétérans-Séniors F (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = 'af23f49a-4b90-44b6-82af-0f829e89c947'::uuid and s.jour = 'jeudi' and s.heure_debut = '20:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '3da51a71-5412-4c51-ac6c-ca860f29ad4b'::uuid, 'vendredi', '17:30'::time, '19:00'::time, '11b9b2b1-17f0-4534-ac42-f8ca7cb07d76'::uuid, 'Vestiaire 1-2 · Planning Ville de Villemomble : U10A-U11A-U12A-U13 (Mimoun)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '3da51a71-5412-4c51-ac6c-ca860f29ad4b'::uuid and s.jour = 'vendredi' and s.heure_debut = '17:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select 'bf2aa817-f4b3-4137-9ee0-22f572dcf34d'::uuid, 'vendredi', '17:30'::time, '19:00'::time, '11b9b2b1-17f0-4534-ac42-f8ca7cb07d76'::uuid, 'Vestiaire 1-2 · Planning Ville de Villemomble : U10A-U11A-U12A-U13 (Mimoun)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = 'bf2aa817-f4b3-4137-9ee0-22f572dcf34d'::uuid and s.jour = 'vendredi' and s.heure_debut = '17:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '7a63c8ca-7a59-46d8-84ae-958fcd047fd1'::uuid, 'vendredi', '17:30'::time, '19:00'::time, '11b9b2b1-17f0-4534-ac42-f8ca7cb07d76'::uuid, 'Vestiaire 1-2 · Planning Ville de Villemomble : U10A-U11A-U12A-U13 (Mimoun)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '7a63c8ca-7a59-46d8-84ae-958fcd047fd1'::uuid and s.jour = 'vendredi' and s.heure_debut = '17:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '836ea257-5913-4d87-a57f-3a2fae18382b'::uuid, 'vendredi', '17:30'::time, '19:00'::time, '11b9b2b1-17f0-4534-ac42-f8ca7cb07d76'::uuid, 'Vestiaire 1-2 · Planning Ville de Villemomble : U10A-U11A-U12A-U13 (Mimoun)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '836ea257-5913-4d87-a57f-3a2fae18382b'::uuid and s.jour = 'vendredi' and s.heure_debut = '17:30'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '1dc5aff3-2c62-4538-bbaa-bc72b185c763'::uuid, 'vendredi', '19:00'::time, '20:30'::time, '11b9b2b1-17f0-4534-ac42-f8ca7cb07d76'::uuid, 'Vestiaire 3-4 · Planning Ville de Villemomble : U16D1-U16D3 (Mimoun)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '1dc5aff3-2c62-4538-bbaa-bc72b185c763'::uuid and s.jour = 'vendredi' and s.heure_debut = '19:00'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '5ff9913a-d820-4e00-96a4-62402b53ce04'::uuid, 'vendredi', '17:45'::time, '19:00'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire 3-4 · Planning Ville de Villemomble : U12-U11F-U13F (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '5ff9913a-d820-4e00-96a4-62402b53ce04'::uuid and s.jour = 'vendredi' and s.heure_debut = '17:45'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select 'b061a73d-650f-4a10-a8e7-35ce7bca8fa6'::uuid, 'vendredi', '19:00'::time, '20:30'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire R1-R2 · Planning Ville de Villemomble : U15F-U18F (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = 'b061a73d-650f-4a10-a8e7-35ce7bca8fa6'::uuid and s.jour = 'vendredi' and s.heure_debut = '19:00'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '940e1708-95e7-4fd1-95cb-0d7e0fc5778e'::uuid, 'vendredi', '19:00'::time, '20:30'::time, 'b29c6413-75d6-4d01-a130-dd671033f841'::uuid, 'Vestiaire R1-R2 · Planning Ville de Villemomble : U15F-U18F (Ripert)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '940e1708-95e7-4fd1-95cb-0d7e0fc5778e'::uuid and s.jour = 'vendredi' and s.heure_debut = '19:00'::time);

insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select '434d8081-f467-46c8-aa50-e2bc6b5d30ed'::uuid, 'vendredi', '20:00'::time, '22:00'::time, '3a33119e-9df0-43eb-ab5f-1e505c3e044f'::uuid, 'Vestiaire 4 · Planning Ville de Villemomble : Séniors R2 (Pompidou)'
where not exists (select 1 from public.club_team_training_slots s
  where s.team_id = '434d8081-f467-46c8-aa50-e2bc6b5d30ed'::uuid and s.jour = 'vendredi' and s.heure_debut = '20:00'::time);
