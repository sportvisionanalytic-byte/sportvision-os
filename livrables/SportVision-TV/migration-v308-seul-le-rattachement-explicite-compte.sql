-- v308 — 27/09/2026 : le titre ne prouve rien, seul le rattachement explicite compte
--
-- RÈGLE POSÉE PAR FOUKA, et elle est plus large que la correction de la v307 : « ce n'est pas parce
-- qu'une galerie porte le nom de mon club qu'elle appartient forcément à mon club. Ça se trouve, je
-- mets mon club contre une équipe adverse, ou un tournoi. **Tant que je ne rattache pas**, ce n'est
-- pas parce que j'ai mis le nom de mon club que ça appartient à mon club. »
--
-- CE QUE ÇA CONDAMNE : toute la démarche de la v296 et de la v301, pas seulement leurs erreurs. Je
-- lisais le titre pour déduire le club, puis la catégorie pour déduire l'équipe. Les deux sont des
-- INFÉRENCES sur une donnée que Fouka saisit lui-même quand il crée la galerie. L'absence de
-- rattachement est une information, pas un oubli à réparer.
--
-- CE QUI RESTE : les 5 galeries que Fouka a rattachées LUI-MÊME à la création, hier midi, depuis le
-- formulaire de l'OS. Elles portent le club et l'équipe qu'il a choisis.
--
--     Villemomble vs AFP 18            U11        cree 27/09 11:40
--     Villemomble plateau U6-U7        U6         cree 27/09 11:47
--     Villemomble vs CS Villetaneuse   U14 D4     cree 27/09 11:58
--     Villemomble vs OPB               U14 D2     cree 27/09 12:05
--     Villemomble plateau U8-U9        U8         cree 27/09 12:18
--
-- CE QUI PART : les 3 que J'AI rattachées depuis leur titre. Elles suivent pourtant sa convention
-- (le sujet nommé en premier : « Rcpf U9 VS amiens »), et elles sont probablement les siennes — mais
-- « probablement » n'est pas « rattaché ». Un clic dans l'OS les remet, et ce clic est une décision
-- qui lui appartient. Détacher à tort cache des photos ; attacher à tort montre l'enfant d'un autre
-- club aux familles du sien.
--
-- Idempotent.

update media_albums a
   set club_id = null, team_id = null, team_ids = '{}', updated_at = now()
 where a.id in (
   select a2.id from media_albums a2
    where a2.club_id is not null
      and a2.created_at < timestamptz '2026-09-27 08:49+00'   -- avant la v296, donc rattachee par moi
      and a2.mission_id is null                               -- et non pas nee d'une mission
 );

update media_assets x
   set club_id = a.club_id
  from media_albums a
 where a.id = x.album_id and x.club_id is distinct from a.club_id;
