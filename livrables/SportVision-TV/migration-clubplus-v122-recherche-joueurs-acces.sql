-- P0 — Retrouver un joueur (et sa date de naissance) par son nom, sans compte.
--
-- Trouvé le 10/09/2026 en balayant les fonctions du même type que le calendrier ouvert (v120).
-- `find_player_match_candidates` (SECURITY DEFINER, aucun contrôle, exécutable par `anon`)
-- rendait identifiant, prénom, nom et DATE DE NAISSANCE de tout joueur d'un club dont on connaît
-- le nom. Aucun joueur n'existait encore en base : rien n'a pu fuir. `find_duplicate_club_candidates`
-- rendait de même noms de clubs, SIRET et identifiants internes à un visiteur.
--
-- Mesuré par tests/recherche-joueurs-acces.test.sql, rouge avant.
--
-- ── La correction ──
-- Ces deux fonctions sont des outils internes. Leurs usages légitimes passent par des fonctions
-- qui contrôlent l'appelant — `match_player_candidates` (administrateur du club), les parcours
-- d'inscription (compte exigé), `provisionner_club_plus_full_com` — et qui les appellent avec
-- leurs propres droits : leur retirer l'exécution directe ne change rien pour eux.
--
--   • find_player_match_candidates : plus appelable par l'API du tout.
--   • find_duplicate_club_candidates : plus appelable sans compte. L'OS l'appelle avec le jeton
--     d'un membre du staff, et la fonction d'activation avec la clé de service.

begin;

revoke execute on function public.find_player_match_candidates(uuid, text, text, date, text) from public, anon, authenticated;

revoke execute on function public.find_duplicate_club_candidates(text, text, uuid) from public, anon;
grant execute on function public.find_duplicate_club_candidates(text, text, uuid) to authenticated, service_role;

-- Deux outils internes du même balayage, qui écrivaient sans contrôle : n'importe qui pouvait
-- créer les autorisations vides d'un joueur, ou recalculer l'état de ses demandes d'inscription.
-- Rien ne fuitait, mais rien ne justifiait l'accès. Seules des fonctions à droits propriétaire
-- les appellent (parcours d'inscription, soumission et vérification des autorisations).
revoke execute on function public.bootstrap_player_authorizations(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.recompute_request_readiness(uuid) from public, anon, authenticated;

commit;
