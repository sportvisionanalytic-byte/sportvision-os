-- ============================================================================
-- migration-audit-final-schema-reconciliation.sql
-- Audit final autonome (29/08/2026, nuit) — traçage workflows + idempotence
-- ============================================================================
-- CONTEXTE : en traçant les chaînes A (Prestation Connect), B (Club+),
-- C (Full Communication) et F (rémunération opérateur) dans le code réel,
-- plusieurs agents ont indépendamment cru trouver des maillons "cassés"
-- parce que des objets qu'ils cherchaient (fonction claim_club_request,
-- trigger protect_junior_content_publication, colonnes niveau_operateur /
-- niveau_snapshot / base_rate_snapshot / multiplier_snapshot / format_mission,
-- colonne profiles.cm_niveau_autonomie, table cm_tutorships, valeurs 'pret'/
-- 'a_valider_tuteur' du CHECK de contenus.statut) étaient absents de TOUS les
-- fichiers migration-*.sql versionnés du dépôt.
--
-- Vérification faite en base réelle (Supabase Management API, requêtes sur
-- information_schema / pg_proc / pg_trigger / pg_constraint) : CES OBJETS
-- EXISTENT TOUS EN PRODUCTION, correctement configurés, et les workflows
-- correspondants fonctionnent réellement (confirmé également par contre-test
-- direct de contenus_valider_transition_statut, qui autorise bien les
-- transitions brouillon→pret, brouillon→a_valider_tuteur, etc.). Il ne s'agit
-- donc PAS de maillons cassés en production, mais d'une dérive base/code :
-- ces objets ont été créés directement (SQL Editor Supabase ou script non
-- committé) sans jamais laisser de fichier migration-*.sql dans ce dépôt.
--
-- RISQUE réel que ce fichier corrige : toute reconstruction de la base depuis
-- les migrations versionnées de ce dépôt (nouvel environnement, restauration,
-- onboarding d'un nouveau développeur) ne recréerait NI la fonction
-- claim_club_request, NI protect_junior_content_publication, NI ces colonnes/
-- table — cassant silencieusement Club+ (prise en charge pool), le tutorat
-- CM Junior, et le moteur de rémunération.
--
-- Ce fichier est un NO-OP sur la base actuelle (tout est déjà en place,
-- vérifié avant écriture) : il sert uniquement à rendre l'état actuel de la
-- base reproductible depuis les migrations versionnées. Toutes les
-- opérations sont protégées (IF NOT EXISTS / OR REPLACE / DO $$ ... $$ avec
-- vérification d'existence) pour être rejouables sans erreur.
-- ============================================================================

-- ── 1. Moteur de rémunération opérateur (grades ★ + coefficients de format) ──

alter table profiles add column if not exists niveau_operateur smallint;
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_niveau_operateur_check'
  ) then
    alter table profiles add constraint profiles_niveau_operateur_check
      check (niveau_operateur is null or (niveau_operateur >= 1 and niveau_operateur <= 5));
  end if;
end $$;

alter table prestations add column if not exists format_mission text;
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.prestations'::regclass and conname = 'prestations_format_mission_check'
  ) then
    alter table prestations add constraint prestations_format_mission_check
      check (format_mission = any (array['standard','double','journee','exceptionnelle']));
  end if;
end $$;

alter table prestations_equipe add column if not exists niveau_snapshot smallint;
alter table prestations_equipe add column if not exists base_rate_snapshot numeric;
alter table prestations_equipe add column if not exists multiplier_snapshot numeric;
alter table prestations_equipe add column if not exists override_reason text;

-- ── 2. Tutorat CM Junior (cm_niveau_autonomie + cm_tutorships + garde) ──────

alter table profiles add column if not exists cm_niveau_autonomie text;
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_cm_niveau_autonomie_check'
  ) then
    alter table profiles add constraint profiles_cm_niveau_autonomie_check
      check (cm_niveau_autonomie is null or cm_niveau_autonomie = any (array['junior','autonome','responsable']));
  end if;
end $$;

create table if not exists cm_tutorships (
  id uuid primary key default gen_random_uuid(),
  junior_id uuid not null references profiles(id) on delete cascade,
  tuteur_id uuid not null references profiles(id) on delete cascade,
  debut date not null default current_date,
  fin date,
  statut text not null default 'actif' check (statut = any (array['actif','termine'])),
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

alter table cm_tutorships enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cm_tutorships' and policyname = 'cm_tutorships_read') then
    create policy cm_tutorships_read on cm_tutorships for select using (is_staff());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cm_tutorships' and policyname = 'cm_tutorships_write') then
    create policy cm_tutorships_write on cm_tutorships for all using (is_staff()) with check (is_staff());
  end if;
end $$;

-- Ajoute 'pret' et 'a_valider_tuteur' au workflow éditorial des contenus
-- (refonte CM Junior/tuteur du 29/08/2026), en conservant toutes les valeurs
-- existantes du workflow classique.
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.contenus'::regclass and conname = 'contenus_statut_check'
      and pg_get_constraintdef(oid) ilike '%a_valider_tuteur%'
  ) then
    alter table contenus drop constraint if exists contenus_statut_check;
    alter table contenus add constraint contenus_statut_check
      check (statut = any (array['brouillon','a_valider_interne','a_valider_client','a_valider_tuteur','corrections','pret','valide','programme','publie','archive']));
  end if;
end $$;

create or replace function public.contenus_valider_transition_statut()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.statut is not distinct from old.statut then return new; end if;
  if exists (
    select 1 from profiles p where p.id = auth.uid()
      and (p.role = 'admin' or (p.role = 'cm' and (p.niveau_cm = 'cm_lead' or p.cm_niveau_autonomie = 'responsable')))
  ) then return new; end if;
  if (old.statut, new.statut) in (
    ('brouillon','a_valider_interne'),
    ('a_valider_interne','a_valider_client'),
    ('a_valider_interne','corrections'),
    ('a_valider_client','valide'),
    ('a_valider_client','corrections'),
    ('valide','programme'),
    ('programme','publie'),
    ('publie','archive'),
    ('corrections','brouillon'),
    ('brouillon','pret'),
    ('brouillon','a_valider_tuteur'),
    ('corrections','a_valider_tuteur'),
    ('a_valider_tuteur','pret'),
    ('a_valider_tuteur','corrections'),
    ('pret','programme')
  ) then return new; end if;
  raise exception 'Transition de statut non autorisée : % → % ne suit pas le workflow éditorial.', old.statut, new.statut;
end;
$function$;

create or replace function public.protect_junior_content_publication()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor_tier text;
begin
  if auth.role() = 'service_role' then return new; end if;
  select cm_niveau_autonomie into actor_tier from profiles where id = auth.uid();
  if actor_tier != 'junior' or new.cm_id != auth.uid() then return new; end if;
  if tg_op = 'INSERT' then
    if new.statut not in ('brouillon','a_valider_tuteur') then
      raise exception 'Un CM Junior ne peut créer un contenu que comme brouillon.';
    end if;
    return new;
  end if;
  if old.statut in ('brouillon','corrections') and new.statut in ('pret','valide','programme','publie') then
    raise exception 'Un CM Junior ne peut pas ignorer la validation du tuteur.';
  end if;
  if old.statut = 'a_valider_tuteur' and new.statut in ('pret','valide') then
    raise exception 'Seul le tuteur peut valider ce contenu.';
  end if;
  return new;
end;
$function$;

do $$ begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_protect_junior_content_publication' and tgrelid = 'public.contenus'::regclass
  ) then
    create trigger trg_protect_junior_content_publication
      before insert or update on public.contenus
      for each row execute function protect_junior_content_publication();
  end if;
end $$;

-- ── 3. Club+ — prise en charge atomique du pool "File Club+ générale" ──────
-- Pattern de référence explicitement cité par la mission d'audit comme "bon
-- exemple" : UPDATE ... WHERE taken_by IS NULL RETURNING. Existe déjà en
-- prod, backfillé ici pour que le dépôt soit reproductible.

create or replace function public.claim_club_request(p_request_id uuid)
returns club_requests
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row club_requests;
  v_authorized boolean;
begin
  select exists(
    select 1 from profiles where id = auth.uid()
    and (role = 'admin' or (role = 'cm' and (cm_niveau_autonomie = 'responsable' or cm_pool_clubplus_general = true)))
  ) into v_authorized;
  if not v_authorized then
    raise exception 'Seuls les membres du pool Club+ general ou le Responsable CM peuvent prendre en charge cette demande.';
  end if;

  update club_requests set taken_by = auth.uid(), status = case when status = 'recues' then 'en_traitement' else status end
    where id = p_request_id and taken_by is null
    returning * into v_row;

  if v_row.id is null then
    raise exception 'Demande introuvable ou deja prise en charge.';
  end if;

  return v_row;
end;
$function$;
