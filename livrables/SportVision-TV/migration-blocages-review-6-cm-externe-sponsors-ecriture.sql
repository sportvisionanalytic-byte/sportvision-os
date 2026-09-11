-- Le CM externe écrit les sponsors de son club, comme il les lit depuis la migration 1.
--
-- Décision de Fouka du 11/09 : « CM externe, mêmes droits que le CM SportVision sur l'annuaire et
-- les sponsors ». La migration 1 lui a ouvert la LECTURE. L'écriture restait fermée
-- (csp_member_insert/update : admin, president, sponsor_mgr, tresorier ; le CM SportVision, lui,
-- écrit par csp_operateur_manage/peut_operer_club). Résultat mesuré : Club+ lui affiche le bouton
-- « Ajouter » et la base refuse — le pire des deux.
--
-- `external_cm` est donc ajouté aux deux listes de rôles, et à rien d'autre. La SUPPRESSION reste
-- réservée à l'Owner Club+ (csp_admin_delete), comme pour le trésorier et le responsable sponsors.
--
-- Rejouable. Garde-fou : si l'une des deux policies a changé depuis le 12/09, rien n'est modifié.

begin;

do $garde$
declare
  v_ins text := (select coalesce(qual, with_check) from pg_policies where tablename = 'club_sponsors' and policyname = 'csp_member_insert');
  v_upd text := (select coalesce(qual, with_check) from pg_policies where tablename = 'club_sponsors' and policyname = 'csp_member_update');
begin
  if v_ins is null or v_upd is null then
    raise exception 'blocages-review-6 : csp_member_insert/csp_member_update introuvable. Rien n''a été modifié.';
  end if;
  if position('external_cm' in v_ins) > 0 and position('external_cm' in v_upd) > 0 then
    raise notice 'blocages-review-6 : déjà appliquée.';
  elsif position('''sponsor_mgr''::text, ''tresorier''::text' in v_ins) = 0 then
    raise exception 'blocages-review-6 : csp_member_insert a changé depuis le 12/09/2026. Rien n''a été modifié — reporter « external_cm » sur sa nouvelle définition.';
  end if;
end $garde$;

alter policy csp_member_insert on public.club_sponsors
  with check (
    exists (select 1 from club_members
             where club_members.club_id = club_sponsors.club_id
               and club_members.user_id = auth.uid()
               and club_members.status = 'actif'
               and club_members.role = any (array['admin', 'president', 'sponsor_mgr', 'tresorier', 'external_cm']))
    or exists (select 1 from cm_agency_club_access caa
                 join memberships m on m.organization_id = caa.cm_agency_org_id
                where caa.club_id = club_sponsors.club_id and m.user_id = auth.uid() and m.status = 'actif'
                  and (caa.expires_at is null or caa.expires_at >= current_date))
    or exists (select 1 from memberships m join organizations o on o.id = m.organization_id
                where m.user_id = auth.uid() and m.status = 'actif' and m.cm_super_access = true
                  and o.organization_type = 'cm_agency')
  );

alter policy csp_member_update on public.club_sponsors
  using (
    exists (select 1 from club_members
             where club_members.club_id = club_sponsors.club_id
               and club_members.user_id = auth.uid()
               and club_members.status = 'actif'
               and club_members.role = any (array['admin', 'president', 'sponsor_mgr', 'tresorier', 'external_cm']))
    or exists (select 1 from cm_agency_club_access caa
                 join memberships m on m.organization_id = caa.cm_agency_org_id
                where caa.club_id = club_sponsors.club_id and m.user_id = auth.uid() and m.status = 'actif'
                  and (caa.expires_at is null or caa.expires_at >= current_date))
    or exists (select 1 from memberships m join organizations o on o.id = m.organization_id
                where m.user_id = auth.uid() and m.status = 'actif' and m.cm_super_access = true
                  and o.organization_type = 'cm_agency')
  );

commit;

-- Vérification : les deux policies nomment external_cm, la suppression n'a pas bougé.
select policyname, position('external_cm' in coalesce(qual, with_check)) > 0 as ouvre_cm_externe
  from pg_policies
 where tablename = 'club_sponsors' and policyname in ('csp_member_insert', 'csp_member_update', 'csp_admin_delete')
 order by policyname;
