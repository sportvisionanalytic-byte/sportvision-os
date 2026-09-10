-- Deux frontières resserrées après lecture de la matrice par Fouka, le 10/09/2026.
--
-- ── 1. Un coach ne fait pas disparaître son équipe ──
-- La matrice montrait « Coach → archiver une équipe : oui ». Il pouvait donc retirer son équipe
-- de tous les écrans du club — calendrier, effectifs, Match Center — d'une case à cocher.
--
-- « Le coach gère l'activité de son équipe, mais ne modifie pas son existence structurelle. »
--
-- La cause : `ctm_member_update` ouvre l'UPDATE de `club_teams` à tout membre du club, sans
-- distinguer les colonnes. Une policy ne sait pas restreindre une colonne ; c'est donc un trigger
-- qui garde `archivee`, comme pour `club_members.teams` et l'identité d'un joueur.
--
-- ── 2. La fiche d'une personne ne se supprime pas ──
-- « Même pour le président, on avait posé le principe d'archiver plutôt que supprimer. La
-- personne peut avoir de l'historique, un compte Connect, des commandes, des galeries. »
--
-- `pp_admin_delete` accordait le hard delete à tout administrateur de club. On le retire : le
-- retrait d'un joueur passe par `account_status = 'retire'` et par la fin de son appartenance à
-- l'équipe, deux gestes réversibles qui conservent l'historique. La suppression physique devient
-- une opération administrative, réservée au staff SportVision — direction et secrétariat.
--
-- `is_staff()` n'est PAS utilisée pour ce dernier point : elle inclut encore le rôle `cm`, dette
-- connue et non corrigée à ce jour. On nomme donc explicitement les rôles.

begin;

-- ── 1. L'archivage d'une équipe ──
create or replace function public.proteger_existence_equipe()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if new.archivee is distinct from old.archivee then
    if not (
      peut_operer_club(old.club_id)
      or is_club_admin(old.club_id)
      or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'com', 'sec'))
    ) then
      raise exception 'Archiver ou réactiver une équipe relève du club : un éducateur gère l''activité de son équipe, pas son existence.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_proteger_existence_equipe on public.club_teams;
create trigger trg_proteger_existence_equipe
  before update on public.club_teams
  for each row execute function public.proteger_existence_equipe();

-- ── 2. La suppression d'une fiche joueur ──
drop policy if exists pp_admin_delete on public.player_profiles;

drop policy if exists pp_staff_delete on public.player_profiles;
create policy pp_staff_delete on public.player_profiles
  for delete using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'sec'))
  );

comment on policy pp_staff_delete on public.player_profiles is
  'La suppression physique d''une fiche joueur est une opération administrative exceptionnelle : elle efface un historique de matchs, de médias, de commandes et d''autorisations. Le club retire un joueur par account_status et par la fin de son appartenance à l''équipe.';

commit;
