-- ============================================================================
-- migration-os-v2-plannings-hebdo-activity-log.sql
-- ============================================================================
-- Fondations de la refonte OS Admin V2 (28/08/2026, demande Fouka) : 2 tables
-- nouvelles pour que le futur tableau de bord "Accueil" puisse afficher des
-- alertes et une activité réelles, pas inventées.
--
-- 1. plannings_hebdo — un CM planifie sa semaine de contenu (contenus déjà
--    créés comme aujourd'hui, rien ne change côté création), puis SOUMET la
--    semaine en un geste. Introduit une vraie séparation créateur/validateur
--    qui n'existait nulle part avant dans ce module (même pour un contenu
--    individuel) : un CM ne peut jamais valider/refuser son propre planning,
--    seul un admin ou un CM lead DIFFÉRENT du soumetteur le peut. La
--    validation d'un planning ne court-circuite pas le cycle de vie propre à
--    chaque `contenus` (brouillon→...→publié) : c'est un checkpoint plus
--    grossier ("cette semaine est cohérente"), pas un remplacement.
--
-- 2. activity_log — journal unifié pour la section "Activité" de l'Accueil.
--    Alimenté automatiquement par des triggers sur les 3 journaux déjà
--    existants (financial_audit_log, document_events, club_credit_
--    transactions) + les 2 nouveaux flux ci-dessous — aucun code existant à
--    modifier pour ces 3 premiers, le trigger fait le pont tout seul.
-- ============================================================================

-- ── 1. plannings_hebdo ──────────────────────────────────────────────────────

create table if not exists plannings_hebdo (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  cm_id uuid not null references profiles(id),
  semaine_debut date not null,
  statut text not null default 'brouillon' check (statut in ('brouillon','soumis','valide','refuse')),
  soumis_at timestamptz,
  valide_par uuid references profiles(id),
  valide_at timestamptz,
  motif_refus text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, semaine_debut)
);

alter table contenus add column if not exists planning_hebdo_id uuid references plannings_hebdo(id) on delete set null;

alter table plannings_hebdo enable row level security;

-- Visible par le(s) CM affectés au club (même fonction que contenus) ou le staff.
create policy "ph_visible_select" on plannings_hebdo for select
using (
  contenus_visible_par_cm(client_id, auth.uid())
  or exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role in ('admin','sec','com'))
);

-- Création réservée au CM affecté (pour lui-même) ou au staff.
create policy "ph_cm_insert" on plannings_hebdo for insert
with check (
  (cm_id = auth.uid() and contenus_visible_par_cm(client_id, auth.uid()))
  or exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
);

-- Garde-fou large côté RLS (qui peut toucher la ligne) — le détail fin de
-- quelle TRANSITION est autorisée à qui vit dans le trigger ci-dessous, pas
-- ici : RLS ne sait pas comparer OLD/NEW facilement pour une règle "un CM ne
-- peut pas valider SON PROPRE planning", plus naturel en trigger.
create policy "ph_involved_update" on plannings_hebdo for update
using (
  contenus_visible_par_cm(client_id, auth.uid())
  or exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
);

-- Vraie séparation créateur/validateur — n'existait nulle part avant ce
-- chantier, même pour un contenu individuel (contenus_update ne distingue
-- pas créateur/validateur, cf. audit du 28/08/2026).
create or replace function check_planning_hebdo_transition()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_is_admin boolean;
  v_is_lead boolean;
begin
  select exists(select 1 from profiles where id = auth.uid() and role = 'admin') into v_is_admin;
  select exists(select 1 from profiles where id = auth.uid() and role = 'cm' and niveau_cm = 'cm_lead') into v_is_lead;

  if new.statut = old.statut then
    new.updated_at = now();
    return new;
  end if;

  if new.statut = 'soumis' then
    if old.statut <> 'brouillon' then
      raise exception 'Seul un planning en brouillon peut être soumis.';
    end if;
    if not (auth.uid() = old.cm_id or v_is_admin) then
      raise exception 'Seul le CM créateur (ou un admin) peut soumettre ce planning.';
    end if;
    if not exists (select 1 from contenus where planning_hebdo_id = old.id) then
      raise exception 'Aucun contenu associé à cette semaine — rien à soumettre.';
    end if;
    new.soumis_at := now();
  elsif new.statut in ('valide', 'refuse') then
    if old.statut <> 'soumis' then
      raise exception 'Seul un planning soumis peut être validé ou refusé.';
    end if;
    if not (v_is_admin or v_is_lead) then
      raise exception 'Seul un administrateur ou un CM lead peut valider ou refuser un planning.';
    end if;
    if auth.uid() = old.cm_id then
      raise exception 'Un CM ne peut pas valider ou refuser son propre planning.';
    end if;
    if new.statut = 'refuse' and coalesce(trim(new.motif_refus), '') = '' then
      raise exception 'Un motif est requis pour refuser un planning.';
    end if;
    new.valide_par := auth.uid();
    new.valide_at := now();
  elsif new.statut = 'brouillon' and old.statut = 'refuse' then
    if not (auth.uid() = old.cm_id or v_is_admin) then
      raise exception 'Seul le CM créateur (ou un admin) peut reprendre ce planning refusé.';
    end if;
  else
    raise exception 'Transition de statut non autorisée (% → %).', old.statut, new.statut;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_check_planning_hebdo_transition on plannings_hebdo;
create trigger trg_check_planning_hebdo_transition
  before update on plannings_hebdo
  for each row execute function check_planning_hebdo_transition();

-- ── 2. activity_log ──────────────────────────────────────────────────────

create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  categorie text not null check (categorie in ('finance', 'communication', 'equipe', 'recrutement', 'signature')),
  titre text not null,
  description text,
  acteur_id uuid references profiles(id) on delete set null,
  entity_type text,
  entity_id uuid,
  target_href text
);

alter table activity_log enable row level security;

create policy "actlog_staff_select" on activity_log for select
using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role in ('admin','sec','com','prod','compta')));

create policy "actlog_staff_insert" on activity_log for insert
with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role in ('admin','sec','com','prod','compta','cm')));

-- Fan-out automatique depuis les 3 journaux existants — aucun code appelant
-- à modifier, le trigger fait le pont.
create or replace function fanout_financial_audit_to_activity_log()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into activity_log (categorie, titre, description, acteur_id, entity_type, entity_id)
  values (
    'finance',
    coalesce(new.action, 'Action finance') || coalesce(' — ' || new.table_cible, ''),
    case when new.montant_apres is not null then 'Montant : ' || new.montant_apres || ' €' else null end,
    new.acteur_id, new.table_cible, new.ligne_id
  );
  return new;
end;
$$;
drop trigger if exists trg_fanout_financial_audit on financial_audit_log;
create trigger trg_fanout_financial_audit after insert on financial_audit_log for each row execute function fanout_financial_audit_to_activity_log();

create or replace function fanout_document_events_to_activity_log()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into activity_log (categorie, titre, description, acteur_id, entity_type)
  values (
    'signature',
    coalesce(new.event_type, 'Document') || coalesce(' — ' || new.document_ref, ''),
    new.description, new.user_id, new.document_type
  );
  return new;
end;
$$;
drop trigger if exists trg_fanout_document_events on document_events;
create trigger trg_fanout_document_events after insert on document_events for each row execute function fanout_document_events_to_activity_log();

create or replace function fanout_club_credit_to_activity_log()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into activity_log (categorie, titre, description, acteur_id, entity_type, entity_id)
  values (
    'communication',
    coalesce(new.label, 'Mouvement de crédit'),
    (case when new.amount < 0 then 'Crédit consommé : ' else 'Crédit ajouté : ' end) || abs(new.amount)::text,
    new.created_by, 'club', new.club_id
  );
  return new;
end;
$$;
drop trigger if exists trg_fanout_club_credit on club_credit_transactions;
create trigger trg_fanout_club_credit after insert on club_credit_transactions for each row execute function fanout_club_credit_to_activity_log();

-- Nouveaux flux (plannings hebdo, candidatures) : pas de journal préexistant
-- à brancher, le trigger écrit directement dans activity_log.
create or replace function fanout_planning_hebdo_to_activity_log()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_client_nom text;
begin
  if new.statut = old.statut then return new; end if;
  select nom into v_client_nom from clients where id = new.client_id;
  insert into activity_log (categorie, titre, description, acteur_id, entity_type, entity_id)
  values (
    'communication',
    case new.statut
      when 'soumis' then 'Planning soumis — ' || coalesce(v_client_nom, 'club')
      when 'valide' then 'Planning validé — ' || coalesce(v_client_nom, 'club')
      when 'refuse' then 'Planning refusé — ' || coalesce(v_client_nom, 'club')
      else 'Planning mis à jour — ' || coalesce(v_client_nom, 'club')
    end,
    new.motif_refus,
    coalesce(new.valide_par, new.cm_id), 'planning_hebdo', new.id
  );
  return new;
end;
$$;
drop trigger if exists trg_fanout_planning_hebdo on plannings_hebdo;
create trigger trg_fanout_planning_hebdo after update on plannings_hebdo for each row execute function fanout_planning_hebdo_to_activity_log();

create or replace function fanout_recruitment_to_activity_log()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into activity_log (categorie, titre, description, entity_type, entity_id)
  values (
    'recrutement',
    'Nouvelle candidature — ' || coalesce(new.poste, 'poste'),
    trim(coalesce(new.prenom, '') || ' ' || coalesce(new.nom, '')),
    'recruitment_application', new.id
  );
  return new;
end;
$$;
drop trigger if exists trg_fanout_recruitment on recruitment_applications;
create trigger trg_fanout_recruitment after insert on recruitment_applications for each row execute function fanout_recruitment_to_activity_log();
