-- Le président devient un vrai rôle d'administration du club.
--
-- ── Ce qui a été constaté ──
-- Un utilisateur `role = 'president'` n'était RIEN : ni `is_club_admin`, ni `peut_operer_club`.
-- Mesuré en base. Le président de SF Villemomble est d'ailleurs stocké comme `admin` — c'est la
-- seule façon dont le produit fonctionnait, en masquant le rôle réel derrière un autre.
--
-- Décision de Fouka, 10/09/2026 : « president n'est pas un titre décoratif. C'est un véritable
-- rôle d'administration Club+. Un utilisateur role='president' doit pouvoir administrer son
-- propre club sans qu'on ait besoin de le masquer derrière role='admin'. »
--
-- ── L'inventaire, fait avant d'écrire ──
-- `is_club_admin` gouverne 47 policies sur 34 tables, plus 14 fonctions. En les parcourant une
-- par une : équipes, matchs, calendrier, sources de calendrier, sponsors, actualités, médias et
-- leurs règles d'accès, réservations, lieux, projets, demandes d'adhésion, autorisations
-- parentales, fiches joueurs, logos, et l'identité du club (`clubs_admin_update`, dont le SIRET).
--
-- Tout cela EST l'administration normale d'un club. Fouka a explicitement tranché que le SIRET en
-- fait partie : « Il peut notamment gérer le SIRET si c'est actuellement une prérogative de
-- l'administrateur du club. » Elle l'est.
--
-- On intègre donc `president` dans `is_club_admin` plutôt que de créer une troisième fonction
-- d'autorité. Une de plus, et l'on recréerait le patchwork que la journée vient de supprimer.
--
-- ── Les deux exceptions, et elles seules ──
-- Deux pouvoirs ne relèvent pas de l'administration courante mais de la PROPRIÉTÉ du club. Ils
-- restent à l'administrateur au sens strict (`is_real_club_admin`, c'est-à-dire `role = 'admin'`
-- dans `club_members`) et au staff SportVision :
--
--   1. attribuer ou retirer un rôle privilégié — `admin`, `president`, `cm_externe` — et modifier
--      la ligne de qui en porte un. Un président ne se nomme donc pas administrateur, et ne
--      destitue pas un autre président. C'est la protection demandée : « destituer un
--      propriétaire/président protégé via une simple modification de membre » reste impossible.
--
--   2. le hard delete d'un membre. Le principe posé plus tôt vaut pour tout le monde : on révoque
--      en suspendant, la ligne reste, l'historique avec.
--
-- Effet de bord voulu : ces deux pouvoirs échappent aussi, désormais, au CM délégué par agence et
-- au super-accès CM, que `is_club_admin` couvrait. C'est conforme — « le CM ne peut jamais
-- attribuer ni révoquer owner / admin système / CM / Production ».

begin;

-- ── 1. Le président administre son club ──
create or replace function public.is_club_admin(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from club_members
    where club_id = target_club_id and user_id = auth.uid()
      -- `president` ajouté le 10/09/2026. Il administre son club au même titre que `admin` ;
      -- ce qui relève de la PROPRIÉTÉ du club passe, lui, par `is_real_club_admin`.
      and role in ('admin', 'president') and status = 'actif'
  )
  or exists (
    select 1
    from cm_agency_club_access caa
    join memberships m on m.organization_id = caa.cm_agency_org_id
    where caa.club_id = target_club_id
      and m.user_id = auth.uid()
      and m.status = 'actif'
      and (caa.expires_at is null or caa.expires_at >= current_date)
  )
  or exists (
    select 1 from memberships m
    join organizations o on o.id = m.organization_id
    where m.user_id = auth.uid() and m.status = 'actif' and m.cm_super_access = true
      and o.organization_type = 'cm_agency'
  );
$function$;

-- ── 2. Les rôles privilégiés restent à l'administrateur au sens strict ──
create or replace function public.protect_sensitive_club_member_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  is_os_staff boolean;
  is_this_club_admin boolean;
  is_proprietaire boolean;
  is_self_accepting_own_invitation boolean;
  a_une_invitation_ouverte boolean;
  v_club uuid;
  v_role_privilegie boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  v_club := new.club_id;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin', 'com', 'sec')
  ) into is_os_staff;

  select is_club_admin(v_club) into is_this_club_admin;
  -- `role = 'admin'` strictement : ni le président, ni le CM délégué, ni le super-accès.
  select is_real_club_admin(v_club) into is_proprietaire;

  v_role_privilegie := new.role in ('admin', 'president', 'cm_externe')
                    or (tg_op = 'UPDATE' and old.role in ('admin', 'president', 'cm_externe'));

  if v_role_privilegie and not (is_os_staff or is_proprietaire) then
    if not (
      tg_op = 'INSERT'
      and new.user_id = auth.uid()
      and exists (
        select 1 from club_invitations ci
        join auth.users u on u.id = auth.uid()
        where ci.club_id = v_club
          and lower(ci.email) = lower(u.email)
          and ci.role = new.role
          and ci.statut in ('preparee', 'envoyee', 'acceptee')
          and ci.expire_at > now() - interval '1 day'
      )
    ) then
      raise exception 'Ce rôle relève de la propriété du club : seul son administrateur peut l''attribuer, le retirer, ou modifier la ligne de qui le porte.';
    end if;
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  if new.club_id is distinct from old.club_id then
    raise exception 'Modification non autorisée : club_id est immuable, une adhésion ne se déplace pas par UPDATE.';
  end if;

  if is_this_club_admin and not is_os_staff and old.user_id = auth.uid()
     and (new.status is distinct from 'actif' or new.role is distinct from old.role)
  then
    raise exception 'Un administrateur ne peut pas se retirer ses propres droits d''administration.';
  end if;

  select exists (
    select 1
      from club_invitations ci
      join auth.users u on u.id = auth.uid()
     where ci.club_id = old.club_id
       and lower(ci.email) = lower(u.email)
       and ci.statut in ('preparee', 'envoyee')
       and ci.expire_at > now()
  ) into a_une_invitation_ouverte;

  if not is_os_staff and not is_this_club_admin and not peut_operer_club(old.club_id)
     and new.teams is distinct from old.teams
     and not (old.user_id = auth.uid() and a_une_invitation_ouverte)
  then
    raise exception 'Modification non autorisée : le périmètre d''équipes est fixé par l''administrateur du club.';
  end if;

  is_self_accepting_own_invitation :=
    auth.uid() = old.user_id
    and old.status = 'invitation'
    and new.status = 'actif'
    and new.role = old.role;

  if not is_os_staff and not is_this_club_admin and not peut_operer_club(old.club_id)
     and not is_self_accepting_own_invitation then
    if new.role is distinct from old.role
       or new.status is distinct from old.status
    then
      raise exception 'Modification non autorisée : rôle et statut sont réservés à l''administrateur du club ou au staff SportVision.';
    end if;
  end if;

  return new;
end;
$function$;

-- ── 3. Le hard delete d'un membre reste au propriétaire ──
drop policy if exists cm_admin_delete on public.club_members;
create policy cm_admin_delete on public.club_members
  for delete using (is_real_club_admin(club_id));

comment on policy cm_admin_delete on public.club_members is
  'Supprimer physiquement une adhésion efface qui a saisi quel résultat et qui a invité qui. Réservé à l''administrateur du club au sens strict ; tout le monde révoque en suspendant.';

commit;
