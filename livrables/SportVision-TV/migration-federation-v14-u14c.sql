-- Creation de « U14 C », la troisieme equipe U14 engagee.
--
-- Fouka, 09/09/2026 : « ecrit U14 C du coup ».
--
-- La federation engage trois equipes U14 a Villemomble et le club n'en avait que deux en base.
-- La manquante joue la poule C du championnat U14 D4 (Sevran, Bondy AS, Tremblay, Villepinte,
-- Noisy le Grand, Vaujours, Montreuil, Aulnaysienne, Raincy FA, FC en Salle) : 20 matchs
-- attendaient depuis le chargement de la saison, avec leur libelle federal « U14 3 ».
--
-- Le nom retenu suit celui que le club emploie deja dans son fichier d'amicaux, ou l'on trouve
-- « U14 B » et « U14C » : les U14 y sont designees par une lettre, pas par leur division. C'est
-- aussi pour ca que le match amical « U14C » du 05/09 contre Pontault-Combault rejoint cette
-- equipe ici : correspondance exacte du libelle, aux espaces pres.
--
-- Ce qui n'est PAS fait, faute de certitude : les deux amicaux marques « U14 B » et « U14B »
-- (Val d'Europe le 29/08, Mitry Mory le 05/09). Si B designe l'equipe aujourd'hui nommee
-- « U14 D4 », le rattachement tient en une ligne — mais c'est au club de le dire, pas a moi de le
-- supposer parce que la lettre tombe bien.

begin;

insert into public.club_teams (club_id, name, categorie, categories, section, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid, 'U14 C', 'U14', array['U14'], 'Masculin',
       'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'::uuid
 where not exists (
   select 1 from public.club_teams
    where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and name = 'U14 C'
 );

-- Les 20 matchs de championnat, jusqu'ici sans equipe.
update public.club_matches m
   set team_id = (select id from public.club_teams
                   where club_id = m.club_id and name = 'U14 C' and coalesce(archivee, false) = false)
 where m.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and m.provider = 'SPORTCORICO'
   and m.team = 'U14 3';

-- L'amical du 05/09, dont le libelle nomme exactement cette equipe.
update public.club_matches m
   set team_id = (select id from public.club_teams
                   where club_id = m.club_id and name = 'U14 C' and coalesce(archivee, false) = false)
 where m.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and m.provider = 'OTHER'
   and m.team = 'U14C';

-- Le rattachement de source, pour que la synchro quotidienne s'appuie dessus.
update public.club_team_source_mappings
   set team_id = (select id from public.club_teams
                   where club_id = club_team_source_mappings.club_id
                     and name = 'U14 C' and coalesce(archivee, false) = false),
       status = 'confirmed',
       confidence = 1.00,
       confirmed_at = now()
 where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and provider = 'SPORTCORICO'
   and external_team_name = 'U14 3';

commit;
