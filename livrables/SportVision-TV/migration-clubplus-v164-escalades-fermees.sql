-- v164 : fermeture de quatre chemins d'escalade (12/09/2026).
--
-- Trouvés par l'audit de sécurité du 12/09. Aucun n'est atteignable depuis un écran : tous le sont
-- par un appel direct à l'API, ce qui suffit, puisque le jeton d'un compte salarié est dans son
-- navigateur.
--
-- 1. ensure_default_pole_affectation() était exécutable par anon et par tout compte connecté. Elle
--    insère des lignes pole_affectations, y compris en « responsable », pour l'utilisateur qu'on
--    lui passe : un opérateur terrain pouvait se nommer Responsable de pôle, donc ouvrir factures,
--    devis, contrats, rémunérations et chiffre d'affaires du pôle. Elle n'est appelée que par les
--    triggers de création de compte (handle_new_user, handle_user_invited), tous deux SECURITY
--    DEFINER appartenant à postgres : leur retirer l'accès public ne casse rien.
-- 2. media_link_type_product() était ouverte de la même façon et insère dans media_products. Elle
--    n'est appelée que par media_link_save().
-- 3. Le garde-fou des champs sensibles de profiles ne couvrait que le rôle, le grade et l'état du
--    compte. Trois colonnes en étaient absentes et donnent des droits : cm_niveau_autonomie
--    (« responsable » = tous les contenus de tous les clients, et l'auto-affectation de clubs),
--    niveau_operateur (pilote la rémunération recommandée, 45 à 80 euros), et
--    cm_pool_clubplus_general. type_contrat s'y ajoute, c'est une donnée RH.
-- 4. memberships.cm_super_access n'était protégée par rien : un membre d'agence pouvait s'ouvrir
--    l'accès à tous les clubs en modifiant sa propre ligne.
-- S'y ajoute le cloisonnement manquant sur media_assets : media_albums a sa policy restrictive de
-- périmètre photographe, la table des photos ne l'avait pas.
-- Test : tests/escalades-fermees.test.sql

revoke execute on function public.ensure_default_pole_affectation(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.media_link_type_product(uuid, text) from public, anon, authenticated;

create or replace function public.protect_sensitive_profile_fields()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  is_admin boolean;
  is_lead_cm boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select exists(select 1 from profiles where id = auth.uid() and role = 'admin') into is_admin;
  select exists(select 1 from profiles where id = auth.uid() and role = 'cm' and niveau_cm = 'cm_lead') into is_lead_cm;

  if not is_admin then
    if new.role is distinct from old.role
       or new.grade is distinct from old.grade
       or new.grade_valide_at is distinct from old.grade_valide_at
       or new.grade_valide_par is distinct from old.grade_valide_par
       or new.actif is distinct from old.actif
    then
      raise exception 'Modification non autorisée : rôle, grade et statut du compte sont réservés à l''administrateur.';
    end if;
    -- Ajouts du 12/09/2026 : ces colonnes donnent des droits ou fixent de l'argent.
    if new.cm_niveau_autonomie is distinct from old.cm_niveau_autonomie
       or new.cm_pool_clubplus_general is distinct from old.cm_pool_clubplus_general
    then
      raise exception 'Modification non autorisée : le niveau d''autonomie CM est réservé à l''administrateur.';
    end if;
    if new.niveau_operateur is distinct from old.niveau_operateur then
      raise exception 'Modification non autorisée : le niveau d''opérateur fixe la rémunération recommandée, il est réservé à l''administrateur.';
    end if;
    if new.type_contrat is distinct from old.type_contrat then
      raise exception 'Modification non autorisée : le type de contrat est réservé à l''administrateur.';
    end if;
    if new.niveau_cm is distinct from old.niveau_cm and not is_lead_cm then
      raise exception 'Modification non autorisée : le niveau CM est réservé à l''administrateur ou au Lead CM.';
    end if;
  end if;

  return new;
end $$;

create or replace function public.protect_sensitive_membership_fields()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_is_staff boolean;
  v_is_org_admin boolean;
  v_est_operateur boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select exists(select 1 from profiles where id = auth.uid() and role in ('admin','sec')) into v_is_staff;
  if v_is_staff then
    return new;
  end if;

  -- 12/09/2026 : l'accès « tous les clubs » d'une agence CM ne se donne pas soi-même. Il vient du
  -- staff SportVision, seul chemin restant après ce garde-fou.
  if new.cm_super_access is distinct from old.cm_super_access then
    raise exception 'Modification non autorisée : l''accès étendu d''une agence est réservé au staff SportVision.';
  end if;

  if new.organization_id is distinct from old.organization_id then
    raise exception 'Modification non autorisée : l''organisation d''une adhésion est immuable.';
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'Modification non autorisée : une adhésion ne peut pas être réattribuée à un autre utilisateur.';
  end if;

  if old.source = 'club_members' and exists (
    select 1 from club_members cm
     where cm.user_id = new.user_id
       and cm.club_id = new.organization_id
       and cm.role = new.role
       and cm.status = new.status
  ) then
    return new;
  end if;

  select is_org_admin(old.organization_id) into v_is_org_admin;
  select peut_operer_club(old.organization_id) into v_est_operateur;

  if (v_is_org_admin or v_est_operateur) and old.user_id is distinct from auth.uid() then
    if new.role is distinct from old.role then
      if not exists (
        select 1 from organization_role_catalog rc
        join organizations o on o.organization_type = rc.organization_type
        where o.id = old.organization_id and rc.role_key = new.role
      ) then
        raise exception 'Rôle invalide pour ce type d''organisation.';
      end if;
    end if;
    if new.status is distinct from old.status then
      if new.status not in ('actif', 'suspendu') then
        raise exception 'Statut invalide : un administrateur d''organisation peut seulement activer ou suspendre un membre.';
      end if;
      if old.status = 'invitation' and new.status = 'suspendu' then
        raise exception 'Une invitation en attente ne peut pas être suspendue, seulement annulée par le staff.';
      end if;
    end if;
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Modification non autorisée : le rôle est réservé au staff SportVision ou à un administrateur de l''organisation.';
  end if;

  if new.status is distinct from old.status then
    if not (old.status = 'invitation' and new.status = 'actif' and old.user_id = auth.uid()) then
      raise exception 'Modification non autorisée : seule l''activation de votre propre invitation est permise en self-service.';
    end if;
  end if;

  return new;
end $$;

-- Le périmètre du photographe, posé sur les photos comme il l'est déjà sur les galeries.
drop policy if exists massets_photographe_perimetre on public.media_assets;
create policy massets_photographe_perimetre on public.media_assets as restrictive for all to public
  using (not est_operateur_terrain() or photographe_voit_album(album_id))
  with check (not est_operateur_terrain() or photographe_voit_album(album_id));
