-- ============================================================
-- SPORTVISION CLUB+ — Migration v21
-- Suite de migration-clubplus-v1 à v20.sql. Idempotente.
--
-- Portée : Phase 11 du module « Espace Joueur & Famille »
-- (cf. CLUBPLUS_PLAYER_FAMILY_ARCHITECTURE.md, §9.2) — projets
-- collectifs d'équipe. Réutilise catalogue_offres (pas de duplication du
-- catalogue) et le pattern Stripe déjà en place côté Portail
-- (create-checkout-session/stripe-webhook), mais SANS réutiliser
-- client_users/paiements/prestations : un joueur/parent contribuant à un
-- projet n'est jamais un client Portail (même risque de mélange qu'ailleurs
-- dans ce module — cf. architecture §0). Un Edge Function séparé
-- (create-team-contribution-checkout) et une extension du webhook
-- existant (branché sur contribution_id en plus de paiement_id) portent
-- la partie paiement ; cette migration ne fait que la partie données.
-- ============================================================

-- ── 1. is_team_educateur étendu au président ──
-- Le prompt d'origine liste le président parmi les créateurs autorisés
-- d'un projet collectif (§19), au même titre que l'admin — le président
-- n'est pas restreint à une équipe, contrairement à coach/resp_equipe.

create or replace function is_team_educateur(p_team_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from club_members cm, club_teams ct
    where ct.id = p_team_id and cm.club_id = ct.club_id and cm.user_id = auth.uid() and cm.status = 'actif'
      and (
        cm.role in ('admin', 'president')
        or (cm.role in ('coach', 'resp_equipe') and cm.teams @> to_jsonb(ct.name::text))
      )
  );
$$;

-- ── 2. TABLES ──

create table if not exists team_projects (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  team_id uuid references club_teams(id) on delete cascade not null,
  catalogue_offre_id uuid references catalogue_offres(id) not null,
  titre text not null,
  objectif text,
  montant_cible numeric(10,2) not null,
  montant_collecte numeric(10,2) not null default 0,
  date_evenement date,
  date_limite date,
  part_conseillee numeric(10,2),
  contribution_min numeric(10,2),
  responsable_id uuid references auth.users on delete set null,
  conditions_non_atteint text,
  statut text check (statut in (
    'brouillon', 'attente_validation_club', 'ouvert', 'objectif_atteint',
    'paiement_complementaire_necessaire', 'confirme', 'annule', 'rembourse',
    'prestation_realisee', 'livre'
  )) not null default 'brouillon',
  created_by uuid references auth.users on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_tpr_upd on team_projects;
create trigger trg_tpr_upd before update on team_projects
  for each row execute procedure update_updated_at_generic();

create index if not exists idx_tpr_club on team_projects(club_id, statut);
create index if not exists idx_tpr_team on team_projects(team_id);

create table if not exists team_project_contributions (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references team_projects(id) on delete cascade not null,
  contributor_type text check (contributor_type in ('joueur_majeur', 'parent', 'club', 'sponsor')) not null,
  contributor_user_id uuid references auth.users on delete set null,
  player_id uuid references player_profiles(id) on delete set null,
  montant numeric(10,2) not null,
  statut text check (statut in ('en_attente', 'paye', 'rembourse', 'echoue')) not null default 'en_attente',
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  created_at timestamptz default now()
);

create index if not exists idx_tpc_project on team_project_contributions(project_id, statut);

create table if not exists team_project_events (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references team_projects(id) on delete cascade not null,
  event_type text not null,
  acted_by uuid references auth.users on delete set null,
  note text,
  created_at timestamptz default now()
);

create index if not exists idx_tpe_project on team_project_events(project_id);

-- ── 3. JOURNAL AUTOMATIQUE (pas de RPC dédiée : une création/un changement
--    de statut se journalise tout seul) ──

create or replace function log_team_project_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    insert into team_project_events (project_id, event_type, acted_by) values (new.id, 'creee', auth.uid());
  elsif TG_OP = 'UPDATE' and new.statut is distinct from old.statut then
    insert into team_project_events (project_id, event_type, acted_by, note) values (new.id, 'statut:' || new.statut, auth.uid(), null);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_tpr_log on team_projects;
create trigger trg_tpr_log after insert or update on team_projects
  for each row execute procedure log_team_project_event();

-- ── 4. RECALCUL AUTOMATIQUE DU MONTANT COLLECTÉ ──
-- Se déclenche quand une contribution passe à 'paye' (fait par stripe-webhook,
-- service role, donc jamais bloqué par RLS) : recompte la somme des
-- contributions payées et bascule 'ouvert' -> 'objectif_atteint' si la
-- cible est atteinte. Ne fait jamais régresser un statut déjà avancé
-- (confirme, prestation_realisee, livre...).

create or replace function recompute_team_project_amount()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_project_id uuid := coalesce(new.project_id, old.project_id);
  v_total numeric(10,2);
  v_target numeric(10,2);
  v_statut text;
begin
  select coalesce(sum(montant), 0) into v_total from team_project_contributions where project_id = v_project_id and statut = 'paye';
  select montant_cible, statut into v_target, v_statut from team_projects where id = v_project_id;

  update team_projects
  set montant_collecte = v_total,
      statut = case when v_statut = 'ouvert' and v_target is not null and v_total >= v_target then 'objectif_atteint' else statut end
  where id = v_project_id;

  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_tpc_recompute on team_project_contributions;
create trigger trg_tpc_recompute after insert or update or delete on team_project_contributions
  for each row execute procedure recompute_team_project_amount();

-- ── 5. RLS ──

alter table team_projects enable row level security;
alter table team_project_contributions enable row level security;
alter table team_project_events enable row level security;

drop policy if exists "tpr_family_select" on team_projects;
create policy "tpr_family_select" on team_projects for select using (is_family_of_team(team_id));

drop policy if exists "tpr_member_select" on team_projects;
create policy "tpr_member_select" on team_projects for select using (is_club_member(club_id));

drop policy if exists "tpr_educateur_insert" on team_projects;
create policy "tpr_educateur_insert" on team_projects for insert with check (is_team_educateur(team_id));

-- Le créateur peut encore modifier tant que le projet est en brouillon (pas
-- encore soumis) ; l'admin peut tout modifier à tout moment (validation,
-- annulation, etc.) — même convention que club_bookings (cbk_admin_update) :
-- au-delà du brouillon, le pipeline est piloté par le club/SportVision.
drop policy if exists "tpr_creator_update_draft" on team_projects;
create policy "tpr_creator_update_draft" on team_projects for update using (
  created_by = auth.uid() and statut = 'brouillon'
);

drop policy if exists "tpr_admin_update" on team_projects;
create policy "tpr_admin_update" on team_projects for update using (is_club_admin(club_id));

drop policy if exists "tpr_admin_delete" on team_projects;
create policy "tpr_admin_delete" on team_projects for delete using (is_club_admin(club_id));

-- team_project_contributions : le contributeur voit ses propres
-- contributions, les dirigeants (admin ou éducateur de l'équipe du
-- projet) voient tout. Aucune policy INSERT/UPDATE : la création passe
-- par l'Edge Function create-team-contribution-checkout (doit appeler
-- Stripe), la mise à jour par stripe-webhook — tous deux en service role,
-- qui contourne le RLS.
drop policy if exists "tpc_contributor_select" on team_project_contributions;
create policy "tpc_contributor_select" on team_project_contributions for select using (contributor_user_id = auth.uid());

drop policy if exists "tpc_manager_select" on team_project_contributions;
create policy "tpc_manager_select" on team_project_contributions for select using (
  exists (
    select 1 from team_projects tp
    where tp.id = team_project_contributions.project_id
      and (is_club_admin(tp.club_id) or is_team_educateur(tp.team_id))
  )
);

drop policy if exists "tpe_select" on team_project_events;
create policy "tpe_select" on team_project_events for select using (
  exists (
    select 1 from team_projects tp
    where tp.id = team_project_events.project_id
      and (is_club_admin(tp.club_id) or is_team_educateur(tp.team_id) or is_family_of_team(tp.team_id))
  )
);
