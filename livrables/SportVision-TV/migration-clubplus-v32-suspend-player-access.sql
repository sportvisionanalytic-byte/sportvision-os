-- ============================================================
-- SPORTVISION CLUB+ — Migration v32 (BROUILLON — NON EXÉCUTÉE)
-- Suite de migration-clubplus-v1 à v31.sql. Idempotente.
--
-- Contexte : en portant les modules Connect "Joueurs & Familles" /
-- "Demandes Joueurs & Familles" (livrables/SportVision-Connect/app/
-- modules/club-gestion-joueurs-familles.js), vérification faite le
-- 2026-08-07 contre le schéma Supabase réel (curl + spec OpenAPI
-- PostgREST en direct, ET grep sur toutes les migrations v1-v31) :
--
--   - La fonction `suspend_player_access`, citée à la fois par
--     CLUBPLUS_PLAYER_FAMILY_ARCHITECTURE.md §6 et par le cadrage de
--     sécurité du chantier Connect comme RPC SECURITY DEFINER "déjà
--     prévue" pour suspendre l'accès d'un joueur, N'EXISTE PAS. Absente
--     des migrations ET du endpoint /rpc/ en direct.
--   - La table `player_access_events` (§2.9 de l'architecture, audit des
--     changements de statut d'accès) N'EXISTE PAS non plus.
--
-- Club+ (app.html) n'expose lui-même AUCUN bouton "Suspendre" dans sa
-- vue Joueurs (famPlayerRowHtml affiche seulement le badge de statut) :
-- rien n'a donc jamais appelé cette fonction en production, et le
-- module Connect ci-dessus n'appelle PAS non plus de fonction
-- inexistante — il n'affiche aucune action de suspension.
--
-- Cette migration est un BROUILLON prêt à relire/valider par Fouka
-- avant exécution. Elle n'a pas été appliquée à la base réelle et
-- aucun code frontend ne l'appelle pour l'instant. Objectif : combler le
-- trou plutôt que de le laisser à un futur "policy UPDATE ouverte" sur
-- player_profiles.account_status, ce que les règles de sécurité du
-- chantier interdisent explicitement pour un changement d'état sensible
-- touchant des mineurs.
-- ============================================================

-- Table d'audit des changements d'accès joueur (prévue par l'architecture
-- §2.9, jamais créée). Consultée pour l'historique, pas pour l'état
-- courant (qui reste player_profiles.account_status, seule source de
-- vérité — même logique déjà appliquée à membership_request_events /
-- authorization_events pour les autres tables sensibles du module).
create table if not exists player_access_events (
  id uuid default gen_random_uuid() primary key,
  player_id uuid references player_profiles(id) on delete cascade not null,
  event_type text not null check (event_type in ('suspendu', 'reactive', 'retire')),
  motif text,
  acted_by uuid references auth.users on delete set null,
  created_at timestamptz default now()
);

create index if not exists idx_pae_player on player_access_events(player_id, created_at desc);

alter table player_access_events enable row level security;

drop policy if exists "pae_admin_select" on player_access_events;
create policy "pae_admin_select" on player_access_events for select using (
  is_club_admin((select club_id from player_profiles where id = player_access_events.player_id))
);

-- suspend_player_access : SECURITY DEFINER, admin uniquement. L'architecture
-- (§6) décrit un parcours en deux temps ("admin ou éducateur (demande),
-- effective seulement côté admin") mais aucune interface éducateur pour
-- "demander" une suspension n'existe nulle part (ni Club+, ni ce module
-- Connect) — cette première version se limite donc à l'action effective
-- (admin), qui est le seul cas réellement utilisable aujourd'hui. Une
-- demande éducateur pourra être ajoutée plus tard sans changer cette
-- fonction (ex: nouvelle table player_suspension_requests + notification),
-- sans quoi le  périmètre serait spéculatif.
--
-- p_reactivate=false (défaut) suspend, true réactive — une seule fonction
-- plutôt que deux, même patron que renew_season_membership (v22) qui
-- porte plusieurs actions derrière un seul paramètre p_action.
create or replace function suspend_player_access(p_player_id uuid, p_motif text default null, p_reactivate boolean default false)
returns player_profiles
language plpgsql security definer set search_path = public as $$
declare
  v_player player_profiles;
begin
  select * into v_player from player_profiles where id = p_player_id;
  if v_player.id is null then raise exception 'Joueur introuvable'; end if;
  if not is_club_admin(v_player.club_id) then raise exception 'Seul un administrateur du club peut suspendre ou réactiver un accès'; end if;

  if p_reactivate then
    if v_player.account_status <> 'suspendu' then raise exception 'Ce joueur n''est pas suspendu'; end if;
    update player_profiles set account_status = 'actif' where id = p_player_id returning * into v_player;
    insert into player_access_events (player_id, event_type, motif, acted_by) values (p_player_id, 'reactive', p_motif, auth.uid());
  else
    if v_player.account_status = 'suspendu' then raise exception 'Ce joueur est déjà suspendu'; end if;
    update player_profiles set account_status = 'suspendu' where id = p_player_id returning * into v_player;
    insert into player_access_events (player_id, event_type, motif, acted_by) values (p_player_id, 'suspendu', p_motif, auth.uid());
  end if;

  return v_player;
end;
$$;
revoke all on function suspend_player_access(uuid, text, boolean) from public;
grant execute on function suspend_player_access(uuid, text, boolean) to authenticated;
