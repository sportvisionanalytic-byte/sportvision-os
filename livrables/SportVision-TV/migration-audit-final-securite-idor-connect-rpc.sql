-- ============================================================================
-- Audit sécurité final (nuit du 28-29/08/2026) — IDOR sur RPC SECURITY DEFINER
-- ============================================================================
-- Constat : 6 fonctions SECURITY DEFINER exposées en RPC (donc appelables
-- directement via POST /rest/v1/rpc/<nom> avec la seule clé anon publique,
-- aucune session requise) prennent un p_user_id / p_owner_user_id en
-- paramètre SANS jamais vérifier que l'appelant est bien ce user_id (ni
-- via auth.uid(), ni via is_staff()). Résultat : n'importe qui pouvait
-- récupérer, pour un UUID arbitraire d'un autre utilisateur :
--   - connect_agent_discount / connect_agent_effective_tier : le palier
--     d'abonnement Agent et son état de remise mensuelle (donnée business,
--     pas de PII directe mais fuite de statut commercial).
--   - connect_agent_relationship_count / connect_particulier_total_sportifs_count :
--     le nombre de sportifs liés/gérés par ce compte.
--   - connect_particulier_limit : le plafond de sportifs autorisé pour ce compte.
--   - connect_owner_client_id : le client_id interne associé à ce compte
--     (mapping UUID, faible sensibilité seule mais permet un chaînage).
--
-- Vérifié dans le code réel (app-connect) que TOUS les points d'appel
-- légitimes passent déjà l'id de l'appelant authentifié lui-même
-- (jamais un id tiers) — voir agentSubscription.ts, particulier/sportifs/
-- page.tsx, particulier/page.tsx. Le correctif ci-dessous (exiger
-- auth.uid() = p_user_id, ou is_staff() pour un usage staff futur) ne
-- change donc AUCUN comportement légitime, il ferme uniquement l'accès à
-- un id arbitraire. Additif pur, aucune destruction de donnée.
-- ============================================================================

create or replace function public.connect_agent_discount(p_user_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_sub connect_agent_subscriptions%rowtype;
  v_tier text;
  v_monthly_used boolean;
begin
  if auth.uid() is null or (auth.uid() <> p_user_id and not is_staff()) then
    raise exception 'Accès refusé.';
  end if;

  select * into v_sub from connect_agent_subscriptions where user_id = p_user_id and status = 'active';
  v_tier := coalesce(v_sub.tier, 'gratuit');
  v_monthly_used := v_tier = 'pro' and v_sub.monthly_discount_used_at is not null;

  return jsonb_build_object(
    'montage_pct', case when v_tier in ('starter', 'growth', 'pro') then 5 else 0 end,
    'monthly_pct', case when v_tier = 'pro' and not v_monthly_used then 10 else 0 end,
    'monthly_used_this_period', coalesce(v_monthly_used, false)
  );
end;
$function$;

create or replace function public.connect_agent_effective_tier(p_user_id uuid)
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_tier text;
begin
  if auth.uid() is null or (auth.uid() <> p_user_id and not is_staff()) then
    raise exception 'Accès refusé.';
  end if;

  select tier into v_tier from connect_agent_subscriptions
    where user_id = p_user_id and status = 'active';
  return coalesce(v_tier, 'gratuit');
end;
$function$;

create or replace function public.connect_agent_relationship_count(p_user_id uuid)
 returns integer
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null or (auth.uid() <> p_user_id and not is_staff()) then
    raise exception 'Accès refusé.';
  end if;

  return (select count(*)::int from connect_access_relationships
    where grantee_user_id = p_user_id and relation_type = 'agent' and status = 'acceptee');
end;
$function$;

create or replace function public.connect_particulier_limit(p_user_id uuid)
 returns integer
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_profil text;
begin
  if auth.uid() is null or (auth.uid() <> p_user_id and not is_staff()) then
    raise exception 'Accès refusé.';
  end if;

  select profil_particulier into v_profil from connect_profile_settings where user_id = p_user_id;

  if v_profil = 'agent' then
    return connect_agent_tier_limit(connect_agent_effective_tier(p_user_id));
  elsif v_profil in ('parent', 'tuteur', 'autre') then
    return 3;
  else
    return 999; -- profil jamais choisi (compte pré-v67) : pas de plafond rétroactif
  end if;
end;
$function$;

create or replace function public.connect_particulier_total_sportifs_count(p_user_id uuid)
 returns integer
 language plpgsql
 stable security definer
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
       where owner_user_id = p_user_id);
end;
$function$;

create or replace function public.connect_owner_client_id(p_owner_user_id uuid)
 returns uuid
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null or (auth.uid() <> p_owner_user_id and not is_staff()) then
    raise exception 'Accès refusé.';
  end if;

  return coalesce(
    (select client_id from player_profiles where user_id = p_owner_user_id limit 1),
    (select client_id from connect_profile_settings where user_id = p_owner_user_id limit 1)
  );
end;
$function$;

-- connect_agent_effective_tier() est réutilisée EN INTERNE par
-- connect_particulier_limit() ci-dessus avec le même p_user_id que
-- l'appelant déjà vérifié — l'appel interne passe donc toujours le
-- garde (auth.uid() = p_user_id), aucune régression.
