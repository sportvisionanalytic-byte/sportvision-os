-- La composition d'un match, décidée par le coach, invisible des joueurs (21/09/2026)
--
-- DEMANDE DE FOUKA : « s'il y a un match à venir, qu'il puisse mettre la composition en avance.
-- Les joueurs ne doivent pas la voir, mais moi, community manager, je dois pouvoir voir la
-- composition, ou alors les 14 convoqués. »
--
-- POURQUOI CE N'EST PAS UN DÉTAIL DE CONFORT. Un coach qui prépare son onze la veille ne veut
-- surtout pas que son groupe le découvre avant lui : c'est la première chose qu'il demandera
-- avant de saisir quoi que ce soit ici. La discrétion n'est donc pas un réglage d'affichage, elle
-- est portée par la RLS — un joueur ou un parent n'a aucun chemin de lecture vers cette table,
-- même en interrogeant l'API directement.
--
-- Pour SportVision, à l'inverse, la liste des convoqués est une information de production : elle
-- dit qui sera sur le terrain, donc qui photographier. Le CM la lit, il ne l'écrit pas.
--
-- CE QU'ON NE FAIT PAS : pas de schéma tactique, pas de position sur un terrain dessiné, pas de
-- capitaine ni de brassard. Fouka a demandé « la composition ou les 14 convoqués » — un groupe et
-- trois états suffisent. Le reste s'ajoutera si le terrain le réclame.

begin;

create table if not exists public.match_convocations (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references club_matches(id) on delete cascade,
  player_id uuid not null references player_profiles(id) on delete cascade,
  -- 'titulaire' : il commence. 'remplacant' : il est sur le banc. 'reserve' : convoqué, non retenu
  -- dans le groupe final — le coach garde la trace de son choix sans l'effacer.
  role text not null default 'titulaire' check (role in ('titulaire', 'remplacant', 'reserve')),
  poste text,
  ordre int not null default 0,
  decide_par uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, player_id)
);

create index if not exists match_convocations_match_idx on match_convocations (match_id);
create index if not exists match_convocations_player_idx on match_convocations (player_id);

comment on table public.match_convocations is
  'Le groupe convoqué pour un match, décidé par le coach. Invisible des joueurs et des familles '
  'par construction (aucune policy de lecture ne les atteint) — voir migration v242.';

alter table public.match_convocations enable row level security;
grant select, insert, update, delete on public.match_convocations to authenticated;

-- ══ QUI DÉCIDE ═══════════════════════════════════════════════════════════════
-- Le coach de l'équipe concernée, et ceux qui administrent le club. Pas le CM SportVision : il
-- regarde le terrain, il ne fait pas la feuille de match.
create or replace function public.peut_composer_match(p_match_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1
      from club_matches m
      left join club_teams ct
        on ct.club_id = m.club_id
       and (ct.id = m.team_id or (m.team_id is null and ct.name = m.team))
     where m.id = p_match_id
       and (
         (ct.id is not null and is_real_team_educateur(ct.id))
         or is_club_admin(m.club_id)
       )
  );
$$;

revoke all on function public.peut_composer_match(uuid) from public;
grant execute on function public.peut_composer_match(uuid) to authenticated;

-- ══ QUI LIT ══════════════════════════════════════════════════════════════════
-- Le staff du club, et SportVision quand elle travaille ce club. `is_club_member` ne couvre que
-- club_members : un joueur vit dans player_profiles, un parent dans parent_profiles, ni l'un ni
-- l'autre n'est membre du club au sens de cette table. C'est ce qui rend la composition invisible
-- pour eux sans qu'aucun écran n'ait à y penser.
create or replace function public.peut_lire_composition(p_match_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from club_matches m
     where m.id = p_match_id
       and (is_club_member(m.club_id) or peut_travailler_club(m.club_id) or is_staff())
  );
$$;

revoke all on function public.peut_lire_composition(uuid) from public;
grant execute on function public.peut_lire_composition(uuid) to authenticated;

drop policy if exists convocations_lecture on public.match_convocations;
create policy convocations_lecture on public.match_convocations
  for select using (peut_lire_composition(match_id));

drop policy if exists convocations_ecriture on public.match_convocations;
create policy convocations_ecriture on public.match_convocations
  for all using (peut_composer_match(match_id)) with check (peut_composer_match(match_id));

-- Un compte désactivé ne compose plus rien, comme partout ailleurs.
drop policy if exists convocations_compte_desactive on public.match_convocations;
create policy convocations_compte_desactive on public.match_convocations
  as restrictive for all to authenticated
  using (not (select compte_os_desactive()))
  with check (not (select compte_os_desactive()));

-- ══ POSER LE GROUPE EN UNE FOIS ══════════════════════════════════════════════
-- L'écran envoie la liste entière, pas des ajouts et des retraits un par un : c'est ainsi qu'on
-- le manipule (on coche, on décoche, on enregistre), et cela évite un état intermédiaire où la
-- composition enregistrée ne correspond à rien de voulu.
create or replace function public.match_composer(p_match_id uuid, p_groupe jsonb)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n int;
begin
  if not peut_composer_match(p_match_id) then
    raise exception 'Seul le coach de cette équipe ou un dirigeant du club peut composer ce match.'
      using errcode = '42501';
  end if;

  delete from match_convocations where match_id = p_match_id;

  insert into match_convocations (match_id, player_id, role, poste, ordre, decide_par)
  select p_match_id,
         (e->>'player_id')::uuid,
         coalesce(nullif(e->>'role', ''), 'titulaire'),
         nullif(e->>'poste', ''),
         coalesce((e->>'ordre')::int, 0),
         auth.uid()
    from jsonb_array_elements(coalesce(p_groupe, '[]'::jsonb)) e
   where e->>'player_id' is not null;

  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.match_composer(uuid, jsonb) from public;
grant execute on function public.match_composer(uuid, jsonb) to authenticated;

-- ══ LIRE LE GROUPE, AVEC LES NOMS ════════════════════════════════════════════
create or replace function public.match_composition(p_match_id uuid)
returns table (player_id uuid, prenom text, nom text, role text, poste text, ordre int)
language sql
stable security definer
set search_path to 'public'
as $$
  select c.player_id, p.prenom, p.nom, c.role, coalesce(c.poste, p.poste), c.ordre
    from match_convocations c
    join player_profiles p on p.id = c.player_id
   where c.match_id = p_match_id
     and peut_lire_composition(p_match_id)
   order by case c.role when 'titulaire' then 1 when 'remplacant' then 2 else 3 end, c.ordre, p.nom;
$$;

revoke all on function public.match_composition(uuid) from public;
grant execute on function public.match_composition(uuid) to authenticated;

-- ══ COMBIEN DE CONVOQUÉS, POUR UNE LISTE DE MATCHS ═══════════════════════════
-- Sert l'écran du coach (une pastille par match) et le panneau de la Production dans l'OS, sans
-- une requête par match.
create or replace function public.matchs_convocations_compte(p_club_id uuid)
returns table (match_id uuid, titulaires int, remplacants int, total int)
language sql
stable security definer
set search_path to 'public'
as $$
  select c.match_id,
         count(*) filter (where c.role = 'titulaire')::int,
         count(*) filter (where c.role = 'remplacant')::int,
         count(*) filter (where c.role <> 'reserve')::int
    from match_convocations c
    join club_matches m on m.id = c.match_id
   where m.club_id = p_club_id
     and (is_club_member(p_club_id) or peut_travailler_club(p_club_id) or is_staff())
   group by c.match_id;
$$;

revoke all on function public.matchs_convocations_compte(uuid) from public;
grant execute on function public.matchs_convocations_compte(uuid) to authenticated;

commit;
