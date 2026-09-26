-- v292 — 26/09/2026 : à l'écran, une équipe porte le nom que le club lui donne
--
-- Fouka : « bug sur Villemomble, plus rien dans le calendrier, plus les matchs ». Le calendrier
-- n'est pas vide — 434 matchs, 352 à venir, et chaque persona les voit (admin 434, CM 434,
-- président 434, coach 58, mesuré en rôle `authenticated`). Ce qui est cassé, c'est la lecture
-- HUMAINE du calendrier : 312 des 434 matchs de Villemomble affichaient un nom d'équipe que le
-- club ne connaît pas.
--
--     ce que le club appelle      ce que l'écran affichait      matchs
--     U14 D4                      U14 2                            30
--     Séniors Féminines           Seniors F 1                      27
--     Séniors D2                  Seniors 3                        24
--     Séniors R2                  Seniors 1                        23
--     U18 R3                      U18 1                            23
--     ...                                                     312 au total
--
-- Trois lignes différentes affichaient « Seniors 1 » : les Séniors R2, les Anciens D1 et les Super
-- Vétérans. Un président qui cherche le match de ses Séniors D1 trouve « Seniors 2 ». Un coach
-- cherche son équipe et ne la trouve nulle part. Le calendrier est plein et illisible, ce qui se
-- raconte exactement comme « il n'y a plus rien ».
--
-- POURQUOI. `club_matches.team_id` est juste sur les 362 lignes concernées, toutes clubs confondus.
-- Seul le texte `club_matches.team` est faux : il porte le libellé de la fédération, que la synchro
-- réécrit à chaque passage. Le numéro fédéral (« U14 2 ») et le nom du club (« U14 D4 ») décrivent
-- la même équipe dans deux systèmes de nommage, et c'est le nom du club qui doit s'afficher : c'est
-- celui que le coach, le président et les familles emploient.
--
-- CE QUI N'EST PAS PERDU. Le libellé de la source est d'abord écrit dans
-- club_team_source_mappings.external_team_name, sa place légitime, avant toute réécriture. Aucune
-- information ne disparaît, elle change de colonne.
--
-- ET POURQUOI ÇA NE REVIENDRA PAS. `team` est ajouté à champs_verrouilles : la synchro
-- fédérale retire les champs verrouillés de son patch (federation-sync-matchs, v237), donc le
-- prochain passage ne réécrira plus le nom. Sans ce verrou, la correction tenait jusqu'à 6 h du
-- matin.
--
-- Idempotent : rejouable sans effet une fois les noms alignés.

-- 1. Garder le libellé de la source là où il a un sens, avant de toucher à l'affichage.
insert into club_team_source_mappings
  (club_id, saison_id, team_id, provider, external_team_id, external_team_name,
   confidence, status, confirmed_at)
select distinct on (m.club_id, m.provider, m.team)
       m.club_id, m.saison_id, m.team_id, m.provider, m.team, m.team, 1.0, 'confirmed', now()
  from club_matches m
  join club_teams t on t.id = m.team_id
 where t.name <> m.team
   and m.provider in ('MANUAL','CSV','ICS','FOOTCLUBS_XLSX','PDF','FFF','SPORTCORICO','OTHER')
   and not exists (
     select 1 from club_team_source_mappings x
      where x.club_id = m.club_id and x.provider = m.provider and x.external_team_id = m.team);

-- 2. Afficher le nom du club. team_id fait foi, il n'y a rien à deviner.
update club_matches m
   set team = t.name,
       champs_verrouilles = array(select distinct unnest(coalesce(m.champs_verrouilles,'{}') || array['team'])),
       updated_at = now()
  from club_teams t
 where t.id = m.team_id
   and t.name <> m.team;
