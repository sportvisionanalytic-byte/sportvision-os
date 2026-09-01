-- ============================================================================
-- migration-poles-v23-espace-responsable.sql
-- Nouveau poste "Responsable de pôle" (31/08/2026, demande explicite de
-- Fouka) : pole_affectations.role_pole='responsable' existe déjà depuis
-- migration-poles-v1 (orthogonal au rôle fonctionnel profiles.role), mais ne
-- débloquait jusqu'ici qu'un seul écran (Roadmap pôle). Fouka veut une
-- interface proche de celle d'un admin, mais strictement limitée à SON pôle,
-- avec droits d'écriture complets (confirmé explicitement, pas juste lecture).
--
-- migration-poles-v9-roadmap-responsable-select.sql avait déjà ouvert
-- clients/contrats en LECTURE SEULE pour tout Responsable, quel que soit son
-- rôle fonctionnel (is_pole_responsable()/client_pole_responsable_ok(),
-- réutilisées ici telles quelles). Cette migration complète :
--   1. l'ÉCRITURE sur clients/contrats (v9 n'avait que la lecture),
--   2. devis/factures (jamais couverts du tout),
--   3. prestations, prestations_equipe, kits, kit_reservations, materiels
--      (jamais couverts — ces tables filtrent aujourd'hui par LISTE DE RÔLES
--      FONCTIONNELS avant même de regarder le pôle : un Responsable `photo`
--      ou `cm` s'y heurterait à une RLS vide, exactement le bug déjà trouvé
--      et corrigé pour clients/contrats par v9).
--
-- Toutes les policies sont ADDITIVES (aucune policy existante modifiée) :
-- zéro régression pour les rôles déjà couverts (admin/sec/prod/compta/rh...),
-- seul un compte avec role_pole='responsable' sur un pôle précis gagne un
-- accès, strictement borné à ce pôle par is_pole_responsable()/
-- client_pole_responsable_ok() (SECURITY DEFINER, déjà vérifiées cette nuit
-- sans risque de récursion RLS).
-- ============================================================================

-- Petit helper manquant : un Responsable doit aussi gérer le matériel
-- "Commun" (pole_id null) de son pôle, pas seulement le matériel qui lui est
-- explicitement dédié — is_pole_responsable(null) est structurellement faux
-- (personne n'est "responsable du pôle NULL"), d'où ce helper séparé.
create or replace function public.is_any_pole_responsable()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from pole_affectations
    where user_id = auth.uid() and role_pole = 'responsable' and actif = true
  );
$function$;

comment on function public.is_any_pole_responsable() is 'Vrai si le compte appelant est Responsable d''au moins un pôle (peu importe lequel) -- utilisé pour le matériel "Commun" (pole_id null), qui n''appartient à aucun pôle précis mais doit rester gérable par tout Responsable.';

create or replace function public.is_pole_responsable_of_prestation(p_prestation_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select is_pole_responsable(pole_id) from prestations where id = p_prestation_id;
$function$;

comment on function public.is_pole_responsable_of_prestation(uuid) is 'Vrai si le compte appelant est Responsable du pôle auquel appartient CETTE prestation -- pour prestations_equipe (affectation d''équipe), qui n''a pas de pole_id propre.';

-- ── Prestations ──────────────────────────────────────────────────────────
create policy prestations_responsable_pole_all on public.prestations
  for all
  using (is_pole_responsable(pole_id))
  with check (is_pole_responsable(pole_id));

-- ── Clients : écriture (v9 n'avait que la lecture) ──────────────────────
create policy clients_responsable_pole_write on public.clients
  for all
  using (is_pole_responsable(pole_id))
  with check (is_pole_responsable(pole_id));

-- ── Contrats : écriture (v9 n'avait que la lecture) ─────────────────────
create policy contrats_responsable_pole_write on public.contrats
  for all
  using (client_pole_responsable_ok(client_id))
  with check (client_pole_responsable_ok(client_id));

-- ── Devis : jamais couvert ───────────────────────────────────────────────
create policy devis_responsable_pole_all on public.devis
  for all
  using (client_pole_responsable_ok(client_id))
  with check (client_pole_responsable_ok(client_id));

-- ── Factures : jamais couvert ────────────────────────────────────────────
create policy factures_responsable_pole_all on public.factures
  for all
  using (client_pole_responsable_ok(client_id))
  with check (client_pole_responsable_ok(client_id));

-- ── Équipe (affectation collaborateur <-> prestation) : jamais couvert ──
create policy equipe_responsable_pole_all on public.prestations_equipe
  for all
  using (is_pole_responsable_of_prestation(prestation_id))
  with check (is_pole_responsable_of_prestation(prestation_id));

-- ── Kits : jamais couvert (filtré par rôle fonctionnel en amont) ───────
create policy kits_responsable_pole_all on public.kits
  for all
  using (is_pole_responsable(pole_id) or (pole_id is null and is_any_pole_responsable()))
  with check (is_pole_responsable(pole_id) or (pole_id is null and is_any_pole_responsable()));

-- ── Matériels : même trou que kits ──────────────────────────────────────
create policy materiels_responsable_pole_all on public.materiels
  for all
  using (is_pole_responsable(pole_id) or (pole_id is null and is_any_pole_responsable()))
  with check (is_pole_responsable(pole_id) or (pole_id is null and is_any_pole_responsable()));

-- ── Réservations de kit : dérivé du pôle du kit réservé ─────────────────
create policy kit_resa_responsable_pole_all on public.kit_reservations
  for all
  using (
    exists (
      select 1 from kits k
      where k.id = kit_reservations.kit_id
        and (is_pole_responsable(k.pole_id) or (k.pole_id is null and is_any_pole_responsable()))
    )
  )
  with check (
    exists (
      select 1 from kits k
      where k.id = kit_reservations.kit_id
        and (is_pole_responsable(k.pole_id) or (k.pole_id is null and is_any_pole_responsable()))
    )
  );

-- ============================================================================
-- ROLLBACK (documenté, non exécuté) :
--   drop policy prestations_responsable_pole_all on public.prestations;
--   drop policy clients_responsable_pole_write on public.clients;
--   drop policy contrats_responsable_pole_write on public.contrats;
--   drop policy devis_responsable_pole_all on public.devis;
--   drop policy factures_responsable_pole_all on public.factures;
--   drop policy equipe_responsable_pole_all on public.prestations_equipe;
--   drop policy kits_responsable_pole_all on public.kits;
--   drop policy materiels_responsable_pole_all on public.materiels;
--   drop policy kit_resa_responsable_pole_all on public.kit_reservations;
--   drop function public.is_any_pole_responsable();
--   drop function public.is_pole_responsable_of_prestation(uuid);
-- Aucune donnée existante modifiée par cette migration (policies additives
-- uniquement) : aucun rollback de données nécessaire.
-- ============================================================================
