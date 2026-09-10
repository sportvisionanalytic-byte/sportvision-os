-- Renommer une équipe faisait perdre ses droits à son coach, en silence.
--
-- ── Prouvé en production, transaction annulée, 10/09/2026 ──
-- Un coach rattaché à « Séniors R2 ». Le CM renomme l'équipe en « Séniors R2 Élite ».
--
--   avant : is_team_educateur = true,  28 matchs visibles
--   après : is_team_educateur = FALSE,  0 match visible
--   son périmètre en base : toujours ["Séniors R2"]
--
-- Rien n'a échoué, aucun message n'est apparu. Le coach se serait simplement retrouvé devant un
-- écran vide, sans savoir pourquoi.
--
-- ── La cause, et pourquoi on ne la supprime pas aujourd'hui ──
-- `club_members.teams` désigne les équipes par leur NOM, et `is_team_educateur` compare à la
-- lettre près. La bonne réponse serait de référencer par `team_id`. Mais douze colonnes portent
-- un nom d'équipe — `club_bookings`, `club_calendar_events`, `club_creations`, `club_invitations`,
-- `club_matches`, `club_media`, `club_members`, `club_newsroom_items`, `club_requests`,
-- `club_sponsors`, `connect_declared_club_players`, `planned_presences` — et trois policies plus
-- deux fonctions les comparent. Une migration nom → identifiant se décide, elle ne s'improvise
-- pas au bout d'une journée de correctifs.
--
-- ⚠ DETTE TECHNIQUE ASSUMÉE : le rattachement par nom reste. Ce fichier rend le RENOMMAGE sûr,
-- il ne supprime pas la cause. La migration vers `team_id` est à cadrer séparément.
--
-- ── Ce qu'on pose ──
--   1. Un nom d'équipe est unique dans son club. Sans ça, deux équipes homonymes donneraient au
--      même coach l'accès aux deux — vérifié : aucun doublon n'existe aujourd'hui.
--   2. Le renommage propage le nouveau nom à toutes les références, dans LA MÊME transaction.
--      Il n'existe donc aucun instant où une référence pointe vers un nom disparu.

begin;

-- ── 1. Unicité du nom dans le club ──
-- Le message d'abord, l'index ensuite : une violation d'index unique donne un texte que personne
-- ne peut lire. Les archivées comptent — réactiver une équipe ne doit pas créer d'homonyme.
create or replace function public.verifier_unicite_nom_equipe()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_op = 'UPDATE' and new.name is not distinct from old.name then
    return new;
  end if;
  if exists (
    select 1 from club_teams t
     where t.club_id = new.club_id
       and t.id <> new.id
       and lower(btrim(t.name)) = lower(btrim(new.name))
  ) then
    raise exception 'Une autre équipe de ce club porte déjà le nom « % ». Deux équipes de même nom donneraient les mêmes droits à leurs éducateurs.', btrim(new.name);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_unicite_nom_equipe on public.club_teams;
create trigger trg_unicite_nom_equipe
  before insert or update of name, club_id on public.club_teams
  for each row execute function public.verifier_unicite_nom_equipe();

create unique index if not exists club_teams_nom_unique_par_club
  on public.club_teams (club_id, lower(btrim(name)));

-- ── 2. La propagation du renommage ──
create or replace function public.propager_renommage_equipe()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.name is not distinct from old.name then
    return new;
  end if;

  -- LE point critique : le périmètre des encadrants. Sans cette ligne, le coach perd son équipe.
  update club_members m
     set teams = (
       select coalesce(jsonb_agg(case when t = old.name then new.name else t end), '[]'::jsonb)
         from jsonb_array_elements_text(m.teams) t
     )
   where m.club_id = new.club_id
     and m.teams ? old.name;

  -- Les invitations en cours désignent aussi l'équipe par son nom : une invitation partie hier
  -- doit rattacher à l'équipe d'aujourd'hui.
  update club_invitations ci
     set teams = (
       select coalesce(jsonb_agg(case when t = old.name then new.name else t end), '[]'::jsonb)
         from jsonb_array_elements_text(ci.teams) t
     )
   where ci.club_id = new.club_id
     and ci.teams ? old.name;

  update club_sponsors s
     set teams = (
       select coalesce(jsonb_agg(case when t = old.name then new.name else t end), '[]'::jsonb)
         from jsonb_array_elements_text(s.teams) t
     )
   where s.club_id = new.club_id
     and s.teams ? old.name;

  -- Les libellés texte. Là où un `team_id` existe, il fait foi : on suit le lien plutôt que le
  -- nom, ce qui rattrape au passage une référence déjà désynchronisée.
  update club_matches
     set team = new.name
   where club_id = new.club_id
     and (team_id = new.id or (team_id is null and team = old.name));

  update club_calendar_events
     set team = new.name
   where club_id = new.club_id
     and (team_id = new.id or (team_id is null and team = old.name));

  update club_bookings
     set team = new.name
   where club_id = new.club_id
     and (team_id = new.id or (team_id is null and team = old.name));

  update club_creations       set team = new.name where club_id = new.club_id and team = old.name;
  update club_media           set team = new.name where club_id = new.club_id and team = old.name;
  update club_newsroom_items  set team = new.name where club_id = new.club_id and team = old.name;
  update club_requests        set team = new.name where club_id = new.club_id and team = old.name;

  -- Les présences terrain nomment l'équipe sans porter le club : on remonte par le match ou
  -- l'événement auquel elles se rattachent, jamais par le seul libellé — deux clubs peuvent avoir
  -- une « U15 D1 ».
  update planned_presences pp
     set equipe = new.name
   where pp.equipe = old.name
     and (
       exists (select 1 from club_matches m where m.id = pp.match_id and m.club_id = new.club_id)
       or exists (select 1 from club_calendar_events e where e.id = pp.calendar_event_id and e.club_id = new.club_id)
     );

  -- `connect_declared_club_players.team` n'est pas traitée : la table ne porte pas de club_id, et
  -- rien ne permet de rattacher une de ses lignes à un club sans deviner. Elle est vide à ce jour.
  -- Notée dans la dette, avec la migration nom → team_id.

  return new;
end;
$$;

drop trigger if exists trg_propager_renommage_equipe on public.club_teams;
create trigger trg_propager_renommage_equipe
  after update of name on public.club_teams
  for each row execute function public.propager_renommage_equipe();

comment on function public.propager_renommage_equipe() is
  'Renommer une équipe met à jour, dans la même transaction, toutes les références qui la désignent par son nom — à commencer par club_members.teams, dont dépendent les droits des éducateurs. Palliatif assumé : la vraie correction est de référencer par team_id, migration à cadrer.';

commit;
