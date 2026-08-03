-- ============================================================
-- SPORTVISION CLUB+ — Migration v1
-- Connecte SportVision Club+ au même projet Supabase que l'OS et le Portail.
-- Idempotente : peut être rejouée sans erreur (drop policy if exists avant chaque create).
-- N'altère aucune table existante de façon cassante (ajouts uniquement).
-- À exécuter dans Supabase → SQL Editor, après les migrations OS/Portail existantes.
--
-- Portée de cette v1 : authentification + création de club + adhésion (club_members).
-- Les autres modules (demandes, newsroom, sponsors...) restent en données de démo
-- côté app.html tant qu'ils n'ont pas leur propre migration.
-- ============================================================

-- Réutilise la fonction générique déjà créée par migration-portail-v1.sql ; recréée
-- ici au cas où Club+ serait déployé seul sur un projet qui n'a pas encore Portail.
create or replace function update_updated_at_generic()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- ── 1. CLUBS ──

create table if not exists clubs (
  id uuid default gen_random_uuid() primary key,
  nom text not null,
  ville text,
  discipline text,
  saison text default '2026-2027',
  plan text check (plan in ('club','performance')) default 'club',
  engagement text check (engagement in ('12mois','sans')) default '12mois',
  pilot_mode boolean default true,
  credits_balance integer default 0,
  credits_monthly integer default 5,
  credits_reserved integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_clubs_upd on clubs;
create trigger trg_clubs_upd before update on clubs
  for each row execute procedure update_updated_at_generic();

alter table clubs enable row level security;

-- ── Fonction non-récursive de vérification d'appartenance à un club ──
-- SECURITY DEFINER : contourne le RLS de club_members lors de son évaluation interne,
-- ce qui évite la boucle infinie qu'aurait une sous-requête club_members directement
-- dans une policy de club_members elle-même (cf. migration-fix-recursion-profiles.sql
-- pour l'incident équivalent déjà rencontré sur `profiles`).
create or replace function is_club_member(target_club_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from club_members
    where club_id = target_club_id and user_id = auth.uid() and status = 'actif'
  );
$$;

drop policy if exists "clubs_member_select" on clubs;
create policy "clubs_member_select" on clubs for select using (is_club_member(id));

drop policy if exists "clubs_staff_all" on clubs;
create policy "clubs_staff_all" on clubs for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','com','sec'))
);
-- (staff OS géré via `profiles`, table distincte de `club_members` : pas de récursion ici)

-- ── 2. CLUB_MEMBERS ──
-- Table séparée de `profiles` (staff OS) et de `client_users` (clients Portail), sur le
-- même principe que client_users : un compte Club+ n'a jamais de ligne dans `profiles`,
-- donc les policies existantes de l'OS échouent naturellement pour lui (fail-closed par
-- défaut, aucune policy existante à modifier). Alimentée par l'Edge Function
-- clubplus-onboarding (service role). Un utilisateur peut appartenir à plusieurs clubs
-- avec un rôle différent dans chacun — d'où (user_id, club_id) unique plutôt que id = user_id.

create table if not exists club_members (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  club_id uuid references clubs(id) on delete cascade not null,
  role text check (role in (
    'admin','president','secretaire','comm','cm_externe','coach',
    'resp_equipe','sponsor_mgr','tresorier','membre_bureau','lecture_seule'
  )) not null default 'admin',
  prenom text,
  nom text,
  telephone text,
  teams jsonb default '[]',
  status text check (status in ('actif','invitation','suspendu')) default 'actif',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, club_id)
);

drop trigger if exists trg_club_members_upd on club_members;
create trigger trg_club_members_upd before update on club_members
  for each row execute procedure update_updated_at_generic();

alter table club_members enable row level security;

drop policy if exists "cm_self_select" on club_members;
create policy "cm_self_select" on club_members for select using (auth.uid() = user_id);

drop policy if exists "cm_same_club_select" on club_members;
create policy "cm_same_club_select" on club_members for select using (is_club_member(club_id));

drop policy if exists "cm_self_update" on club_members;
create policy "cm_self_update" on club_members for update using (auth.uid() = user_id);

drop policy if exists "cm_staff_all" on club_members;
create policy "cm_staff_all" on club_members for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','com','sec'))
);

create index if not exists idx_cm_user on club_members(user_id);
create index if not exists idx_cm_club on club_members(club_id);

-- ── 3. Historique des crédits (amorce — table seule, pas encore alimentée par l'app) ──

create table if not exists club_credit_transactions (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  label text not null,
  amount integer not null,
  created_by uuid references auth.users,
  created_at timestamptz default now()
);

alter table club_credit_transactions enable row level security;

drop policy if exists "cct_member_select" on club_credit_transactions;
create policy "cct_member_select" on club_credit_transactions for select using (is_club_member(club_id));

drop policy if exists "cct_staff_all" on club_credit_transactions;
create policy "cct_staff_all" on club_credit_transactions for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','com','sec'))
);

create index if not exists idx_cct_club on club_credit_transactions(club_id, created_at desc);

-- ── 4. Empêcher le trigger handle_new_user() (staff OS) de créer une fiche
--      `profiles` fantôme pour un compte Club+ ──
-- Le trigger existant (corrigé par migration-fix-portail-cree-profil-staff.sql) ne crée
-- déjà une ligne `profiles` QUE si raw_user_meta_data->>'role' est fourni à l'inscription.
-- L'Edge Function clubplus-onboarding n'envoie jamais ce champ : aucune action requise ici,
-- ce commentaire documente juste pourquoi c'est sûr.
