-- Événement canonique, suite (04/09/2026, audit transversal) — section 21 du prompt : "content.
-- event_id, planned_presence.event_id, mission.event_id... doivent pointer vers le même événement
-- canonique". contenus a déjà les deux FK (match_id + calendar_event_id, migration-contenus-
-- match-event-link.sql) ; planned_presences et prestations n'avaient que match_id (migration-
-- planned-presences-match-link.sql, migration-prestations-match-link.sql) — aucun chemin pour lier
-- une présence CM ou une mission à un événement NON-match (Media Day, tournoi...). Complète le
-- même schéma dual que contenus, jamais une nouvelle table event.

alter table planned_presences add column if not exists calendar_event_id uuid references club_calendar_events(id) on delete set null;
alter table prestations add column if not exists calendar_event_id uuid references club_calendar_events(id) on delete set null;

comment on column planned_presences.calendar_event_id is 'Événement Club+ non-match d''origine (Media Day, tournoi...) si applicable — voir contenus.calendar_event_id pour le même patron. NULL pour une présence liée à un match (voir match_id).';
comment on column prestations.calendar_event_id is 'Événement Club+ non-match d''origine si applicable — voir contenus.calendar_event_id pour le même patron. NULL pour une prestation liée à un match (voir match_id).';
