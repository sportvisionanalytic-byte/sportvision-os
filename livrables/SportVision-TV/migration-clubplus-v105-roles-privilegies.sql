-- Un CM affilié pouvait se nommer administrateur du club. On ferme.
--
-- ── Prouvé en production, transaction annulée, 10/09/2026 ──
-- Avec l'identité du vrai CM cloisonné de SF Villemomble :
--
--   insert into club_members (user_id, club_id, role, status)
--   values (<lui>, <son club>, 'admin', 'actif');     → ACCEPTÉ, role = 'admin'
--
-- La policy `club_members_cm_affecte_all` lui donne ALL sur `club_members` de ses clubs, et le
-- trigger `protect_sensitive_club_member_fields` — celui qui gèle rôle, statut et périmètre — ne
-- s'exécute que BEFORE UPDATE. L'INSERT n'était surveillé par personne.
--
-- Conséquence : le CM devenait `is_club_admin`, donc administrateur du club au sens de toutes les
-- policies. Le SIRET restait hors de portée (trigger `proteger_identite_legale_club`, vérifié), mais
-- tout le reste s'ouvrait : révoquer le président, changer les rôles, la facturation.
--
-- ── La règle, décidée par Fouka le 10/09/2026 ──
-- « Le CM est administrateur OPÉRATIONNEL délégué. Il ne peut jamais attribuer ni révoquer
-- owner / admin système / CM / Production. Le président est protégé : le CM peut le préparer et
-- l'inviter, jamais le destituer ni transférer sa propriété. »
--
-- Trois rôles deviennent donc privilégiés : `admin`, `president`, `cm_externe`. Les toucher — les
-- attribuer, les retirer, ou modifier la ligne de quelqu'un qui les porte — exige d'être déjà
-- administrateur du club ou staff SportVision.
--
-- ── L'exception, et pourquoi elle ne rouvre rien ──
-- Un président invité doit pouvoir accepter son invitation, et c'est bien lui qui déclenche
-- l'INSERT. On l'autorise donc quand la personne s'inscrit ELLE-MÊME sur une invitation ouverte
-- à SON adresse — invitation qu'un opérateur du club a créée. Le CM ne peut pas se l'appliquer à
-- lui-même : il devrait s'envoyer une invitation à sa propre adresse, ce qui laisse une trace
-- nominative dans `club_invitations`, et il resterait de toute façon incapable de s'attribuer
-- `admin`, absent de la contrainte de cette table depuis la v100.

begin;

create or replace function public.protect_sensitive_club_member_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  is_os_staff boolean;
  is_this_club_admin boolean;
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

  -- ── Rôles privilégiés : réservés à l'administrateur du club et au staff SportVision ──
  -- Vaut à l'INSERT comme à l'UPDATE. C'est l'INSERT qui manquait : un CM s'y nommait admin.
  v_role_privilegie := new.role in ('admin', 'president', 'cm_externe')
                    or (tg_op = 'UPDATE' and old.role in ('admin', 'president', 'cm_externe'));

  if v_role_privilegie and not (is_os_staff or is_this_club_admin) then
    -- La seule porte : quelqu'un qui accepte SA propre invitation, créée par un opérateur du
    -- club. Il s'inscrit lui-même, sur une invitation nominative à son adresse.
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
      raise exception 'Ce rôle est réservé à l''administrateur du club. Un community manager ne peut ni l''attribuer, ni le retirer, ni modifier la ligne de qui le porte.';
    end if;
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  if new.club_id is distinct from old.club_id then
    raise exception 'Modification non autorisée : club_id est immuable, une adhésion ne se déplace pas par UPDATE.';
  end if;

  -- 19/08/2026 (audit pré-lancement, migration-connect-v15) : un admin ne peut pas
  -- modifier SA PROPRE ligne pour perdre son statut d'admin actif.
  if is_this_club_admin and not is_os_staff and old.user_id = auth.uid()
     and (new.status is distinct from 'actif' or new.role is distinct from 'admin')
  then
    raise exception 'Un administrateur ne peut pas se retirer ses propres droits d''administration.';
  end if;

  -- 10/09/2026 — L'acceptation d'une invitation nominative élargit le périmètre d'équipes.
  -- Étroite par construction : sa propre ligne, sur un club où une invitation à son adresse est
  -- encore ouverte. Elle se referme dès que l'invitation passe à « acceptee » ou « revoquee ».
  select exists (
    select 1
      from club_invitations ci
      join auth.users u on u.id = auth.uid()
     where ci.club_id = old.club_id
       and lower(ci.email) = lower(u.email)
       and ci.statut in ('preparee', 'envoyee')
       and ci.expire_at > now()
  ) into a_une_invitation_ouverte;

  -- `teams` porte des droits (is_team_educateur), pas une préférence d'affichage : il se gèle
  -- comme role et status. Un opérateur du club (CM compris) peut le fixer — c'est son métier.
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

  -- Rôle et statut : l'opérateur du club les gère aussi, dans la limite des rôles non privilégiés
  -- déjà posée plus haut. C'est ce qui permet à un CM de révoquer l'accès d'un coach invité par
  -- son prédécesseur — sans quoi un changement de CM laisserait le club ingérable.
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

drop trigger if exists trg_protect_sensitive_club_member_fields on public.club_members;
create trigger trg_protect_sensitive_club_member_fields
  before insert or update on public.club_members
  for each row execute function public.protect_sensitive_club_member_fields();

-- ── Le hard delete d'un membre sort du périmètre du CM ──
-- « Aucun hard delete si désactivation/révocation permet de conserver l'historique. » Supprimer
-- une ligne `club_members` efface qui a saisi quel résultat et qui a été invité par qui. Le CM
-- révoque en passant le statut à « suspendu » ; la ligne, elle, reste.
--
-- `club_members_cm_affecte_all` (ALL) lui accordait le DELETE au passage. On la remplace par des
-- policies nommées, sans DELETE. Le SELECT/INSERT/UPDATE restent, l'autorité devient commune.
drop policy if exists club_members_cm_affecte_all on public.club_members;

drop policy if exists cm_operateur_select on public.club_members;
create policy cm_operateur_select on public.club_members
  for select using (peut_operer_club(club_id));

drop policy if exists cm_operateur_insert on public.club_members;
create policy cm_operateur_insert on public.club_members
  for insert with check (peut_operer_club(club_id));

drop policy if exists cm_operateur_update on public.club_members;
create policy cm_operateur_update on public.club_members
  for update using (peut_operer_club(club_id)) with check (peut_operer_club(club_id));

commit;
