-- migration-connect-v80-fix-sportifs-count-club-kind.sql (02/09/2026)
--
-- Gap trouvé lors de l'audit Connect du 02/09 : connect_particulier_total_sportifs_count() ne
-- comptait que les kinds 'linked' (connect_access_relationships) et 'managed'
-- (managed_athlete_profiles) — le 3e kind 'club' ajouté par migration-connect-v79 (enfant
-- réellement affilié via parent_player_relationships confirmé) n'était jamais compté. Un parent
-- avec un enfant réellement confirmé voyait "0 / 3 enfants" au lieu de "1 / 3" sur la bannière de
-- plafond — sous-compte des vraies affiliations club, jamais l'inverse (pas de risque de
-- dépassement de plafond non détecté, juste un affichage trompeur).

create or replace function public.connect_particulier_total_sportifs_count(p_user_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or (auth.uid() <> p_user_id and not is_staff()) then
    raise exception 'Accès refusé.';
  end if;

  return
    (select count(*)::int from connect_access_relationships
       where grantee_user_id = p_user_id and status = 'acceptee')
    +
    (select count(*)::int from managed_athlete_profiles
       where owner_user_id = p_user_id)
    +
    (select count(*)::int from parent_player_relationships ppr
       join parent_profiles pf on pf.id = ppr.parent_id
       where pf.user_id = p_user_id and ppr.statut = 'confirme');
end;
$function$;
