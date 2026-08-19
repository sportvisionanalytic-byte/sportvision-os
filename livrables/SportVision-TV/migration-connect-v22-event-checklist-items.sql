-- ============================================================
-- SPORTVISION CONNECT — Migration v22 : table `event_checklist_items` —
-- checklist en 3 phases (avant / jour J / après) pour une organisation
-- `event` (tournoi Full Communication). Plan Tier C § Phase 4 « Eventtimeline
-- / Live ».
--
-- ── Contexte ─────────────────────────────────────────────────────────────
-- `/eventtimeline` (app-next) affiche depuis sa création une timeline 3
-- phases figée en mock (eventPhasesByEventOrg, lib/mock/events.ts, 12 items
-- de référence : 4 par phase). migration-connect-v20 a posé le type
-- d'organisation `event` mais rien côté base ne permet de suivre la
-- progression réelle d'un événement — cette migration comble ce trou.
--
-- ── Modèle ────────────────────────────────────────────────────────────────
-- Une ligne = un item de checklist pour une organisation event donnée.
-- `phase` reprend les 3 phases du design (avant/jour_j/apres). Pas de
-- colonne `ordre` : les 12 items de référence sont insérés dans l'ordre
-- voulu par seed_event_checklist() ci-dessous et triés par `created_at` à
-- la lecture — largement suffisant pour une checklist de 4 items par phase,
-- pas besoin d'une colonne de tri dédiée pour ce volume.
--
-- ── Pas de seed automatique ──────────────────────────────────────────────
-- Contrairement à organization_role_catalog (peuplé une fois pour toutes
-- les organisations d'un type), une checklist est un état PAR événement :
-- aucune ligne n'est insérée automatiquement quand une organisation `event`
-- est créée (connect-staff-create-org/connect-org-activate ne touchent pas
-- cette table). Le staff clique explicitement "Générer la checklist
-- standard" (RPC seed_event_checklist ci-dessous, exposée côté OS) une fois
-- l'espace activé — une organisation event fraîchement créée a donc
-- légitimement ZÉRO ligne ici, ce n'est pas une erreur à corriger.
--
-- ── RLS ───────────────────────────────────────────────────────────────────
-- Lecture : membre actif de l'organisation event concernée (is_org_member,
-- migration-connect-v2) ou n'importe quel compte staff (is_staff(), même
-- fonction) — même patron exact que cal_member_select sur calendar_events
-- (migration-connect-v3-coach-academie-requests.sql:65).
-- Écriture (insert/update/delete, donc cocher/décocher) : réservée aux
-- rôles admin/sec/com (même garde que coat_staff_all sur
-- connect_org_activation_tokens, migration-connect-v20) — le client event
-- reste strictement lecture seule, cohérent avec sessions/camps (Phase 1) :
-- le staff planifie/pilote, le client consulte.
--
-- ── Seed : RPC plutôt que 12 boutons ────────────────────────────────────
-- seed_event_checklist(p_organization_id) : function SQL ordinaire (PAS
-- security definer) — l'insert qu'elle exécute passe donc par la RLS de la
-- table comme n'importe quel insert direct, réservée à admin/sec/com par
-- "eci_staff_write" ci-dessous. Pas de vérification de rôle dupliquée dans
-- la fonction : la RLS est le seul gardien, une seule source de vérité.
-- Idempotente : si des lignes existent déjà pour cette organisation, la
-- fonction ne réinsère rien et renvoie simplement les lignes existantes
-- (permet de recliquer le bouton "Générer" sans dupliquer).
--
-- Additive, idempotente (create table if not exists, drop policy/trigger
-- if exists avant chaque create). À exécuter après
-- migration-connect-v2-organizations-entitlements.sql (is_org_member,
-- is_staff) et migration-connect-v20-event-cm-agency-org-types.sql (type
-- 'event').
--
-- EXÉCUTÉE — vérifié en base réelle le 19/08/2026 (audit pré-lancement) :
-- table event_checklist_items, fonctions set_event_checklist_fait/
-- seed_event_checklist et policies eci_select/eci_staff_write existent
-- déjà en base. Cet en-tête disait à tort "NON EXÉCUTÉE".
-- ============================================================

-- ─── 1. Table ────────────────────────────────────────────────────────────
create table if not exists event_checklist_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade not null,
  phase text not null check (phase in ('avant','jour_j','apres')),
  label text not null,
  fait boolean not null default false,
  fait_le timestamptz,
  fait_par uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_event_checklist_items_org on event_checklist_items(organization_id);

alter table event_checklist_items enable row level security;

-- ─── 2. Trigger : fait_le/fait_par posés côté serveur, jamais confiés au
-- payload client (même raisonnement que set_contenu_stats_saisi,
-- migration-cm-contenu-stats.sql) — évite qu'un membre staff attribue une
-- coche à quelqu'un d'autre ou falsifie la date. Se déclenche uniquement au
-- passage false→true (pose fait_le/fait_par) ou true→false (les efface :
-- une case décochée n'a plus de date/auteur de complétion). L'insert
-- initial (seed) n'est pas concerné : fait vaut toujours false à la
-- création, ces colonnes restent null jusqu'à la première coche. ──────────
create or replace function set_event_checklist_fait()
returns trigger language plpgsql as $$
begin
  if new.fait and (old.fait is distinct from true) then
    new.fait_le = now();
    new.fait_par = auth.uid();
  elsif not new.fait then
    new.fait_le = null;
    new.fait_par = null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_event_checklist_fait on event_checklist_items;
create trigger trg_event_checklist_fait
  before update on event_checklist_items
  for each row execute function set_event_checklist_fait();

-- ─── 3. Policies ─────────────────────────────────────────────────────────
drop policy if exists "eci_select" on event_checklist_items;
create policy "eci_select" on event_checklist_items for select using (
  is_org_member(organization_id) or is_staff()
);

drop policy if exists "eci_staff_write" on event_checklist_items;
create policy "eci_staff_write" on event_checklist_items for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','com'))
) with check (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','com'))
);

-- ─── 4. Seed des 12 items de référence (4 par phase) ────────────────────
-- Contenu repris tel quel du mock d'origine (eventPhasesByEventOrg,
-- lib/mock/events.ts) — même libellés, aucune réinvention.
create or replace function seed_event_checklist(p_organization_id uuid)
returns setof event_checklist_items
language plpgsql as $$
begin
  if exists (select 1 from event_checklist_items where organization_id = p_organization_id) then
    return query select * from event_checklist_items where organization_id = p_organization_id order by created_at asc;
    return;
  end if;

  return query insert into event_checklist_items (organization_id, phase, label) values
    (p_organization_id, 'avant', 'Teasing'),
    (p_organization_id, 'avant', 'Présentation des équipes'),
    (p_organization_id, 'avant', 'Mise en avant des sponsors'),
    (p_organization_id, 'avant', 'Informations pratiques'),
    (p_organization_id, 'jour_j', 'Stories en direct'),
    (p_organization_id, 'jour_j', 'Résultats en temps réel'),
    (p_organization_id, 'jour_j', 'Photos d''action'),
    (p_organization_id, 'jour_j', 'Clips et temps forts'),
    (p_organization_id, 'apres', 'Galerie complète'),
    (p_organization_id, 'apres', 'Aftermovie'),
    (p_organization_id, 'apres', 'Remerciements partenaires'),
    (p_organization_id, 'apres', 'Rapport')
  returning *;
end;
$$;

-- ============================================================
-- NOTE — ce qui reste hors périmètre de cette migration
--
-- Pas de colonne "date de l'événement" sur event_checklist_items ni sur
-- organizations : le mock d'origine affichait un dateLabel par phase
-- ("Jusqu'au 25 août 2026", etc.), entièrement inventé — aucune colonne
-- réelle n'existe pour ça aujourd'hui (ni sur `organizations`, ni sur
-- `clients`). app-next affiche à la place un compteur réel "N/4 faites" par
-- phase (calculé depuis fait), jamais une date fabriquée. À ajouter
-- séparément si un vrai besoin de dater l'événement émerge (hors scope
-- Phase 4).
-- ============================================================
