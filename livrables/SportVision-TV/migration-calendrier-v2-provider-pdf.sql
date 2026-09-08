-- ═══════════════════════════════════════════════════════════════════════════════
-- Le PDF devient une source de calendrier reconnue
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- ProviderId (types.ts) est le miroir strict de ces contraintes. Ajouter « PDF » d'un cote sans
-- l'ajouter de l'autre produirait un echec d'insertion en production, au moment ou un club
-- importe son calendrier — le plus mauvais moment possible pour le decouvrir.

begin;

alter table club_matches drop constraint if exists club_matches_provider_check;
alter table club_matches add constraint club_matches_provider_check
  check (provider = any (array['MANUAL','CSV','ICS','FOOTCLUBS_XLSX','PDF','FFF','OTHER']));

alter table club_calendar_sources drop constraint if exists club_calendar_sources_provider_check;
alter table club_calendar_sources add constraint club_calendar_sources_provider_check
  check (provider = any (array['MANUAL','CSV','ICS','FOOTCLUBS_XLSX','PDF','FFF','OTHER']));

alter table club_team_source_mappings drop constraint if exists club_team_source_mappings_provider_check;
alter table club_team_source_mappings add constraint club_team_source_mappings_provider_check
  check (provider = any (array['MANUAL','CSV','ICS','FOOTCLUBS_XLSX','PDF','FFF','OTHER']));

commit;

select 'OK — PDF accepte par les trois contraintes' as verdict;
