-- ============================================================
-- SPORTVISION CONNECT — v10 : synchronisation continue club_members → memberships
--
-- Même bug que v7 (client_users → memberships), non corrigé côté clubs à
-- l'époque. v2 §3.3 avait inséré les memberships depuis club_members en
-- UNE SEULE FOIS (insert...select), pour l'état existant au moment de la
-- migration. Tout membre de club ajouté depuis (via clubplus-onboarding ou
-- clubplus-invite, qui n'écrivent que dans club_members) n'obtient aucun
-- membership, et devient invisible pour le sélecteur d'organisation /
-- hasModule() côté Connect — alors même que club_members le liste bien
-- comme membre actif. Découvert lors de l'audit du 2026-08-06.
--
-- Contrairement à client_users (où le rôle/statut sont toujours 'client'/
-- 'actif' par construction), club_members porte déjà un vrai rôle et statut
-- distincts par membre — on les reprend tels quels, pas de valeur imposée.
-- organization_id = club_id directement (pas d'indirection, cf. v2 §3.3).
-- ============================================================

create or replace function sync_club_member_to_membership()
returns trigger language plpgsql security definer as $$
begin
  insert into memberships (user_id, organization_id, role, status, source)
  values (new.user_id, new.club_id, new.role, new.status, 'club_members')
  on conflict (user_id, organization_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_sync_club_member_to_membership on club_members;
create trigger trg_sync_club_member_to_membership
  after insert on club_members
  for each row execute function sync_club_member_to_membership();

-- ============================================================
-- NOTE — rattrapage recommandé après exécution
--
-- Aucune ligne existante n'est modifiée (le trigger ne joue que sur les
-- futurs inserts). Pour les membres de club déjà ajoutés entre le
-- déploiement de v2 et aujourd'hui et qui n'auraient toujours aucun
-- membership, relancer ponctuellement l'insert de v2 §3.3 suffit à les
-- rattraper :
--
-- insert into memberships (user_id, organization_id, role, status, source)
-- select cm.user_id, cm.club_id, cm.role, cm.status, 'club_members'
-- from club_members cm
-- on conflict (user_id, organization_id) do nothing;
-- ============================================================
