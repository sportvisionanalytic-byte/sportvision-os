-- ============================================================
-- Migration v18 — synchronise UPDATE/DELETE de club_members vers memberships
-- (v10 ne synchronisait que l'INSERT).
--
-- ─── Faille trouvée par audit indépendant le 10/08/2026 ──────────────────
-- `trg_sync_club_member_to_membership` (migration-connect-v10) ne se
-- déclenche que sur INSERT. Toute la logique d'accès Connect (sélecteur
-- d'espace, `is_org_member()`, `canAccess()` côté app-next) lit
-- `memberships.status`/`memberships.role`, jamais `club_members`
-- directement. Conséquence mesurée dans l'app vanilla en production
-- (`toggleSuspend()`) : suspendre un membre met bien à jour
-- `club_members.status='suspendu'`, mais `memberships.status` reste
-- 'actif' pour toujours — le membre suspendu garde un accès complet à
-- l'espace du club (organisation visible dans son sélecteur, toutes les
-- policies gardées par `is_org_member()` continuent de l'autoriser). Même
-- bug pour un changement de rôle (`memberships.role` reste figé à sa
-- valeur d'origine) : un admin rétrogradé garde les outils d'admin, un
-- membre promu admin ne les obtient jamais tant que `memberships.role` ne
-- suit pas.
--
-- ─── Correctif ───────────────────────────────────────────────────────────
-- Deux triggers supplémentaires, réutilisant la même fonction étendue :
-- AFTER UPDATE (recopie role/status) et AFTER DELETE (retire le
-- membership — pas de suppression de club_members aujourd'hui côté UI,
-- mais couvre le cas si un jour ajouté). additive, idempotente
-- (`create or replace`, `drop trigger if exists`).
-- ============================================================

create or replace function sync_club_member_to_membership()
returns trigger language plpgsql security definer as $$
begin
  if tg_op = 'DELETE' then
    delete from memberships where user_id = old.user_id and organization_id = old.club_id and source = 'club_members';
    return old;
  end if;

  insert into memberships (user_id, organization_id, role, status, source)
  values (new.user_id, new.club_id, new.role, new.status, 'club_members')
  on conflict (user_id, organization_id) do update
    set role = excluded.role, status = excluded.status
    where memberships.source = 'club_members';

  return new;
end;
$$;

drop trigger if exists trg_sync_club_member_to_membership on club_members;
create trigger trg_sync_club_member_to_membership
  after insert or update or delete on club_members
  for each row execute function sync_club_member_to_membership();

-- ============================================================
-- NOTE — rattrapage recommandé après exécution
--
-- Le trigger recalcule désormais correctement pour tout futur INSERT/
-- UPDATE/DELETE, mais ne retouche pas les lignes déjà désynchronisées par
-- le bug v10 (un membre déjà suspendu/rétrogradé avant l'exécution de
-- cette migration reste désynchronisé jusqu'à son prochain changement).
-- Rattrapage ponctuel des lignes existantes :
--
-- update memberships m set role = cm.role, status = cm.status
-- from club_members cm
-- where m.user_id = cm.user_id and m.organization_id = cm.club_id
--   and m.source = 'club_members' and (m.role is distinct from cm.role or m.status is distinct from cm.status);
-- ============================================================
