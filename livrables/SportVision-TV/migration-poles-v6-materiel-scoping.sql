-- migration-poles-v6-materiel-scoping.sql
--
-- Migration multi-pôles (Football + Basket), Lot 7 — Matériel (kits/materiels).
-- À exécuter APRÈS migration-poles-v1 à v5 (fondations poles/pole_affectations,
-- backfill, RLS clients/prestations/etc., création du pôle Basket).
--
-- Périmètre : modélise le fait qu'un kit ou un équipement individuel peut être
-- Commun (partagé par tout SportVision, comportement inchangé), Dédié à un
-- pôle (visible/réservable UNIQUEMENT par ce pôle + admin) ou en Priorité pour
-- un pôle (visible/réservable par tout le monde comme aujourd'hui — juste
-- "taggé" pour affichage/priorité d'usage future, aucune restriction RLS).
--
-- Décision de modélisation (cahier des charges laissait le choix) :
--   pole_id uuid nullable (NULL = Commun, comportement actuel INCHANGÉ pour
--     tout le matériel existant — cette migration est purement additive,
--     aucune colonne n'est backfillée à autre chose que NULL) ;
--   pole_exclusif boolean, significatif UNIQUEMENT quand pole_id n'est pas
--     NULL : true = "Dédié" (accès restreint par RLS), false = "Priorité"
--     (accès libre comme le Commun, juste affiché différemment côté UI).
-- Alternative envisagée et écartée : un enum à 3 valeurs
-- ('commun'|'dedie'|'priorite') sur une seule colonne — écarté car il aurait
-- fallu une deuxième colonne pole_id quand même pour dédié/priorité (un enum
-- seul ne dit pas QUEL pôle), et la contrainte CHECK ci-dessous exprime déjà
-- proprement l'invariant (pole_exclusif n'a de sens que si pole_id existe)
-- sans complexité de type supplémentaire. kits et materiels ont CHACUN leur
-- propre pole_id/pole_exclusif (pas de colonne calculée depuis l'autre table) :
-- un équipement individuel (materiels) peut être affecté indépendamment de son
-- kit conteneur (kits) — utile pour un accessoire acheté spécifiquement pour
-- Basket mais rangé dans un kit par ailleurs commun, ou l'inverse. Aucune
-- contrainte de cohérence n'est imposée entre materiels.pole_id et le pole_id
-- du kit auquel il est rattaché (kit_id) : au choix de l'utilisateur au
-- moment de la création/édition ; le formulaire pré-remplit par défaut sur le
-- pôle du kit choisi, mais reste modifiable.
--
-- Sécurité (voir §RLS ci-dessous) : la restriction RLS ne porte QUE sur le
-- cas "Dédié" (pole_exclusif = true). Le cas "Priorité" reste aussi ouvert
-- que "Commun" pour l'instant — le cahier des charges ne demande que de
-- MODÉLISER la priorité, pas d'implémenter un arbitrage de réservation
-- (ex: empêcher un membre d'un autre pôle de réserver un kit en Priorité
-- Basket si un besoin Basket existe au même moment) : logique métier future,
-- hors périmètre de ce lot. Le système anti-double-réservation existant sur
-- kit_reservations (statuts + créneaux) n'est pas touché.
--
-- Portée RLS élargie par rapport à la demande initiale : le cahier des
-- charges ne nommait que kits/kit_reservations, mais comme materiels reçoit
-- aussi sa propre colonne pole_id (accessoire affecté indépendamment de son
-- kit), la policy materiels_select (aujourd'hui is_staff() sans restriction)
-- laisserait sinon fuiter la liste des équipements dédiés à un pôle vers le
-- staff d'un autre pôle (visible dans l'onglet "Matériels", indépendant de
-- l'onglet "Kits") — incohérent avec l'exigence "visible/réservable QUE par
-- les membres de ce pôle". materiels_select et materiels_write sont donc
-- réécrites avec le même scoping, par cohérence et prudence sécuritaire.
-- materiels_finance_read (expert_comptable/auditeur) est volontairement
-- laissée INTACTE, même exception qu'en migration-poles-v3-rls.sql (audit
-- transverse).
--
-- Toutes les policies ci-dessous ont été VÉRIFIÉES EN DIRECT CONTRE LA PROD
-- (pg_policies.qual/with_check, 31/08/2026) avant écriture, jamais devinées
-- par lecture de fichiers de migration.
--
-- ⚠️ Piège de récursion RLS (déjà rencontré 2x cette nuit sur d'autres
-- tables) : kits_select interroge DÉJÀ kit_reservations par sous-requête
-- classique (JOIN prestations_equipe) pour la branche "collaborateur affecté
-- à une prestation utilisant ce kit". Si kit_reservations interrogeait à son
-- tour `kits` par une sous-requête classique pour son propre scoping pôle, on
-- obtiendrait exactement le cycle décrit dans les instructions (kits ->
-- kit_reservations -> kits). Pour casser ce cycle à la racine, le scoping
-- pôle de kit_reservations passe PAR LA FONCTION SECURITY DEFINER
-- kit_reservation_pole_scope_ok(), qui lit `kits` en contournant sa RLS (même
-- principe que prestation_pole_scope_ok()/client_pole_scope_ok() en v3) —
-- jamais une sous-requête RLS-évaluée vers kits depuis une policy de
-- kit_reservations.
--
-- Idempotente : alter table add column if not exists, create or replace
-- function, drop policy if exists suivi de create policy.
--
-- ROLLBACK : section commentée tout en bas, redéfinit verbatim les 8
-- policies dans leur état exact d'avant cette migration (vérifié en direct
-- ci-dessus).

-- ── 1. Colonnes pole_id / pole_exclusif (nullable, additives) ──────────────
alter table kits add column if not exists pole_id uuid references poles(id);
alter table kits add column if not exists pole_exclusif boolean;
alter table materiels add column if not exists pole_id uuid references poles(id);
alter table materiels add column if not exists pole_exclusif boolean;

comment on column kits.pole_id is 'NULL = Commun (partagé SportVision, comportement historique). Non-NULL = affecté à ce pôle — voir pole_exclusif pour Dédié/Priorité. Migration-poles-v6, 31/08/2026. Tout le matériel existant reste NULL après cette migration (additive uniquement).';
comment on column kits.pole_exclusif is 'Significatif uniquement si pole_id non NULL. true = Dédié (RLS restreint la visibilité/réservation aux membres du pôle + admin). false = Priorité (visible/réservable par tous comme Commun, juste taggé pour affichage — pas de restriction RLS). NULL si pole_id est NULL (cf. contrainte kits_pole_exclusif_coherent).';
comment on column materiels.pole_id is 'Affectation propre à cet équipement, indépendante du pole_id du kit auquel il est éventuellement rattaché (kit_id) — voir commentaire de tête de migration-poles-v6-materiel-scoping.sql pour la justification.';
comment on column materiels.pole_exclusif is 'Même sémantique que kits.pole_exclusif (Dédié/Priorité), appliquée à un équipement individuel plutôt qu''à un kit entier.';

alter table kits drop constraint if exists kits_pole_exclusif_coherent;
alter table kits add constraint kits_pole_exclusif_coherent check (
  (pole_id is null and pole_exclusif is null) or (pole_id is not null and pole_exclusif is not null)
);
alter table materiels drop constraint if exists materiels_pole_exclusif_coherent;
alter table materiels add constraint materiels_pole_exclusif_coherent check (
  (pole_id is null and pole_exclusif is null) or (pole_id is not null and pole_exclusif is not null)
);

create index if not exists idx_kits_pole on kits(pole_id) where pole_id is not null;
create index if not exists idx_materiels_pole on materiels(pole_id) where pole_id is not null;

-- ── 2. Fonctions helper SECURITY DEFINER ────────────────────────────────────
-- Réutilise pole_scope_ok() (déjà en place, migration-poles-v3-rls.sql) —
-- même point d'entrée admin-bypass + affectation pôle, pas de duplication.
create or replace function kit_pole_scope_ok(p_pole_id uuid, p_pole_exclusif boolean)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  -- Commun (pole_id null) ou Priorité (pole_exclusif pas strictement true) :
  -- toujours visible, comme aujourd'hui. Dédié (pole_exclusif = true) :
  -- restreint aux membres du pôle (+ admin, via pole_scope_ok).
  select p_pole_id is null or p_pole_exclusif is not true or pole_scope_ok(p_pole_id);
$$;

comment on function kit_pole_scope_ok(uuid, boolean) is 'Vrai si le matériel est Commun, en Priorité (pas d''exclusivité), ou si l''appelant est admin/affecté au pôle propriétaire. Utilisé par les policies RLS kits/materiels (migration-poles-v6).';

-- Contourne la RLS de `kits` en interne pour que kit_reservations puisse
-- vérifier le scoping pôle du kit réservé SANS jamais redéclencher
-- l'évaluation de la policy kits_select (qui, elle, interroge
-- kit_reservations par sous-requête classique) — cf. piège de récursion en
-- tête de fichier.
create or replace function kit_reservation_pole_scope_ok(p_kit_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_kit_id is null or coalesce(
    (select kit_pole_scope_ok(k.pole_id, k.pole_exclusif) from kits k where k.id = p_kit_id),
    true -- kit_id référence un kit introuvable/supprimé : fail-open, ne restreint jamais un accès qui n'était pas déjà conditionné à l'existence du kit
  );
$$;

comment on function kit_reservation_pole_scope_ok(uuid) is 'Scoping pôle pour kit_reservations, résolu via le kit réservé — security definer pour ne jamais réévaluer la RLS de kits depuis une policy de kit_reservations (kits_select interroge déjà kit_reservations, cf. migration-poles-v6).';

-- ── 3. RLS — kits ────────────────────────────────────────────────────────
drop policy if exists "kits_select" on kits;
create policy "kits_select" on kits for select using (
  (
    (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod','sec','compta'])))
    or (exists (select 1 from kit_reservations kr join prestations_equipe pe on pe.prestation_id = kr.prestation_id where kr.kit_id = kits.id and pe.collaborateur_id = auth.uid()))
  )
  and kit_pole_scope_ok(kits.pole_id, kits.pole_exclusif)
);

drop policy if exists "kits_write" on kits;
create policy "kits_write" on kits for all using (
  (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod','sec','compta'])))
  and kit_pole_scope_ok(kits.pole_id, kits.pole_exclusif)
) with check (
  (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod','sec','compta'])))
  and kit_pole_scope_ok(kits.pole_id, kits.pole_exclusif)
);

-- ── 4. RLS — kit_reservations ────────────────────────────────────────────
drop policy if exists "kit_resa_select" on kit_reservations;
create policy "kit_resa_select" on kit_reservations for select using (
  (
    (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod'])))
    or (collaborateur_id = auth.uid())
  )
  and kit_reservation_pole_scope_ok(kit_reservations.kit_id)
);

drop policy if exists "kit_resa_insert" on kit_reservations;
create policy "kit_resa_insert" on kit_reservations for insert with check (
  (
    (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod'])))
    or (collaborateur_id = auth.uid())
  )
  and kit_reservation_pole_scope_ok(kit_id)
);

drop policy if exists "kit_resa_update" on kit_reservations;
create policy "kit_resa_update" on kit_reservations for update using (
  (
    (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod'])))
    or (collaborateur_id = auth.uid())
  )
  and kit_reservation_pole_scope_ok(kit_reservations.kit_id)
);

drop policy if exists "kit_resa_delete" on kit_reservations;
create policy "kit_resa_delete" on kit_reservations for delete using (
  (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod'])))
  and kit_reservation_pole_scope_ok(kit_reservations.kit_id)
);

-- ── 5. RLS — materiels (extension de prudence, voir commentaire de tête) ──
drop policy if exists "materiels_select" on materiels;
create policy "materiels_select" on materiels for select using (
  is_staff() and kit_pole_scope_ok(materiels.pole_id, materiels.pole_exclusif)
);

drop policy if exists "materiels_write" on materiels;
create policy "materiels_write" on materiels for all using (
  (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod','compta'])))
  and kit_pole_scope_ok(materiels.pole_id, materiels.pole_exclusif)
) with check (
  (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod','compta'])))
  and kit_pole_scope_ok(materiels.pole_id, materiels.pole_exclusif)
);

-- materiels_finance_read : NON touchée (audit transverse expert_comptable/auditeur, même exception qu'en v3).

-- ══════════════════════════════════════════════════════════════════════
-- ROLLBACK — décommenter et exécuter en cas de problème (redéfinition
-- verbatim de l'état exact d'avant cette migration, vérifié en direct le
-- 31/08/2026 avant d'écrire ce fichier) :
-- ══════════════════════════════════════════════════════════════════════

-- drop policy if exists "kits_select" on kits;
-- create policy "kits_select" on kits for select using (
--   (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod','sec','compta'])))
--   or (exists (select 1 from kit_reservations kr join prestations_equipe pe on pe.prestation_id = kr.prestation_id where kr.kit_id = kits.id and pe.collaborateur_id = auth.uid()))
-- );
--
-- drop policy if exists "kits_write" on kits;
-- create policy "kits_write" on kits for all using (
--   exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod','sec','compta']))
-- );
--
-- drop policy if exists "kit_resa_select" on kit_reservations;
-- create policy "kit_resa_select" on kit_reservations for select using (
--   (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod'])))
--   or (collaborateur_id = auth.uid())
-- );
--
-- drop policy if exists "kit_resa_insert" on kit_reservations;
-- create policy "kit_resa_insert" on kit_reservations for insert with check (
--   (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod'])))
--   or (collaborateur_id = auth.uid())
-- );
--
-- drop policy if exists "kit_resa_update" on kit_reservations;
-- create policy "kit_resa_update" on kit_reservations for update using (
--   (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod'])))
--   or (collaborateur_id = auth.uid())
-- );
--
-- drop policy if exists "kit_resa_delete" on kit_reservations;
-- create policy "kit_resa_delete" on kit_reservations for delete using (
--   exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod']))
-- );
--
-- drop policy if exists "materiels_select" on materiels;
-- create policy "materiels_select" on materiels for select using (is_staff());
--
-- drop policy if exists "materiels_write" on materiels;
-- create policy "materiels_write" on materiels for all using (
--   exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','prod','compta']))
-- );
--
-- drop function if exists kit_reservation_pole_scope_ok(uuid);
-- drop function if exists kit_pole_scope_ok(uuid, boolean);
-- alter table materiels drop constraint if exists materiels_pole_exclusif_coherent;
-- alter table kits drop constraint if exists kits_pole_exclusif_coherent;
-- alter table materiels drop column if exists pole_exclusif;
-- alter table materiels drop column if exists pole_id;
-- alter table kits drop column if exists pole_exclusif;
-- alter table kits drop column if exists pole_id;
