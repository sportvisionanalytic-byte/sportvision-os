-- ============================================================
-- Fix RÉGRESSION CRITIQUE : le trigger de sécurité déployé le jour même
-- (migration-securite-club-members-client-users-rls.sql,
-- protect_sensitive_club_member_fields) bloque désormais TOUT changement de
-- `status`/`role` sur club_members sauf pour le staff OS ou un admin de club
-- déjà actif — sans exception pour le cas d'auto-activation d'une invitation.
--
-- Or le flux d'invitation prévu (clubplus-invite + SportVision-Club-Plus.html)
-- fait faire à l'invité lui-même un PATCH club_members … status:'actif' sur SA
-- PROPRE ligne pendant qu'elle est encore 'invitation' — à ce moment-là,
-- is_club_admin(club_id) renvoie forcément false pour lui (il n'est pas
-- encore admin actif), donc le trigger lève une exception à chaque tentative.
-- L'appel front (sbFetch) n'inspecte jamais le statut HTTP et redirige quand
-- même vers app.html : l'échec est invisible, mais le membre reste bloqué en
-- status='invitation' indéfiniment (donc exclu de is_club_member() et de
-- quasiment toutes les policies du module club). Découvert le 2026-08-06.
--
-- Le module Connect (memberships) avait déjà prévu exactement ce cas
-- (migration-connect-v6-org-admin.sql, "Cas 2 : self-activation") — ce
-- garde-fou n'avait simplement pas été répliqué sur club_members au moment
-- d'écrire la migration de sécurité. Même correctif ici, appliqué à
-- club_members (user_id, comme memberships).
--
-- Idempotente. À exécuter dans Supabase → SQL Editor.
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

  if is_os_staff or is_this_club_admin then
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

-- Le trigger existant réutilise déjà cette fonction (create or replace la met
-- à jour en place, pas besoin de recréer le trigger lui-même).
