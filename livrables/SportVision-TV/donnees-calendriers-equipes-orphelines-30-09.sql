-- Matchs sans équipe : Fontainebleau et Villemomble (30/09/2026) — DÉJÀ EXÉCUTÉ
--
-- Six matchs des deux clubs n'étaient rattachés à aucune équipe : ils existent en base, ils ne
-- s'affichent dans aucun calendrier. Deux cas étaient certains, ils sont traités ici. Les autres
-- sont restés en attente d'une réponse de Fouka, parce que les deviner reviendrait à poser des
-- matchs dans le calendrier d'une équipe qui ne les joue pas.
--
-- CE QUI A ÉTÉ FAIT
--
-- 1. RCP Fontainebleau, libellé fédéral « U16 3 » — 4 matchs (3 en U16 D3, 1 en Coupe Comité U16).
--    Le club a U16A (D1) et U16B (D2). « U16 3 » joue une TROISIÈME division et a son propre match
--    de coupe, distinct de celui d'U16B : c'est bien une troisième équipe, elle n'avait pas de
--    fiche. Créée sous le nom de la maison, U16C, et non sous celui de la fédération : le club
--    nomme ses équipes, c'est la règle du 26/09.
--
-- 2. SF Villemomble, libellé fédéral « U18 F 1 » — 1 match (Coupe Nike Féminine U18). Le club n'a
--    qu'une équipe U18 féminine, « U18 F », déjà porteuse de 18 matchs en U18F D1. Le « 1 » est le
--    numéro d'équipe de la fédération, exactement comme chez l'adversaire : « Paris Xiii ES
--    U18 F 1 ». Même équipe, rattachée.
--
-- LA SYNCHRO NE DÉFERA PAS CE TRAVAIL. Vérifié dans `federation-sync-matchs/index.ts` : à la mise à
-- jour, `team_id` ne fait jamais partie des champs réécrits. Rien à verrouiller.
--
-- CE QUI RESTE OUVERT, ET POURQUOI ON N'A PAS TRANCHÉ
--
-- · RCPF U13A porte 7 matchs de « Critérium Régional U12 Espoir P1 » EN PLUS de ses 16 de
--   « Criterium Régional U13 ». Six dates portent deux matchs : ce sont deux équipes. Le club a
--   U13B, U13C, U12A, U12B, U12C, toutes à zéro match. La compétition dit U12, les adversaires
--   disent U13. Le libellé fédéral d'origine a été écrasé lors d'un rattachement précédent, il ne
--   départage plus rien.
--
-- · SF Villemomble « U14 D2 » porte 22 matchs de « U15 D1 » en plus de ses 18 de « U14 D2 » —
--   dix-huit dates à deux matchs. Et l'équipe « U15 D2 » du club est à zéro match. Les adversaires
--   de « U15 D1 » sont pourtant tous des « U14 1 ».
--
-- · Le match amical « U15 » du 05/09 contre CO Vincennes dépend de la même réponse.

-- 1. La troisième équipe U16 de Fontainebleau.
insert into club_teams (club_id, name, categorie)
select id, 'U16C', 'U16' from clubs where nom ilike '%Fontainebleau%'
on conflict do nothing;

update club_matches m set team_id = (
  select ct.id from club_teams ct join clubs c on c.id = ct.club_id
  where c.nom ilike '%Fontainebleau%' and ct.name = 'U16C')
where m.team_id is null and m.team = 'U16 3'
  and m.club_id = (select id from clubs where nom ilike '%Fontainebleau%' limit 1);
-- 4 lignes.

-- 2. Le match de coupe des U18 féminines de Villemomble.
update club_matches m set team_id = (
  select ct.id from club_teams ct join clubs c on c.id = ct.club_id
  where c.nom ilike '%Villemomble%' and ct.name = 'U18 F')
where m.team_id is null and m.team = 'U18 F 1'
  and m.club_id = (select id from clubs where nom ilike '%Villemomble%' limit 1);
-- 1 ligne.
