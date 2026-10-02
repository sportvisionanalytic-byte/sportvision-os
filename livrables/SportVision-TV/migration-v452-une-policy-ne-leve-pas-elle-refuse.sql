-- v452 (02/10/2026) — Une policy ne lève pas, elle refuse.
--
-- MESURÉ : un visiteur sans compte qui touche `messages_client` ou les objets `messages/` reçoit
--
--     ERROR P0001 « Accès refusé. »
--     CONTEXT PL/pgSQL function connect_owner_client_id(uuid) line 4 at RAISE
--
-- c'est-à-dire un HTTP 500 « DatabaseError » là où il devait recevoir un refus propre. Ça FERME
-- bien — il n'y a aucune fuite, c'est vérifié — mais une exception levée à l'intérieur d'une policy
-- est une mine. Une policy s'évalue sur CHAQUE ligne candidate : le jour où elle rencontre une
-- ligne dont le propriétaire n'est pas l'appelant au cours d'une lecture par ailleurs légitime,
-- c'est la lecture légitime qui tombe, pas la ligne.
--
-- POURQUOI ON NE CHANGE PAS LA FONCTION EXISTANTE. `connect_owner_client_id` est appelée à deux
-- titres : par ces quatre policies, et par trois RPC (`client_mark_message_read`,
-- `connect_client_ids_for_caller`, `connect_get_athlete_detail`) où la LEVÉE EST LE REFUS. La
-- rendre muette ouvrirait ces trois-là sur un `client_id` nul. On la laisse donc intacte, et on
-- ajoute une jumelle silencieuse réservée aux policies : NULL au lieu de l'exception, et une
-- comparaison avec NULL rend NULL, donc faux, donc refusé — exactement l'effet voulu.
--
-- Les quatre expressions ci-dessous sont RECOPIÉES DE LA BASE, pas réécrites de mémoire : elles ont
-- été relues par pg_get_expr juste avant de générer ce fichier, et le seul changement est le nom de
-- la fonction appelée.

create or replace function public.connect_owner_client_id_muet(p_owner_user_id uuid)
returns uuid
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  -- Jumelle silencieuse de connect_owner_client_id, pour usage EN POLICY uniquement. Mêmes
  -- conditions, mais un refus se dit NULL : une policy qui lève fait tomber la requête entière.
  if auth.uid() is null or (auth.uid() <> p_owner_user_id and not is_staff()) then
    return null;
  end if;

  return coalesce(
    (select client_id from player_profiles where user_id = p_owner_user_id limit 1),
    (select client_id from connect_profile_settings where user_id = p_owner_user_id limit 1)
  );
end;
$function$;

drop policy if exists mc_client_insert on public.messages_client;
create policy mc_client_insert on public.messages_client
  for insert
  with check (((auteur_type = 'client'::text) AND ((auteur_client_id = auth.uid()) OR (auteur_client_id IS NULL)) AND ((EXISTS ( SELECT 1
   FROM client_users cu
  WHERE ((cu.id = auth.uid()) AND (cu.client_id = messages_client.client_id)))) OR club_member_has_client_access(client_id) OR player_has_client_access(client_id) OR (connect_owner_client_id_muet(auth.uid()) = client_id) OR (EXISTS ( SELECT 1
   FROM connect_access_relationships car
  WHERE ((car.grantee_user_id = auth.uid()) AND (car.status = 'acceptee'::text) AND car.right_voir AND (connect_owner_client_id_muet(car.owner_user_id) = messages_client.client_id)))) OR (EXISTS ( SELECT 1
   FROM managed_athlete_profiles map
  WHERE ((map.owner_user_id = auth.uid()) AND (map.client_id = messages_client.client_id)))))));

drop policy if exists mc_client_select on public.messages_client;
create policy mc_client_select on public.messages_client
  for select
  using (((EXISTS ( SELECT 1
   FROM client_users cu
  WHERE ((cu.id = auth.uid()) AND (cu.client_id = messages_client.client_id)))) OR club_member_has_client_access(client_id) OR player_has_client_access(client_id) OR (connect_owner_client_id_muet(auth.uid()) = client_id) OR (EXISTS ( SELECT 1
   FROM connect_access_relationships car
  WHERE ((car.grantee_user_id = auth.uid()) AND (car.status = 'acceptee'::text) AND car.right_voir AND (connect_owner_client_id_muet(car.owner_user_id) = messages_client.client_id)))) OR (EXISTS ( SELECT 1
   FROM managed_athlete_profiles map
  WHERE ((map.owner_user_id = auth.uid()) AND (map.client_id = messages_client.client_id))))));

drop policy if exists sv_media_prive_messages_insert on storage.objects;
create policy sv_media_prive_messages_insert on storage.objects
  for insert
  with check (((bucket_id = 'sportvision-media-prive'::text) AND ((storage.foldername(name))[1] = 'messages'::text) AND ((EXISTS ( SELECT 1
   FROM client_users cu
  WHERE ((cu.id = auth.uid()) AND ((cu.client_id)::text = (storage.foldername(objects.name))[2])))) OR club_member_has_client_access(((storage.foldername(name))[2])::uuid) OR player_has_client_access(((storage.foldername(name))[2])::uuid) OR (connect_owner_client_id_muet(auth.uid()) = ((storage.foldername(name))[2])::uuid) OR (EXISTS ( SELECT 1
   FROM connect_access_relationships car
  WHERE ((car.grantee_user_id = auth.uid()) AND (car.status = 'acceptee'::text) AND car.right_voir AND (connect_owner_client_id_muet(car.owner_user_id) = ((storage.foldername(objects.name))[2])::uuid)))) OR (EXISTS ( SELECT 1
   FROM managed_athlete_profiles map
  WHERE ((map.owner_user_id = auth.uid()) AND (map.client_id = ((storage.foldername(objects.name))[2])::uuid)))) OR is_staff())));

drop policy if exists sv_media_prive_messages_select on storage.objects;
create policy sv_media_prive_messages_select on storage.objects
  for select
  using (((bucket_id = 'sportvision-media-prive'::text) AND ((storage.foldername(name))[1] = 'messages'::text) AND ((EXISTS ( SELECT 1
   FROM client_users cu
  WHERE ((cu.id = auth.uid()) AND ((cu.client_id)::text = (storage.foldername(objects.name))[2])))) OR club_member_has_client_access(((storage.foldername(name))[2])::uuid) OR player_has_client_access(((storage.foldername(name))[2])::uuid) OR (connect_owner_client_id_muet(auth.uid()) = ((storage.foldername(name))[2])::uuid) OR (EXISTS ( SELECT 1
   FROM connect_access_relationships car
  WHERE ((car.grantee_user_id = auth.uid()) AND (car.status = 'acceptee'::text) AND car.right_voir AND (connect_owner_client_id_muet(car.owner_user_id) = ((storage.foldername(objects.name))[2])::uuid)))) OR (EXISTS ( SELECT 1
   FROM managed_athlete_profiles map
  WHERE ((map.owner_user_id = auth.uid()) AND (map.client_id = ((storage.foldername(objects.name))[2])::uuid)))) OR is_staff())));

