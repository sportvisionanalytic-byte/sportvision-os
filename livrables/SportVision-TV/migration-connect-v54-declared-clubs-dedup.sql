-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v54
-- Rapprochement des clubs non partenaires déclarés par plusieurs joueurs.
--
-- Contexte : l'action "declare" de connect-player-onboarding (édition
-- signup + /affiliations/ajouter) ne fait aujourd'hui qu'envoyer une
-- notification staff isolée à chaque déclaration — rien n'est stocké
-- nulle part. Si 3 joueurs déclarent indépendamment "US Exemple,
-- Nemours", le staff reçoit 3 notifications sans aucun lien entre elles.
-- Cette migration ajoute un rapprochement automatique par nom+ville
-- normalisés, SANS créer de fausse organisation active (aucune écriture
-- dans organizations/clubs — toujours le principe déjà posé : rien n'est
-- activé automatiquement, un humain du staff vérifie et décide).
--
-- NON EXÉCUTÉE — à relire puis exécuter par Fouka dans Supabase → SQL
-- Editor. Idempotente (create table/policy if not exists, drop policy if
-- exists avant chaque create policy, create or replace function).
-- ============================================================

create table if not exists connect_declared_clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null,
  -- Normalisation simple (minuscules + espaces multiples réduits) pour rapprocher
  -- "US Exemple" / "us  exemple" / " US Exemple " sans dépendance à une extension
  -- (pas d'unaccent() garanti disponible) — matching volontairement conservateur,
  -- un vrai doublon avec accents différents ("Étoile" vs "Etoile") ne sera pas
  -- rapproché automatiquement, le staff garde la main dans ce cas.
  name_norm text not null,
  city_norm text not null,
  first_declared_at timestamptz not null default now(),
  unique (name_norm, city_norm)
);

create table if not exists connect_declared_club_players (
  id uuid primary key default gen_random_uuid(),
  declared_club_id uuid not null references connect_declared_clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  team text,
  prenom text,
  nom text,
  created_at timestamptz not null default now(),
  -- Un même joueur qui redéclare le même club (double clic, nouvelle tentative)
  -- met juste à jour sa ligne plutôt que d'être compté deux fois.
  unique (declared_club_id, user_id)
);

create index if not exists idx_cdcp_club on connect_declared_club_players(declared_club_id);

alter table connect_declared_clubs enable row level security;
alter table connect_declared_club_players enable row level security;

-- Lecture réservée au staff (fiche staff/prospection future) — aucune policy
-- INSERT/UPDATE pour authenticated : toute écriture passe par la fonction
-- SECURITY DEFINER ci-dessous, appelée par l'edge function en service_role.
drop policy if exists "cdc_staff_select" on connect_declared_clubs;
create policy "cdc_staff_select" on connect_declared_clubs for select using (is_staff());

drop policy if exists "cdcp_staff_select" on connect_declared_club_players;
create policy "cdcp_staff_select" on connect_declared_club_players for select using (is_staff());

-- p_user_id est un paramètre explicite (pas auth.uid()) car cette fonction est
-- appelée par l'edge function via le client service_role, qui n'a pas de JWT
-- utilisateur — même raisonnement que les autres fonctions appelées en
-- service_role dans ce projet. EXECUTE réservé à service_role uniquement
-- (jamais authenticated) pour qu'un client ne puisse jamais enregistrer une
-- déclaration au nom d'un autre user_id.
create or replace function connect_declare_club(
  p_name text, p_city text, p_team text, p_user_id uuid, p_prenom text, p_nom text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name_norm text := lower(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')));
  v_city_norm text := lower(trim(regexp_replace(coalesce(p_city, ''), '\s+', ' ', 'g')));
  v_club_id uuid;
  v_count int;
begin
  if v_name_norm = '' or v_city_norm = '' then
    raise exception 'Nom et ville du club requis.';
  end if;
  if p_user_id is null then
    raise exception 'Utilisateur requis.';
  end if;

  insert into connect_declared_clubs (name, city, name_norm, city_norm)
  values (trim(p_name), trim(p_city), v_name_norm, v_city_norm)
  on conflict (name_norm, city_norm) do update set name = connect_declared_clubs.name
  returning id into v_club_id;

  insert into connect_declared_club_players (declared_club_id, user_id, team, prenom, nom)
  values (v_club_id, p_user_id, nullif(trim(coalesce(p_team, '')), ''), p_prenom, p_nom)
  on conflict (declared_club_id, user_id) do update set
    team = excluded.team, prenom = excluded.prenom, nom = excluded.nom;

  select count(*) into v_count from connect_declared_club_players where declared_club_id = v_club_id;

  return jsonb_build_object('club_id', v_club_id, 'players_count', v_count);
end;
$$;

revoke all on function connect_declare_club(text, text, text, uuid, text, text) from public;
grant execute on function connect_declare_club(text, text, text, uuid, text, text) to service_role;

-- ============================================================
-- FIN. Actions manuelles requises après relecture :
--   1. Exécuter ce fichier entier dans Supabase → SQL Editor (idempotent).
--   2. Redéployer l'edge function connect-player-onboarding (modifiée pour
--      appeler connect_declare_club() avant la notification staff).
-- ============================================================
