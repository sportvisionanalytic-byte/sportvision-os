-- ============================================================================
-- migration-fix-connect-os-accounts-list-email-type.sql
-- ============================================================================
-- Bug réel trouvé le 22/08/2026 : la page "Comptes Club+ / Connect" de l'OS
-- affichait "Erreur de chargement" de façon récurrente, sans jamais pouvoir
-- être reproduit via un appel direct de connect_os_accounts_list() (bloqué
-- avant la vraie erreur par la vérification is_staff(), qui échoue forcément
-- hors contexte utilisateur authentifié). Fouka a fini par coller le message
-- d'erreur réel affiché côté client (ajouté le 22/08 dans loadConnectComptes,
-- voir SportVision-OS-Full.html) : "structure of query does not match
-- function result type".
--
-- Cause : auth.users.email est de type character varying(255), pas text.
-- La fonction déclare RETURNS TABLE(..., email text, ...) mais son corps
-- sélectionnait u.email brut (deux fois, une par branche du UNION ALL). Un
-- SELECT top-niveau tolère cette différence silencieusement (varchar→text
-- implicite), mais RETURN QUERY en PL/pgSQL fait une vérification stricte
-- du tupledesc — d'où l'échec systématique en production, alors qu'un test
-- direct de la requête SELECT seule (hors fonction) passait sans erreur et
-- ne permettait donc pas de repérer le bug.
--
-- Fix : cast explicite u.email::text dans les deux branches du UNION ALL.
-- Toute autre colonne source vérifiée déjà en type text natif (player_
-- profiles.prenom/nom, clubs.nom, connect_profile_settings.account_type/
-- ville, connect_declared_clubs.name, connect_agent_subscriptions.tier/
-- status) — aucun autre cast nécessaire.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.connect_os_accounts_list()
 RETURNS TABLE(user_id uuid, type text, prenom text, nom text, email text, ville text, club_nom text, agent_tier text, agent_status text, nb_athletes integer, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_staff() then
    raise exception 'FORBIDDEN: réservé au staff';
  end if;

  return query
  select
    pp.user_id,
    'club'::text,
    pp.prenom,
    pp.nom,
    u.email::text,
    null::text,
    c.nom,
    null::text,
    null::text,
    null::int,
    pp.created_at
  from player_profiles pp
  join auth.users u on u.id = pp.user_id
  left join clubs c on c.id = pp.club_id
  where pp.user_id is not null

  union all

  select
    cps.user_id,
    cps.account_type,
    coalesce(u.raw_user_meta_data->>'first_name', ''),
    coalesce(u.raw_user_meta_data->>'last_name', ''),
    u.email::text,
    cps.ville,
    dc.name,
    cas.tier,
    cas.status,
    (select count(*)::int from managed_athlete_profiles map where map.owner_user_id = cps.user_id)
      + (select count(*)::int from connect_access_relationships car
           where car.grantee_user_id = cps.user_id and car.status = 'acceptee'),
    cps.created_at
  from connect_profile_settings cps
  join auth.users u on u.id = cps.user_id
  left join connect_declared_club_players dcp on dcp.user_id = cps.user_id
  left join connect_declared_clubs dc on dc.id = dcp.declared_club_id
  left join connect_agent_subscriptions cas on cas.user_id = cps.user_id
  order by 11 desc;
end;
$function$;

-- ============================================================================
-- Vérifié après écriture : select connect_os_accounts_list() sans contexte
-- utilisateur retombe proprement sur "FORBIDDEN: réservé au staff" (comportement
-- normal attendu), l'erreur "structure of query does not match function
-- result type" a disparu.
-- ============================================================================
