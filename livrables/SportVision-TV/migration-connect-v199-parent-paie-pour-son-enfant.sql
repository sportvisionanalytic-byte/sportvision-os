-- v199 — Le parent d'un enfant affilié peut payer, et retrouve sa commande (12/09/2026).
--
-- CE QUI N'ALLAIT PAS. Trois fonctions décident qui peut agir pour qui.
-- `connect_resolve_beneficiary_client_id` et `connect_list_contents_for_athletes` connaissent le
-- cas « club » : un parent confirmé, relié à son enfant par `parent_player_relationships`. Les
-- deux autres ne le connaissaient pas :
--   • `connect_particulier_can_pay_client` : branches self, player_profiles, managed, linked —
--     aucune sur le lien parental ;
--   • `connect_client_ids_for_caller` : union de self, linked, managed — pas de branche club.
--
-- Le parcours était donc coupé au milieu : le parent réserve une prestation pour son enfant (la
-- réservation marche, elle passe par la fonction qui connaît le cas), la prestation est créée sur
-- la fiche client de l'enfant, puis il clique « Régler » et reçoit 403. Et s'il contourne, la
-- commande n'apparaît ni dans ses commandes, ni dans ses factures : « Commande introuvable ».
--
-- C'est exactement le parcours dont Fouka a demandé qu'il fonctionne : un parent réserve, paie, et
-- retrouve sa commande.
--
-- On exige `is_confirmed_parent_of`, qui est la seule définition d'un parent confirmé dans toute
-- la base, et qui exclut déjà les joueurs retirés ou suspendus (v179).
-- Idempotente.

create or replace function public.connect_particulier_can_pay_client(p_client_id uuid)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select
    -- "self" : le compte du payeur EST le client.
    exists (
      select 1 from connect_profile_settings
      where user_id = auth.uid() and client_id = p_client_id
    )
    or exists (
      select 1 from player_profiles
      where user_id = auth.uid() and client_id = p_client_id
    )
    -- "managed" : sportif géré par l'appelant.
    or exists (
      select 1 from managed_athlete_profiles
      where owner_user_id = auth.uid() and client_id = p_client_id
    )
    -- "club" (v199) : parent confirmé d'un joueur affilié à un club. C'est le cas le plus
    -- courant, et c'était le seul absent.
    or exists (
      select 1 from player_profiles pp
      where pp.client_id = p_client_id
        and is_confirmed_parent_of(pp.id)
    )
    -- "linked" : sportif ayant accordé le droit right_payer à l'appelant.
    or exists (
      select 1
      from connect_access_relationships car
      join player_profiles pp on pp.user_id = car.owner_user_id
      where car.grantee_user_id = auth.uid()
        and car.status = 'acceptee'
        and car.right_payer
        and pp.client_id = p_client_id
    )
    or exists (
      select 1
      from connect_access_relationships car
      join connect_profile_settings cps on cps.user_id = car.owner_user_id
      where car.grantee_user_id = auth.uid()
        and car.status = 'acceptee'
        and car.right_payer
        and cps.client_id = p_client_id
    );
$function$;

-- La liste des clients pour lesquels l'appelant agit : même trou, mêmes conséquences (commandes
-- et factures introuvables). On y ajoute la branche club.
do $$
declare v_src text;
begin
  select pg_get_functiondef(oid) into v_src from pg_proc
   where proname = 'connect_client_ids_for_caller' and pronamespace = 'public'::regnamespace;
  if v_src is null then raise exception 'connect_client_ids_for_caller introuvable'; end if;
  if position('is_confirmed_parent_of' in v_src) > 0 then
    raise notice 'Branche club déjà présente.';
    return;
  end if;
  v_src := replace(v_src,
    '  union all
  select map.client_id, ''managed''::text, map.id, map.prenom || '' '' || map.nom',
    '  union all
  -- "club" (v199) : parent confirmé d''un joueur affilié. Sans cette branche, la commande passée
  -- pour son enfant n''apparaissait ni dans ses commandes ni dans ses factures.
  select pp.client_id, ''club''::text, pp.id,
         coalesce(nullif(trim(concat(pp.prenom, '' '', pp.nom)), ''''), ''Mon enfant'')
  from player_profiles pp
  where pp.client_id is not null
    and is_confirmed_parent_of(pp.id)

  union all
  select map.client_id, ''managed''::text, map.id, map.prenom || '' '' || map.nom');
  execute v_src;
end $$;
