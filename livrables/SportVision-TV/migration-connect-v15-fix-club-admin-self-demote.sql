-- ============================================================
-- Fix : un admin de club peut se retirer lui-même ses propres droits
-- (se suspendre ou se rétrograder) via un appel API direct, en dehors de
-- l'UI SportVision Connect.
--
-- ─── Faille ──────────────────────────────────────────────────────────────
-- `protect_sensitive_club_member_fields()` (créée par migration-securite-
-- club-members-client-users-rls.sql, mise à jour par migration-connect-v13-
-- fix-club-members-invite-activation.sql pour le cas de self-activation)
-- calcule `is_this_club_admin := is_club_admin(old.club_id)` puis, dès que
-- `is_os_staff or is_this_club_admin` est vrai, fait `return new;` sans
-- aucune autre vérification :
--
--   if is_os_staff or is_this_club_admin then
--     return new;
--   end if;
--
-- `is_club_admin(club_id)` (migration-clubplus-v2.sql) vérifie seulement
-- que l'appelant a une ligne `role='admin' and status='actif'` dans CE
-- club — y compris sur SA PROPRE ligne. Un admin actif qui fait un PATCH
-- sur sa propre ligne club_members (role -> autre chose que 'admin', ou
-- status -> 'suspendu') est donc laissé passer par le trigger. Combiné à
-- la policy RLS "cm_admin_update" (`for update using (is_club_admin(club_id))`,
-- migration-clubplus-v2.sql), qui ne distingue pas non plus "sa propre
-- ligne" des autres, l'update aboutit réellement en base.
--
-- Le front (src/app/(app)/users/page.tsx) masque déjà le bouton "Désactiver"
-- sur sa propre ligne (isSelf), mais c'est une protection UI uniquement :
-- un appel direct à l'API REST Supabase (clé publishable + jeton de session
-- de l'admin, tous deux déjà accessibles côté client) contourne ce garde-fou.
-- Un admin peut ainsi se suspendre ou se rétrograder lui-même, perdant
-- `is_club_member`/`is_club_admin` sur son propre club (les deux exigent
-- status='actif') sans porte de sortie en libre-service — cf. le commentaire
-- déjà présent dans users/page.tsx, qui documente cette conséquence sans que
-- le trigger l'empêche réellement à la source.
--
-- ─── Correctif ───────────────────────────────────────────────────────────
-- Ajoute, uniquement dans la branche `is_this_club_admin` (jamais dans la
-- branche `is_os_staff`, pour ne pas casser un transfert de propriété
-- légitime fait par le staff SportVision) : si l'appelant modifie SA PROPRE
-- ligne (`old.user_id = auth.uid()`) et que ce changement le ferait sortir
-- de "admin actif" (status différent de 'actif', ou role différent de
-- 'admin'), l'update est refusé.
--
-- Additive : ne touche à rien d'autre du comportement existant (self-
-- activation d'une invitation, gestion des autres membres par un admin,
-- bypass staff OS). Idempotente (`create or replace`), pas de nouveau
-- trigger à créer — le trigger existant (trg_protect_sensitive_club_member_
-- fields) réutilise cette fonction en place.
--
-- NON EXÉCUTÉE PAR L'AGENT. À exécuter par Fouka dans Supabase → SQL Editor
-- après relecture.
-- ============================================================

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

  if is_os_staff then
    return new;
  end if;

  if is_this_club_admin then
    -- Un admin ne peut pas modifier SA PROPRE ligne pour perdre son statut
    -- d'admin actif (se suspendre ou se rétrograder). Seul le staff OS
    -- (branche ci-dessus) peut le faire, pour un transfert de propriété
    -- légitime.
    if old.user_id = auth.uid()
       and (new.status is distinct from 'actif' or new.role is distinct from 'admin')
    then
      raise exception 'Un administrateur ne peut pas se retirer ses propres droits d''administration.';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Modification non autorisée : rôle et statut sont réservés à l''administrateur du club ou au staff SportVision.';
  end if;

  if new.status is distinct from old.status then
    -- Self-activation : un membre invité peut activer SA PROPRE invitation
    -- (invitation -> actif), et seulement ce changement précis — rien d'autre.
    if not (old.status = 'invitation' and new.status = 'actif' and old.user_id = auth.uid()) then
      raise exception 'Modification non autorisée : rôle et statut sont réservés à l''administrateur du club ou au staff SportVision.';
    end if;
  end if;

  return new;
end;
$$;

-- Le trigger existant (trg_protect_sensitive_club_member_fields, before update
-- on club_members) réutilise déjà cette fonction : `create or replace` la met
-- à jour en place, pas besoin de recréer le trigger lui-même.
