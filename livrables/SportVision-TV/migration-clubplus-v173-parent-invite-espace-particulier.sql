-- v173 : le parent invité par le club arrive dans SON espace (12/09/2026).
--
-- accept_parent_invitation() créait bien le profil parent et le rattachement à l'enfant, mais
-- n'écrivait jamais connect_profile_settings.account_type, dont la valeur par défaut est
-- « joueur ». Le parent invité par le club atterrissait donc dans l'Espace joueur, vide, après
-- avoir lu « vous pourrez suivre ses contenus depuis votre espace ». Il n'avait aucun moyen de
-- comprendre ce qui s'était passé.
--
-- La fonction pose maintenant le type de compte « particulier » et le profil « parent ». Elle ne
-- touche à rien d'autre : un compte qui serait déjà réglé (un parent qui est aussi joueur, cas
-- rare mais réel) garde son réglage.
-- Test : tests/parent-invite-espace-particulier.test.sql

create or replace function public.accept_parent_invitation(p_invitation_id uuid)
returns parent_player_relationships
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_inv parent_invitations;
  v_parent parent_profiles;
  v_rel parent_player_relationships;
begin
  select * into v_inv from parent_invitations where id = p_invitation_id;
  if v_inv.id is null then raise exception 'Invitation introuvable'; end if;
  if v_inv.statut <> 'envoyee' then raise exception 'Invitation déjà traitée'; end if;
  if v_inv.email is distinct from auth.email() then raise exception 'Cette invitation ne correspond pas à votre compte'; end if;

  select * into v_parent from parent_profiles where user_id = auth.uid();
  if v_parent.id is null then
    insert into parent_profiles (user_id, prenom, nom) values (auth.uid(), v_inv.prenom, v_inv.nom)
    returning * into v_parent;
  end if;

  -- Le type de compte : sans lui, l'application ouvre l'Espace joueur, qui n'a rien à lui montrer.
  insert into connect_profile_settings (user_id, account_type, profil_particulier)
  values (auth.uid(), 'particulier', 'parent')
  on conflict (user_id) do update
     set account_type = case when connect_profile_settings.account_type = 'joueur'
                             then 'particulier' else connect_profile_settings.account_type end,
         profil_particulier = coalesce(connect_profile_settings.profil_particulier, 'parent'),
         updated_at = now();

  update parent_invitations set statut = 'acceptee' where id = p_invitation_id;

  if v_inv.player_id is not null then
    insert into parent_player_relationships (parent_id, player_id, statut, confirmed_at)
    values (v_parent.id, v_inv.player_id, 'confirme', now())
    on conflict (parent_id, player_id) do update set statut = 'confirme', confirmed_at = now()
    returning * into v_rel;
  end if;

  return v_rel;
end $$;
