-- ============================================================
-- SPORTVISION CLUB+ — Migration v2
-- Suite de migration-clubplus-v1.sql. Idempotente.
--
-- Portée : permet à un admin d'un club (role='admin' dans club_members,
-- pas le staff SportVision OS) de gérer les membres de SON club — suspendre,
-- réactiver, retirer un accès. La création d'un nouveau membre (invitation)
-- ne passe jamais par une policy client : elle se fait exclusivement via
-- l'Edge Function clubplus-invite (service role), qui crée le compte
-- auth.users ET la ligne club_members ensemble. Donc aucune policy INSERT
-- club-admin n'est ajoutée ici — uniquement UPDATE et DELETE.
-- ============================================================

-- ── Fonction non-récursive : l'appelant est-il admin ACTIF de ce club ? ──
-- Même précaution que is_club_member (migration-clubplus-v1.sql) : SECURITY
-- DEFINER pour éviter la récursion RLS d'une sous-requête club_members dans
-- une policy de club_members elle-même.
create or replace function is_club_admin(target_club_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from club_members
    where club_id = target_club_id and user_id = auth.uid()
      and role = 'admin' and status = 'actif'
  );
$$;

drop policy if exists "cm_admin_update" on club_members;
create policy "cm_admin_update" on club_members for update using (is_club_admin(club_id));

drop policy if exists "cm_admin_delete" on club_members;
create policy "cm_admin_delete" on club_members for delete using (is_club_admin(club_id));
