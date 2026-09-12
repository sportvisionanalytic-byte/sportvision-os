-- v188 — Une invitation de parent ne vaut que pour un enfant du club qui invite (12/09/2026).
--
-- Faille trouvée à l'audit du 12/09. `accept_parent_invitation` ne vérifiait qu'une chose :
-- l'adresse e-mail de l'invitation est celle du compte. Or c'est celui qui invite qui choisit
-- cette adresse. Et `clubplus-family-invite` contrôlait le club de l'APPELANT, jamais le club de
-- l'ENFANT désigné par `player_id`.
--
-- Chemin complet : ouvrir un Club+ Gratuit (self-service, deux minutes) → on est admin de son
-- propre club, donc `peut_operer_club` dit oui → s'inviter soi-même comme parent avec le
-- `player_id` d'un enfant de n'importe quel club → accepter. Le lien naissait `confirme`, et
-- `is_confirmed_parent_of()` ouvre alors la fiche du mineur, son équipe, son calendrier, ses
-- photos, ses achats, et le dépôt de sa photo de visage.
--
-- Le contrôle est posé ICI, en base, parce qu'une edge function n'est pas un garde-fou : le même
-- insert peut venir d'ailleurs. La fonction est corrigée en parallèle, les deux se doublent.
-- Idempotente.

create or replace function public.accept_parent_invitation(p_invitation_id uuid)
returns parent_player_relationships
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_inv parent_invitations;
  v_parent parent_profiles;
  v_rel parent_player_relationships;
begin
  select * into v_inv from parent_invitations where id = p_invitation_id;
  if v_inv.id is null then raise exception 'Invitation introuvable'; end if;
  if v_inv.statut <> 'envoyee' then raise exception 'Invitation déjà traitée'; end if;
  if v_inv.email is distinct from auth.email() then raise exception 'Cette invitation ne correspond pas à votre compte'; end if;

  -- Le joueur désigné doit appartenir au club qui a émis l'invitation.
  if v_inv.player_id is not null then
    if not exists (
      select 1 from player_profiles pp
       where pp.id = v_inv.player_id
         and pp.club_id is not distinct from v_inv.club_id
    ) then
      raise exception 'Cette invitation ne correspond pas à un joueur de ce club.'
        using errcode = '42501';
    end if;
  end if;

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
end $function$;
