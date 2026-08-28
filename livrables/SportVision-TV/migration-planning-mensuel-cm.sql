-- ============================================================================
-- migration-planning-mensuel-cm.sql
-- ============================================================================
-- Planning mensuel CM (28/08/2026, demande Fouka) : pour un client Full
-- Communication, le CM affilié récupère le calendrier du mois (matchs,
-- entraînements, événements) et le transmet en un geste à la production.
-- Chaque présence prévue devient alors une mission opérationnelle.
--
-- Choix de modélisation (vérifiés avant écriture, ne pas redécider) :
--
-- 1. Pas de table `missions` séparée : ce projet utilise déjà `prestations`
--    à la fois comme prestation commerciale ET mission opérationnelle (cycle
--    `statut_prestation` à 32 valeurs, gouverné par le trigger serveur
--    validate_prestation_statut_transition). On génère donc des lignes
--    `prestations` normales, pas une nouvelle notion parallèle.
--
-- 2. monthly_production_plans.client_id référence clients(id), PAS clubs(id).
--    Un client Full Com est une ligne `clients` (type_client='club', contrat
--    actif type_contrat='full_communication' — confirmé en base : au moins
--    une ligne contrats avec ce couple type_contrat/statut='actif' existe
--    déjà). `clubs` est un produit séparé (Club+), relié à `clients` via
--    clubs.portail_client_id qui peut être null : pas une base fiable pour
--    cette fonctionnalité.
--
-- 3. Aucune table équivalente n'existait avant cette migration (vérifié via
--    information_schema.tables : seule `plannings_hebdo` matchait un nom
--    proche, et c'est le calendrier ÉDITORIAL de `contenus`, un domaine
--    totalement différent — non modifié ici). On reprend seulement son
--    principe général brouillon→envoyé pour la séparation créateur/
--    validateur, avec une famille de tables séparée.
--
-- 4. La fonction de génération insère les prestations au statut 'planifiée'.
--    C'est bien un statut de départ valide et cohérent avec le reste du
--    cycle : validate_prestation_statut_transition liste déjà la transition
--    'à_planifier' → 'planifiée' → 'équipe_affectée', et c'est l'état
--    attendu en entrée par le mécanisme d'acceptation existant
--    (repondreInvitation / prestations_equipe), vérifié ce soir avec un
--    compte de test réel. Le trigger ne gouverne QUE les UPDATE (il ignore
--    les INSERT), donc créer directement une ligne à 'planifiée' est propre.
--
-- 5. prestations.source a une contrainte CHECK existante limitée à
--    ('vitrine','connect','clubplus','interne'). On y ajoute
--    'planning_mensuel_cm' comme nouveau canal d'origine légitime (au même
--    titre que les autres, qui décrivent tous un canal de création) plutôt
--    que de réutiliser 'interne' — garde la traçabilité demandée par la
--    spec produit sans perdre la cohérence de la colonne.
-- ============================================================================

-- ── 1. monthly_production_plans ────────────────────────────────────────────

create table if not exists monthly_production_plans (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  cm_id uuid not null references profiles(id),
  -- Convention : toujours le 1er du mois concerné (ex. 2026-09-01), jamais
  -- une autre date du mois. Permet un unique(client_id, mois) simple et sans
  -- ambiguïté, à l'image de plannings_hebdo.semaine_debut.
  mois date not null,
  statut text not null default 'brouillon' check (statut in ('brouillon','envoyé')),
  envoye_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, mois)
);

drop trigger if exists trg_mpp_updated_at on monthly_production_plans;
create trigger trg_mpp_updated_at
  before update on monthly_production_plans
  for each row execute function update_updated_at();

-- ── 2. planned_presences ────────────────────────────────────────────────────

create table if not exists planned_presences (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references monthly_production_plans(id) on delete cascade,
  -- Texte libre, même convention que prestations.equipes : pas de table
  -- équipes systématiquement peuplée pour tous les clients.
  equipe text,
  date_presence date not null,
  heure_debut time,
  lieu text,
  adversaire text,
  type_couverture text not null default 'photo_video' check (type_couverture in ('photo','video','photo_video')),
  statut text not null default 'prevu' check (statut in ('prevu','mission_creee','annule')),
  created_prestation_id uuid references prestations(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_planned_presences_plan_id on planned_presences(plan_id);

drop trigger if exists trg_pp_updated_at on planned_presences;
create trigger trg_pp_updated_at
  before update on planned_presences
  for each row execute function update_updated_at();

-- ── 3. Traçabilité légère sur prestations ──────────────────────────────────
-- Double lien pratique dans les deux sens (comme contenus.prestation_id /
-- media_livrables) : permet de savoir qu'une prestation vient d'une présence
-- planifiée sans dupliquer les données déjà sur
-- planned_presences.created_prestation_id.

alter table prestations add column if not exists planned_presence_id uuid references planned_presences(id) on delete set null;

-- Nouveau canal d'origine légitime pour prestations.source (voir point 5
-- ci-dessus) : on élargit la contrainte CHECK existante plutôt que de la
-- dupliquer.
alter table prestations drop constraint if exists prestations_source_check;
alter table prestations add constraint prestations_source_check
  check (source = any (array['vitrine','connect','clubplus','interne','planning_mensuel_cm']));

-- ── 4. RLS ───────────────────────────────────────────────────────────────

alter table monthly_production_plans enable row level security;
alter table planned_presences enable row level security;

-- monthly_production_plans : visible par le CM affilié au client (même
-- fonction que contenus/plannings_hebdo) ou par le staff admin/sec.
drop policy if exists "mpp_select" on monthly_production_plans;
create policy "mpp_select" on monthly_production_plans for select
using (
  contenus_visible_par_cm(client_id, auth.uid())
  or exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role in ('admin','sec'))
);

-- Création réservée au CM affecté (pour lui-même, en tant que cm_id) ou à
-- l'admin.
drop policy if exists "mpp_insert" on monthly_production_plans;
create policy "mpp_insert" on monthly_production_plans for insert
with check (
  (cm_id = auth.uid() and contenus_visible_par_cm(client_id, auth.uid()))
  or exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
);

-- Modification directe (hors RPC) réservée au CM créateur tant que le plan
-- est en brouillon, ou à l'admin en toutes circonstances. Une fois
-- statut='envoyé', generate_missions_from_plan (SECURITY DEFINER) reste seule
-- habilitée à modifier la ligne pour un CM.
drop policy if exists "mpp_update" on monthly_production_plans;
create policy "mpp_update" on monthly_production_plans for update
using (
  (cm_id = auth.uid() and contenus_visible_par_cm(client_id, auth.uid()) and statut = 'brouillon')
  or exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
);

drop policy if exists "mpp_delete" on monthly_production_plans;
create policy "mpp_delete" on monthly_production_plans for delete
using (
  (cm_id = auth.uid() and contenus_visible_par_cm(client_id, auth.uid()) and statut = 'brouillon')
  or exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
);

-- planned_presences : mêmes règles, via le plan parent.
drop policy if exists "pp_select" on planned_presences;
create policy "pp_select" on planned_presences for select
using (
  exists (
    select 1 from monthly_production_plans p
    where p.id = planned_presences.plan_id
      and (
        contenus_visible_par_cm(p.client_id, auth.uid())
        or exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role in ('admin','sec'))
      )
  )
);

drop policy if exists "pp_insert" on planned_presences;
create policy "pp_insert" on planned_presences for insert
with check (
  exists (
    select 1 from monthly_production_plans p
    where p.id = planned_presences.plan_id
      and p.cm_id = auth.uid()
      and contenus_visible_par_cm(p.client_id, auth.uid())
  )
  or exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
);

-- Best-effort (pas de blocage garanti à 100% côté DB, cf. spec produit) :
-- un CM peut modifier/supprimer une présence de son plan tant qu'elle n'a
-- pas déjà été transformée en mission ('mission_creee'). Une fois la mission
-- créée, seule generate_missions_from_plan (SECURITY DEFINER) ou l'admin
-- touchent encore la ligne.
drop policy if exists "pp_update" on planned_presences;
create policy "pp_update" on planned_presences for update
using (
  (
    exists (
      select 1 from monthly_production_plans p
      where p.id = planned_presences.plan_id
        and p.cm_id = auth.uid()
        and contenus_visible_par_cm(p.client_id, auth.uid())
    )
    and planned_presences.statut <> 'mission_creee'
  )
  or exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
);

drop policy if exists "pp_delete" on planned_presences;
create policy "pp_delete" on planned_presences for delete
using (
  (
    exists (
      select 1 from monthly_production_plans p
      where p.id = planned_presences.plan_id
        and p.cm_id = auth.uid()
        and contenus_visible_par_cm(p.client_id, auth.uid())
    )
    and planned_presences.statut <> 'mission_creee'
  )
  or exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
);

-- ── 5. generate_missions_from_plan ─────────────────────────────────────────
-- SECURITY DEFINER : bypass RLS en interne, MAIS revérifie systématiquement
-- le droit de l'appelant via auth.uid() (jamais confiance en un paramètre).
-- Idempotente : rejouable sans jamais créer de doublon (exigence produit
-- explicite), car elle ne traite que les présences 'prevu' dont
-- created_prestation_id est encore null.

create or replace function generate_missions_from_plan(p_plan_id uuid)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_plan monthly_production_plans%rowtype;
  v_is_admin boolean;
  v_presence record;
  v_prestation_id uuid;
  v_created_count int := 0;
begin
  select * into v_plan from monthly_production_plans where id = p_plan_id;
  if not found then
    raise exception 'Plan de production introuvable.';
  end if;

  select exists(select 1 from profiles where id = auth.uid() and role = 'admin') into v_is_admin;

  if not (v_is_admin or auth.uid() = v_plan.cm_id) then
    raise exception 'Seul le CM créateur du plan (ou un administrateur) peut envoyer ce planning à la production.';
  end if;

  for v_presence in
    select * from planned_presences
    where plan_id = p_plan_id
      and statut = 'prevu'
      and created_prestation_id is null
  loop
    insert into prestations (
      client_id, date_prestation, heure_debut, lieu, equipes,
      type_prestation, statut, source, planned_presence_id, notes_internes
    ) values (
      v_plan.client_id, v_presence.date_presence, v_presence.heure_debut,
      v_presence.lieu, v_presence.equipe,
      'match', 'planifiée', 'planning_mensuel_cm', v_presence.id,
      'Générée automatiquement depuis le planning mensuel CM ('
        || to_char(v_plan.mois, 'MM/YYYY') || ', plan ' || v_plan.id || ').'
    )
    returning id into v_prestation_id;

    update planned_presences
    set statut = 'mission_creee', created_prestation_id = v_prestation_id
    where id = v_presence.id;

    v_created_count := v_created_count + 1;
  end loop;

  if v_plan.statut <> 'envoyé' then
    update monthly_production_plans
    set statut = 'envoyé', envoye_at = now()
    where id = p_plan_id;
  end if;

  return v_created_count;
end;
$$;
