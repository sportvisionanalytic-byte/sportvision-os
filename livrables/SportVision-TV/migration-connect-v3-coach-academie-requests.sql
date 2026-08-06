-- ============================================================
-- SPORTVISION CONNECT — Migration v3 : socle minimal Coach & Académie
-- + table `requests` générique réutilisable par tout futur espace.
--
-- Contexte : contrairement à Club, Coach et Académie n'ont AUCUNE table
-- existante côté SportVision (confirmé par l'audit Lot 0 — `formation_*`
-- concerne la formation RH interne des collaborateurs, pas un espace
-- coach/académie externe, piège de nommage déjà signalé). Ce n'est donc
-- pas une migration de données : c'est la création d'un socle minimal
-- mais réellement fonctionnel, pour que les modules Connect Coach et
-- Académie aient de vraies tables à lire/écrire.
--
-- Choix structurant : plutôt que de dupliquer le schéma "un jeu de
-- tables par espace" (club_requests, club_calendar_events...) pour
-- Coach et Académie, cette migration introduit `requests` et
-- `calendar_events` GÉNÉRIQUES, scopés par `organization_id` (la
-- colonne déjà commune à tous les types d'organisation depuis
-- migration-connect-v2). Club garde ses tables actuelles inchangées
-- (rien à casser, rien à migrer) ; Coach et Académie démarrent
-- directement sur le modèle cible du cahier des charges (section 21,
-- "modules communs, construire une fois, configurer selon les
-- profils"). Une unification de club_requests vers `requests` pourra
-- se faire plus tard, à froid, si souhaité — pas fait ici.
--
-- Sécurité : `requests` reproduit EXACTEMENT le correctif appliqué
-- aujourd'hui à club_requests dans migration-connect-v1-securite-
-- hardening.sql (RPC obligatoire pour changer le statut, annulation
-- limitée à une demande pas encore prise en charge, trigger de
-- protection en défense en profondeur) — construit correctement dès
-- le départ plutôt que corrigé après coup.
--
-- Idempotente. À exécuter dans Supabase → SQL Editor, après
-- migration-connect-v2-organizations-entitlements.sql.
-- ============================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. REQUESTS — générique, organization_id-scoped
-- ═══════════════════════════════════════════════════════════════

create table if not exists requests (
  id uuid default gen_random_uuid() primary key,
  organization_id uuid references organizations(id) on delete cascade not null,
  type text not null,
  requester_id uuid references auth.users on delete set null,
  requester_name text,
  status text not null default 'recues' check (status in (
    'recues','info_manquante','en_traitement','prete_a_creer','terminee','refusee'
  )),
  urgency text default 'normale' check (urgency in ('normale','haute')),
  detail text,
  missing jsonb default '[]',
  comments jsonb default '[]',
  credits_reserved integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table requests enable row level security;

create index if not exists idx_requests_org on requests(organization_id, status);

drop policy if exists "req_member_select" on requests;
create policy "req_member_select" on requests for select using (
  is_org_member(organization_id) or is_staff()
);

-- Écriture directe (hors statut/crédits, protégés par trigger ci-dessous) réservée aux
-- membres pour les commentaires ; la création passe par submit_request(), pas par un
-- INSERT direct (policy insert volontairement réservée au staff, cf. note plus bas).
drop policy if exists "req_member_update" on requests;
create policy "req_member_update" on requests for update using (
  is_org_member(organization_id) or is_staff()
);

drop policy if exists "req_staff_insert" on requests;
create policy "req_staff_insert" on requests for insert with check (is_staff());

drop policy if exists "req_admin_delete" on requests;
create policy "req_admin_delete" on requests for delete using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- Trigger de protection : même défense en profondeur que club_requests. Nécessaire même si
-- submit_request()/update_request_status() sont SECURITY DEFINER (donc pas bloquées par la
-- policy insert staff-only ci-dessus) car un PATCH direct sur /rest/v1/requests reste
-- possible pour un membre via "req_member_update" — c'est justement ce chemin qu'il faut
-- fermer pour status/credits_reserved.
create or replace function protect_sensitive_request_fields()
returns trigger language plpgsql security definer as $$
declare
  v_is_staff boolean;
begin
  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin','cm','sec','prod')
  ) into v_is_staff;

  if v_is_staff then
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id then
    raise exception 'Modification non autorisée : l''organisation d''une demande ne peut pas être changée.';
  end if;

  if new.status is distinct from old.status or new.credits_reserved is distinct from old.credits_reserved then
    if not (old.status = 'recues' and new.status = 'refusee' and new.credits_reserved = 0) then
      raise exception 'Modification non autorisée : le statut et les crédits d''une demande ne peuvent être modifiés que par SportVision, ou pour annuler une demande non encore prise en charge.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_sensitive_request_fields on requests;
create trigger trg_protect_sensitive_request_fields
  before update on requests
  for each row execute function protect_sensitive_request_fields();

create or replace function submit_request(
  p_organization_id uuid, p_type text, p_urgency text, p_detail text, p_credits integer
) returns requests
language plpgsql security definer as $$
declare
  v_row requests;
begin
  if not is_org_member(p_organization_id) then
    raise exception 'Accès refusé : vous n''êtes pas membre de cette organisation.';
  end if;

  insert into requests (organization_id, type, requester_id, status, urgency, detail, credits_reserved)
  values (p_organization_id, p_type, auth.uid(), 'recues', coalesce(p_urgency,'normale'), p_detail, coalesce(p_credits, 0))
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function update_request_status(p_request_id uuid, p_status text)
returns requests
language plpgsql security definer as $$
declare
  v_row requests;
  v_is_staff boolean;
begin
  select * into v_row from requests where id = p_request_id;
  if v_row.id is null then
    raise exception 'Demande introuvable.';
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin','cm','sec','prod')
  ) into v_is_staff;

  if v_is_staff then
    null;
  elsif is_org_member(v_row.organization_id) then
    if p_status <> 'refusee' or v_row.status <> 'recues' then
      raise exception 'Vous ne pouvez annuler qu''une demande non encore prise en charge par SportVision.';
    end if;
  else
    raise exception 'Accès refusé.';
  end if;

  update requests set
    status = p_status,
    credits_reserved = case when p_status in ('terminee','refusee') then 0 else credits_reserved end
    where id = p_request_id
    returning * into v_row;

  return v_row;
end;
$$;


-- ═══════════════════════════════════════════════════════════════
-- 2. CALENDAR_EVENTS — générique, lecture seule côté organisation
--    (c'est SportVision qui alimente le planning, même principe que
--    club_calendar_events aujourd'hui pour Club)
-- ═══════════════════════════════════════════════════════════════

create table if not exists calendar_events (
  id uuid default gen_random_uuid() primary key,
  organization_id uuid references organizations(id) on delete cascade not null,
  event_date date not null,
  type text not null default 'contenu',
  title text not null,
  context text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz default now()
);

alter table calendar_events enable row level security;

create index if not exists idx_calendar_events_org on calendar_events(organization_id, event_date);

drop policy if exists "cal_member_select" on calendar_events;
create policy "cal_member_select" on calendar_events for select using (
  is_org_member(organization_id) or is_staff()
);

drop policy if exists "cal_staff_write" on calendar_events;
create policy "cal_staff_write" on calendar_events for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','prod','cm'))
);


-- ═══════════════════════════════════════════════════════════════
-- 3. COACH — joueurs suivis (le reste du besoin Coach : séances,
--    planning, demandes de tournage passe par calendar_events/requests
--    ci-dessus, communs à tous les espaces)
-- ═══════════════════════════════════════════════════════════════

create table if not exists coach_players (
  id uuid default gen_random_uuid() primary key,
  organization_id uuid references organizations(id) on delete cascade not null,
  prenom text not null,
  nom text,
  categorie text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table coach_players enable row level security;

create index if not exists idx_coach_players_org on coach_players(organization_id);

drop policy if exists "cp_member_all" on coach_players;
create policy "cp_member_all" on coach_players for all using (
  is_org_member(organization_id) or is_staff()
) with check (
  is_org_member(organization_id) or is_staff()
);


-- ═══════════════════════════════════════════════════════════════
-- 4. ACADÉMIE — groupes et participants (stages/inscriptions passent
--    par requests/calendar_events ci-dessus pour cette première version)
-- ═══════════════════════════════════════════════════════════════

create table if not exists academie_groups (
  id uuid default gen_random_uuid() primary key,
  organization_id uuid references organizations(id) on delete cascade not null,
  nom text not null,
  niveau text,
  coach_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table academie_groups enable row level security;

create index if not exists idx_academie_groups_org on academie_groups(organization_id);

drop policy if exists "ag_member_all" on academie_groups;
create policy "ag_member_all" on academie_groups for all using (
  is_org_member(organization_id) or is_staff()
) with check (
  is_org_member(organization_id) or is_staff()
);

create table if not exists academie_participants (
  id uuid default gen_random_uuid() primary key,
  organization_id uuid references organizations(id) on delete cascade not null,
  group_id uuid references academie_groups(id) on delete set null,
  prenom text not null,
  nom text,
  date_naissance date,
  responsable_nom text,
  responsable_contact text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table academie_participants enable row level security;

create index if not exists idx_academie_participants_org on academie_participants(organization_id, group_id);

drop policy if exists "ap_member_all" on academie_participants;
create policy "ap_member_all" on academie_participants for all using (
  is_org_member(organization_id) or is_staff()
) with check (
  is_org_member(organization_id) or is_staff()
);


-- ============================================================
-- NOTE — périmètre volontairement minimal
--
-- Ce socle couvre les entitlements déjà seedés en v2 pour coach
-- (joueurs_suivis, seances, planning_coach, demandes_tournage) et
-- académie (groupes, stages, inscriptions, campagnes) via ces 4 tables
-- + les 2 tables génériques. "Séances" et "stages" ne sont PAS des
-- tables dédiées ici : ce sont des `calendar_events` typés
-- différemment (context = nom du joueur/groupe), pour éviter de créer
-- une table par sous-fonction avant d'avoir un vrai usage qui en
-- démontre le besoin. Si l'usage réel révèle qu'il faut des colonnes
-- propres (ex: présences aux stages, quotas d'inscription), ce sera
-- une migration additive ultérieure, pas un obstacle aujourd'hui.
-- ============================================================
