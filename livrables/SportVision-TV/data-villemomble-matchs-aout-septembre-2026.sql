-- Matchs SF Villemomble, aout et septembre 2026.
--
-- Source : « Planning de aout 2026 a Aout 2027 .xlsx » (Fouka, 09/09/2026), onglets « Aout 2026 »
-- et « Septembre 2026 » UNIQUEMENT. Les huit autres onglets portent encore les dates de la saison
-- passee (novembre-decembre 2025, janvier-mai 2026) et, sur mars/avril/mai, un adversaire
-- numerique dans 100 % des lignes : ils seront importes quand le club les aura remplis.
--
-- Lecture faite par le moteur de l'application (src/lib/calendar), avec le mapping de colonnes
-- FORCE : la detection automatique prenait la colonne COMPETITION pour l'equipe et attribuait
-- 27 matchs a une equipe nommee « Amical ».
--
-- `team` garde le libelle du planning tel quel. `team_id` n'est renseigne que lorsque la
-- correspondance avec une equipe du club est certaine : un libelle generique (« U14 », « U16 »,
-- « U11/12 ») reste sans rattachement plutot que d'etre attribue au hasard entre deux equipes.
-- Les traductions appliquees sont celles deja arbitrees pour les creneaux d'entrainement :
-- Seniors D1 -> Seniors D3, U16D1 -> U16 R3, U15D1 -> U15 D2, U14D2 -> U14 D1.
--
-- is_home est deduit du lieu (Villemomble, Mimoun, Ripert, Pompidou = domicile), et laisse a null
-- quand la source ne donne pas de lieu — jamais un « domicile » par defaut.
--
-- Idempotent : `on conflict do nothing` s'appuie sur club_matches_fallback_uniq
-- (club_id, team_id, lower(opponent), match_date, kickoff_time).
--
-- 72 matchs, dont 53 rattaches a une equipe et 19 laisses libres.
-- 7 lignes ecartees (legendes « EXTERIEUR / RIPERT / MIMOUN / POMPIDOU », lignes incompletes).

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Séniors R2',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Séniors R2'),
 'Meaux', '2026-08-12'::date, '20:15'::time, 'STADE CLAUDE RIPERT VILLEMOMBLE',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Séniors R2',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Séniors R2'),
 'Camon', '2026-08-16'::date, '15:00'::time, 'STADE ALAIN MIMOUN.                   VILLEMOMBLE',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Séniors R2',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Séniors R2'),
 'Courbevoie', '2026-08-22'::date, '15:00'::time, 'Courbevoie',
 'Amical', false, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U14',
 null,
 'Bondy', '2026-08-22'::date, '11:00'::time, 'Bondy',
 'Amical', false, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U18 R3',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U18 R3'),
 'FC Chartres', '2026-08-23'::date, '12:30'::time, 'Stade ALAIN MIMOUN           VILLEMOMBLE',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U16 D1',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U16 R3'),
 'CSL Aulnay', '2026-08-26'::date, '18:30'::time, 'Stade Vélodrome                                               Aulnay Sous Bois',
 'Amical', false, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U18 R3',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U18 R3'),
 'FC Montfermeil', '2026-08-26'::date, '20:00'::time, 'Stade Alain Mimoun.           VILLEMOMBLE',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U18 D2',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U18 D2'),
 'JA Drancy', '2026-08-26'::date, null::time, null,
 'Amical', null, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Séniors R2',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Séniors R2'),
 'Goussainville', '2026-08-26'::date, '20:30'::time, 'Stade Claude Ripert.               VILLEMOMBLE',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Séniors R2',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Séniors R2'),
 'Tremblay', '2026-08-29'::date, '15:00'::time, 'Tremblay',
 'Amical', false, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U14 B',
 null,
 'Val d''Europe', '2026-08-29'::date, '17:00'::time, 'Alain Mimoun',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U16 D1',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U16 R3'),
 'RC Joinville', '2026-08-30'::date, '11:30'::time, 'Stade Jean pierre Garchery
Joinville',
 'Amical', false, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U18 R3',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U18 R3'),
 'OL NOISY', '2026-08-30'::date, '12:30'::time, 'Stade Alain Mimoun           Villemomble',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U18 D2',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U18 D2'),
 'AS Bondy', '2026-08-30'::date, '14:30'::time, 'Stade Alain Mimoun             Villemomble',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Seniors D2',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Séniors D2'),
 'FC Nogent', '2026-08-30'::date, '16:30'::time, 'Stade Alain Mimoun             Villemomble',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U18 D2',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U18 D2'),
 'As Chelles', '2026-09-02'::date, '20:30'::time, 'Stade Claude Ripert            Villemomble',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U14',
 null,
 'RC joinville', '2026-09-05'::date, '14:00'::time, 'Stade Claude Ripert Villemomble',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U11/12',
 null,
 'Interne', '2026-09-05'::date, '10:00'::time, 'Stade Alain Mimoun',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U15',
 null,
 'CO Vincennes', '2026-09-05'::date, '13:00'::time, 'Stade Alain Mimoun',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U16',
 null,
 'CO Vincennes', '2026-09-05'::date, '15:00'::time, 'Stade Alain Mimoun',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U9',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U9'),
 'Pontault Combault', '2026-09-05'::date, '10:00'::time, 'Stade Claude Ripert Villemomble',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U10',
 null,
 'Bussy FC', '2026-09-05'::date, '11:00'::time, 'Stade Claude Ripert Villemomble',
 'Amical / Deux équipes', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U14C',
 null,
 'Pontau combault', '2026-09-05'::date, '11:00'::time, 'Stade Alain Mimoun',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U14B',
 null,
 'Mitry Mory', '2026-09-05'::date, '13:00'::time, 'Extérieur',
 'Amical', false, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U11A VS U11B',
 null,
 'Interne', '2026-09-05'::date, '10:00'::time, 'Stade Alain Mimoun',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U12',
 null,
 'My Elevent', '2026-09-06'::date, '10:00'::time, 'Stade Claude Ripert Villemomble',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U18 R3',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U18 R3'),
 'Us Nogent', '2026-09-06'::date, '12:30'::time, 'Stade Alain mimoun Villemomble',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U18 D2',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U18 D2'),
 'FC Montfermeil', '2026-09-06'::date, null::time, null,
 'Amical', null, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Séniors R2',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Séniors R2'),
 'St Geneviève', '2026-09-06'::date, '15:30'::time, 'Stade léo lagrange                   St Geneviève des Bois',
 'Championnat', false, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Séniors D2',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Séniors D2'),
 'Rosny', '2026-09-06'::date, '15:00'::time, 'Stade Alain mimoun Villemomble',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Super Vétérans',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Super Vétérans'),
 'Paris 19ème', '2026-09-06'::date, '09:30'::time, 'Stade Alain Mimoun Villemomble',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U16D1',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U16 R3'),
 'Le Raincy', '2026-09-08'::date, null::time, null,
 'Amical', null, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U18 D2',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U18 D2'),
 'Csl Aulnay', '2026-09-09'::date, null::time, null,
 'Amical', null, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U10',
 null,
 'My Events', '2026-09-12'::date, '09:30'::time, 'Stade Claude Ripert Villemomble',
 'Tournoi', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U14',
 null,
 'CS Meaux', '2026-09-12'::date, '14:00'::time, 'Stade Alain Mimoun Villemomble',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U14',
 null,
 'Gonesse', '2026-09-12'::date, '12:00'::time, 'Stade Alain Mimoun Villemomble',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U15F',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U15 F'),
 'FC Sevran', '2026-09-12'::date, null::time, null,
 'Amical', null, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U11',
 null,
 'My Events', '2026-09-13'::date, '09:30'::time, 'Stade Claude Ripert Villemomble',
 'Tournoi', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Seniors R2',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Séniors R2'),
 'CO Vincennes', '2026-09-13'::date, '13:30'::time, 'Stade Alain mimoun Villemomble',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U18 R3',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U18 R3'),
 'FC Bussy', '2026-09-13'::date, '14:00'::time, 'Stade mauric Herzog Bussy Saint Georges',
 'Championnat', false, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U18 D2',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U18 D2'),
 'Villepinte', '2026-09-13'::date, '11:00'::time, 'Villepinte',
 'Amical', false, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Séniors D1',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Séniors D3'),
 'LAGNY', '2026-09-13'::date, '17:30'::time, 'Stade Alain mimoun Villemomble',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Séniors D2',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Séniors D2'),
 'Sevran', '2026-09-13'::date, '15:00'::time, null,
 'Amical', null, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Anciens D1',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Anciens D1'),
 '318', '2026-09-13'::date, null::time, null,
 'Amical', null, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U16',
 null,
 'Montferrmeil', '2026-09-16'::date, '19:00'::time, 'Stade Alain Mimoun Villemomble',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U8',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U8'),
 'My Events', '2026-09-19'::date, '09:30'::time, 'Stade Claude Ripert Villemomble',
 'Tournoi', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U10',
 null,
 'Rc joinville', '2026-09-19'::date, '10:00'::time, 'Stade  Claude Ripert Villemomble',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U14 D2',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U14 D1'),
 'FC Aulnay', '2026-09-19'::date, '16:30'::time, 'Stade Belval                          Aulnay Sous Bois',
 'Championnat', false, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U14 D4',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U14 D4'),
 'CSL Aunlay', '2026-09-19'::date, '16:00'::time, 'Stade vélodrome Aulnay-Sou-Bois',
 'Championnat', false, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U15D1',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U15 D2'),
 'FCM Auber', '2026-09-19'::date, '16:30'::time, 'Stade Alain Mimoun Villemomble',
 'Championnat', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U18F',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U18 F'),
 'ES Paris XIII', '2026-09-19'::date, '15:00'::time, null,
 null, null, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Séniors F',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Séniors Féminines'),
 'JS Suresnes', '2026-09-19'::date, '18:00'::time, null,
 null, null, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U12',
 null,
 'My Events', '2026-09-20'::date, '09:30'::time, 'Stade Claude Ripert Villemomble',
 'Amical', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U16D1',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U16 R3'),
 'JA drancy', '2026-09-20'::date, '11:00'::time, null,
 'Championnat', null, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U18 R3',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U18 R3'),
 'RC Argenteuil', '2026-09-20'::date, '13:00'::time, 'Stade Claude Ripert Villemomble',
 'Championnat', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U18D2',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U18 D2'),
 'FC Coubron', '2026-09-20'::date, '15:00'::time, 'Stade Claude Ripert Villemomble',
 'Championnat', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Séniors R2',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Séniors R2'),
 'FC Rueil Malmaison', '2026-09-20'::date, '15:30'::time, 'Stade Claude Ripert Villemomble',
 'Championnat', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Séniors D1',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Séniors D3'),
 'Etoile Bobigny', '2026-09-20'::date, '15:30'::time, null,
 'Championnat', null, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Séniors D2',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Séniors D2'),
 'Paris International', '2026-09-20'::date, '15:00'::time, null,
 'Championnat', null, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Anciens D1',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Anciens D1'),
 'Stade de l''est', '2026-09-20'::date, '09:45'::time, 'Stade Claude Ripert Villemomble',
 null, true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Super Vétérans',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Super Vétérans'),
 'AC Epinay', '2026-09-20'::date, '09:45'::time, 'Stade Claude Ripert Villemomble',
 'Championnat', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U10',
 null,
 'Ass sarcelles', '2026-09-26'::date, '10:00'::time, 'Nelson Mandela',
 'Amical', false, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U14 D2',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U14 D1'),
 'OPB', '2026-09-26'::date, '16:30'::time, 'Stade Claude Ripert Villemomble',
 'Championnat', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U14 D4',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U14 D4'),
 'CS Villetaneuse', '2026-09-26'::date, '14:30'::time, 'Stade Claude Ripert Villemomble',
 'Championnat', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U14 D4',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U14 D4'),
 'Sevran Fc', '2026-09-26'::date, '13:00'::time, null,
 'Championnat', null, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U15 D1',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U15 D2'),
 'CSl Aulnay', '2026-09-26'::date, '14:00'::time, 'Stade vélodrome               Aulnay Sous Bois',
 'Championnat', false, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'U18F',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U18 F'),
 'BFC', '2026-09-26'::date, '16:00'::time, 'Stade des Rigondes                      Bagnolet',
 null, false, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Séniors F',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Séniors Féminines'),
 'Pierrefitte FC', '2026-09-26'::date, '19:30'::time, 'Complexe Roger Freville Pierrefitte',
 'Championnat', false, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Séniors D1',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Séniors D3'),
 'AC Epinay', '2026-09-27'::date, '15:30'::time, 'Stade Alain Mimoun Villemomble',
 'Championnat', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Séniors D2',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Séniors D2'),
 'Saint Denis', '2026-09-27'::date, '15:00'::time, 'Stade Alain Mimoun Villemomble',
 'Championnat', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Anciens D1',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Anciens D1'),
 'FC Tremblay', '2026-09-27'::date, '10:00'::time, 'Parc des sports                             Tremblay',
 null, false, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;

insert into public.club_matches
 (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition, is_home, provider, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54', 'Super Vétérans',
 (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Super Vétérans'),
 'BFC', '2026-09-27'::date, '09:45'::time, 'Stade Claude Ripert Villemomble',
 'Championnat', true, 'OTHER', 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'
on conflict do nothing;
