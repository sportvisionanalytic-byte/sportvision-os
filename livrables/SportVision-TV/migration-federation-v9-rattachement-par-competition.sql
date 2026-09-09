-- Rattacher un match par sa COMPETITION quand elle nomme sans ambiguite une equipe du club.
--
-- ── Le defaut ──
-- Apres le realignement (v8), l'equipe « Séniors R2 » portait 71 matchs. Aucune equipe ne joue
-- 71 matchs dans une saison. En regardant le detail : 22 en Seniors R2, mais aussi 22 en
-- « Anciens D1 » et 18 en « Super Vétérans ».
--
-- La source regroupe ces trois competitions sous une seule etiquette d'equipe, « SENIORS 1 » :
-- chez elle, les veterans et les anciens sont des engagements de l'equipe premiere, pas des
-- equipes a part. Le club, lui, en fait trois equipes distinctes — et il a raison, ce ne sont pas
-- les memes joueurs.
--
-- Rattacher sur le nom d'equipe de la source etait donc structurellement faux pour ces cas.
--
-- ── La regle ──
-- Quand le nom de la competition designe exactement une equipe du club (aux accents et a la casse
-- pres), c'est cette equipe qui joue. « Anciens D1 » et « Super Vétérans » sont a la fois des
-- championnats et des equipes : l'information est dans la competition, pas dans l'etiquette.
--
-- La regle ne s'applique QUE sur une correspondance exacte de nom. Une coupe (« COUPE DE FRANCE
-- FÉMININE ») ou un libelle generique (« Amical », « Championnat ») ne designe aucune equipe :
-- ces matchs-la gardent le rattachement qu'ils avaient.

begin;

update public.club_matches m
   set team_id = cible.id
  from public.club_teams cible
 where m.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and cible.club_id = m.club_id
   and coalesce(cible.archivee, false) = false
   and m.competition is not null
   and lower(unaccent(m.competition)) = lower(unaccent(cible.name))
   and m.team_id is distinct from cible.id
   -- Une equipe ne peut pas etre designee par deux noms differents : si la competition
   -- correspondait a plusieurs equipes, on ne saurait pas laquelle choisir et on ne toucherait
   -- a rien. Garde de principe, aucune ambiguite constatee au 09/09/2026.
   and (select count(*) from public.club_teams c2
         where c2.club_id = m.club_id
           and coalesce(c2.archivee, false) = false
           and lower(unaccent(c2.name)) = lower(unaccent(m.competition))) = 1;

commit;
