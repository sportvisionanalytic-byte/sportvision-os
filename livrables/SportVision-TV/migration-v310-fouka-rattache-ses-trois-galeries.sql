-- v310 — 27/09/2026 : Fouka rattache lui-même ses trois galeries RCPF
--
-- Fouka, en voyant l'effet de la v308 : « normalement le U16 voit une galerie etc. »
--
-- LA v308 AVAIT RAISON DANS SA RÈGLE, et elle la garde : une galerie n'appartient à un club que si
-- Fouka l'a rattachée, jamais parce que son titre contient le nom du club. J'avais rattaché ces trois
-- galeries depuis leur titre, la v308 les a donc détachées — et c'était le bon réflexe, parce que
-- « probablement les siennes » n'est pas « rattachées ».
--
-- CE QUI CHANGE ICI N'EST PAS LA RÈGLE, C'EST LA SOURCE. Ce rattachement ne vient plus d'une lecture
-- de titre : Fouka vient de dire que ces galeries sont celles de ses équipes. C'est la même donnée
-- qu'il aurait saisie dans le formulaire de l'OS, et la différence est entière : l'une est une
-- déduction, l'autre une décision.
--
--     RCPF VS PSG U16      -> U16A     110 photos
--     Rcpf U9 VS amiens    -> U9        96 photos
--     Rcpf U10 VS amiens   -> U10      250 photos
--
-- Les catégories sont celles que le titre nomme et que le club possède une seule fois. Elles restent
-- vérifiables d'un coup d'œil dans l'OS, et corrigibles en un clic si l'une est fausse.
--
-- AUCUNE ÉQUIPE SUPPLÉMENTAIRE n'est posée : `team_ids` reste vide. Un match de U16 est un match de
-- U16, et un surclassé y est rattaché au cas par cas depuis la v309 — pas en élargissant la galerie.
--
-- Idempotent.

update media_albums a
   set club_id = c.id, team_id = t.id, updated_at = now()
  from clubs c, club_teams t, (values
        ('5536bdea-34d8-47da-a889-82f3b3eef3af'::uuid, 'U16A'),
        ('a3ff909d-b6f2-4116-9c27-8025a4684e89'::uuid, 'U9'),
        ('a33f958a-e20f-4c01-a0d5-f025f0526364'::uuid, 'U10')
      ) as v(album_id, equipe)
 where a.id = v.album_id
   and c.nom = 'RCP Fontainebleau'
   and t.club_id = c.id and t.name = v.equipe and coalesce(t.archivee, false) = false;

update media_assets x
   set club_id = a.club_id
  from media_albums a
 where a.id = x.album_id and x.club_id is distinct from a.club_id;
