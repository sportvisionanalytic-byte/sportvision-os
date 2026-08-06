-- ============================================================
-- Migration de sécurité : verrouille les colonnes sensibles de
-- `club_members` (role, club_id, status) et `client_users` (client_id)
-- contre une auto-promotion / auto-changement de tenant.
--
-- Même défaut, même correctif que migration-securite-profiles-rls.sql
-- (déjà appliquée sur `profiles`) — jamais répliqué sur ces deux tables.
-- ============================================================
--
-- ─── Failles corrigées ───────────────────────────────────────────────────────
--
-- 1. `club_members` — policy "cm_self_update" (migration-clubplus-v1.sql:132) :
--    `for update using (auth.uid() = user_id)`, sans restriction de colonne.
--    N'importe quel membre d'un club (coach, secrétaire, lecture_seule...)
--    pouvait, par un simple appel PATCH direct à l'API REST Supabase (clé
--    publishable déjà visible dans le HTML + son propre jeton de session),
--    changer sa propre ligne `role` en 'admin' et obtenir le contrôle total
--    du club via la policy "cm_admin_update"/"cm_admin_delete"
--    (migration-clubplus-v2.sql) qui ne vérifie que `is_club_admin(club_id)`.
--
-- 2. `client_users` — policy "cu_self_update" (migration-portail-v1.sql:42) :
--    même défaut sur `client_id`, qui est la clé de cloisonnement utilisée
--    par TOUTES les policies du Portail (prestations, devis, contrats,
--    avis_clients, facturation — cf. migration-portail-v2/v3/v4/v5/v6/v8/v21).
--    Un client Portail pouvait changer son propre `client_id` vers celui d'un
--    autre client par un seul PATCH, et voir/agir sur les prestations, devis,
--    contrats et avis de cet autre client. Fuite inter-tenant complète.
--
-- ─── Ce que fait cette migration ────────────────────────────────────────────
--
-- 1. `club_members` : un trigger bloque toute modification de role/club_id/
--    status par quelqu'un qui n'est ni le staff OS (profiles.role in admin,
--    com, sec — même liste que "cm_staff_all") ni l'admin actif du club
--    concerné (is_club_admin, même fonction que "cm_admin_update"). `club_id`
--    reste bloqué même pour un admin de club : une ligne club_members ne doit
--    jamais changer de club par UPDATE (seule l'Edge Function clubplus-invite
--    crée des lignes, cf. note de migration-clubplus-v2.sql) — un déplacement
--    de club se fait par suppression + recréation, jamais par UPDATE.
--
-- 2. `client_users` : un trigger bloque toute modification de `client_id` par
--    quelqu'un qui n'est pas staff OS (même liste de rôles que "cu_staff_all" :
--    admin, sec, com, compta). prenom/nom/telephone restent modifiables par le
--    client lui-même, seul `client_id` est protégé.
--
-- Idempotente : DROP ... IF EXISTS avant chaque CREATE, peut être rejouée sans
-- effet de bord. À exécuter dans Supabase → SQL Editor.

-- ─── 1. Trigger de protection des colonnes sensibles sur club_members ───────
create or replace function protect_sensitive_club_member_fields()
returns trigger language plpgsql security definer as $$
declare
  is_os_staff boolean;
  is_this_club_admin boolean;
begin
  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin', 'com', 'sec')
  ) into is_os_staff;

  select is_club_admin(old.club_id) into is_this_club_admin;

  if new.club_id is distinct from old.club_id then
    raise exception 'Modification non autorisée : club_id est immuable, une adhésion ne se déplace pas par UPDATE.';
  end if;

  if not is_os_staff and not is_this_club_admin then
    if new.role is distinct from old.role
       or new.status is distinct from old.status
    then
      raise exception 'Modification non autorisée : rôle et statut sont réservés à l''administrateur du club ou au staff SportVision.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_sensitive_club_member_fields on club_members;
create trigger trg_protect_sensitive_club_member_fields
  before update on club_members
  for each row execute function protect_sensitive_club_member_fields();

-- ─── 2. Trigger de protection de client_id sur client_users ─────────────────
create or replace function protect_sensitive_client_user_fields()
returns trigger language plpgsql security definer as $$
declare
  is_os_staff boolean;
begin
  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin', 'sec', 'com', 'compta')
  ) into is_os_staff;

  if not is_os_staff then
    if new.client_id is distinct from old.client_id then
      raise exception 'Modification non autorisée : client_id est réservé au staff SportVision.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_sensitive_client_user_fields on client_users;
create trigger trg_protect_sensitive_client_user_fields
  before update on client_users
  for each row execute function protect_sensitive_client_user_fields();
