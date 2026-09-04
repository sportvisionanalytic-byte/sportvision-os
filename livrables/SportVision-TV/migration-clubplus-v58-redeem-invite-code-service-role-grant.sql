-- ============================================================================
-- migration-clubplus-v58-redeem-invite-code-service-role-grant.sql (03/09/2026)
-- ============================================================================
-- Complète migration-clubplus-v57-smart-links-qr.sql : redeem_invite_code() a été créée avec
-- `revoke all on function redeem_invite_code(text) from public` et AUCUN grant explicite ensuite
-- — ce qui retire aussi l'exécution au rôle `service_role` (il n'est pas superuser côté Supabase,
-- juste un rôle avec bypass RLS ; il perd comme tout le monde le privilège EXECUTE implicite dès
-- qu'on le révoque à `public`). L'edge function connect-player-onboarding doit pourtant appeler
-- cette fonction via le client service role (`admin`) — sans ce grant, tout appel échouerait avec
-- "permission denied for function redeem_invite_code". Même patron que
-- migration-connect-v54-declared-clubs-dedup.sql / migration-connect-v69-...-profile-writeback.sql
-- (grant execute ... to service_role), oublié par erreur dans v57.

grant execute on function redeem_invite_code(text) to service_role;

-- ============================================================================
-- VÉRIFICATION RECOMMANDÉE après exécution :
--
-- select has_function_privilege('service_role', 'redeem_invite_code(text)', 'execute'); -- true
-- ============================================================================
