-- ============================================================
-- SPORTVISION PORTAIL — Migration v12
-- Rétractation client : mécanisme de collecte + traitement humain, PAS un
-- moteur de conformité automatique.
--
-- CADRE IMPORTANT — à respecter strictement : cette migration n'implémente
-- AUCUNE logique de qualification juridique automatique (type de client
-- professionnel/consommateur, canal de conclusion du contrat, calcul du
-- délai légal selon le profil...). Le droit de rétractation français
-- (art. L221-18 et s. du Code de la consommation ; obligation récente pour
-- les interfaces en ligne concluant des contrats à distance avec des
-- consommateurs) reste un sujet légal réel qui nécessite une validation par
-- un juriste avant d'être automatisé — même règle de prudence déjà suivie
-- sur ce projet ailleurs (cf. l'en-tête de stripe-webhook/index.ts sur
-- l'avoir Pennylane automatique : documenter l'incertitude plutôt que
-- deviner). Le SportVision OS ne décide donc JAMAIS seul si un client a
-- droit à la rétractation : il se contente de transmettre la demande à un
-- humain (staff), qui accepte ou refuse depuis l'OS, et traite tout
-- remboursement éventuel manuellement ensuite via le flux existant.
--
-- Complète prestations.retractation_renoncee / retractation_renoncee_at
-- (migration-portail-v7.sql, qui trace la renonciation VOLONTAIRE du client
-- au moment de la commande) avec le cas inverse : une demande de
-- rétractation formulée APRÈS coup, depuis l'espace client du Portail.
--
-- Idempotente. À exécuter après migration-portail-v7.sql,
-- migration-portail-v10.sql (notify_staff_by_role) et
-- migration-clubplus-v24-protect-sensitive-fields.sql (référence de style
-- pour le trigger de protection ci-dessous).
-- ============================================================

create table if not exists retractation_demandes (
  id uuid default gen_random_uuid() primary key,
  client_id uuid references clients(id) on delete cascade not null,
  prestation_id uuid references prestations(id) on delete set null,
  devis_id uuid references devis(id) on delete set null,
  motif text,
  demandee_at timestamptz default now(),
  ip text,
  statut text check (statut in ('en_attente','acceptee','refusee')) default 'en_attente',
  traitee_par uuid references profiles(id),
  traitee_at timestamptz,
  note_staff text
);

create index if not exists idx_retractation_client on retractation_demandes(client_id);
create index if not exists idx_retractation_statut on retractation_demandes(statut);

alter table retractation_demandes enable row level security;

-- ─── Trigger de protection ────────────────────────────────────────────────
-- Même style que protect_sensitive_club_fields (migration-clubplus-v24) :
-- statut/traitee_par/traitee_at/note_staff restent réservés au staff, quelle
-- que soit la policy RLS en place. Aucune policy UPDATE n'est accordée au
-- client ci-dessous (RLS bloque donc déjà toute tentative), mais ce trigger
-- est une seconde barrière volontaire — l'historique de `clubs` (policy
-- d'update trop large en v9, corrigée seulement en v24 par ce même type de
-- trigger) montre que compter uniquement sur "il n'y a pas de policy
-- aujourd'hui" est fragile dans la durée.
create or replace function protect_sensitive_retractation_fields()
returns trigger language plpgsql security definer as $$
declare
  is_os_staff boolean;
begin
  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin', 'sec', 'compta')
  ) into is_os_staff;

  if is_os_staff then
    return new;
  end if;

  if new.statut is distinct from old.statut
     or new.traitee_par is distinct from old.traitee_par
     or new.traitee_at is distinct from old.traitee_at
     or new.note_staff is distinct from old.note_staff
  then
    raise exception 'Modification non autorisée : le traitement d''une demande de rétractation est réservé au staff SportVision.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_sensitive_retractation_fields on retractation_demandes;
create trigger trg_protect_sensitive_retractation_fields
  before update on retractation_demandes
  for each row execute function protect_sensitive_retractation_fields();

-- ─── RLS ──────────────────────────────────────────────────────────────────
drop policy if exists "retractation_client_select" on retractation_demandes;
drop policy if exists "retractation_client_insert" on retractation_demandes;
drop policy if exists "retractation_staff_all" on retractation_demandes;

-- Le client voit ses propres demandes ; le staff voit tout.
create policy "retractation_client_select" on retractation_demandes for select using (
  exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = retractation_demandes.client_id)
);

-- Le client ne peut créer une demande que pour lui-même, et si prestation_id
-- / devis_id sont renseignés, ils doivent lui appartenir (même garde que
-- avis_client_insert, migration-portail-v21 — sans ça, un client pourrait
-- rattacher sa demande à la prestation ou au devis d'un AUTRE client, visible
-- ensuite par le staff comme si c'était le sien). statut/traitee_par/
-- traitee_at/note_staff ne sont jamais envoyés par le formulaire du Portail
-- et repartent de toute façon sur leurs valeurs par défaut ('en_attente',
-- null, null, null) — voir aussi le trigger ci-dessus pour toute écriture
-- ultérieure.
create policy "retractation_client_insert" on retractation_demandes for insert with check (
  exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = retractation_demandes.client_id)
  and (
    prestation_id is null
    or exists (select 1 from prestations p where p.id = retractation_demandes.prestation_id and p.client_id = retractation_demandes.client_id)
  )
  and (
    devis_id is null
    or exists (select 1 from devis d where d.id = retractation_demandes.devis_id and d.client_id = retractation_demandes.client_id)
  )
);

-- Le staff (admin, sec, compta) peut tout consulter et traiter.
create policy "retractation_staff_all" on retractation_demandes for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'sec', 'compta'))
) with check (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'sec', 'compta'))
);

-- ─── Notification staff à chaque nouvelle demande (priorité haute) ───────
create or replace function trg_notify_retractation_demande()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nom_client text;
begin
  select nom into v_nom_client from clients where id = new.client_id;
  perform notify_staff_by_role(
    array['admin','sec'],
    'Nouvelle demande de rétractation — ' || coalesce(v_nom_client, 'client'),
    coalesce(nullif(left(new.motif, 140), ''), 'Aucun motif renseigné.') || ' — à examiner sous 48 heures (Documents → Rétractations).',
    'haute',
    new.prestation_id,
    new.client_id
  );
  return new;
end;
$$;

drop trigger if exists trg_retractation_notify on retractation_demandes;
create trigger trg_retractation_notify
  after insert on retractation_demandes
  for each row execute function trg_notify_retractation_demande();
