-- ============================================================
-- SPORTVISION CLUB+ — Migration v45
-- Suite de migration-clubplus-v1 à v44.sql. Idempotente.
-- NON EXÉCUTÉE — à relire puis exécuter par Fouka dans Supabase → SQL Editor.
-- Ne JAMAIS exécuter depuis un agent.
-- ============================================================
--
-- Brief Fouka 17/08/2026 (retour sur la page de connexion Club+, point 16
-- "États à prévoir" — invitation en attente) : en investiguant, trouvé que
-- le flux d'invitation d'un membre (edge function clubplus-invite, crée un
-- compte auth.users + une ligne club_members en status='invitation') est
-- CASSÉ de bout en bout aujourd'hui, pour deux raisons cumulées :
--
--   1. getSpaces() (app-next/src/lib/supabase/session.ts) filtre
--      `.eq("status", "actif")` sur la requête `memberships` (synchronisée
--      depuis club_members, migration-connect-v10) — un membre invité
--      n'apparaît donc dans AUCUNE liste d'espaces, même pas pour voir son
--      invitation. Corrigé côté code dans le même commit que cette
--      migration (retrait du filtre, pickActiveSpace adapté pour ne
--      jamais auto-sélectionner un espace non "actif").
--
--   2. Même en voyant son invitation, l'invité n'a AUCUN moyen de
--      l'accepter : la policy "cm_self_update" (migration-clubplus-v1.sql)
--      permet à un membre de modifier sa propre ligne club_members, mais
--      un trigger de sécurité ajouté depuis (migration-securite-club-
--      members-client-users-rls.sql, faille "un membre pouvait s'auto-
--      promouvoir admin par un PATCH direct") bloque désormais TOUTE
--      modification de `role`/`status` par quelqu'un qui n'est ni le staff
--      OS ni déjà admin du club — y compris la personne qui n'essaie que
--      d'accepter SA PROPRE invitation, un cas légitime que ce trigger
--      n'avait pas anticipé.
--
-- Vérifié en direct (curl REST, lecture seule, SUPABASE_URL/
-- SUPABASE_SECRET_KEY du .env racine) avant d'écrire cette migration :
--   - Aucune fonction accept_club_invitation/decline_club_invitation
--     n'existe (grep sur tous les fichiers migration-*.sql).
--   - club_members.status en prod aujourd'hui : 2 lignes 'invitation'
--     (dont une, "Jean Testeur-Invite", bloquée depuis le 08/08/2026 faute
--     de mécanisme d'acceptation), 2 lignes 'actif', 0 'suspendu'.
--   - clubs.nom existe (utilisé côté UI pour nommer le club dans la carte
--     d'invitation).
--
-- ── Ce que fait cette migration ────────────────────────────────────────
--
-- 1. Étend le trigger protect_sensitive_club_member_fields() (CREATE OR
--    REPLACE, ne le duplique pas) : ajoute une exception NARROW — un
--    utilisateur peut modifier SA PROPRE ligne uniquement si
--    OLD.status = 'invitation' ET NEW.status = 'actif' ET NEW.role =
--    OLD.role (rôle inchangé, seul le statut bouge). Ne réouvre PAS la
--    faille d'origine (auto-promotion à un rôle différent, ou n'importe
--    quelle autre transition de statut) : ces cas restent bloqués comme
--    avant, réservés au staff OS ou à l'admin du club.
--
-- 2. accept_club_invitation(p_club_id uuid) — SECURITY DEFINER. Vérifie
--    que l'appelant a bien une ligne club_members pour ce club avec
--    status='invitation', puis pose status='actif' (role/club_id
--    inchangés — le trigger ci-dessus laisse passer cette transition
--    précise). Échoue explicitement sinon (pas d'échec silencieux).
--
-- 3. decline_club_invitation(p_club_id uuid) — SECURITY DEFINER. Même
--    vérification, puis DELETE de la ligne (refuser une invitation ne
--    laisse pas de statut "refusé" trainer — club_members.status n'a que
--    3 valeurs, 'actif'/'invitation'/'suspendu', aucune ne convient pour
--    "refusé" ; supprimer la ligne est le comportement le plus simple et
--    honnête, cohérent avec "la fin d'affiliation ne supprime jamais le
--    compte Connect" — ici on ne supprime QUE la relation club, jamais le
--    compte auth.users de la personne).
--
-- Idempotente (create or replace function, drop function if exists avant
-- tout changement de signature).
-- ============================================================

-- ────────────────────────────────────────────────────────────────────────
-- 1. Trigger — exception narrow pour l'auto-acceptation d'invitation
-- ────────────────────────────────────────────────────────────────────────
-- Reproduit exactement la fonction existante (migration-securite-club-
-- members-client-users-rls.sql), ajoute seulement la branche "auto-accept"
-- avant le blocage général.

create or replace function protect_sensitive_club_member_fields()
returns trigger language plpgsql security definer as $$
declare
  is_os_staff boolean;
  is_this_club_admin boolean;
  is_self_accepting_own_invitation boolean;
begin
  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin', 'com', 'sec')
  ) into is_os_staff;

  select is_club_admin(old.club_id) into is_this_club_admin;

  if new.club_id is distinct from old.club_id then
    raise exception 'Modification non autorisée : club_id est immuable, une adhésion ne se déplace pas par UPDATE.';
  end if;

  -- Auto-acceptation de sa propre invitation : la seule transition qu'un
  -- non-admin/non-staff peut déclencher sur role/status. Rôle strictement
  -- inchangé, statut strictement invitation -> actif, et uniquement sur sa
  -- propre ligne (auth.uid() = old.user_id, jamais un tiers).
  is_self_accepting_own_invitation :=
    auth.uid() = old.user_id
    and old.status = 'invitation'
    and new.status = 'actif'
    and new.role = old.role;

  if not is_os_staff and not is_this_club_admin and not is_self_accepting_own_invitation then
    if new.role is distinct from old.role
       or new.status is distinct from old.status
    then
      raise exception 'Modification non autorisée : rôle et statut sont réservés à l''administrateur du club ou au staff SportVision.';
    end if;
  end if;

  return new;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────
-- 2. accept_club_invitation
-- ────────────────────────────────────────────────────────────────────────

create or replace function accept_club_invitation(p_club_id uuid)
returns void language plpgsql security definer as $$
begin
  update club_members
  set status = 'actif'
  where club_id = p_club_id and user_id = auth.uid() and status = 'invitation';

  if not found then
    raise exception 'Aucune invitation en attente trouvée pour ce club.';
  end if;
end;
$$;

revoke all on function accept_club_invitation(uuid) from public, anon;
grant execute on function accept_club_invitation(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 3. decline_club_invitation
-- ────────────────────────────────────────────────────────────────────────

create or replace function decline_club_invitation(p_club_id uuid)
returns void language plpgsql security definer as $$
begin
  delete from club_members
  where club_id = p_club_id and user_id = auth.uid() and status = 'invitation';

  if not found then
    raise exception 'Aucune invitation en attente trouvée pour ce club.';
  end if;
end;
$$;

revoke all on function decline_club_invitation(uuid) from public, anon;
grant execute on function decline_club_invitation(uuid) to authenticated;

-- ============================================================
-- VÉRIFICATION RECOMMANDÉE après exécution (à rejouer séparément) :
--
-- select prosrc from pg_proc where proname = 'protect_sensitive_club_member_fields';
-- -> doit contenir "is_self_accepting_own_invitation"
--
-- select proname from pg_proc where proname in
--   ('accept_club_invitation', 'decline_club_invitation');
-- -> doit renvoyer 2 lignes
--
-- Test réel recommandé (avec le compte "Jean Testeur-Invite", invitation
-- bloquée depuis le 08/08/2026, club_id 9a3062f7-7636-4058-8d3c-
-- 299bcc44eb18) : se connecter avec ce compte une fois le code déployé,
-- vérifier que l'invitation apparaît et que "Accepter" fonctionne
-- réellement (status passe à 'actif', l'espace devient accessible).
-- ============================================================
