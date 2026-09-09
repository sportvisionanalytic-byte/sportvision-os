-- ═══════════════════════════════════════════════════════════════════════════════
-- Le CRM n'a pas a etre alimentable depuis le navigateur
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- find_or_create_client_by_email() cree une fiche client (prospect) et etait executable par
-- `anon`. Verifie en conditions reelles le 09/09/2026 : l'appel aboutit et cree la ligne. Avec la
-- seule cle publique du site, on pouvait donc remplir le CRM de faux prospects.
--
-- Aucun appelant legitime n'en a besoin depuis un navigateur : les cinq fonctions qui l'utilisent
-- (clubplus-onboarding, portal-onboarding, create-guest-rdv, create-guest-request,
-- connect-club-signup-review) tournent cote serveur avec la cle de service, laquelle n'est pas
-- concernee par ce retrait. Les parcours invites gardent en plus leur limitation de debit.

-- Le droit vient de PUBLIC, pas d'un grant nominatif : retirer a `anon` seul ne change rien
-- (verifie, la fonction restait executable). On retire a PUBLIC puis on redonne explicitement au
-- role de service, seul appelant legitime.
revoke execute on function public.find_or_create_client_by_email(text, text, text, text, text, text, text, text, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.find_or_create_client_by_email(text, text, text, text, text, text, text, text, text, boolean, uuid) to service_role;

select has_function_privilege('anon', p.oid, 'EXECUTE') as anon_peut_encore,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_conserve
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='find_or_create_client_by_email';
