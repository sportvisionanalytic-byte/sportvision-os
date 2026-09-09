-- Trois doublons que l'orthographe rendait indetectables.
--
-- Reperes a l'oeil en relisant le calendrier des 19 et 20 septembre, apres le nettoyage
-- automatique de la v18 :
--
--   U14 D1     « FCM Auber »      = « Aubervilliers Fcm U14 1 »
--   U14 D4     « CSL Aunlay »     = « Aulnay Csl U14 4 »        (Aunlay pour Aulnay)
--   Anciens D1 « Stade de l'est » = « Stade Est Pavillon Seniors 1 »
--
-- Aucun rapprochement automatique raisonnable ne les attrape : « Auber » n'est pas un prefixe
-- d'« Aubervilliers » au sens des sept premiers caracteres, « Aunlay » est une faute de frappe, et
-- « Stade de l'est » ne partage avec « Stade Est Pavillon » que le mot « stade », qui est
-- generique. Elargir la regle pour les couvrir reviendrait a rapprocher entre eux tous les clubs
-- dont le nom commence par « Stade », et donc a supprimer de vrais matchs.
--
-- On les supprime donc nommement, par identifiant, apres avoir verifie que les trois lignes ne
-- portent ni score, ni homme du match, ni contenu, ni operateur affecte.
--
-- La lecon vaut au-dela de ces trois-la : un rapprochement de noms libres finit toujours par
-- laisser passer quelque chose. C'est pour cette raison que les matchs federaux portent desormais
-- un identifiant de source (external_event_id) et un identifiant de club adverse
-- (opponent_club_slug) : sur eux, aucune comparaison de texte n'est necessaire.

begin;

delete from public.club_matches
 where id in (
   '75822ed2-433f-4543-af50-fd4fb58f422a',  -- U14 D4 · 19/09 · « CSL Aunlay »
   'eb24a7c7-96e8-44d4-bb94-ef49ce860f07',  -- Anciens D1 · 20/09 · « Stade de l'est »
   '19db4be2-8587-4f1c-aaab-ba9452f61d85'   -- U15D1 · 19/09 · « FCM Auber »
 )
   and club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and provider = 'OTHER'
   -- Garde de derniere minute : si l'une de ces lignes a recu un score ou un contenu entre-temps,
   -- elle n'est plus un doublon inerte et on ne la touche pas.
   and score is null and man_of_match is null and taken_by is null
   and coalesce(contents::text, '[]') = '[]';

commit;
