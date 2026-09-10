-- La fiche sportive appartient au club. L'identité appartient au compte.
--
-- ── La frontière, posée par Fouka le 10/09/2026 ──
-- « Le CM peut administrer la fiche sportive, pas posséder l'identité personnelle du joueur. Une
-- fois le joueur réellement inscrit, l'identité personnelle appartient au compte, pas au CM. »
--
-- Il peut : équipe, catégorie, numéro, poste, statut dans l'effectif, archiver/retirer du club,
-- et corriger nom/prénom TANT QUE la fiche n'a pas été revendiquée par un vrai compte — c'est le
-- cas normal d'une fiche préparée par le club avant l'arrivée du joueur.
--
-- Il ne peut pas : supprimer la fiche, toucher au compte rattaché, ni modifier l'identité d'une
-- fiche revendiquée.
--
-- ── Comment c'est tenu ──
-- Une policy ne sait pas restreindre des COLONNES. La règle vit donc dans un trigger, et elle
-- s'applique à tout le monde sauf au staff SportVision et au service_role : ce n'est pas une
-- règle « anti-CM », c'est la règle de la fiche. Un administrateur de club ne réécrit pas
-- davantage le nom d'un joueur qui a pris possession de son compte.
--
-- `user_id` est le marqueur de revendication : nul tant que personne n'a activé la fiche,
-- renseigné dès qu'un compte s'y rattache (`accepter_invitation_joueur`,
-- `connect_join_club_via_smart_link`).
--
-- Le DELETE n'est accordé à personne de nouveau : la fiche porte l'historique des matchs, des
-- médias et des autorisations. On archive via `account_status = 'retire'`.

begin;

create or replace function public.proteger_identite_joueur()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_is_os_staff boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin', 'com', 'sec')
  ) into v_is_os_staff;
  if v_is_os_staff then
    return new;
  end if;

  -- Le rattachement à un compte ne se déplace pas à la main. C'est ce lien qui décide de tout le
  -- reste : le confier à un écran, c'est permettre de s'attribuer la fiche d'un autre.
  if new.user_id is distinct from old.user_id then
    raise exception 'Le compte rattaché à une fiche joueur ne se modifie pas depuis cet espace.';
  end if;
  if new.client_id is distinct from old.client_id then
    raise exception 'Le rattachement client d''une fiche joueur ne se modifie pas depuis cet espace.';
  end if;

  -- Fiche revendiquée : l'identité appartient à la personne. Elle seule peut la corriger, via
  -- `pp_self_update`. Le club garde la main sur tout ce qui est sportif.
  if old.user_id is not null and old.user_id is distinct from auth.uid() then
    if new.prenom is distinct from old.prenom
       or new.nom is distinct from old.nom
       or new.date_naissance is distinct from old.date_naissance
    then
      raise exception 'Cette fiche appartient désormais à son titulaire : son identité ne se modifie plus depuis l''espace du club.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_proteger_identite_joueur on public.player_profiles;
create trigger trg_proteger_identite_joueur
  before update on public.player_profiles
  for each row execute function public.proteger_identite_joueur();

-- ── La fiche sportive, ouverte à qui opère le club ──
-- Pas de DELETE : il n'est accordé à personne de nouveau ici.
drop policy if exists pp_operateur_update on public.player_profiles;
create policy pp_operateur_update on public.player_profiles
  for update using (peut_operer_club(club_id)) with check (peut_operer_club(club_id));

drop policy if exists pp_operateur_insert on public.player_profiles;
create policy pp_operateur_insert on public.player_profiles
  for insert with check (peut_operer_club(club_id));

-- ── Et l'effectif lui-même ──
-- Affecter un joueur à une équipe, l'en retirer : c'est le geste quotidien du club. Il vit dans
-- `team_memberships`, qui n'avait aucune policy pour l'opérateur.
--
-- ⚠ La première version de cette policy interrogeait `club_teams` directement :
--
--   exists (select 1 from club_teams t where t.id = team_memberships.team_id and peut_operer_club(t.club_id))
--
-- Elle a mis `club_teams`, `player_profiles` et `team_memberships` en RÉCURSION INFINIE, et rendu
-- ces trois tables illisibles en production pendant quelques minutes. La raison : `club_teams`
-- porte une policy familiale qui interroge `team_memberships`, laquelle interrogeait désormais
-- `club_teams`. Le cycle était fermé par cette ligne.
--
-- Une policy ne doit jamais lire une table qui, directement ou non, relit la sienne. La résolution
-- passe par une fonction SECURITY DEFINER : elle lit `club_teams` avec les droits de son
-- propriétaire, donc sans réévaluer la moindre policy.
create or replace function public.peut_operer_equipe(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from club_teams t
     where t.id = p_team_id and public.peut_operer_club(t.club_id)
  );
$$;

comment on function public.peut_operer_equipe(uuid) is
  'Qui peut agir sur une équipe : celui qui opère son club. SECURITY DEFINER par nécessité — appelée depuis une policy de team_memberships, elle ne doit pas réévaluer les policies de club_teams, sous peine de récursion infinie (incident du 10/09/2026).';

drop policy if exists tm_operateur_manage on public.team_memberships;
create policy tm_operateur_manage on public.team_memberships
  for all
  using (peut_operer_equipe(team_id))
  with check (peut_operer_equipe(team_id));

commit;
