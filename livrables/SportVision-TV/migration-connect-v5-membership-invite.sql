-- ============================================================
-- SPORTVISION CONNECT — Migration v5 : auto-activation des memberships
-- + synchronisation continue clients/clubs → organizations.
--
-- Deux sujets indépendants, regroupés car tous deux nécessaires pour que
-- le futur flux d'invitation self-service (edge function org-invite,
-- livrée séparément) fonctionne de bout en bout.
--
-- ── 1. Pourquoi l'auto-activation manque ─────────────────────────────
-- migration-connect-v2 a créé `memberships` avec deux policies
-- seulement : lecture (soi-même/staff/membre de l'org) et écriture
-- réservée au staff ("mb_staff_write"). Concrètement, un utilisateur
-- invité à rejoindre une organisation (Coach, Académie, Sponsor...) n'a
-- AUCUN moyen de faire passer sa propre ligne de statut 'invitation' à
-- 'actif' après avoir accepté — la seule action possible aujourd'hui
-- serait que le staff le fasse à la main pour chaque invitation. Ce
-- n'était pas visible tant qu'aucun flux d'invitation self-service
-- n'existait ; l'edge function org-invite en dépend directement.
--
-- ── 2. Pourquoi une nouvelle organisation n'apparaît pas automatiquement ──
-- migration-connect-v2 peuple `organizations` par une COPIE PONCTUELLE
-- de `clients`/`clubs` au moment de son exécution (documenté explicitement
-- dans ce fichier). Un club ou client créé après coup reste invisible
-- côté Connect tant que personne ne rejoue les INSERT à la main. Cette
-- migration ajoute des triggers sur `clients` et `clubs` qui créent (ou
-- mettent à jour le nom/statut de) la ligne `organizations`
-- correspondante à chaque INSERT/UPDATE — la copie ponctuelle initiale
-- de v2 reste nécessaire pour l'historique, mais devient inutile pour
-- tout ce qui est créé après cette migration.
--
-- Idempotente. À exécuter dans Supabase → SQL Editor, après
-- migration-connect-v2-organizations-entitlements.sql (v3/v4 non
-- requises pour ce fichier, mais ne pas exécuter avant v2).
-- ============================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. AUTO-ACTIVATION D'UNE INVITATION memberships
-- ═══════════════════════════════════════════════════════════════

drop policy if exists "mb_self_activate" on memberships;
create policy "mb_self_activate" on memberships for update using (
  auth.uid() = user_id
);

-- Même stratégie que pour club_members/club_requests/prestations : RLS ne
-- peut pas restreindre par colonne, donc un trigger protège role/
-- organization_id, et n'autorise QUE la transition invitation → actif
-- sur SA PROPRE ligne en self-service. Gérer le rôle d'un AUTRE membre
-- de l'organisation reste staff-only pour l'instant (pas de rôle
-- "administrateur d'organisation" détecté ici, contrairement à
-- is_club_admin pour Club — à ajouter dans une migration ultérieure si
-- un vrai besoin de gestion inter-membres émerge pour Coach/Académie/
-- Sponsor).
create or replace function protect_sensitive_membership_fields()
returns trigger language plpgsql security definer as $$
declare
  v_is_staff boolean;
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

  if new.role is distinct from old.role then
    raise exception 'Modification non autorisée : le rôle est réservé au staff SportVision.';
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


-- ═══════════════════════════════════════════════════════════════
-- 2. SYNCHRONISATION CONTINUE clients/clubs → organizations
--    (même logique de peuplement que migration-connect-v2 §3.1/§3.2,
--    appliquée désormais à chaque écriture plutôt qu'une seule fois)
-- ═══════════════════════════════════════════════════════════════

create or replace function sync_club_to_organization()
returns trigger language plpgsql security definer as $$
begin
  insert into organizations (id, organization_type, nom, ville, legacy_club_id, legacy_client_id)
  values (new.id, 'club', new.nom, new.ville, new.id, new.portail_client_id)
  on conflict (id) do update set
    nom = excluded.nom,
    ville = excluded.ville,
    legacy_client_id = excluded.legacy_client_id,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_sync_club_to_organization on clubs;
create trigger trg_sync_club_to_organization
  after insert or update on clubs
  for each row execute function sync_club_to_organization();

-- Un client ne devient une organisation "projet" QUE s'il n'est rattaché
-- à aucun club (même règle qu'en v2 §3.2) — sinon c'est le club qui fait
-- déjà foi pour cette entité, et créer une 2e ligne organizations
-- dupliquerait un même client réel en deux espaces distincts.
create or replace function sync_client_to_organization()
returns trigger language plpgsql security definer as $$
begin
  if exists (select 1 from clubs c where c.portail_client_id = new.id) then
    return new;
  end if;
  insert into organizations (id, organization_type, nom, ville, legacy_client_id, legacy_type_client)
  values (new.id, 'projet', new.nom, new.ville, new.id, new.type_client)
  on conflict (id) do update set
    nom = excluded.nom,
    ville = excluded.ville,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_sync_client_to_organization on clients;
create trigger trg_sync_client_to_organization
  after insert or update on clients
  for each row execute function sync_client_to_organization();

-- Cas particulier : un client existant qui se voit rattacher un club
-- APRÈS coup (clubs.portail_client_id renseigné a posteriori) ne doit
-- plus avoir sa propre ligne organizations séparée — le club devient la
-- référence. On ne supprime pas la ligne automatiquement (une
-- suppression pourrait casser des memberships déjà créés dessus sans
-- validation écrite, contraire à la règle de prudence) : on se contente
-- de na pas laisser trg_sync_club_to_organization recréer un doublon,
-- déjà garanti par le on conflict (id) do update ci-dessus (l'id club
-- est distinct de l'id client, donc c'est bien deux lignes tant que
-- l'ancienne n'est pas nettoyée à la main si besoin).


-- ============================================================
-- NOTE — vérification recommandée après exécution
--
-- select count(*) from memberships where status = 'invitation';
-- (juste pour confirmer que la colonne/contrainte existent toujours
-- normalement ; aucune ligne n'est modifiée par cette migration)
--
-- Test manuel de l'auto-activation, en tant qu'utilisateur invité (pas
-- staff) : UPDATE memberships SET status = 'actif' WHERE id = '<sa
-- propre ligne, statut invitation>' — doit réussir. Toute tentative de
-- modifier `role` ou le statut d'une ligne appartenant à quelqu'un
-- d'autre doit échouer.
-- ============================================================
