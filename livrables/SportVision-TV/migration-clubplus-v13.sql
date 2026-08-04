-- ============================================================
-- SPORTVISION CLUB+ — Migration v13
-- Suite de migration-clubplus-v1 à v12.sql. Idempotente.
--
-- Portée : Phase 1+2 du module « Espace Joueur & Famille »
-- (cf. CLUBPLUS_PLAYER_FAMILY_ARCHITECTURE.md) — fondations d'identité :
-- fiches joueur (avec ou sans compte Auth), profils parent, liens
-- parent↔joueur, rattachement équipe historisé par saison, et les
-- fonctions RLS dédiées à cet univers.
--
-- IMPORTANT — pourquoi ce n'est PAS branché sur club_members/is_club_member :
-- is_club_member(club_id) ne vérifie que le statut, sans distinction de
-- rôle, et sert de condition SELECT sur clubs, club_teams, club_media,
-- club_creations, club_calendar_events, club_matches, club_requests,
-- club_credit_transactions. Un joueur/parent qui deviendrait un
-- club_members hériterait automatiquement de la lecture des demandes de
-- création internes, des transactions de crédits et de colonnes
-- sensibles de clubs (credits_balance, role_permissions,
-- portail_client_id). C'est pourquoi ce module introduit ses propres
-- fonctions SECURITY DEFINER (is_own_player, is_confirmed_parent_of,
-- is_family_of_team, is_team_educateur), plus restrictives et scopées à
-- l'équipe plutôt qu'au club.
--
-- Aucune donnée créée par un client directement sur player_profiles/
-- parent_profiles : la création passe par des Edge Functions à service
-- role (invitations, import), phases suivantes — même convention que
-- club_members (aucune policy INSERT n'existe dessus non plus).
-- ============================================================

-- ── 1. RÈGLE D'ÂGE, CALCULÉE SERVEUR — jamais une valeur transmise par le client ──

create or replace function sv_age_bracket(p_date_naissance date)
returns text
language sql
immutable
as $$
  select case
    when p_date_naissance is null then null
    when age(p_date_naissance) < interval '14 years' then 'moins_14'
    when age(p_date_naissance) < interval '18 years' then '14_17'
    else 'majeur'
  end;
$$;

-- ── 2. TABLES ──

create table if not exists player_profiles (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  user_id uuid references auth.users on delete set null,
  prenom text not null,
  nom text not null,
  date_naissance date not null,
  sexe text check (sexe in ('M','F','autre')),
  numero_licence text,
  numero_maillot text,
  photo_url text,
  account_status text check (account_status in (
    'sans_compte','invite','en_attente_activation','actif','suspendu','retire'
  )) not null default 'sans_compte',
  created_by uuid references auth.users on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint player_user_unique unique (user_id)
);

drop trigger if exists trg_pp_upd on player_profiles;
create trigger trg_pp_upd before update on player_profiles
  for each row execute procedure update_updated_at_generic();

create index if not exists idx_pp_club on player_profiles(club_id);
create index if not exists idx_pp_user on player_profiles(user_id);

-- Colonnes sensibles (club_id, user_id, date_naissance, account_status) : RLS est
-- row-level, pas column-level — un self-update ouvert laisserait un joueur se
-- déplacer de club ou s'auto-activer. Ce trigger ferme ces colonnes précises
-- sauf pour un admin du club, même patron que la mise en garde déjà documentée
-- sur clubs_admin_update/cm_admin_update (v1/v9).
create or replace function guard_player_profile_update()
returns trigger language plpgsql as $$
begin
  if not is_club_admin(new.club_id) then
    if new.club_id is distinct from old.club_id
       or new.user_id is distinct from old.user_id
       or new.date_naissance is distinct from old.date_naissance
       or new.account_status is distinct from old.account_status then
      raise exception 'Modification non autorisée sur ces champs';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_pp_guard on player_profiles;
create trigger trg_pp_guard before update on player_profiles
  for each row execute procedure guard_player_profile_update();

create table if not exists parent_profiles (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null unique,
  prenom text,
  nom text,
  telephone text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_parp_upd on parent_profiles;
create trigger trg_parp_upd before update on parent_profiles
  for each row execute procedure update_updated_at_generic();

create table if not exists parent_player_relationships (
  id uuid default gen_random_uuid() primary key,
  parent_id uuid references parent_profiles(id) on delete cascade not null,
  player_id uuid references player_profiles(id) on delete cascade not null,
  relation_type text check (relation_type in ('parent','tuteur_legal','autre_representant')) default 'parent',
  statut text check (statut in ('en_attente_confirmation','confirme','refuse','retire')) not null default 'en_attente_confirmation',
  confirmed_at timestamptz,
  created_at timestamptz default now(),
  unique (parent_id, player_id)
);

create index if not exists idx_ppr_parent on parent_player_relationships(parent_id);
create index if not exists idx_ppr_player on parent_player_relationships(player_id);

create table if not exists team_memberships (
  id uuid default gen_random_uuid() primary key,
  player_id uuid references player_profiles(id) on delete cascade not null,
  team_id uuid references club_teams(id) on delete cascade not null,
  club_id uuid references clubs(id) on delete cascade not null,
  saison text not null,
  statut text check (statut in (
    'active','en_attente_renouvellement','archivee','quittee_equipe','quittee_club'
  )) not null default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (player_id, team_id, saison)
);

drop trigger if exists trg_tm_upd on team_memberships;
create trigger trg_tm_upd before update on team_memberships
  for each row execute procedure update_updated_at_generic();

create index if not exists idx_tm_player on team_memberships(player_id);
create index if not exists idx_tm_team on team_memberships(team_id, statut);

create or replace function check_team_membership_club()
returns trigger language plpgsql as $$
begin
  if new.club_id <> (select club_id from club_teams where id = new.team_id) then
    raise exception 'team_id n''appartient pas à club_id';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_tm_check_club on team_memberships;
create trigger trg_tm_check_club before insert or update on team_memberships
  for each row execute procedure check_team_membership_club();

-- ── 3. FONCTIONS RLS DÉDIÉES (créées après les tables ci-dessus : SECURITY
--    DEFINER en language sql est validé contre le catalogue à la création,
--    même contrainte d'ordre que is_club_member en v1) ──

create or replace function is_own_player(p_player_id uuid)
returns boolean language sql security definer stable as $$
  select exists (select 1 from player_profiles where id = p_player_id and user_id = auth.uid());
$$;

create or replace function is_confirmed_parent_of(p_player_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from parent_player_relationships ppr
    join parent_profiles pp on pp.id = ppr.parent_id
    where ppr.player_id = p_player_id and pp.user_id = auth.uid() and ppr.statut = 'confirme'
  );
$$;

-- Vrai si l'appelant (joueur lui-même OU un parent confirmé de ce joueur) a un
-- rattachement actif à cette équipe précise — volontairement scopé équipe,
-- pas club, contrairement à is_club_member.
create or replace function is_family_of_team(p_team_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from team_memberships tm
    join player_profiles p on p.id = tm.player_id
    where tm.team_id = p_team_id and tm.statut = 'active'
      and (p.user_id = auth.uid() or is_confirmed_parent_of(p.id))
  );
$$;

-- Éducateur/responsable d'équipe habilité sur cette équipe précise. Réutilise
-- club_members (univers dirigeants) en lecture seule ; un éducateur passe par
-- CETTE fonction pour agir côté joueur/famille, jamais l'inverse.
create or replace function is_team_educateur(p_team_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from club_members cm, club_teams ct
    where ct.id = p_team_id and cm.club_id = ct.club_id and cm.user_id = auth.uid() and cm.status = 'actif'
      and (
        cm.role = 'admin'
        or (cm.role in ('coach','resp_equipe') and cm.teams @> to_jsonb(ct.name::text))
      )
  );
$$;

-- ── 4. RLS ──

alter table player_profiles enable row level security;
alter table parent_profiles enable row level security;
alter table parent_player_relationships enable row level security;
alter table team_memberships enable row level security;

-- player_profiles : lecture par le joueur lui-même, un parent confirmé, un
-- éducateur habilité sur une des équipes du joueur, ou l'admin du club.
-- Écriture (hors colonnes sensibles, cf. guard_player_profile_update) par
-- soi-même ou l'admin ; création réservée aux Edge Functions (service role,
-- phases suivantes).
drop policy if exists "pp_self_select" on player_profiles;
create policy "pp_self_select" on player_profiles for select using (user_id = auth.uid());

drop policy if exists "pp_parent_select" on player_profiles;
create policy "pp_parent_select" on player_profiles for select using (is_confirmed_parent_of(id));

drop policy if exists "pp_educateur_select" on player_profiles;
create policy "pp_educateur_select" on player_profiles for select using (
  exists (select 1 from team_memberships tm where tm.player_id = player_profiles.id and is_team_educateur(tm.team_id))
);

-- Pas de policy INSERT, même pour l'admin : la création de fiche joueur passe
-- toujours par une Edge Function à service role (import, invitation), même
-- convention que club_members qui n'a aucune policy INSERT non plus.
drop policy if exists "pp_admin_select" on player_profiles;
create policy "pp_admin_select" on player_profiles for select using (is_club_admin(club_id));

drop policy if exists "pp_admin_update" on player_profiles;
create policy "pp_admin_update" on player_profiles for update using (is_club_admin(club_id));

drop policy if exists "pp_admin_delete" on player_profiles;
create policy "pp_admin_delete" on player_profiles for delete using (is_club_admin(club_id));

drop policy if exists "pp_self_update" on player_profiles;
create policy "pp_self_update" on player_profiles for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- parent_profiles : profil global (pas par club) — lecture par soi-même, ou
-- par l'admin d'un club où un enfant lié existe.
drop policy if exists "parp_self_select" on parent_profiles;
create policy "parp_self_select" on parent_profiles for select using (user_id = auth.uid());

drop policy if exists "parp_club_admin_select" on parent_profiles;
create policy "parp_club_admin_select" on parent_profiles for select using (
  exists (
    select 1 from parent_player_relationships ppr
    join player_profiles p on p.id = ppr.player_id
    where ppr.parent_id = parent_profiles.id and is_club_admin(p.club_id)
  )
);

drop policy if exists "parp_self_update" on parent_profiles;
create policy "parp_self_update" on parent_profiles for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- parent_player_relationships : le parent confirme lui-même le lien qui le
-- concerne (statut passe en_attente_confirmation -> confirme/refuse) ; le
-- joueur, l'éducateur de l'équipe du joueur et l'admin du club le consultent.
-- La création reste réservée aux Edge Functions (invitation/rattachement).
drop policy if exists "ppr_parent_select" on parent_player_relationships;
create policy "ppr_parent_select" on parent_player_relationships for select using (
  exists (select 1 from parent_profiles pp where pp.id = parent_player_relationships.parent_id and pp.user_id = auth.uid())
);

drop policy if exists "ppr_player_select" on parent_player_relationships;
create policy "ppr_player_select" on parent_player_relationships for select using (is_own_player(player_id));

drop policy if exists "ppr_club_select" on parent_player_relationships;
create policy "ppr_club_select" on parent_player_relationships for select using (
  exists (
    select 1 from player_profiles p
    where p.id = parent_player_relationships.player_id
      and (
        is_club_admin(p.club_id)
        or exists (select 1 from team_memberships tm where tm.player_id = p.id and is_team_educateur(tm.team_id))
      )
  )
);

drop policy if exists "ppr_parent_confirm" on parent_player_relationships;
create policy "ppr_parent_confirm" on parent_player_relationships for update
  using (exists (select 1 from parent_profiles pp where pp.id = parent_player_relationships.parent_id and pp.user_id = auth.uid()))
  with check (exists (select 1 from parent_profiles pp where pp.id = parent_player_relationships.parent_id and pp.user_id = auth.uid()));

-- team_memberships : lecture par le joueur, un parent confirmé, l'éducateur
-- habilité sur l'équipe, l'admin du club. Écriture réservée aux RPC
-- (request_team_membership / validate_team_membership / move_player_to_team,
-- phases suivantes) — même logique que club_requests (v4) : transitions
-- d'état sensibles jamais via une policy UPDATE ouverte.
drop policy if exists "tm_player_select" on team_memberships;
create policy "tm_player_select" on team_memberships for select using (is_own_player(player_id));

drop policy if exists "tm_parent_select" on team_memberships;
create policy "tm_parent_select" on team_memberships for select using (is_confirmed_parent_of(player_id));

drop policy if exists "tm_educateur_select" on team_memberships;
create policy "tm_educateur_select" on team_memberships for select using (is_team_educateur(team_id));

drop policy if exists "tm_admin_select" on team_memberships;
create policy "tm_admin_select" on team_memberships for select using (is_club_admin(club_id));
