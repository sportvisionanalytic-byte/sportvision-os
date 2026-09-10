-- migration-comptes-clubplus-v1 — un membre déjà dans le club peut accepter l'invitation qu'on lui envoie.
--
-- ── Le défaut (audit des créations de compte, 10/09/2026) ──
-- `accepter_invitation_club` sait qu'une personne peut déjà être membre du club : elle ÉLARGIT son
-- rattachement (équipes réunies, rôle d'administrateur ou de président conservé, sinon rôle de
-- l'invitation). Mais elle agit sous l'identité de la personne invitée, et le trigger
-- `protect_sensitive_club_member_fields` ne connaissait qu'un seul cas d'auto-acceptation : le
-- passage « invitation » → « actif » À RÔLE ÉGAL (l'ancien chemin clubplus-invite). Mesuré sur la
-- production, en passant par le vrai lien d'invitation :
--   - un coach déjà membre, invité comme directeur sportif, lisait « Modification non autorisée :
--     rôle et statut sont réservés à l'administrateur du club » et restait coach ;
--   - le président, invité comme coach de l'équipe qu'il entraîne, lisait « Ce rôle relève de la
--     propriété du club » : sa ligne porte un rôle privilégié, et seule une INSERTION était prévue.
-- Dans les deux cas l'invitation avait été préparée par quelqu'un qui en avait le droit
-- (`preparer_invitation_club` exige `peut_operer_club`, et une invitation président exige
-- l'Owner Club+ ou SportVision : `proteger_invitation_role_privilegie`, v116).
--
-- ── Ce qui change ──
-- La personne peut modifier SA propre ligne quand une invitation OUVERTE, adressée à SON adresse,
-- sur CE club, existe, et que le rôle qui en résulte est soit son rôle actuel (conservé), soit
-- exactement celui de l'invitation. C'est la définition même d'accepter cette invitation : rien de
-- plus n'est ouvert. Tout le reste du trigger est inchangé, ligne pour ligne.
--
-- Ce que ça n'ouvre pas : se donner un rôle qu'aucune invitation ne porte ; toucher la ligne d'un
-- autre ; agir sans invitation ouverte (préparée ou envoyée, non expirée). Le périmètre d'équipes
-- suivait déjà cette règle depuis la v97 (`a_une_invitation_ouverte`).
--
-- ── Et son reflet dans `memberships` ──
-- `club_members` est recopiée dans `memberships` par `sync_club_member_to_membership`, toujours
-- sous l'identité de la personne. Le trigger `protect_sensitive_membership_fields` refusait alors
-- à son tour le changement de rôle (« le rôle est réservé au staff SportVision… ») : mesuré en
-- transaction annulée une fois la première correction appliquée. Il laisse désormais passer une
-- mise à jour qui ne fait que RECOPIER la ligne `club_members` correspondante — déjà validée par
-- son propre trigger. Écrire directement dans `memberships` un rôle que `club_members` ne porte pas
-- reste refusé, comme avant.
--
-- Test : livrables/SportVision-TV/tests/invitation-membre-existant.test.sql (transaction annulée),
-- puis livrables/SportVision-TV/tests/clubplus-creation-compte.test.mjs (C10, C12) par le vrai lien.
--
-- NON EXÉCUTÉE en production au moment de l'écriture.

create or replace function public.protect_sensitive_club_member_fields()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  is_os_staff boolean;
  is_this_club_admin boolean;
  is_proprietaire boolean;
  is_self_accepting_own_invitation boolean;
  a_une_invitation_ouverte boolean;
  accepte_une_invitation boolean;
  v_club uuid;
  v_role_privilegie boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  v_club := new.club_id;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin', 'com', 'sec')
  ) into is_os_staff;

  select is_club_admin(v_club) into is_this_club_admin;
  -- `role = 'admin'` strictement : ni le président, ni le CM délégué, ni le super-accès.
  select is_real_club_admin(v_club) into is_proprietaire;

  -- (comptes-clubplus-v1) La personne met à jour SA ligne en acceptant une invitation ouverte qui
  -- lui est adressée sur ce club : le rôle obtenu est le sien (conservé) ou celui de l'invitation.
  accepte_une_invitation := tg_op = 'UPDATE'
    and old.user_id = auth.uid()
    and new.user_id = auth.uid()
    and exists (
      select 1
        from club_invitations ci
        join auth.users u on u.id = auth.uid()
       where ci.club_id = old.club_id
         and lower(ci.email) = lower(u.email)
         and ci.statut in ('preparee', 'envoyee')
         and ci.expire_at > now()
         and (ci.role = new.role or new.role = old.role)
    );

  v_role_privilegie := new.role in ('admin', 'president', 'cm_externe')
                    or (tg_op = 'UPDATE' and old.role in ('admin', 'president', 'cm_externe'));

  if v_role_privilegie and not (is_os_staff or is_proprietaire or accepte_une_invitation) then
    if not (
      tg_op = 'INSERT'
      and new.user_id = auth.uid()
      and exists (
        select 1 from club_invitations ci
        join auth.users u on u.id = auth.uid()
        where ci.club_id = v_club
          and lower(ci.email) = lower(u.email)
          and ci.role = new.role
          and ci.statut in ('preparee', 'envoyee', 'acceptee')
          and ci.expire_at > now() - interval '1 day'
      )
    ) then
      raise exception 'Ce rôle relève de la propriété du club : seul son administrateur peut l''attribuer, le retirer, ou modifier la ligne de qui le porte.';
    end if;
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  if new.club_id is distinct from old.club_id then
    raise exception 'Modification non autorisée : club_id est immuable, une adhésion ne se déplace pas par UPDATE.';
  end if;

  if is_this_club_admin and not is_os_staff and old.user_id = auth.uid()
     and (new.status is distinct from 'actif' or new.role is distinct from old.role)
  then
    raise exception 'Un administrateur ne peut pas se retirer ses propres droits d''administration.';
  end if;

  select exists (
    select 1
      from club_invitations ci
      join auth.users u on u.id = auth.uid()
     where ci.club_id = old.club_id
       and lower(ci.email) = lower(u.email)
       and ci.statut in ('preparee', 'envoyee')
       and ci.expire_at > now()
  ) into a_une_invitation_ouverte;

  if not is_os_staff and not is_this_club_admin and not peut_operer_club(old.club_id)
     and new.teams is distinct from old.teams
     and not (old.user_id = auth.uid() and a_une_invitation_ouverte)
  then
    raise exception 'Modification non autorisée : le périmètre d''équipes est fixé par l''administrateur du club.';
  end if;

  is_self_accepting_own_invitation :=
    (auth.uid() = old.user_id
     and old.status = 'invitation'
     and new.status = 'actif'
     and new.role = old.role)
    -- (comptes-clubplus-v1) ou l'acceptation d'une invitation ouverte, statut ramené à « actif ».
    or (accepte_une_invitation and new.status = 'actif');

  if not is_os_staff and not is_this_club_admin and not peut_operer_club(old.club_id)
     and not is_self_accepting_own_invitation then
    if new.role is distinct from old.role
       or new.status is distinct from old.status
    then
      raise exception 'Modification non autorisée : rôle et statut sont réservés à l''administrateur du club ou au staff SportVision.';
    end if;
  end if;

  return new;
end;
$function$;


create or replace function public.protect_sensitive_membership_fields()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
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

  -- (comptes-clubplus-v1) Le reflet d'une ligne `club_members` : `sync_club_member_to_membership`
  -- recopie rôle et statut après que `protect_sensitive_club_member_fields` les a validés. On ne
  -- laisse passer que la copie EXACTE de cette ligne ; un rôle que `club_members` ne porte pas
  -- continue d'être refusé par les règles ci-dessous.
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
