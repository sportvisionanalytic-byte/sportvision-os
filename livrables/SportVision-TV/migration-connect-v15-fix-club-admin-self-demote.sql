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
-- EXÉCUTÉE (adaptée) le 19/08/2026 — audit pré-lancement. Le CREATE OR REPLACE
-- ci-dessous n'a PAS été relancé tel quel : entre l'écriture de ce fichier et
-- ce soir, protect_sensitive_club_member_fields() a été réécrite ailleurs
-- (introduction de la variable is_self_accepting_own_invitation, structure de
-- contrôle unifiée) — exécuter ce fichier tel quel aurait fait régresser cette
-- version plus récente. Le correctif décrit ici (garde-fou anti-auto-
-- rétrogradation) a été réappliqué à la main sur la base de la version
-- actuellement en base, en conservant is_self_accepting_own_invitation intacte.
--
-- Vérifié en conditions réelles (compte de test, JWT réel, PAS service_role) :
-- auto-suspension et auto-rétrogradation de rôle rejetées avec le message
-- clair ci-dessous, une modification légitime sur son propre champ
-- (téléphone) reste possible. Faille pratiquement neutralisée avant ce
-- correctif par un effet de bord non garanti (trg_sync_club_member_to_
-- membership propageait le changement vers `memberships`, dont son propre
-- trigger le rejetait avec un message trompeur parlant d'invitation) — ce
-- correctif la bloque directement à la source, avec le bon message.
-- ============================================================

-- Version RÉELLEMENT appliquée le 19/08/2026, adaptée à la structure de
-- protect_sensitive_club_member_fields() déjà en place (avec
-- is_self_accepting_own_invitation) au lieu de la version originale ci-dessus
-- prévue pour l'ancienne structure — voir la note en tête de fichier.
create or replace function public.protect_sensitive_club_member_fields()
returns trigger
language plpgsql
security definer
as $function$
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

  -- Un admin ne peut pas modifier SA PROPRE ligne pour perdre son statut
  -- d'admin actif (se suspendre ou se rétrograder). Seul le staff OS peut
  -- le faire (branche is_os_staff plus bas), pour un transfert de propriété
  -- légitime.
  if is_this_club_admin and not is_os_staff and old.user_id = auth.uid()
     and (new.status is distinct from 'actif' or new.role is distinct from 'admin')
  then
    raise exception 'Un administrateur ne peut pas se retirer ses propres droits d''administration.';
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
$function$;

-- Le trigger existant (trg_protect_sensitive_club_member_fields, before update
-- on club_members) réutilise déjà cette fonction : `create or replace` la met
-- à jour en place, pas besoin de recréer le trigger lui-même.
