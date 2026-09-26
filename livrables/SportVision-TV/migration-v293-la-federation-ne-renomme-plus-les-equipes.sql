-- v293 — 26/09/2026 : la fédération ne renomme plus les équipes d'un club
--
-- La v292 a réaligné 362 matchs sur le nom que leur club emploie. Elle ne suffisait pas : la
-- synchro fédérale écrit `team` à CHAQUE mise à jour d'un match (federation-sync-matchs, ligne
-- 219), et rien ne l'en empêchait. La correction aurait tenu jusqu'au passage de 6 h.
--
-- LE VERROU EST LA BONNE RÉPONSE ICI, et il est sûr, parce que l'autre moitié du mécanisme existe
-- déjà : `trg_propager_renommage_equipe` recopie un renommage d'équipe dans club_matches.team en
-- suivant `team_id`. Autrement dit, dès qu'un match porte un team_id :
--
--   - son nom affiché est maintenu par le club, automatiquement, à chaque renommage ;
--   - la fédération n'a plus rien à y apporter, son libellé décrit le même objet dans un autre
--     système de nommage (« U14 2 » pour « U14 D4 »).
--
-- Verrouiller `team` ne fige donc aucun nom : il retire une seule source d'écriture, celle qui se
-- trompait. Le mécanisme de verrou est celui de la v237, respecté par la synchro qui retire les
-- champs verrouillés de son patch.
--
-- La garde anti-doublon de la synchro compare (club_id, provider, external_event_id) et les index
-- de rapprochement du moteur d'import comparent team_id — vérifié avant d'écrire : renommer `team`
-- ne peut pas faire recréer un match à côté de lui-même.
--
-- Idempotent.

update club_matches
   set champs_verrouilles = array(select distinct unnest(coalesce(champs_verrouilles,'{}') || array['team']))
 where team_id is not null
   and not coalesce(champs_verrouilles,'{}') @> array['team'];
