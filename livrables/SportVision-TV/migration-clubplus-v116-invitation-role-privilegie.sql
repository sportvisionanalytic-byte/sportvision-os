-- Une invitation « président » ne se prépare que par qui peut nommer un président.
--
-- ── Trouvé le 10/09/2026, en préparant l'invitation du président de SF Villemomble ──
-- v114 réserve à l'Admin/Owner du club (`is_real_club_admin`) et au staff SportVision le droit
-- d'attribuer un rôle privilégié dans `club_members`. Mais un rôle s'attribue aussi par
-- INVITATION, et cette porte-là était restée ouverte :
--
--   • `club_invitations` accepte le rôle `president` (contrainte club_invitations_role_check) ;
--   • `preparer_invitation_club` et la policy `ci_operateur_all` n'exigent que
--     `peut_operer_club` — le CM affecté, et le président lui-même ;
--   • à l'acceptation, la protection de `club_members` laisse passer la personne invitée dès
--     qu'une invitation au même rôle existe pour son adresse.
--
-- Mesuré par tests/invitation-role-privilegie.test.sql, rouge sur 5 chemins : un CM ou un
-- président préparait une invitation président ; un CM l'insérait directement ; il détournait
-- vers sa propre adresse celle que l'Admin/Owner venait de préparer ; il changeait en
-- « président » une invitation de coach.
--
-- ── La règle ──
-- Créer une invitation président, ou modifier l'adresse, le rôle, les équipes ou l'identité
-- d'une invitation qui en porte un, exige exactement ce qu'exige v114 pour attribuer le rôle :
-- l'Admin/Owner du club, ou le staff SportVision (`admin`, `com`, `sec`). Envoyer, relancer,
-- révoquer ou accepter une invitation président déjà préparée reste possible — ces gestes ne
-- choisissent pas QUI devient président.
--
-- `admin` et `cm_externe` sont déjà exclus des invitations par la contrainte de la table ; la
-- liste ci-dessous les nomme quand même, pour que la règle survive à un élargissement futur.

begin;

create or replace function public.proteger_invitation_role_privilegie()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_privilegie boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  v_privilegie := new.role in ('admin', 'president', 'cm_externe')
               or (tg_op = 'UPDATE' and old.role in ('admin', 'president', 'cm_externe'));
  if not v_privilegie then
    return new;
  end if;

  -- Sur une invitation déjà préparée, seuls les champs qui désignent la personne et son rôle
  -- sont gardés. Le statut, les dates d'envoi et d'acceptation, l'expiration suivent leur cours.
  if tg_op = 'UPDATE'
     and new.email is not distinct from old.email
     and new.role is not distinct from old.role
     and new.teams is not distinct from old.teams
     and new.prenom is not distinct from old.prenom
     and new.nom is not distinct from old.nom
     and new.club_id is not distinct from old.club_id
  then
    return new;
  end if;

  if public.is_real_club_admin(new.club_id)
     or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'com', 'sec'))
  then
    return new;
  end if;

  raise exception 'Seul l''administrateur du compte Club+ du club, ou SportVision, peut inviter un président ou modifier son invitation.'
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_proteger_invitation_role_privilegie on public.club_invitations;
create trigger trg_proteger_invitation_role_privilegie
  before insert or update on public.club_invitations
  for each row execute function public.proteger_invitation_role_privilegie();

commit;
