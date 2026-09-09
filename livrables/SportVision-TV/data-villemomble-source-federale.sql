-- Source federale et equipes decouvertes pour SF Villemomble, saison 2026-2027.
--
-- Renseigne le socle pose le 04/09 (club_calendar_sources / club_team_source_mappings) plutot que
-- d'inventer une structure : c'est exactement ce pour quoi il a ete construit.
--
-- Les 14 equipes engagees sont enregistrees telles que la federation les nomme. Six d'entre elles
-- sont rattachees a une equipe SportVision et marquees `confirmed` : la correspondance est
-- univoque et verifiee (une seule equipe possible de chaque cote). Les huit autres restent
-- `suggested` avec team_id nul — le socle prevoit precisement ce cas : « on enregistre la
-- decouverte sans creer l'equipe en silence, la creation reste une action humaine confirmee ».
--
-- Pourquoi ces huit-la ne sont pas rattachees :
--   U14 2 et U14 3      jouent toutes deux en U14 D4 (poules E et C), le club n'a qu'une U14 D4
--   U14 1               joue en U15 D1 (surclassement), aucune equipe de ce nom en base
--   U16 1               joue en U16 D1, le club a U16 R3 et U16 D3
--   SENIORS 2           joue en Seniors D1, le club a Seniors D2 et D3
--   U18 FEMININES 2     joue en U18F D1, le club a une seule U18 F
--   U15 FEMININES 2     joue en U15F D1, le club a une seule U15 F
--   U18 FEMININES 1     n'a qu'un match de coupe, aucun championnat pour l'identifier

insert into public.club_calendar_sources
 (club_id, saison_id, provider, external_club_id, external_club_name, source_url,
  last_sync_at, sync_status, is_enabled)
values
 ('f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid, 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'::uuid, 'SPORTCORICO', 'villemomble-sports',
  'Villemomble Sports', 'https://api.sportcorico.com/api/clubs/villemomble-sports',
  now(), 'ok', true)
on conflict (club_id, saison_id, provider) do update set
  external_club_id = excluded.external_club_id,
  external_club_name = excluded.external_club_name,
  source_url = excluded.source_url,
  last_sync_at = now(),
  sync_status = 'ok',
  last_error = null;


insert into public.club_team_source_mappings
 (club_id, team_id, saison_id, provider, external_team_id, external_team_name,
  external_competition_name, confidence, status)
values ('f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid, (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Séniors R2'), 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'::uuid, 'SPORTCORICO',
 'villemomble-sports-1', 'SENIORS 1', 'Seniors R2', 1.00, 'confirmed')
on conflict (club_id, saison_id, provider, external_team_id, external_competition_id)
do update set
  external_team_name = excluded.external_team_name,
  external_competition_name = excluded.external_competition_name,
  -- Un rattachement deja confirme par un humain n'est jamais remis en cause par une synchro.
  team_id = coalesce(public.club_team_source_mappings.team_id, excluded.team_id),
  confidence = excluded.confidence;

insert into public.club_team_source_mappings
 (club_id, team_id, saison_id, provider, external_team_id, external_team_name,
  external_competition_name, confidence, status)
values ('f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid, null, 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'::uuid, 'SPORTCORICO',
 'villemomble-sports-6', 'SENIORS 2', 'Seniors D1', 0.00, 'suggested')
on conflict (club_id, saison_id, provider, external_team_id, external_competition_id)
do update set
  external_team_name = excluded.external_team_name,
  external_competition_name = excluded.external_competition_name,
  -- Un rattachement deja confirme par un humain n'est jamais remis en cause par une synchro.
  team_id = coalesce(public.club_team_source_mappings.team_id, excluded.team_id),
  confidence = excluded.confidence;

insert into public.club_team_source_mappings
 (club_id, team_id, saison_id, provider, external_team_id, external_team_name,
  external_competition_name, confidence, status)
values ('f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid, (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Séniors D2'), 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'::uuid, 'SPORTCORICO',
 'villemomble-sports-10', 'SENIORS 3', 'Seniors D2', 1.00, 'confirmed')
on conflict (club_id, saison_id, provider, external_team_id, external_competition_id)
do update set
  external_team_name = excluded.external_team_name,
  external_competition_name = excluded.external_competition_name,
  -- Un rattachement deja confirme par un humain n'est jamais remis en cause par une synchro.
  team_id = coalesce(public.club_team_source_mappings.team_id, excluded.team_id),
  confidence = excluded.confidence;

insert into public.club_team_source_mappings
 (club_id, team_id, saison_id, provider, external_team_id, external_team_name,
  external_competition_name, confidence, status)
values ('f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid, (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='Séniors Féminines'), 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'::uuid, 'SPORTCORICO',
 'villemomble-sports-67', 'SENIORS FÉMININES 1', 'Seniors Féminines', 1.00, 'confirmed')
on conflict (club_id, saison_id, provider, external_team_id, external_competition_id)
do update set
  external_team_name = excluded.external_team_name,
  external_competition_name = excluded.external_competition_name,
  -- Un rattachement deja confirme par un humain n'est jamais remis en cause par une synchro.
  team_id = coalesce(public.club_team_source_mappings.team_id, excluded.team_id),
  confidence = excluded.confidence;

insert into public.club_team_source_mappings
 (club_id, team_id, saison_id, provider, external_team_id, external_team_name,
  external_competition_name, confidence, status)
values ('f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid, null, 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'::uuid, 'SPORTCORICO',
 'villemomble-sports-58', 'U18 FÉMININES 1', 'COUPE NIKE FÉMININE U18', 0.00, 'suggested')
on conflict (club_id, saison_id, provider, external_team_id, external_competition_id)
do update set
  external_team_name = excluded.external_team_name,
  external_competition_name = excluded.external_competition_name,
  -- Un rattachement deja confirme par un humain n'est jamais remis en cause par une synchro.
  team_id = coalesce(public.club_team_source_mappings.team_id, excluded.team_id),
  confidence = excluded.confidence;

insert into public.club_team_source_mappings
 (club_id, team_id, saison_id, provider, external_team_id, external_team_name,
  external_competition_name, confidence, status)
values ('f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid, (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U18 R3'), 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'::uuid, 'SPORTCORICO',
 'villemomble-sports', 'U18 1', 'U18 R3', 1.00, 'confirmed')
on conflict (club_id, saison_id, provider, external_team_id, external_competition_id)
do update set
  external_team_name = excluded.external_team_name,
  external_competition_name = excluded.external_competition_name,
  -- Un rattachement deja confirme par un humain n'est jamais remis en cause par une synchro.
  team_id = coalesce(public.club_team_source_mappings.team_id, excluded.team_id),
  confidence = excluded.confidence;

insert into public.club_team_source_mappings
 (club_id, team_id, saison_id, provider, external_team_id, external_team_name,
  external_competition_name, confidence, status)
values ('f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid, (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U18 D2'), 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'::uuid, 'SPORTCORICO',
 'villemomble-sports-7', 'U18 2', 'U18 D2', 1.00, 'confirmed')
on conflict (club_id, saison_id, provider, external_team_id, external_competition_id)
do update set
  external_team_name = excluded.external_team_name,
  external_competition_name = excluded.external_competition_name,
  -- Un rattachement deja confirme par un humain n'est jamais remis en cause par une synchro.
  team_id = coalesce(public.club_team_source_mappings.team_id, excluded.team_id),
  confidence = excluded.confidence;

insert into public.club_team_source_mappings
 (club_id, team_id, saison_id, provider, external_team_id, external_team_name,
  external_competition_name, confidence, status)
values ('f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid, null, 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'::uuid, 'SPORTCORICO',
 'villemomble-sports-76', 'U18 FÉMININES 2', 'U18F D1', 0.00, 'suggested')
on conflict (club_id, saison_id, provider, external_team_id, external_competition_id)
do update set
  external_team_name = excluded.external_team_name,
  external_competition_name = excluded.external_competition_name,
  -- Un rattachement deja confirme par un humain n'est jamais remis en cause par une synchro.
  team_id = coalesce(public.club_team_source_mappings.team_id, excluded.team_id),
  confidence = excluded.confidence;

insert into public.club_team_source_mappings
 (club_id, team_id, saison_id, provider, external_team_id, external_team_name,
  external_competition_name, confidence, status)
values ('f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid, null, 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'::uuid, 'SPORTCORICO',
 'villemomble-sports-2', 'U16 1', 'U16 D1', 0.00, 'suggested')
on conflict (club_id, saison_id, provider, external_team_id, external_competition_id)
do update set
  external_team_name = excluded.external_team_name,
  external_competition_name = excluded.external_competition_name,
  -- Un rattachement deja confirme par un humain n'est jamais remis en cause par une synchro.
  team_id = coalesce(public.club_team_source_mappings.team_id, excluded.team_id),
  confidence = excluded.confidence;

insert into public.club_team_source_mappings
 (club_id, team_id, saison_id, provider, external_team_id, external_team_name,
  external_competition_name, confidence, status)
values ('f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid, (select id from public.club_teams where club_id='f0d3bafa-3004-4831-bd85-249aa9af5c54' and name='U16 D3'), 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'::uuid, 'SPORTCORICO',
 'villemomble-sports-8', 'U16 2', 'U16 D3', 1.00, 'confirmed')
on conflict (club_id, saison_id, provider, external_team_id, external_competition_id)
do update set
  external_team_name = excluded.external_team_name,
  external_competition_name = excluded.external_competition_name,
  -- Un rattachement deja confirme par un humain n'est jamais remis en cause par une synchro.
  team_id = coalesce(public.club_team_source_mappings.team_id, excluded.team_id),
  confidence = excluded.confidence;

insert into public.club_team_source_mappings
 (club_id, team_id, saison_id, provider, external_team_id, external_team_name,
  external_competition_name, confidence, status)
values ('f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid, null, 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'::uuid, 'SPORTCORICO',
 'villemomble-sports-72', 'U15 FÉMININES 2', 'U15F D1', 0.00, 'suggested')
on conflict (club_id, saison_id, provider, external_team_id, external_competition_id)
do update set
  external_team_name = excluded.external_team_name,
  external_competition_name = excluded.external_competition_name,
  -- Un rattachement deja confirme par un humain n'est jamais remis en cause par une synchro.
  team_id = coalesce(public.club_team_source_mappings.team_id, excluded.team_id),
  confidence = excluded.confidence;

insert into public.club_team_source_mappings
 (club_id, team_id, saison_id, provider, external_team_id, external_team_name,
  external_competition_name, confidence, status)
values ('f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid, null, 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'::uuid, 'SPORTCORICO',
 'villemomble-sports-3', 'U14 1', 'U15 D1', 0.00, 'suggested')
on conflict (club_id, saison_id, provider, external_team_id, external_competition_id)
do update set
  external_team_name = excluded.external_team_name,
  external_competition_name = excluded.external_competition_name,
  -- Un rattachement deja confirme par un humain n'est jamais remis en cause par une synchro.
  team_id = coalesce(public.club_team_source_mappings.team_id, excluded.team_id),
  confidence = excluded.confidence;

insert into public.club_team_source_mappings
 (club_id, team_id, saison_id, provider, external_team_id, external_team_name,
  external_competition_name, confidence, status)
values ('f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid, null, 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'::uuid, 'SPORTCORICO',
 'villemomble-sports-5', 'U14 2', 'U14 D4', 0.00, 'suggested')
on conflict (club_id, saison_id, provider, external_team_id, external_competition_id)
do update set
  external_team_name = excluded.external_team_name,
  external_competition_name = excluded.external_competition_name,
  -- Un rattachement deja confirme par un humain n'est jamais remis en cause par une synchro.
  team_id = coalesce(public.club_team_source_mappings.team_id, excluded.team_id),
  confidence = excluded.confidence;

insert into public.club_team_source_mappings
 (club_id, team_id, saison_id, provider, external_team_id, external_team_name,
  external_competition_name, confidence, status)
values ('f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid, null, 'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'::uuid, 'SPORTCORICO',
 'villemomble-sports-9', 'U14 3', 'U14 D4', 0.00, 'suggested')
on conflict (club_id, saison_id, provider, external_team_id, external_competition_id)
do update set
  external_team_name = excluded.external_team_name,
  external_competition_name = excluded.external_competition_name,
  -- Un rattachement deja confirme par un humain n'est jamais remis en cause par une synchro.
  team_id = coalesce(public.club_team_source_mappings.team_id, excluded.team_id),
  confidence = excluded.confidence;
