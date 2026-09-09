-- Les deux derniers rattachements d'equipe, tranches par Fouka le 09/09/2026.
--
--   « U14 D4 » du club  = l'equipe federale U14 2, celle qui commence le 19/09 et rencontre
--                         Clichois UF, Villetaneuse, Ile St Denis, Coubron, Montfermeil…
--   « U18 F » du club   = l'equipe federale U18 F 2, celle qui joue le championnat U18F D1
--                         (18 matchs), et non celle qui n'a qu'un match de Coupe Nike.
--
-- Restent volontairement non rattaches :
--   U14 3 (20 matchs)  la troisieme equipe U14 engagee en U14 D4, que le club n'a pas en base.
--                      Fouka : « la 3e jsp met pas pour le moment garde une seul ».
--   U18 F 1 (1 match)  la seconde equipe U18 feminine, absente de la base elle aussi.
--
-- Ces matchs gardent leur libelle federal : le jour ou les equipes seront creees, le rattachement
-- tiendra en deux lignes. Les laisser visibles et non rattaches vaut mieux que les ranger sous une
-- equipe qui n'est pas la leur.

begin;

update public.club_matches m
   set team_id = (select id from public.club_teams
                   where club_id = m.club_id and name = 'U14 D4' and coalesce(archivee, false) = false)
 where m.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and m.provider = 'SPORTCORICO'
   and m.team = 'U14 2';

update public.club_matches m
   set team_id = (select id from public.club_teams
                   where club_id = m.club_id and name = 'U18 F' and coalesce(archivee, false) = false)
 where m.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and m.provider = 'SPORTCORICO'
   and m.team = 'U18 F 2';

-- Les rattachements de source, pour que la synchro quotidienne s'appuie dessus et qu'un humain
-- voie que ces deux-la ont ete confirmes, pas devines.
update public.club_team_source_mappings
   set team_id = (select id from public.club_teams
                   where club_id = club_team_source_mappings.club_id
                     and name = case external_team_name when 'U14 2' then 'U14 D4' else 'U18 F' end
                     and coalesce(archivee, false) = false),
       status = 'confirmed',
       confidence = 1.00,
       confirmed_at = now()
 where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and provider = 'SPORTCORICO'
   and external_team_name in ('U14 2', 'U18 F 2');

commit;
