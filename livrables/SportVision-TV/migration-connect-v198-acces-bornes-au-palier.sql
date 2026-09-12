-- v198 — Les accès suivis s'arrêtent avec l'abonnement (12/09/2026).
--
-- CE QUI N'ALLAIT PAS. Sur `customer.subscription.deleted`, le webhook passe l'abonnement Agent
-- en `canceled`. `connect_agent_effective_tier` retombe alors sur `gratuit` (2 sportifs), mais les
-- lignes `connect_access_relationships` en `acceptee` ne sont jamais touchées, et AUCUNE lecture
-- ne les filtre par palier : `connect_client_ids_for_caller` et `connect_list_my_athletes` ne
-- testent que `status = 'acceptee'`.
--
-- Un agent souscrivait Pro (24,90 EUR), faisait accepter 20 demandes d'accès dans le mois,
-- résiliait, et continuait de lire les contenus, les commandes, les factures et les messages de
-- ces 20 sportifs, indéfiniment, en payant zéro. Variante silencieuse : Pro vers Starter, facturé
-- 9,90 EUR au lieu de 24,90 EUR, vingt sportifs conservés.
--
-- CE QUE FAIT CETTE MIGRATION. Le plafond s'applique à la LECTURE, là où il compte. Au-delà de la
-- limite du palier réellement en cours, seuls les N accès les plus ANCIENS restent servis : celui
-- qui redescend garde ce qu'il avait en premier, et ne perd jamais un accès au hasard. Rien n'est
-- supprimé : l'accès redevient entier dès que l'abonnement reprend.
--
-- La descente de palier est par ailleurs refusée côté paiement tant que le nombre de sportifs
-- dépasse la nouvelle limite (manage-agent-subscription) : cette borne-ci est le filet.
--
-- Aujourd'hui : 0 relation en production. On pose la règle avant qu'elle coûte quelque chose.
-- Idempotente.

create or replace function public.connect_acces_dans_le_palier(p_grantee uuid)
returns table(relation_id uuid)
language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  with limite as (
    select case
             when cps.profil_particulier = 'agent'
               then connect_agent_tier_limit(connect_agent_effective_tier(p_grantee))
             when cps.profil_particulier in ('parent', 'tuteur', 'autre') then 3
             when cps.created_at < timestamptz '2026-08-16 00:00:00+00' then 999
             else 3
           end as n
      from connect_profile_settings cps
     where cps.user_id = p_grantee
  ),
  classees as (
    select car.id,
           row_number() over (order by coalesce(car.responded_at, car.created_at), car.id) as rang
      from connect_access_relationships car
     where car.grantee_user_id = p_grantee
       and car.status = 'acceptee'
  )
  select c.id from classees c
   where c.rang <= coalesce((select n from limite), 3);
$function$;

grant execute on function public.connect_acces_dans_le_palier(uuid) to authenticated, anon;

create or replace function public.connect_client_ids_for_caller(p_right text)
returns table(client_id uuid, kind text, ref_id uuid, label text)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;
  if p_right not in ('voir','download','reserver','commandes','factures','payer','cotisation','calendrier','modifier') then
    raise exception 'Droit inconnu.';
  end if;

  return query
  select cid, 'self'::text, auth.uid(), null::text
  from (select connect_owner_client_id(auth.uid()) as cid) s
  where cid is not null

  union all
  select connect_owner_client_id(car.owner_user_id), 'linked'::text, car.owner_user_id,
    coalesce(nullif(trim(concat(pp.prenom, ' ', pp.nom)), ''), car.grantee_display_name, 'Sportif')
  from connect_access_relationships car
  left join player_profiles pp on pp.user_id = car.owner_user_id
  where car.grantee_user_id = auth.uid()
    and car.status = 'acceptee'
    -- Au-delà du palier réellement en cours, l'accès n'est plus servi (v198).
    and car.id in (select relation_id from connect_acces_dans_le_palier(auth.uid()))
    and connect_owner_client_id(car.owner_user_id) is not null
    and case p_right
      when 'voir' then car.right_voir
      when 'download' then car.right_download
      when 'reserver' then car.right_reserver
      when 'commandes' then car.right_commandes
      when 'factures' then car.right_factures
      when 'payer' then car.right_payer
      when 'cotisation' then car.right_cotisation
      when 'calendrier' then car.right_calendrier
      when 'modifier' then car.right_modifier
    end

  union all
  select map.client_id, 'managed'::text, map.id, map.prenom || ' ' || map.nom
  from managed_athlete_profiles map
  where map.owner_user_id = auth.uid() and map.client_id is not null;
end;
$function$;

-- Même borne sur la liste des sportifs suivis : sinon l'écran continue d'afficher vingt fiches
-- dont plus aucune n'ouvre quoi que ce soit, ce qui serait pire qu'un refus clair.
do $$
declare v_src text;
begin
  select pg_get_functiondef(oid) into v_src from pg_proc
   where proname = 'connect_list_my_athletes' and pronamespace = 'public'::regnamespace;
  if v_src is null then raise exception 'connect_list_my_athletes introuvable'; end if;
  if position('connect_acces_dans_le_palier' in v_src) > 0 then
    raise notice 'Déjà bornée, rien à faire.';
    return;
  end if;
  v_src := replace(v_src,
    'where car.grantee_user_id = auth.uid() and car.status = ''acceptee''',
    'where car.grantee_user_id = auth.uid() and car.status = ''acceptee''
    and car.id in (select relation_id from connect_acces_dans_le_palier(auth.uid()))');
  execute v_src;
end $$;
