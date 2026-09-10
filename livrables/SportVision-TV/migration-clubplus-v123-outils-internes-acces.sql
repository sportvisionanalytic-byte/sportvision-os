-- Des outils internes qui écrivaient, appelables sans compte.
--
-- Trouvé le 10/09/2026, au balayage qui a suivi les deux P0 du jour (v120, v122). Aucune donnée
-- ne fuitait, mais rien ne justifiait l'accès, et le premier permettait de nuire :
--
--   • check_and_record_rate_limit(identifiant, max, fenêtre) — remplir le compteur d'une adresse
--     e-mail suffisait à bloquer la personne sur un parcours limité (mot de passe oublié,
--     activation, paiement invité). Les 23 appels du code passent par la clé de service.
--   • get_or_create_saison(label) — un visiteur créait des saisons à volonté. L'OS l'appelle avec
--     le jeton d'un membre du staff ; le déclencheur des clubs, avec ses propres droits.
--   • club_president_connu(club) — outil interne du cockpit (v117), resté appelable.
--
-- Mesuré par tests/outils-internes-acces.test.sql, rouge avant.

begin;

revoke execute on function public.check_and_record_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_and_record_rate_limit(text, integer, integer) to service_role;

revoke execute on function public.get_or_create_saison(text) from public, anon;
grant execute on function public.get_or_create_saison(text) to authenticated, service_role;

revoke execute on function public.club_president_connu(uuid) from public, anon, authenticated;

commit;
