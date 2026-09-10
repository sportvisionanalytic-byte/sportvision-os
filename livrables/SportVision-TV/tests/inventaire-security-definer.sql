with f as (
  select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) args,
         coalesce(array_to_string(p.proconfig, ','), '') cfg,
         has_function_privilege('anon', p.oid, 'execute') anon_x,
         has_function_privilege('authenticated', p.oid, 'execute') auth_x,
         lower(pg_get_functiondef(p.oid)) def,
         p.prorettype = 'trigger'::regtype as est_trigger
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
)
select proname, args, cfg, anon_x, auth_x,
       (def ~ '\m(insert\s+into|update\s+\S+\s+set|delete\s+from)\M') as ecrit,
       (def ~ 'execute\s+(format|''|\w+\s*\|\|)|execute\s+v_' ) as sql_dynamique,
       array_to_string(array(select distinct m[1] from regexp_matches(def,
         '\m(club_members|club_invitations|profiles|clubs|memberships|player_profiles|parent_player_links|player_parent_requests|factures|devis|contrats|paiements|avoirs|media_orders|gallery_orders|galerie_\w+|stripe\w*|auth\.users|club_cm_affectations|cm_agency_club_access|team_memberships|connect_\w+)\M', 'g') m), ',') as tables_sensibles
  from f
 where not est_trigger and (anon_x or auth_x)
 order by (def ~ 'execute\s+(format|''|\w+\s*\|\|)|execute\s+v_') desc, anon_x desc, proname;
