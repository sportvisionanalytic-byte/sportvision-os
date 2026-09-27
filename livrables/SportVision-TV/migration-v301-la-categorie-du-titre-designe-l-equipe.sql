-- v301 — 27/09/2026 : la catégorie écrite dans le titre désigne une équipe, et une seule
--
-- Hier j'ai refusé de deviner l'équipe d'une galerie, et j'avais raison de refuser de DEVINER. Mais
-- je n'avais pas regardé assez loin : chaque club n'a qu'UNE SEULE équipe par catégorie.
--
--     SF Villemomble     U9, U10, U11, U11 F
--     RCP Fontainebleau  U9, U10, U11
--
-- « Villemomble Cup U10 » ne désigne donc pas « un des U10 » : il désigne l'équipe nommée
-- exactement « U10 », et il n'y en a pas deux. Ce n'est plus une supposition, c'est une lecture.
--
-- LA RÈGLE, et ses deux garde-fous : le titre ne doit contenir QU'UNE catégorie, et le club doit
-- avoir EXACTEMENT une équipe portant ce nom exact. « U11 » ne peut pas attraper « U11 F » : la
-- comparaison est sur le nom entier, pas sur un fragment. Seize galeries sur vingt-trois passent.
--
-- LES SEPT QUI RESTENT, et pourquoi elles restent : leur titre ne nomme aucune catégorie.
--
--     FC 93 plateau - Villemomble      Joinville VS fontainebleau
--     Joinville VS Villemomble         Mortmant vs fontainebleau
--     Noisy plateau - Villemomble      rc argenteuil vs Villemomble
--     Reui malmaison vs Villemomble
--
-- Le rapprochement par le match du même jour ne donne rien non plus : il n'existe AUCUN match les
-- 14, 21 et 24 septembre en base. Ces sept-là attendent que quelqu'un dise à quelle équipe elles
-- appartiennent, depuis l'OS. En attendant, la v302 fait qu'aucune famille ne les voit.
--
-- Idempotent.

update media_albums a
   set team_id = t.id, updated_at = now()
  from club_teams t
 where a.team_id is null
   and a.club_id is not null
   and cardinality(coalesce(a.team_ids,'{}')) = 0
   and t.club_id = a.club_id
   and coalesce(t.archivee, false) = false
   -- La catégorie du titre, et il n'en faut qu'une : deux catégories dans un titre décriraient
   -- deux équipes, et on ne choisirait pas.
   and (select count(*) from regexp_matches(a.title, '(?i)\mU\s?\d{1,2}\M', 'g')) = 1
   and t.name = 'U' || (regexp_match(a.title, '(?i)\mU\s?(\d{1,2})\M'))[1]
   -- Et le club ne doit avoir qu'une équipe de ce nom exact.
   and 1 = (select count(*) from club_teams x
             where x.club_id = a.club_id and coalesce(x.archivee,false) = false
               and x.name = 'U' || (regexp_match(a.title, '(?i)\mU\s?(\d{1,2})\M'))[1]);
