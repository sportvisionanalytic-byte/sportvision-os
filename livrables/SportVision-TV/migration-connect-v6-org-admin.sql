-- ============================================================
-- SPORTVISION CONNECT — Migration v6 : catalogue de rôles centralisé
-- + gestion des autres membres par un admin d'organisation + rôles Sponsor.
--
-- Contexte : la migration v5 n'autorisait qu'une seule action self-service
-- (accepter sa propre invitation). Un admin Coach/Académie ne pouvait pas
-- gérer les AUTRES membres de son organisation (changer un rôle, suspendre),
-- et Sponsor n'avait aucun catalogue de rôles, donc pas d'invitation
-- possible. Cette migration corrige les deux, en évitant de dupliquer le
-- catalogue de rôles à deux endroits (trigger SQL + edge function
-- org-invite) : une seule table `organization_role_catalog` fait
-- désormais foi pour les deux.
--
-- ⚠️ Cette migration change le contrat de l'edge function org-invite :
-- elle doit être REDÉPLOYÉE avec la nouvelle version (fournie séparément)
-- qui lit ce catalogue en base au lieu d'une liste codée en dur. La
-- version actuellement déployée continue de fonctionner pour Coach/
-- Académie (mêmes rôles, mêmes clés) mais ne connaîtra jamais Sponsor
-- tant qu'elle n'est pas redéployée.
--
-- Idempotente. À exécuter après migration-connect-v5-membership-invite.sql.
-- ============================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. CATALOGUE DE RÔLES CENTRALISÉ
-- ═══════════════════════════════════════════════════════════════

create table if not exists organization_role_catalog (
  organization_type text not null,
  role_key text not null,
  label text not null,
  is_admin boolean not null default false,
  is_default boolean not null default false,
  primary key (organization_type, role_key)
);

insert into organization_role_catalog (organization_type, role_key, label, is_admin, is_default) values
  ('coach', 'proprietaire', 'Propriétaire', true, false),
  ('coach', 'assistant', 'Assistant', false, false),
  ('coach', 'resp_communication', 'Responsable communication', false, false),
  ('coach', 'collaborateur_limite', 'Collaborateur (accès limité)', false, true),
  ('academie', 'admin', 'Administrateur', true, false),
  ('academie', 'secretaire', 'Secrétaire', false, false),
  ('academie', 'coach', 'Coach', false, false),
  ('academie', 'resp_programme', 'Responsable programme', false, false),
  ('academie', 'resp_communication', 'Responsable communication', false, false),
  ('academie', 'lecture_seule', 'Lecture seule', false, true),
  -- Sponsor n'avait aucun rôle défini nulle part avant cette migration.
  -- Deux rôles minimalistes : un référent qui peut inviter/gérer, un
  -- contact simple en lecture. À affiner si un vrai usage sponsor révèle
  -- un besoin plus fin (ex: contact facturation distinct du contact
  -- communication) — pas inventé ici faute de cas réel à observer.
  ('sponsor', 'referent', 'Référent', true, false),
  ('sponsor', 'contact', 'Contact', false, true)
on conflict (organization_type, role_key) do nothing;

alter table organization_role_catalog enable row level security;

drop policy if exists "orc_public_select" on organization_role_catalog;
create policy "orc_public_select" on organization_role_catalog for select using (true);

drop policy if exists "orc_staff_write" on organization_role_catalog;
create policy "orc_staff_write" on organization_role_catalog for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);


-- ═══════════════════════════════════════════════════════════════
-- 2. is_org_admin() — même pattern que is_club_admin pour Club
-- ═══════════════════════════════════════════════════════════════

create or replace function is_org_admin(p_organization_id uuid)
returns boolean language sql stable security definer as $$
  select exists(
    select 1 from memberships m
    join organizations o on o.id = m.organization_id
    join organization_role_catalog rc
      on rc.organization_type = o.organization_type and rc.role_key = m.role
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.status = 'actif'
      and rc.is_admin = true
  );
$$;


-- ═══════════════════════════════════════════════════════════════
-- 3. RLS — un admin d'organisation peut désormais écrire sur les lignes
--    memberships de SA PROPRE organisation (le trigger, remplacé ci-
--    dessous, décide ensuite précisément ce qui est permis)
-- ═══════════════════════════════════════════════════════════════

drop policy if exists "mb_org_admin_write" on memberships;
create policy "mb_org_admin_write" on memberships for update using (
  is_org_admin(organization_id)
);


-- ═══════════════════════════════════════════════════════════════
-- 4. TRIGGER — remplace celui de v5, ajoute le cas "admin d'organisation
--    gère un AUTRE membre", garde tel quel le cas self-activation.
-- ═══════════════════════════════════════════════════════════════

create or replace function protect_sensitive_membership_fields()
returns trigger language plpgsql security definer as $$
declare
  v_is_staff boolean;
  v_is_org_admin boolean;
begin
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

  -- Cas 1 : un admin de l'organisation modifie un AUTRE membre. Jamais
  -- sa propre ligne par ce chemin — évite qu'un admin se rétrograde ou
  -- se suspende lui-même par erreur et verrouille son organisation sans
  -- personne pour revenir en arrière (aucun admin de secours automatique
  -- n'existe, donc ce garde-fou est la seule protection pour l'instant).
  if v_is_org_admin and old.user_id is distinct from auth.uid() then
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
        raise exception 'Statut invalide : un admin d''organisation peut seulement activer ou suspendre un membre.';
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
$$;

drop trigger if exists trg_protect_sensitive_membership_fields on memberships;
create trigger trg_protect_sensitive_membership_fields
  before update on memberships
  for each row execute function protect_sensitive_membership_fields();


-- ============================================================
-- NOTE — ce qui reste hors périmètre
--
-- Pas de garantie qu'une organisation garde toujours au moins un admin
-- actif (un admin pourrait suspendre tous les autres admins un par un,
-- ou changer leur rôle vers un rôle non-admin, jusqu'à se retrouver
-- seul). Pas bloqué ici : cas limite rare, à traiter plus tard si un
-- incident réel le justifie plutôt que d'ajouter une contrainte
-- complexe (compter les admins actifs à chaque UPDATE) sans besoin
-- démontré.
-- ============================================================
