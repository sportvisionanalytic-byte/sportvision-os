-- ============================================================================
-- migration-clubplus-v48-onboarding-club.sql
-- Onboarding Communication club — master prompt Fouka (02/09/2026) : centraliser
-- systématiquement identité/organigramme/équipes/entraînements/calendrier/
-- branding/sponsors/réseaux/droit à l'image dès la signature d'un club, via
-- Club+, sans ressaisie côté OS.
--
-- Audit préalable (deux agents dédiés, 02/09/2026) confirmé avant d'écrire une
-- seule ligne : `clubs`/`club_members`/`club_teams`/`club_sponsors`/
-- `club_calendar_events` existent déjà et sont réels (pas mock) — RÉUTILISÉS
-- tels quels, aucun doublon créé. Seuls les vrais trous constatés sont
-- comblés ici :
--   - aucune table de créneaux d'entraînement récurrents (club_calendar_events
--     ne modélise que des dates ponctuelles)
--   - aucune table de lieux/installations réutilisable (partout ailleurs
--     c'est un champ texte libre : club_calendar_events.location,
--     club_matches.lieu, event_editions.lieu — jamais une vraie entité)
--   - réseaux sociaux club à 100% mock (settings/integrations/page.tsx),
--     seul clubs.instagram_handle est réel (un champ texte, pas un modèle
--     de comptes) — aucun mot de passe, jamais, uniquement un statut
--     "compte identifié / accès SportVision" comme demandé explicitement
--   - droit à l'image existe uniquement au niveau JOUEUR individuel
--     (authorization_types/parental_authorizations, Connect) — rien au
--     niveau politique du club lui-même
--   - aucun suivi de progression d'onboarding nulle part
--
-- Non traité dans cette migration (dette déjà existante, hors périmètre) :
-- le scoping club_members.teams (jsonb, noms en texte libre comparés à
-- club_teams.name plutôt qu'une vraie FK) documenté et assumé comme choix
-- délibéré dans migration-clubplus-v37 — touche une règle déjà en place
-- (is_team_educateur, club_matches), pas re-décidé ici sans validation
-- explicite de Fouka.
-- ============================================================================

-- ── club_venues : lieux/installations réutilisables (terrains, gymnases) ──
create table if not exists public.club_venues (
  id uuid default gen_random_uuid() primary key,
  club_id uuid not null references public.clubs(id) on delete cascade,
  nom text not null,
  adresse text,
  ville text,
  terrain_principal boolean not null default false,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
comment on table public.club_venues is 'Lieux/installations du club (terrains, gymnases, club-house), réutilisables par les créneaux d''entraînement (club_team_training_slots.venue_id) et, plus tard, par le calendrier — migration-clubplus-v48, onboarding club.';

create index if not exists idx_club_venues_club on public.club_venues(club_id);
alter table public.club_venues enable row level security;

create policy "cven_staff_all" on public.club_venues for all using (
  exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','com','sec']))
);
create policy "cven_member_select" on public.club_venues for select using (is_club_member(club_id));
create policy "cven_member_insert" on public.club_venues for insert with check (is_club_member(club_id));
create policy "cven_member_update" on public.club_venues for update using (is_club_member(club_id));
create policy "cven_admin_delete" on public.club_venues for delete using (is_club_admin(club_id));

create or replace function public.set_updated_at_club_venues()
returns trigger language plpgsql as $function$
begin new.updated_at = now(); return new; end;
$function$;
drop trigger if exists trg_club_venues_updated_at on public.club_venues;
create trigger trg_club_venues_updated_at before update on public.club_venues
  for each row execute function public.set_updated_at_club_venues();

-- ── club_team_training_slots : créneaux d'entraînement récurrents par équipe ──
create table if not exists public.club_team_training_slots (
  id uuid default gen_random_uuid() primary key,
  team_id uuid not null references public.club_teams(id) on delete cascade,
  jour text not null check (jour in ('lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche')),
  heure_debut time not null,
  heure_fin time,
  venue_id uuid references public.club_venues(id) on delete set null,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
comment on table public.club_team_training_slots is 'Créneaux d''entraînement hebdomadaires récurrents par équipe (jour + horaires + lieu) — n''existait sous aucune forme avant cette migration (club_calendar_events ne modélise que des dates ponctuelles) — migration-clubplus-v48, onboarding club.';

create index if not exists idx_ctts_team on public.club_team_training_slots(team_id);
alter table public.club_team_training_slots enable row level security;

-- Pas de club_id direct sur cette table (rattachée à une équipe) : les policies
-- passent par une jointure vers club_teams, même principe que csp_member_select
-- vers club_members pour club_sponsors.
create policy "ctts_staff_all" on public.club_team_training_slots for all using (
  exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','com','sec']))
);
create policy "ctts_member_select" on public.club_team_training_slots for select using (
  exists (select 1 from public.club_teams ct where ct.id = team_id and is_club_member(ct.club_id))
);
create policy "ctts_member_insert" on public.club_team_training_slots for insert with check (
  exists (select 1 from public.club_teams ct where ct.id = team_id and is_club_member(ct.club_id))
);
create policy "ctts_member_update" on public.club_team_training_slots for update using (
  exists (select 1 from public.club_teams ct where ct.id = team_id and is_club_member(ct.club_id))
);
create policy "ctts_member_delete" on public.club_team_training_slots for delete using (
  exists (select 1 from public.club_teams ct where ct.id = team_id and is_club_member(ct.club_id))
);

create or replace function public.set_updated_at_club_team_training_slots()
returns trigger language plpgsql as $function$
begin new.updated_at = now(); return new; end;
$function$;
drop trigger if exists trg_ctts_updated_at on public.club_team_training_slots;
create trigger trg_ctts_updated_at before update on public.club_team_training_slots
  for each row execute function public.set_updated_at_club_team_training_slots();

-- ── club_social_accounts : comptes réseaux sociaux du club, JAMAIS de mot de passe ──
create table if not exists public.club_social_accounts (
  id uuid default gen_random_uuid() primary key,
  club_id uuid not null references public.clubs(id) on delete cascade,
  plateforme text not null check (plateforme in ('instagram','tiktok','facebook','linkedin','youtube','autre')),
  handle_ou_url text not null,
  -- Statut d'accès, jamais un identifiant/mot de passe (règle de sécurité absolue,
  -- master prompt §55/§20) : le club déclare juste si SportVision a déjà un accès
  -- (invitation administrateur/délégation côté plateforme), pas comment.
  acces_sportvision boolean not null default false,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (club_id, plateforme, handle_ou_url)
);
comment on table public.club_social_accounts is 'Comptes réseaux sociaux du club — statut "identifié / accès SportVision" uniquement, jamais de mot de passe stocké ici (voir handle_ou_url + acces_sportvision). Remplace le seul champ clubs.instagram_handle (texte libre unique) par un vrai modèle multi-comptes — migration-clubplus-v48, onboarding club.';

create index if not exists idx_club_social_accounts_club on public.club_social_accounts(club_id);
alter table public.club_social_accounts enable row level security;

create policy "csa_staff_all" on public.club_social_accounts for all using (
  exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','com','sec']))
);
create policy "csa_member_select" on public.club_social_accounts for select using (is_club_member(club_id));
-- Écriture réservée aux rôles de direction/communication du club, même esprit que
-- club_sponsors (argent/image, pas un simple membre) : admin/president/comm.
create policy "csa_manage_insert" on public.club_social_accounts for insert with check (
  exists (select 1 from public.club_members where club_members.club_id = club_social_accounts.club_id and club_members.user_id = auth.uid() and club_members.status = 'actif' and club_members.role = any (array['admin','president','comm']))
);
create policy "csa_manage_update" on public.club_social_accounts for update using (
  exists (select 1 from public.club_members where club_members.club_id = club_social_accounts.club_id and club_members.user_id = auth.uid() and club_members.status = 'actif' and club_members.role = any (array['admin','president','comm']))
);
create policy "csa_manage_delete" on public.club_social_accounts for delete using (
  exists (select 1 from public.club_members where club_members.club_id = club_social_accounts.club_id and club_members.user_id = auth.uid() and club_members.status = 'actif' and club_members.role = any (array['admin','president','comm']))
);

create or replace function public.set_updated_at_club_social_accounts()
returns trigger language plpgsql as $function$
begin new.updated_at = now(); return new; end;
$function$;
drop trigger if exists trg_csa_updated_at on public.club_social_accounts;
create trigger trg_csa_updated_at before update on public.club_social_accounts
  for each row execute function public.set_updated_at_club_social_accounts();

-- ── Droit à l'image, niveau politique du CLUB (distinct du droit à l'image
--    individuel par joueur déjà géré côté Connect) ──
alter table public.clubs add column if not exists droit_image_mode text
  check (droit_image_mode in ('inscription','papier','numerique','aucune','autre'));
alter table public.clubs add column if not exists droit_image_licencies_exclus boolean not null default false;
-- Notes en clair (ex. "ne pas publier untel"), jamais une liste publique : lisible
-- uniquement par le staff SportVision et l'admin/président du club (déjà couvert
-- par clubs_admin_update / clubs_staff_all, aucune nouvelle policy nécessaire —
-- ce sont juste des colonnes sur une table déjà correctement scopée).
alter table public.clubs add column if not exists droit_image_notes text;
comment on column public.clubs.droit_image_mode is 'Fonctionnement du club pour le droit à l''image (distinct des autorisations individuelles par joueur, gérées côté Connect via authorization_types/parental_authorizations) — migration-clubplus-v48.';
comment on column public.clubs.droit_image_notes is 'Notes libres (ex. licenciés à ne pas publier) — jamais une liste publique, visible uniquement staff SportVision + admin du club (RLS clubs_admin_update/clubs_staff_all déjà en place).';

-- ── Objectifs / ton de communication (Étape "Communication" de l'onboarding) ──
alter table public.clubs add column if not exists objectifs_communication text[];
alter table public.clubs add column if not exists ton_communication text;
alter table public.clubs add column if not exists sujets_sensibles text;
comment on column public.clubs.objectifs_communication is 'Objectifs prioritaires déclarés par le club (notoriété, recrutement, féminines, sponsors...), liste ouverte — migration-clubplus-v48.';
comment on column public.clubs.sujets_sensibles is 'Points d''attention communication (ex. ne pas publier certaines blessures) — indicatif pour le CM, ne bloque jamais une publication (le CM reste autonome selon les règles Full Communication déjà validées).';

-- ── club_onboarding_progress : suivi de la collecte, PAS une 2e base de données ──
-- Un seul statut par club, calculé/complété au fil de l'eau — la progression en %
-- elle-même n'est PAS stockée ici (voir club_onboarding_completion() plus bas) :
-- toujours recalculée depuis les vraies tables (clubs/club_members/club_teams/...),
-- pour ne jamais désynchroniser un pourcentage affiché de la réalité des données.
create table if not exists public.club_onboarding_progress (
  id uuid default gen_random_uuid() primary key,
  club_id uuid not null references public.clubs(id) on delete cascade unique,
  statut text not null default 'not_started' check (statut in ('not_started','in_progress','submitted','needs_information','validated')),
  started_at timestamptz,
  submitted_at timestamptz,
  validated_at timestamptz,
  validated_by uuid references public.profiles(id),
  needs_information_notes text,
  last_activity_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
comment on table public.club_onboarding_progress is 'Statut de collecte de l''onboarding Communication d''un club (pas les données elles-mêmes, qui vivent dans clubs/club_members/club_teams/etc.) — migration-clubplus-v48.';

create index if not exists idx_club_onboarding_progress_statut on public.club_onboarding_progress(statut);
alter table public.club_onboarding_progress enable row level security;

create policy "cop_staff_all" on public.club_onboarding_progress for all using (
  exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','com','sec']))
);
create policy "cop_member_select" on public.club_onboarding_progress for select using (is_club_member(club_id));
-- Le club peut faire avancer/soumettre son propre onboarding, mais ne peut jamais
-- se valider lui-même (validated_at/validated_by/statut='validated' réservés au
-- staff via cop_staff_all) : with check bloque explicitement ce statut.
create policy "cop_member_upsert" on public.club_onboarding_progress for insert with check (
  is_club_member(club_id) and statut in ('not_started','in_progress','submitted')
);
create policy "cop_member_update" on public.club_onboarding_progress for update using (
  is_club_member(club_id)
) with check (
  is_club_member(club_id) and statut in ('not_started','in_progress','submitted')
);

create or replace function public.set_updated_at_club_onboarding_progress()
returns trigger language plpgsql as $function$
begin new.updated_at = now(); new.last_activity_at = now(); return new; end;
$function$;
drop trigger if exists trg_cop_updated_at on public.club_onboarding_progress;
create trigger trg_cop_updated_at before update on public.club_onboarding_progress
  for each row execute function public.set_updated_at_club_onboarding_progress();

-- ── Calcul de progression, TOUJOURS depuis les données réelles (jamais un
--    pourcentage stocké) — 8 sections, chacune vraie/fausse selon un critère
--    minimal explicite. SECURITY DEFINER pour être appelable par le club comme
--    par le staff sans dupliquer la logique de lecture par table.
create or replace function public.club_onboarding_completion(p_club_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_identite boolean;
  v_responsables boolean;
  v_equipes boolean;
  v_entrainements boolean;
  v_calendrier boolean;
  v_branding boolean;
  v_sponsors boolean;
  v_communication boolean;
  v_droit_image boolean;
  v_sections_total int := 9;
  v_sections_ok int;
begin
  select (nom is not null and ville is not null and adresse is not null)
    into v_identite from clubs where id = p_club_id;

  select exists(select 1 from club_members where club_id = p_club_id and status = 'actif')
    into v_responsables;

  select exists(select 1 from club_teams where club_id = p_club_id)
    into v_equipes;

  select exists(
    select 1 from club_team_training_slots ctts
    join club_teams ct on ct.id = ctts.team_id
    where ct.club_id = p_club_id
  ) into v_entrainements;

  select exists(select 1 from club_calendar_events where club_id = p_club_id)
    into v_calendrier;

  select (logo_url is not null or ecusson_url is not null)
    into v_branding from clubs where id = p_club_id;

  select exists(select 1 from club_sponsors where club_id = p_club_id)
    into v_sponsors;

  select (
    exists(select 1 from club_social_accounts where club_id = p_club_id)
    and objectifs_communication is not null and array_length(objectifs_communication, 1) > 0
  ) into v_communication from clubs where id = p_club_id;

  select (droit_image_mode is not null) into v_droit_image from clubs where id = p_club_id;

  v_sections_ok := (case when v_identite then 1 else 0 end)
    + (case when v_responsables then 1 else 0 end)
    + (case when v_equipes then 1 else 0 end)
    + (case when v_entrainements then 1 else 0 end)
    + (case when v_calendrier then 1 else 0 end)
    + (case when v_branding then 1 else 0 end)
    + (case when v_sponsors then 1 else 0 end)
    + (case when v_communication then 1 else 0 end)
    + (case when v_droit_image then 1 else 0 end);

  return jsonb_build_object(
    'identite', coalesce(v_identite, false),
    'responsables', v_responsables,
    'equipes', v_equipes,
    'entrainements', v_entrainements,
    'calendrier', v_calendrier,
    'branding', coalesce(v_branding, false),
    'sponsors', v_sponsors,
    'communication', coalesce(v_communication, false),
    'droit_image', coalesce(v_droit_image, false),
    'sections_completees', v_sections_ok,
    'sections_total', v_sections_total,
    'pourcentage', round((v_sections_ok::numeric / v_sections_total) * 100)
  );
end;
$function$;

comment on function public.club_onboarding_completion(uuid) is 'Progression de l''onboarding Communication d''un club, calculée EN DIRECT depuis les vraies tables (clubs/club_members/club_teams/club_team_training_slots/club_calendar_events/club_sponsors/club_social_accounts) — jamais un pourcentage stocké séparément qui pourrait désynchroniser de la réalité. Appelable par le club (is_club_member) ou le staff, SECURITY DEFINER pour lire uniformément malgré les RLS de chaque table sous-jacente.';

grant execute on function public.club_onboarding_completion(uuid) to authenticated;

-- ROLLBACK :
-- drop function if exists public.club_onboarding_completion(uuid);
-- drop trigger if exists trg_cop_updated_at on public.club_onboarding_progress;
-- drop function if exists public.set_updated_at_club_onboarding_progress();
-- drop table if exists public.club_onboarding_progress;
-- alter table public.clubs drop column if exists sujets_sensibles;
-- alter table public.clubs drop column if exists ton_communication;
-- alter table public.clubs drop column if exists objectifs_communication;
-- alter table public.clubs drop column if exists droit_image_notes;
-- alter table public.clubs drop column if exists droit_image_licencies_exclus;
-- alter table public.clubs drop column if exists droit_image_mode;
-- drop trigger if exists trg_csa_updated_at on public.club_social_accounts;
-- drop function if exists public.set_updated_at_club_social_accounts();
-- drop table if exists public.club_social_accounts;
-- drop trigger if exists trg_ctts_updated_at on public.club_team_training_slots;
-- drop function if exists public.set_updated_at_club_team_training_slots();
-- drop table if exists public.club_team_training_slots;
-- drop trigger if exists trg_club_venues_updated_at on public.club_venues;
-- drop function if exists public.set_updated_at_club_venues();
-- drop table if exists public.club_venues;
