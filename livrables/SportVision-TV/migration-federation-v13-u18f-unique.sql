-- Le club n'a qu'UNE equipe U18 feminine : les deux entrees federales sont la meme.
--
-- Fouka, 09/09/2026 : « ya pas de deuxieme u18F ».
--
-- Ce que la source montre, et pourquoi elle induisait en erreur : elle expose « U18 F 1 » et
-- « U18 F 2 » comme deux equipes. Mais « U18 F 1 » n'a qu'UN match, en Coupe Nike Feminine U18,
-- tandis que « U18 F 2 » joue les 18 matchs du championnat U18F D1 de septembre a mai. Une
-- inscription en coupe cree une entree distincte chez elle, pas une equipe de plus chez le club.
--
-- Le match de coupe revient donc a l'unique equipe « U18 F ».
--
-- Un point a verifier avec le club, qu'on ne tranche pas ici : le 19/09, cette equipe aurait deux
-- matchs, la coupe a 15h a l'exterieur (Paris XIII) et le championnat a 17h15 a domicile
-- (St Denis RC). Deux rencontres le meme jour a deux heures d'intervalle, c'est peu vraisemblable.
-- L'un des deux a probablement ete reporte sans que la source l'ait enregistre. On importe ce que
-- la source dit ; c'est au club de savoir lequel a ete joue.

begin;

update public.club_matches m
   set team_id = (select id from public.club_teams
                   where club_id = m.club_id and name = 'U18 F' and coalesce(archivee, false) = false)
 where m.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and m.provider = 'SPORTCORICO'
   and m.team = 'U18 F 1';

update public.club_team_source_mappings
   set team_id = (select id from public.club_teams
                   where club_id = club_team_source_mappings.club_id
                     and name = 'U18 F' and coalesce(archivee, false) = false),
       status = 'confirmed',
       confidence = 1.00,
       confirmed_at = now()
 where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and provider = 'SPORTCORICO'
   and external_team_name = 'U18 F 1';

commit;
