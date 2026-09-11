-- v175 : rendre les droits d'exécution que v170 avait retirés par excès de prudence (12/09/2026).
--
-- v170 a réinscrit dans le dépôt deux fonctions du cloisonnement qui n'existaient qu'en production,
-- et leur a appliqué au passage le réflexe maison « revoke from public, anon ». C'était une erreur :
-- ces deux fonctions ne sont pas appelées par une application, elles sont appelées PAR DES POLICIES
-- (ccal_member_select sur club_calendar_events, cma_member_select sur club_matches). Une policy
-- s'évalue avec les droits de celui qui lit, y compris un visiteur anonyme : sans le droit
-- d'exécution, la lecture échoue avec « permission denied for function », au lieu de rendre
-- simplement zéro ligne.
--
-- Le cloisonnement ne repose pas sur le droit d'exécuter la fonction, mais sur ce qu'elle répond :
-- un visiteur anonyme obtient « faux » et ne voit rien. Les droits sont donc rendus, comme les ont
-- leurs voisines directes (is_team_educateur, peut_operer_club).
--
-- Défaut trouvé par la batterie de tests de l'autre session (blocages-review), qui appelle ces
-- fonctions en anonyme : c'est exactement le chemin qu'un visiteur emprunte.
-- Test : tests/blocages-review.test.sql (celui qui l'a révélé) et tests/matchcenter-roles-club.test.sql

grant execute on function public.peut_lire_calendrier_equipe(uuid) to public, anon, authenticated, service_role;
grant execute on function public.membre_borne_a_ses_equipes(uuid) to public, anon, authenticated, service_role;
