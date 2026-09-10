-- Le CM pouvait suspendre un coach dans `club_members`, et la synchronisation le refusait.
--
-- ── Ce que le test a montré ──
-- Après la v105, le CM avait bien le droit de révoquer un coach en le passant à « suspendu ».
-- L'écriture partait, puis :
--
--   ERROR: Modification non autorisée : seule l'activation de votre propre invitation est
--          permise en self-service.
--
-- Le message ne vient pas de `club_members` mais de `memberships` : le trigger
-- `sync_club_member_to_membership` répercute tout changement de rôle ou de statut sur la ligne
-- `memberships`, et `protect_sensitive_membership_fields` y refuse tout ce qui n'est pas un
-- administrateur de l'organisation — ce que le CM n'est justement pas, par construction.
--
-- Autrement dit : deux tables, deux gardiens, et le second ignorait la décision du premier. Même
-- fracture que celle qui traîne depuis ce matin, un cran plus bas.
--
-- ── Ce qu'on fait ──
-- `protect_sensitive_membership_fields` reconnaît désormais l'opérateur du club, avec exactement
-- les mêmes bornes qu'un administrateur d'organisation : activer ou suspendre, jamais autre
-- chose. Les rôles privilégiés restent hors de sa portée — c'est la v105 qui les garde, sur
-- `club_members`, en amont de cette synchronisation.
--
-- On ne touche ni au cas « self-activation », ni au garde-fou qui empêche un admin de se
-- rétrograder lui-même.

begin;

create or replace function public.protect_sensitive_membership_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_is_staff boolean;
  v_is_org_admin boolean;
  v_est_operateur boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin','sec')
  ) into v_is_staff;

  if v_is_staff then
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id then
    raise exception 'Modification non autorisée : l''organisation d''une adhésion est immuable.';
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'Modification non autorisée : une adhésion ne peut pas être réattribuée à un autre utilisateur.';
  end if;

  select is_org_admin(old.organization_id) into v_is_org_admin;

  -- 10/09/2026 — L'opérateur du club (CM affilié, staff d'exploitation) administre les accès
  -- opérationnels de ses clubs : il doit pouvoir activer et suspendre, comme un administrateur
  -- d'organisation. Il n'obtient rien de plus : les rôles privilégiés sont gardés en amont, sur
  -- `club_members` (migration v105), et cette fonction ne fait que répercuter.
  select peut_operer_club(old.organization_id) into v_est_operateur;

  -- Cas 1 : un admin de l'organisation, ou l'opérateur du club, modifie un AUTRE membre. Jamais
  -- sa propre ligne par ce chemin — évite qu'un admin se rétrograde ou se suspende lui-même et
  -- verrouille son organisation sans personne pour revenir en arrière.
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

  -- Cas 2 : self-activation (inchangé depuis v5).
  if new.role is distinct from old.role then
    raise exception 'Modification non autorisée : le rôle est réservé au staff SportVision ou à un administrateur de l''organisation.';
  end if;

  if new.status is distinct from old.status then
    if not (old.status = 'invitation' and new.status = 'actif' and old.user_id = auth.uid()) then
      raise exception 'Modification non autorisée : seule l''activation de votre propre invitation est permise en self-service.';
    end if;
  end if;

  return new;
end;
$function$;

commit;
