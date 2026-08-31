-- migration-poles-v6-finance-remuneration-responsable.sql
--
-- Migration multi-pôles (Football + Basket), Lot 6 — Finance par pôle +
-- grille de rémunération du Responsable de pôle.
-- À exécuter APRÈS migration-poles-v5-creation-basket.sql.
--
-- Contenu :
--   1. pole_id nullable sur expenses/frais (dérivation automatique depuis
--      prestation_id quand disponible ; laissé à NULL sinon — dépense/frais
--      "partagé consolidé", non affecté à un pôle précis — la Direction
--      pourra affecter ces cas au coup par coup depuis l'UI existante).
--   2. Table pole_remuneration_paliers — grille CONFIGURABLE (jamais codée
--      en dur) du barème de rémunération d'un Responsable de pôle.
--   3. Table pole_remuneration_calculs — snapshot mensuel calculé + workflow
--      de validation Direction (à_valider / validé / payé).
--   4. Fonctions SECURITY DEFINER : pole_finance_access_ok, pole_finance_
--      ventilation (revenus/charges ventilés par pôle), pole_calculer_
--      remuneration_responsable (calcule et snapshotte un mois donné),
--      pole_valider_remuneration_responsable (workflow de validation).
--
-- ── Décisions d'architecture (documentées ici, pas seulement en tête de
--    fichier, pour rester visibles à quiconque relit ce fichier plus tard) ──
--
-- A. Grille GLOBALE, pas une par pôle. Le cahier des charges de Fouka
--    présente la grille comme "un standard SportVision", pas une politique
--    par pôle. pole_remuneration_paliers.pole_id reste néanmoins nullable
--    et peut recevoir une ligne pôle-spécifique dans le futur (ex: si le
--    pôle Basket a un jour un barème différent) : la résolution du palier
--    préfère toujours une ligne pôle-spécifique sur une ligne globale
--    (pole_id IS NULL) à borne identique. Aujourd'hui, seules des lignes
--    globales sont insérées (seed ci-dessous).
--
-- B. AUCUNE ligne de palier au-delà de 10 contrats. C'est volontaire et
--    conforme au cahier des charges ("aucun palier automatique") : la
--    fonction de calcul détecte ce cas (nb_contrats > la plus grande borne
--    de la grille) et positionne hors_grille=true + une alerte explicite,
--    sans jamais extrapoler un fixe/variable.
--
-- C. "Bénéfice éligible" calculé par une fonction SECURITY DEFINER
--    (pole_finance_ventilation), PAS par une RLS étendue sur
--    expenses/employee_costs. Vérifié en direct (31/08/2026) : ces deux
--    tables sont aujourd'hui lisibles uniquement par
--    admin/compta/expert_comptable/auditeur (policies expenses_read /
--    employee_costs_read) — un Responsable de pôle non-admin (ex: un
--    salarié 'prod' nommé responsable Basket) n'a et ne doit pas avoir un
--    accès RLS direct à la table expenses/employee_costs de toute
--    l'entreprise. Étendre leur RLS pour un scoping par pôle aurait élargi
--    un accès sensible (masse salariale, fournisseurs) bien au-delà du
--    besoin réel (un total agrégé de son propre pôle). La fonction fait le
--    contrôle d'accès ELLE-MÊME (admin OU is_pole_responsable(p_pole_id))
--    puis retourne un JSON agrégé — jamais les lignes détaillées.
--
-- D. Nouvelle table pole_remuneration_calculs plutôt qu'extension d'une
--    table de paiement existante (paiements/factures = flux clients ;
--    prestations_equipe = missions terrain ; aucune des deux ne modélise
--    "un montant mensuel dû à UN responsable, pour SON pôle, avec un
--    workflow de validation Direction distinct" sans dénaturer son usage
--    actuel — mêmes principes qu'employee_costs, qui est déjà une table
--    séparée pour les salaires fixes).
--
-- E. Prospection personnelle du responsable : AUCUNE commission
--    commerciale supplémentaire n'est créée (pas de nouvelle ligne dans
--    `commissions`) — le variable de responsable (15% du bénéfice
--    éligible) rémunère déjà cette contribution, conformément au cahier
--    des charges. Les missions terrain réalisées personnellement par le
--    responsable continuent de passer par prestations_equipe.remuneration
--    / computeMissionPay() (JS, inchangé) — aucun chevauchement avec cette
--    migration.
--
-- Idempotente : create table if not exists, add column if not exists,
-- create or replace function, drop policy if exists + create policy,
-- insert ... on conflict do nothing.
--
-- ROLLBACK :
--   drop function if exists pole_valider_remuneration_responsable(uuid,text,numeric,text);
--   drop function if exists pole_calculer_remuneration_responsable(uuid,date);
--   drop function if exists pole_finance_ventilation(uuid,date,date);
--   drop function if exists pole_finance_access_ok(uuid);
--   drop table if exists pole_remuneration_calculs;
--   drop table if exists pole_remuneration_paliers;
--   drop trigger if exists trg_sync_expenses_pole_id on expenses;
--   drop trigger if exists trg_sync_frais_pole_id on frais;
--   drop function if exists sync_expense_pole_id();
--   drop function if exists sync_frais_pole_id();
--   alter table expenses drop column if exists pole_id;
--   alter table frais drop column if exists pole_id;

-- ══════════════════════════════════════════════════════════════════════
-- 1. pole_id sur expenses/frais — nullable, dérivé de prestation_id
-- ══════════════════════════════════════════════════════════════════════
alter table expenses add column if not exists pole_id uuid references poles(id);
alter table frais add column if not exists pole_id uuid references poles(id);

comment on column expenses.pole_id is 'Pôle d''affectation. Dérivé automatiquement de prestations.pole_id via prestation_id (trigger sync_expense_pole_id) quand la dépense est liée à une prestation. Reste NULL pour une charge non liée à une mission précise (ex: logiciel/loyer partagé) — la Direction peut alors le renseigner manuellement depuis modalNouvelleDepense pour l''affecter à un pôle (charge indirecte imputable au pôle) ; NULL = charge consolidée SportVision, jamais comptée dans le bénéfice éligible d''un pôle donné.';
comment on column frais.pole_id is 'Même principe que expenses.pole_id (voir commentaire), migration-poles-v6.';

create index if not exists idx_expenses_pole_id on expenses(pole_id) where pole_id is not null;
create index if not exists idx_frais_pole_id on frais(pole_id) where pole_id is not null;

create or replace function sync_expense_pole_id()
returns trigger
language plpgsql
as $$
begin
  if new.prestation_id is not null then
    select pole_id into new.pole_id from prestations where id = new.prestation_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_expenses_pole_id on expenses;
create trigger trg_sync_expenses_pole_id
  before insert or update of prestation_id on expenses
  for each row execute function sync_expense_pole_id();

create or replace function sync_frais_pole_id()
returns trigger
language plpgsql
as $$
begin
  if new.prestation_id is not null then
    select pole_id into new.pole_id from prestations where id = new.prestation_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_frais_pole_id on frais;
create trigger trg_sync_frais_pole_id
  before insert or update of prestation_id on frais
  for each row execute function sync_frais_pole_id();

-- Backfill best-effort des lignes déjà existantes déjà liées à une prestation (additif, ne touche
-- à rien d'autre) — les lignes sans prestation_id restent NULL (charge consolidée, cf. commentaire).
update expenses set pole_id = p.pole_id from prestations p where p.id = expenses.prestation_id and expenses.pole_id is null;
update frais set pole_id = p.pole_id from prestations p where p.id = frais.prestation_id and frais.pole_id is null;

-- ══════════════════════════════════════════════════════════════════════
-- 2. Grille de rémunération du Responsable de pôle — CONFIGURABLE
-- ══════════════════════════════════════════════════════════════════════
create table if not exists pole_remuneration_paliers (
  id uuid default gen_random_uuid() primary key,
  pole_id uuid references poles(id) on delete cascade,
  borne_min integer not null check (borne_min >= 0),
  borne_max integer check (borne_max is null or borne_max >= borne_min),
  fixe_mensuel numeric(10,2) not null default 0,
  variable_pct numeric(5,2) not null default 0,
  libelle_statut text not null,
  actif boolean not null default true,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  -- NULLS NOT DISTINCT (PG17, vérifié en direct — select version()) : une contrainte unique
  -- classique traite deux NULL comme des valeurs DIFFÉRENTES, donc unique(pole_id, borne_min)
  -- SANS ce mot-clé n'empêche PAS deux lignes (NULL, 2) de coexister — piège trouvé en testant en
  -- réel (31/08/2026) : les 3 exécutions successives de cette migration pendant la mise au point
  -- (dont 2 correctifs de fonction plus bas) ont chacune re-triplé silencieusement les 6 lignes de
  -- seed via l'ON CONFLICT DO NOTHING plus bas, qui ne matchait jamais sur pole_id=NULL. Corrigé
  -- ici + doublons nettoyés en prod avant diffusion.
  unique nulls not distinct (pole_id, borne_min)
);

-- Filet de sécurité idempotent pour une table déjà créée par une exécution antérieure de cette
-- migration AVANT le correctif ci-dessus (create table if not exists ne remonterait jamais la
-- contrainte sur une table déjà existante) : dédoublonne puis repose la contrainte NULLS NOT
-- DISTINCT si elle ne l'est pas déjà. Sans effet sur une base qui a la table créée directement
-- avec le correctif.
do $$
begin
  delete from pole_remuneration_paliers a using pole_remuneration_paliers b
    where a.id > b.id and a.pole_id is not distinct from b.pole_id and a.borne_min = b.borne_min;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'pole_remuneration_paliers'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%nulls not distinct%'
  ) then
    alter table pole_remuneration_paliers drop constraint if exists pole_remuneration_paliers_pole_id_borne_min_key;
    alter table pole_remuneration_paliers add constraint pole_remuneration_paliers_pole_id_borne_min_key unique nulls not distinct (pole_id, borne_min);
  end if;
end $$;

comment on table pole_remuneration_paliers is 'Grille CONFIGURABLE (éditable par Fouka sans déploiement de code) du barème de rémunération d''un Responsable de pôle, en fonction du nombre de contrats récurrents (Full Communication) actifs de son pôle. pole_id NULL = ligne globale, applicable à tous les pôles (choix retenu le 31/08/2026 : la grille donnée par Fouka est un standard SportVision, pas une politique par pôle) ; une ligne pole_id renseigné, si ajoutée un jour, prime sur la ligne globale pour la même borne_min. Volontairement PAS de ligne au-delà de 10 (borne_max=10 est la dernière) : au-delà, pole_calculer_remuneration_responsable() ne trouve aucun palier et positionne hors_grille=true (alerte "revue stratégique Direction obligatoire"), conformément au cahier des charges — jamais d''extrapolation automatique.';
comment on column pole_remuneration_paliers.borne_min is 'Nombre minimum (inclus) de contrats récurrents actifs pour ce palier.';
comment on column pole_remuneration_paliers.borne_max is 'Nombre maximum (inclus) de contrats récurrents actifs pour ce palier. NULL = pas de plafond (non utilisé dans la grille de référence actuelle, réservé si Fouka ajoute un palier ouvert plus tard).';
comment on column pole_remuneration_paliers.variable_pct is 'Pourcentage (ex: 15.00 = 15%) appliqué au bénéfice éligible du pôle, UNIQUEMENT s''il est positif.';

alter table pole_remuneration_paliers enable row level security;

drop policy if exists "pole_remuneration_paliers_select_staff" on pole_remuneration_paliers;
create policy "pole_remuneration_paliers_select_staff" on pole_remuneration_paliers for select using (
  exists (select 1 from profiles where id = auth.uid())
);

drop policy if exists "pole_remuneration_paliers_admin_write" on pole_remuneration_paliers;
create policy "pole_remuneration_paliers_admin_write" on pole_remuneration_paliers for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- Seed — grille de référence donnée par Fouka le 31/08/2026 (idempotent : on conflict do nothing,
-- donc un ajustement manuel ultérieur par Fouka via l'UI ne sera jamais écrasé par une ré-exécution
-- de cette migration).
insert into pole_remuneration_paliers (pole_id, borne_min, borne_max, fixe_mensuel, variable_pct, libelle_statut) values
  (null, 0,  1,    0,    0,  '0-1 contrat — pas de rémunération de responsable'),
  (null, 2,  3,    300,  15, '2-3 contrats'),
  (null, 4,  5,    500,  15, '4-5 contrats'),
  (null, 6,  7,    700,  15, '6-7 contrats'),
  (null, 8,  9,    900,  15, '8-9 contrats'),
  (null, 10, 10,   1100, 15, '10 contrats')
on conflict (pole_id, borne_min) do nothing;

-- ══════════════════════════════════════════════════════════════════════
-- 3. Snapshot mensuel calculé + validation Direction
-- ══════════════════════════════════════════════════════════════════════
create table if not exists pole_remuneration_calculs (
  id uuid default gen_random_uuid() primary key,
  pole_id uuid not null references poles(id),
  responsable_id uuid references profiles(id),
  periode date not null,
  nb_contrats_recurrents integer not null default 0,
  palier_id uuid references pole_remuneration_paliers(id),
  hors_grille boolean not null default false,
  fixe_mensuel numeric(10,2) not null default 0,
  revenus_pole numeric(12,2) not null default 0,
  charges_pole numeric(12,2) not null default 0,
  benefice_eligible numeric(12,2) not null default 0,
  variable_pct numeric(5,2) not null default 0,
  variable_montant numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  detail_calcul jsonb not null default '{}'::jsonb,
  statut text not null default 'a_valider' check (statut in ('a_valider','valide','paye')),
  ajustement_montant numeric(10,2),
  ajustement_motif text,
  valide_par uuid references profiles(id),
  valide_le timestamptz,
  paye_le timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (pole_id, periode)
);

comment on table pole_remuneration_calculs is 'Snapshot mensuel de la rémunération calculée d''un Responsable de pôle (fixe + variable selon pole_remuneration_paliers) + workflow de validation Direction avant paiement (statut a_valider -> valide -> paye). Nouvelle table plutôt qu''extension d''une table de paiement existante (voir décision D en tête de fichier) : ni `paiements` (flux client) ni `prestations_equipe` (mission terrain) ne modélisent correctement "un montant dû mensuel à un responsable pour son pôle, avec revue Direction".';
comment on column pole_remuneration_calculs.periode is 'Premier jour du mois calculé (ex: 2026-08-01).';
comment on column pole_remuneration_calculs.hors_grille is 'true si nb_contrats_recurrents dépasse la plus grande borne de la grille (aujourd''hui : >10) — aucun palier automatique appliqué, fixe_mensuel/variable_montant restent à 0, voir detail_calcul->''alerte'' pour le message de revue stratégique Direction.';
comment on column pole_remuneration_calculs.detail_calcul is 'Ventilation traçable du calcul (revenus/charges par catégorie, cf. pole_finance_ventilation) — permet à la Direction d''ajuster le montant en connaissance de cause avant validation, sans recalculer à la main.';
comment on column pole_remuneration_calculs.ajustement_montant is 'Ajustement manuel optionnel décidé par la Direction avant validation (ex: correction ponctuelle) — total effectivement payé = total + ajustement_montant si renseigné. Le calcul brut (total) n''est jamais modifié rétroactivement, pour garder une trace fidèle du calcul automatique.';

create index if not exists idx_prc_pole_periode on pole_remuneration_calculs(pole_id, periode desc);
create index if not exists idx_prc_statut on pole_remuneration_calculs(statut);

alter table pole_remuneration_calculs enable row level security;

-- Lecture : admin, ou le responsable du pôle concerné (SECURITY DEFINER — pas de sous-requête
-- inline vers pole_affectations depuis une policy, même précaution que le reste de la migration
-- multi-pôles, cf. piège de récursion RLS documenté dans migration-poles-v3-rls.sql).
drop policy if exists "pole_remuneration_calculs_select" on pole_remuneration_calculs;
create policy "pole_remuneration_calculs_select" on pole_remuneration_calculs for select using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  or is_pole_responsable(pole_remuneration_calculs.pole_id)
);

-- Écriture : admin uniquement (la Direction valide/paye ; l'insert/update "brut" passe de toute
-- façon par les fonctions SECURITY DEFINER ci-dessous, qui bypassent cette policy — elle sert de
-- filet de sécurité en défense en profondeur contre une écriture directe non maîtrisée).
drop policy if exists "pole_remuneration_calculs_admin_write" on pole_remuneration_calculs;
create policy "pole_remuneration_calculs_admin_write" on pole_remuneration_calculs for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- ══════════════════════════════════════════════════════════════════════
-- 4. Fonctions de calcul (SECURITY DEFINER)
-- ══════════════════════════════════════════════════════════════════════

-- Contrôle d'accès partagé par pole_finance_ventilation et pole_calculer_remuneration_responsable :
-- admin (bypass total) OU responsable actif du pôle concerné. Un simple membre du pôle (role_pole
-- 'membre') n'a PAS accès à ces données financières agrégées — seul le/la responsable du pôle et
-- la Direction, cohérent avec la sensibilité de la donnée (masse salariale, marge).
create or replace function pole_finance_access_ok(p_pole_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
    or is_pole_responsable(p_pole_id);
$$;

comment on function pole_finance_access_ok(uuid) is 'Vrai si l''appelant est admin ou responsable actif du pôle p_pole_id. Utilisé par pole_finance_ventilation() et pole_calculer_remuneration_responsable() (migration-poles-v6) pour gater l''accès à des agrégats financiers sensibles sans élargir la RLS de expenses/employee_costs.';

-- Ventilation finance d'un pôle sur une période [p_debut, p_fin[ : revenus classés par catégorie
-- (Full Communication/contrats récurrents, prestations ponctuelles, tournois/événements,
-- joueurs/académies, autres) + charges classées par catégorie (photographes/vidéastes, community
-- managers, autres missions terrain, déplacements, sous-traitance/montage, matériel/logiciel,
-- fixe responsable/secrétaire/production affecté au pôle, coût indirect alloué, autres charges).
-- Retourne un jsonb ; {"erreur":"acces_refuse"} si l'appelant n'est ni admin ni responsable du
-- pôle (voir pole_finance_access_ok).
--
-- LIMITE CONNUE (documentée volontairement, pas une omission) : la classification "revenus"
-- s'appuie sur le contrat actif du CLIENT au moment du calcul (pas de lien direct facture<->contrat
-- par ligne) — une prestation ponctuelle facturée en plus à un club déjà sous contrat Full
-- Communication sera comptée dans le seau "full_communication" plutôt que "prestations
-- ponctuelles". Aucune colonne actuelle ne permet de distinguer les deux plus finement sans
-- toucher au flux de facturation existant ; à revoir si Fouka a besoin de cette granularité.
create or replace function pole_finance_ventilation(p_pole_id uuid, p_debut date, p_fin date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_revenus jsonb;
  v_charges jsonb;
  v_equipe_photo numeric;
  v_equipe_cm numeric;
  v_equipe_autres numeric;
  v_frais_total numeric;
  v_dep_total numeric;
  v_dep_sous_traitance numeric;
  v_dep_transport numeric;
  v_dep_materiel_logiciel numeric;
  v_dep_autres numeric;
  v_fixe_equipe numeric;
  v_indirect numeric;
  v_charges_total numeric;
  v_revenus_total numeric;
begin
  if not pole_finance_access_ok(p_pole_id) then
    return jsonb_build_object('erreur','acces_refuse');
  end if;

  -- Revenus : classés via le/les contrat(s) actif(s) du client de chaque prestation.
  --
  -- CORRECTIF (trouvé en testant en réel avec un compte 'prod' jetable, 31/08/2026, avant toute
  -- diffusion de cette migration) : la première version de cette fonction lisait v_rentabilite_
  -- missions au lieu de `prestations` directement. Cette vue a sa PROPRE clause WHERE qui exclut
  -- purement et simplement tout appelant dont profiles.role IN ('sec','prod') (voir sa définition,
  -- migration-poles-v4-rentabilite-pole-id.sql) — une protection légitime pour empêcher le
  -- personnel opérationnel de voir la marge de CHAQUE mission, mais auth.uid() reste celui de
  -- l'appelant même à l'intérieur d'une fonction SECURITY DEFINER (auth.uid() lit un GUC de
  -- session, pas le propriétaire de la fonction) : un Responsable de pôle dont le rôle FONCTIONNEL
  -- est justement 'prod' (cas réaliste et probable) obtenait donc 0€ de revenus et 0€ de coût
  -- indirect alloué en interrogeant SA PROPRE ventilation, silencieusement. pole_finance_
  -- ventilation() fait déjà son propre contrôle d'accès précis (pole_finance_access_ok, ligne
  -- au-dessus) : elle n'a pas besoin — et ne doit pas dépendre — du filtre générique de la vue.
  -- Interroge donc `prestations`/`cost_allocations` directement, en répliquant fidèlement le calcul
  -- de revenu_ht/cout_indirect_alloue de la vue, sans sa clause de restriction par rôle appelant.
  with contrats_actifs as (
    select client_id, type_contrat,
      row_number() over (
        partition by client_id
        order by case type_contrat
          when 'full_communication' then 1
          when 'evenement' then 2
          when 'joueur' then 3
          when 'coach_academie' then 3
          else 9
        end
      ) as prio
    from contrats
    where statut = 'actif'
  ),
  rentab as (
    select p.id as prestation_id, coalesce(p.montant_ht, 0::numeric) as revenu_ht, p.client_id
    from prestations p
    where p.pole_id = p_pole_id
      and p.date_prestation >= p_debut and p.date_prestation < p_fin
      and p.statut <> all (array['annulée'::statut_prestation, 'refusée'::statut_prestation])
  ),
  classe as (
    select r.revenu_ht,
      ca.type_contrat as contrat_type
    from rentab r
    left join contrats_actifs ca on ca.client_id = r.client_id and ca.prio = 1
  )
  select jsonb_build_object(
    'full_communication', coalesce(sum(revenu_ht) filter (where contrat_type = 'full_communication'), 0),
    'prestations_ponctuelles', coalesce(sum(revenu_ht) filter (where contrat_type is null or contrat_type = 'ponctuel'), 0),
    'tournois_evenements', coalesce(sum(revenu_ht) filter (where contrat_type = 'evenement'), 0),
    'joueurs_academies', coalesce(sum(revenu_ht) filter (where contrat_type in ('joueur','coach_academie')), 0),
    'autres_revenus', coalesce(sum(revenu_ht) filter (where contrat_type not in ('full_communication','ponctuel','evenement','joueur','coach_academie')), 0),
    'total', coalesce(sum(revenu_ht), 0)
  ), coalesce(sum(revenu_ht), 0)
  into v_revenus, v_revenus_total
  from classe;

  -- Charges — équipe (missions terrain acceptées, prestations du pôle sur la période)
  select
    coalesce(sum(pe.remuneration) filter (where p.role = 'photo'), 0),
    coalesce(sum(pe.remuneration) filter (where p.role = 'cm'), 0),
    coalesce(sum(pe.remuneration) filter (where p.role is null or p.role not in ('photo','cm')), 0)
  into v_equipe_photo, v_equipe_cm, v_equipe_autres
  from prestations_equipe pe
  join prestations pr on pr.id = pe.prestation_id
  left join profiles p on p.id = pe.collaborateur_id
  where pr.pole_id = p_pole_id
    and pe.statut = 'acceptée'
    and pr.date_prestation >= p_debut and pr.date_prestation < p_fin;

  -- Charges — frais (déplacements/km, matériel, etc. déclarés, validés/remboursés)
  select coalesce(sum(f.montant), 0)
  into v_frais_total
  from frais f
  left join prestations pr on pr.id = f.prestation_id
  where f.statut in ('validé','remboursé')
    and coalesce(pr.pole_id, f.pole_id) = p_pole_id
    and f.date_frais >= p_debut and f.date_frais < p_fin;

  -- Charges — dépenses fournisseurs/récurrentes (expenses), engagées/payées/comptabilisées
  select
    coalesce(sum(e.montant_ht), 0),
    coalesce(sum(e.montant_ht) filter (where e.categorie = 'sous_traitance'), 0),
    coalesce(sum(e.montant_ht) filter (where e.categorie = 'transport'), 0),
    coalesce(sum(e.montant_ht) filter (where e.categorie in ('materiel','logiciel')), 0),
    coalesce(sum(e.montant_ht) filter (where e.categorie not in ('sous_traitance','transport','materiel','logiciel')), 0)
  into v_dep_total, v_dep_sous_traitance, v_dep_transport, v_dep_materiel_logiciel, v_dep_autres
  from expenses e
  left join prestations pr on pr.id = e.prestation_id
  where e.statut in ('engagee','payee','comptabilisee')
    and coalesce(pr.pole_id, e.pole_id) = p_pole_id
    and e.date_depense >= p_debut and e.date_depense < p_fin;

  -- Charges — fixe équipe administrative affectée au pôle (secrétaire/production), salaire brut +
  -- charges patronales. Le fixe du/de la responsable lui-même est ajouté séparément par
  -- pole_calculer_remuneration_responsable() (c'est justement l'inconnue qu'elle calcule).
  select coalesce(sum(ec.salaire_brut_mensuel * (1 + coalesce(ec.charges_patronales_pct, 0) / 100.0)), 0)
  into v_fixe_equipe
  from employee_costs ec
  join pole_affectations pa on pa.user_id = ec.collaborateur_id and pa.pole_id = p_pole_id and pa.actif = true
  join profiles p on p.id = ec.collaborateur_id
  where p.role in ('sec','prod');

  -- Charges — coût indirect alloué (cost_allocations). Même correctif que pour les revenus
  -- ci-dessus : calculé directement depuis `prestations`/`cost_allocations` (réplique fidèle de la
  -- formule de v_rentabilite_missions.cout_indirect_alloue), PAS depuis la vue elle-même, qui
  -- renverrait 0 ligne pour un appelant de rôle 'sec'/'prod'.
  select coalesce(sum(
    coalesce((select ca.valeur from cost_allocations ca where ca.actif = true and ca.methode = 'forfait_par_mission' limit 1), 0)
    + coalesce(p.montant_ht, 0) * coalesce((select ca.valeur from cost_allocations ca where ca.actif = true and ca.methode = 'pourcentage_ca' limit 1), 0) / 100.0
  ), 0)
  into v_indirect
  from prestations p
  where p.pole_id = p_pole_id
    and p.date_prestation >= p_debut and p.date_prestation < p_fin
    and p.statut <> all (array['annulée'::statut_prestation, 'refusée'::statut_prestation]);

  v_charges_total := v_equipe_photo + v_equipe_cm + v_equipe_autres + v_frais_total + v_dep_total + v_fixe_equipe + v_indirect;

  v_charges := jsonb_build_object(
    'photographes_videastes', v_equipe_photo,
    'community_managers', v_equipe_cm,
    'autres_missions_terrain', v_equipe_autres,
    'deplacements', v_frais_total + v_dep_transport,
    'sous_traitance_montage', v_dep_sous_traitance,
    'materiel_location', v_dep_materiel_logiciel,
    'fixe_secretaire_production', v_fixe_equipe,
    'cout_indirect_alloue', v_indirect,
    'autres_charges', v_dep_autres,
    'total', v_charges_total
  );

  return jsonb_build_object(
    'pole_id', p_pole_id,
    'periode', jsonb_build_object('debut', p_debut, 'fin', p_fin),
    'revenus', v_revenus,
    'charges', v_charges,
    'marge_avant_fixe_responsable', v_revenus_total - v_charges_total
  );
end;
$$;

comment on function pole_finance_ventilation(uuid,date,date) is 'Ventilation finance (revenus/charges par catégorie) d''un pôle sur [p_debut,p_fin[. Accès géré en interne (pole_finance_access_ok) — ne dépend PAS de la RLS de expenses/employee_costs (volontairement restrictive, voir décision C en tête de migration-poles-v6). Réutilisée par pole_calculer_remuneration_responsable() pour le bénéfice éligible.';

-- Calcule ET enregistre (upsert) le snapshot mensuel de rémunération du Responsable d'un pôle.
-- Idempotent tant que le statut du calcul existant n'est pas 'paye' (un calcul déjà payé n'est
-- plus jamais recalculé silencieusement — il faudrait une action explicite de la Direction,
-- hors périmètre de cette fonction).
create or replace function pole_calculer_remuneration_responsable(p_pole_id uuid, p_periode date)
returns pole_remuneration_calculs
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_periode date := date_trunc('month', p_periode)::date;
  v_periode_fin date := (date_trunc('month', p_periode) + interval '1 month')::date;
  v_existing pole_remuneration_calculs;
  v_responsable uuid;
  v_nb_contrats integer;
  v_palier pole_remuneration_paliers;
  v_hors_grille boolean := false;
  v_fixe numeric := 0;
  v_pct numeric := 0;
  v_ventil jsonb;
  v_revenus_total numeric;
  v_charges_total numeric;
  v_benefice numeric;
  v_variable numeric := 0;
  v_row pole_remuneration_calculs;
begin
  if not pole_finance_access_ok(p_pole_id) then
    raise exception 'accès refusé au pôle %', p_pole_id using errcode = '42501';
  end if;

  select * into v_existing from pole_remuneration_calculs
    where pole_id = p_pole_id and periode = v_periode;
  if found and v_existing.statut = 'paye' then
    return v_existing;
  end if;

  -- Responsable actuel du pôle (s'il y en a plusieurs par erreur, on prend le plus ancien affecté
  -- — cas non censé arriver, un seul responsable par pôle en pratique).
  select user_id into v_responsable
  from pole_affectations
  where pole_id = p_pole_id and role_pole = 'responsable' and actif = true
  order by affecte_le asc
  limit 1;

  -- Contrats récurrents (Full Communication) actifs du pôle sur la période (chevauchement avec
  -- [v_periode, v_periode_fin[ via date_debut/date_fin, contrats sans date = considérés actifs).
  select count(*) into v_nb_contrats
  from contrats c
  join clients cl on cl.id = c.client_id
  where cl.pole_id = p_pole_id
    and c.type_contrat = 'full_communication'
    and c.statut = 'actif'
    and (c.date_debut is null or c.date_debut < v_periode_fin)
    and (c.date_fin is null or c.date_fin >= v_periode);

  -- Palier : ligne pôle-spécifique prioritaire sur ligne globale, à borne identique.
  select * into v_palier
  from pole_remuneration_paliers
  where actif = true
    and (pole_id = p_pole_id or pole_id is null)
    and borne_min <= v_nb_contrats
    and (borne_max is null or borne_max >= v_nb_contrats)
  order by (pole_id = p_pole_id) desc, borne_min desc
  limit 1;

  if v_palier.id is null then
    v_hors_grille := true;
    v_fixe := 0;
    v_pct := 0;
  else
    v_fixe := v_palier.fixe_mensuel;
    v_pct := v_palier.variable_pct;
  end if;

  -- Bénéfice éligible = revenus du pôle - TOUTES les charges directes/imputables du pôle
  -- (ventilation) - le fixe du responsable lui-même (rémunérations fixes du pôle, cf. formule du
  -- cahier des charges). Variable = pct% de ce bénéfice, seulement s'il est positif.
  v_ventil := pole_finance_ventilation(p_pole_id, v_periode, v_periode_fin);
  v_revenus_total := coalesce((v_ventil->'revenus'->>'total')::numeric, 0);
  v_charges_total := coalesce((v_ventil->'charges'->>'total')::numeric, 0);
  v_benefice := v_revenus_total - v_charges_total - v_fixe;
  if v_benefice > 0 then
    v_variable := round(v_benefice * v_pct / 100.0, 2);
  end if;

  insert into pole_remuneration_calculs (
    pole_id, responsable_id, periode, nb_contrats_recurrents, palier_id, hors_grille,
    fixe_mensuel, revenus_pole, charges_pole, benefice_eligible, variable_pct, variable_montant,
    total, detail_calcul, statut
  ) values (
    p_pole_id, v_responsable, v_periode, v_nb_contrats, v_palier.id, v_hors_grille,
    v_fixe, v_revenus_total, v_charges_total, v_benefice, v_pct, v_variable,
    v_fixe + v_variable,
    v_ventil || jsonb_build_object(
      'alerte', case when v_hors_grille then 'Plus de 10 contrats récurrents actifs : revue stratégique Direction obligatoire — aucun palier automatique appliqué.' else null end
    ),
    'a_valider'
  )
  on conflict (pole_id, periode) do update set
    responsable_id = excluded.responsable_id,
    nb_contrats_recurrents = excluded.nb_contrats_recurrents,
    palier_id = excluded.palier_id,
    hors_grille = excluded.hors_grille,
    fixe_mensuel = excluded.fixe_mensuel,
    revenus_pole = excluded.revenus_pole,
    charges_pole = excluded.charges_pole,
    benefice_eligible = excluded.benefice_eligible,
    variable_pct = excluded.variable_pct,
    variable_montant = excluded.variable_montant,
    total = excluded.total,
    detail_calcul = excluded.detail_calcul,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

comment on function pole_calculer_remuneration_responsable(uuid,date) is 'Calcule et snapshotte (upsert) la rémunération du Responsable d''un pôle pour le mois de p_periode. Ne recalcule jamais un mois déjà statut=''paye''. Palier issu de pole_remuneration_paliers (jamais codé en dur) ; hors_grille=true si nb_contrats_recurrents dépasse la grille (>10 aujourd''hui) — aucun montant automatique, alerte stockée dans detail_calcul->>''alerte''.';

-- Workflow de validation Direction (admin uniquement — cohérent avec la policy RLS write de
-- pole_remuneration_calculs, cette fonction est le chemin normal mais pas le seul, l'admin peut
-- aussi écrire directement via l'API si besoin).
create or replace function pole_valider_remuneration_responsable(
  p_calcul_id uuid,
  p_statut text default null,
  p_ajustement_montant numeric default null,
  p_ajustement_motif text default null
)
returns pole_remuneration_calculs
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row pole_remuneration_calculs;
  v_statut_final text;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'seule la Direction (admin) peut valider une rémunération de responsable' using errcode = '42501';
  end if;
  if p_statut is not null and p_statut not in ('a_valider','valide','paye') then
    raise exception 'statut invalide: %', p_statut;
  end if;

  -- p_statut NULL = on ne change PAS le statut (utilisé par l'action "Ajuster le montant" seule,
  -- pour ne jamais faire régresser un calcul déjà validé/payé vers "à valider" par effet de bord).
  update pole_remuneration_calculs set
    statut = coalesce(p_statut, statut),
    ajustement_montant = coalesce(p_ajustement_montant, ajustement_montant),
    ajustement_motif = coalesce(p_ajustement_motif, ajustement_motif),
    valide_par = case when p_statut in ('valide','paye') then auth.uid() else valide_par end,
    valide_le = case when p_statut in ('valide','paye') and valide_le is null then now() else valide_le end,
    paye_le = case when p_statut = 'paye' then now() else paye_le end,
    updated_at = now()
  where id = p_calcul_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'calcul de rémunération introuvable: %', p_calcul_id;
  end if;

  return v_row;
end;
$$;

comment on function pole_valider_remuneration_responsable(uuid,text,numeric,text) is 'Fait avancer le statut d''un calcul de rémunération de responsable (a_valider -> valide -> paye), admin uniquement. Permet un ajustement manuel documenté (ajustement_montant/motif) sans jamais modifier le calcul brut (total).';
