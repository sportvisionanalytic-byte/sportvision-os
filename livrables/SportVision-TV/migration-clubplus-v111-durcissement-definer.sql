-- Audit des fonctions SECURITY DEFINER écrites aujourd'hui, demandé par Fouka.
--
-- ── Ce qui allait déjà ──
-- `peut_operer_equipe`, celle qui casse la récursion RLS, est étroite comme il faut : elle rend
-- un BOOLÉEN et rien d'autre, ne construit aucun SQL dynamique, et ne lit que `club_teams` pour
-- retrouver le club d'une équipe. Elle ne peut donc pas servir de contournement général de la
-- RLS : on ne peut rien en extraire qu'un oui ou un non sur une équipe qu'on nomme déjà.
--
-- ── Deux choses à corriger ──
--
-- 1. `search_path` sans `pg_temp`. Cinq fonctions portaient `search_path=public` tout court.
--    Quand `pg_temp` n'est pas nommé explicitement, PostgreSQL le consulte D'ABORD pour résoudre
--    les tables : quelqu'un capable de créer une table temporaire pourrait masquer une table du
--    schéma public et détourner une fonction qui s'exécute, elle, avec les droits de `postgres`.
--    On le place donc en dernier, explicitement.
--
-- 2. `anon` avait EXECUTE sur tout, y compris les fonctions d'écriture — `preparer_invitation_club`,
--    `accepter_invitation_club`, `decider_lien_parent`, `annuler_invitation_famille`. C'est le
--    défaut de PostgreSQL, qui accorde EXECUTE à PUBLIC. Fonctionnellement elles refusaient déjà
--    un visiteur non connecté (`auth.uid() is null`), mais le moindre privilège demande de ne pas
--    laisser une porte ouverte au motif qu'un garde se tient derrière.
--
--    Révoquer `from anon, authenticated` ne suffirait pas : c'est PUBLIC qui porte le droit par
--    défaut. Leçon déjà payée le 09/09 sur le cockpit Production.
--
-- `lire_invitation_club` garde `anon` : c'est ce que lit la page /rejoindre AVANT que la personne
-- ne se connecte, et elle ne rend ni adresse e-mail ni identité complète.

begin;

-- ── 1. search_path explicite, pg_temp en dernier ──
alter function public.accepter_invitation_club(text)            set search_path = public, pg_temp;
alter function public.accepter_invitation_joueur(uuid)           set search_path = public, pg_temp;
alter function public.annuler_invitation_famille(uuid, text)     set search_path = public, pg_temp;
alter function public.decider_lien_parent(uuid, text)            set search_path = public, pg_temp;
alter function public.preparer_invitation_club(uuid, text, text, text, text, text, jsonb)
                                                                 set search_path = public, pg_temp;
alter function public.marquer_invitation_envoyee(uuid)           set search_path = public, pg_temp;
alter function public.revoquer_invitation_club(uuid)             set search_path = public, pg_temp;
alter function public.proteger_identite_joueur()                 set search_path = public, pg_temp;
alter function public.proteger_existence_equipe()                set search_path = public, pg_temp;
alter function public.protect_sensitive_club_member_fields()     set search_path = public, pg_temp;
alter function public.protect_sensitive_membership_fields()      set search_path = public, pg_temp;

-- ── 2. EXECUTE minimal ──
-- Les fonctions d'ÉCRITURE ne s'adressent qu'à quelqu'un de connecté.
revoke execute on function public.accepter_invitation_club(text)        from public, anon;
revoke execute on function public.accepter_invitation_joueur(uuid)      from public, anon;
revoke execute on function public.annuler_invitation_famille(uuid, text) from public, anon;
revoke execute on function public.decider_lien_parent(uuid, text)       from public, anon;
revoke execute on function public.preparer_invitation_club(uuid, text, text, text, text, text, jsonb) from public, anon;
revoke execute on function public.marquer_invitation_envoyee(uuid)      from public, anon;
revoke execute on function public.revoquer_invitation_club(uuid)        from public, anon;

grant execute on function public.accepter_invitation_club(text)         to authenticated, service_role;
grant execute on function public.accepter_invitation_joueur(uuid)       to authenticated, service_role;
grant execute on function public.annuler_invitation_famille(uuid, text) to authenticated, service_role;
grant execute on function public.decider_lien_parent(uuid, text)        to authenticated, service_role;
grant execute on function public.preparer_invitation_club(uuid, text, text, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.marquer_invitation_envoyee(uuid)       to authenticated, service_role;
grant execute on function public.revoquer_invitation_club(uuid)         to authenticated, service_role;

-- Les fonctions de LECTURE qui exigent une identité : même traitement.
revoke execute on function public.lister_mes_invitations()              from public, anon;
revoke execute on function public.suivi_invitations_club(uuid)          from public, anon;
grant execute on function public.lister_mes_invitations()               to authenticated, service_role;
grant execute on function public.suivi_invitations_club(uuid)           to authenticated, service_role;

-- `peut_operer_club` / `peut_operer_equipe` / `peut_preparer_club` / `peut_gerer_invitations_club`
-- restent accessibles à `anon` : elles sont appelées DEPUIS des policies, y compris sur des
-- chemins où le rôle courant est `anon`. Les retirer casserait l'évaluation de la RLS elle-même.
-- Elles ne rendent qu'un booléen sur un identifiant que l'appelant fournit déjà, et répondent
-- `false` sans session.

commit;
