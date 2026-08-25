-- ============================================================================
-- migration-clubsponsors-delegation-write.sql
-- ============================================================================
-- Demande Fouka (25/08/2026) : un CM délégué (agence externe ou CM SportVision
-- interne, cm_agency_club_access / cm_super_access) doit pouvoir modifier les
-- sponsors d'un club, pas seulement les consulter (csp_member_select utilise
-- déjà is_club_member(), délégation-aware ; seules l'écriture restait
-- réservée à un vrai rôle club_members). csp_admin_delete utilise déjà
-- is_club_admin() (délégation-aware depuis migration-cm-agency-super-access-
-- staff.sql) — seules INSERT/UPDATE avaient une vérification de rôle brute,
-- étendue ici avec le même bloc OR EXISTS que le reste du projet, sans
-- retirer les rôles réels déjà autorisés (admin/president/sponsor_mgr/
-- tresorier).
-- ============================================================================

drop policy if exists "csp_member_insert" on club_sponsors;
create policy "csp_member_insert" on club_sponsors for insert
with check (
  exists (
    select 1 from club_members
    where club_members.club_id = club_sponsors.club_id
      and club_members.user_id = auth.uid()
      and club_members.status = 'actif'
      and club_members.role = any(array['admin','president','sponsor_mgr','tresorier'])
  )
  or exists (
    select 1
    from cm_agency_club_access caa
    join memberships m on m.organization_id = caa.cm_agency_org_id
    where caa.club_id = club_sponsors.club_id
      and m.user_id = auth.uid()
      and m.status = 'actif'
      and (caa.expires_at is null or caa.expires_at >= current_date)
  )
  or exists (
    select 1 from memberships m
    join organizations o on o.id = m.organization_id
    where m.user_id = auth.uid() and m.status = 'actif' and m.cm_super_access = true
      and o.organization_type = 'cm_agency'
  )
);

drop policy if exists "csp_member_update" on club_sponsors;
create policy "csp_member_update" on club_sponsors for update
using (
  exists (
    select 1 from club_members
    where club_members.club_id = club_sponsors.club_id
      and club_members.user_id = auth.uid()
      and club_members.status = 'actif'
      and club_members.role = any(array['admin','president','sponsor_mgr','tresorier'])
  )
  or exists (
    select 1
    from cm_agency_club_access caa
    join memberships m on m.organization_id = caa.cm_agency_org_id
    where caa.club_id = club_sponsors.club_id
      and m.user_id = auth.uid()
      and m.status = 'actif'
      and (caa.expires_at is null or caa.expires_at >= current_date)
  )
  or exists (
    select 1 from memberships m
    join organizations o on o.id = m.organization_id
    where m.user_id = auth.uid() and m.status = 'actif' and m.cm_super_access = true
      and o.organization_type = 'cm_agency'
  )
);
