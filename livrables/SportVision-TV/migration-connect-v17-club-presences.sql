-- ============================================================
-- Migration v17 — présences terrain réelles pour un club Full Communication
-- (module /presences de SportVision Connect, jusqu'ici 100% mock).
--
-- ─── Contexte ────────────────────────────────────────────────────────────
-- Confirmé absent lors du chantier Tier B (09/08/2026) : aucune table de
-- présences n'existe pour un club, ni pour un coach. session.ts pose déjà
-- `presencesUsed: 0 // Non trackés côté réel` en attendant. Cette
-- migration couvre le cas CLUB uniquement (Full Communication, résolu par
-- contrat réel — voir buildClubActiveContext, session.ts) : c'est
-- SportVision qui planifie/valide une présence terrain, pas le club —
-- lecture seule côté club, écriture staff.
--
-- Coach (séances) et académie (stages) restent HORS PÉRIMÈTRE de cette
-- migration : contrairement à un club, ces types d'organisation n'ont
-- aujourd'hui aucun lien vers une ligne `clients` réelle (organizations.
-- legacy_client_id n'est peuplé qu'à la création via une table legacy,
-- jamais pour un coach/académie créé par connect-org-signup) — donc pas
-- de résolution possible d'un contrat Full Communication pour ces types
-- tant qu'un mécanisme de rapprochement équivalent à clubplus-onboarding
-- n'existe pas pour eux. À concevoir séparément (voir le rapport de ce
-- chantier).
--
-- Additive, idempotente. NON EXÉCUTÉE PAR L'AGENT. À exécuter par Fouka
-- dans Supabase → SQL Editor après relecture.
-- ============================================================

create table if not exists club_presences (
  id uuid default gen_random_uuid() primary key,
  organization_id uuid references organizations(id) on delete cascade not null,
  event_label text not null,
  event_date date not null,
  kind text not null check (kind in ('match','training','shooting','event')),
  operator_name text,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  created_at timestamptz default now()
);

alter table club_presences enable row level security;
create index if not exists idx_club_presences_org on club_presences(organization_id, event_date desc);

drop policy if exists "cpr_member_select" on club_presences;
create policy "cpr_member_select" on club_presences for select using (
  is_org_member(organization_id) or is_staff()
);

drop policy if exists "cpr_staff_write" on club_presences;
create policy "cpr_staff_write" on club_presences for all using (is_staff());
