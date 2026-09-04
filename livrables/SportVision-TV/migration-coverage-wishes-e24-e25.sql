-- Souhait de présence Club+ → CM → Production (04/09/2026, décision produit Fouka, findings E24/E25
-- de l'audit transversal). Modèle verrouillé : EVENT → SOUHAIT DU CLUB → ANALYSE CM → PRÉSENCE
-- RETENUE → ENVOI PRODUCTION → MISSION. Le président ne réserve jamais un opérateur et ne crée
-- jamais de mission.
--
-- Audit préalable (avant toute table) : `planned_presences` représente déjà "une présence décidée
-- par SportVision" (créée par le CM, alimente generate_missions_from_plan) — ne JAMAIS la
-- transformer en souhait club, elle reste exactement ce qu'elle est. `club_requests` est un objet
-- générique "demande client" (ex. "Annonce détection U14") SANS event_id/type de couverture/
-- priorité — l'étendre pour porter la sémantique événementielle du souhait aurait mélangé deux
-- concepts métier différents (fourre-tout explicitement proscrit). Aucun objet existant ne
-- représente "un club signale un événement précis à SportVision, pas encore décidé" → nouvelle
-- table minimale `coverage_wishes`, exactement le rôle qui manquait.
--
-- Réutilisation maximale du reste : le passage SELECTED crée une ligne `planned_presences`
-- classique (même mécanisme que creerPresence() dans l'OS, même monthly_production_plans par CM/
-- mois) — "présence retenue" reste UN SEUL objet, jamais dupliqué entre souhait et présence.
-- "Envoi à Production" reste `generate_missions_from_plan()`, déjà construit et déjà testé cette
-- session (scénario E) — aucune nouvelle route Production nécessaire. Gating par entitlement :
-- réutilise `organization_entitlements` (module_key='presences', déjà accordé automatiquement aux
-- clubs Full Communication par grant_entitlements_full_communication(), organization_id = clubs.id
-- via sync_club_to_organization) — zéro hard-code par club/offre.

-- Posée avant coverage_wishes/cm_select_coverage_wish : additif, jamais destructif — défaut
-- 'cm_initiated' pour tout l'existant et tout ce que le CM crée lui-même via creerPresence() sans
-- changement de code côté OS (comportement historique inchangé), 'club_request' posé explicitement
-- par cm_select_coverage_wish() plus bas.
alter table planned_presences add column if not exists source text not null default 'cm_initiated'
  check (source in ('club_request', 'cm_initiated', 'sportvision_internal'));

create table coverage_wishes (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  match_id uuid references club_matches(id) on delete cascade,
  calendar_event_id uuid references club_calendar_events(id) on delete cascade,
  requested_by_user_id uuid not null references auth.users(id),
  source text not null default 'club_request' check (source in ('club_request', 'cm_initiated', 'sportvision_internal')),
  requested_coverage_type text not null check (requested_coverage_type in ('photo', 'video', 'photo_video', 'interview', 'autre')),
  priority text not null default 'normale' check (priority in ('forte', 'normale', 'optionnelle')),
  note text,
  status text not null default 'wished' check (status in ('wished', 'reviewing', 'selected', 'not_selected', 'sent_to_production', 'production_confirmed', 'completed', 'cancelled')),
  not_selected_reason text,
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  planned_presence_id uuid references planned_presences(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coverage_wishes_one_event check (
    (match_id is not null and calendar_event_id is null) or (match_id is null and calendar_event_id is not null)
  )
);

comment on table coverage_wishes is 'EVENT ≠ SOUHAIT ≠ PRÉSENCE RETENUE (planned_presences) ≠ MISSION. Le club signale un event existant (jamais de recopie date/lieu/adversaire, tout vient de club_matches/club_calendar_events). status=selected crée une ligne planned_presences (via cm_select_coverage_wish) ; "sent_to_production" est propagé automatiquement quand cette planned_presences passe à mission_creee (generate_missions_from_plan, déjà existant) — jamais une 2e écriture manuelle de ce statut.';

create index idx_coverage_wishes_club on coverage_wishes(club_id);
create index idx_coverage_wishes_match on coverage_wishes(match_id) where match_id is not null;
create index idx_coverage_wishes_calendar on coverage_wishes(calendar_event_id) where calendar_event_id is not null;

-- Idempotence bulk (§30/31) : un souhait actif au plus par (club, event) — un double-clic sur 5
-- événements ne peut jamais créer 10 lignes.
create unique index coverage_wishes_unique_active_match on coverage_wishes(club_id, match_id) where status <> 'cancelled' and match_id is not null;
create unique index coverage_wishes_unique_active_calendar on coverage_wishes(club_id, calendar_event_id) where status <> 'cancelled' and calendar_event_id is not null;

create or replace function coverage_wishes_touch_updated_at()
returns trigger language plpgsql as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;
create trigger trg_coverage_wishes_updated_at before update on coverage_wishes
  for each row execute function coverage_wishes_touch_updated_at();

-- Une fois décidé (selected/not_selected et au-delà), le club ne peut plus modifier silencieusement
-- type/priorité/note en écrasant la décision CM (§32) — seuls wished/reviewing restent modifiables
-- côté club ; le service_role (nos RPC ci-dessous) reste toujours exempté.
create or replace function protect_coverage_wish_after_review()
returns trigger language plpgsql as $function$
begin
  if auth.role() = 'service_role' then return new; end if;
  if old.status not in ('wished', 'reviewing') and (
    new.requested_coverage_type is distinct from old.requested_coverage_type
    or new.priority is distinct from old.priority
    or new.note is distinct from old.note
  ) then
    raise exception 'Ce souhait a déjà été traité par SportVision — contactez votre CM pour toute modification.';
  end if;
  return new;
end;
$function$;
create trigger trg_protect_coverage_wish_after_review before update on coverage_wishes
  for each row execute function protect_coverage_wish_after_review();

alter table coverage_wishes enable row level security;

-- Lecture club : les membres du club concerné voient leurs propres souhaits (même patron que
-- club_presences/club_bookings).
create policy "cw_club_select" on coverage_wishes for select using (is_club_member(club_id));

-- Création club (§2) : uniquement admin/président/comm/directeur sportif d'un club ACTIF sur CE
-- club précis — jamais un coach par défaut. Entitlement vérifié ici (pas de hard-code par offre).
create policy "cw_club_insert" on coverage_wishes for insert with check (
  source = 'club_request'
  and exists (
    select 1 from club_members cm
    where cm.club_id = coverage_wishes.club_id and cm.user_id = auth.uid() and cm.status = 'actif'
      and cm.role in ('admin', 'president', 'comm', 'directeur_sportif')
  )
  and exists (
    select 1 from organization_entitlements oe
    where oe.organization_id = coverage_wishes.club_id and oe.module_key = 'presences' and oe.actif = true
      and (oe.expires_at is null or oe.expires_at > now())
  )
);

-- Modification club (§32) : mêmes rôles, bloquée après décision par le trigger ci-dessus.
create policy "cw_club_update" on coverage_wishes for update using (
  exists (
    select 1 from club_members cm
    where cm.club_id = coverage_wishes.club_id and cm.user_id = auth.uid() and cm.status = 'actif'
      and cm.role in ('admin', 'president', 'comm', 'directeur_sportif')
  )
);

-- Traitement CM (§42) : le CM affilié au client du club (contenus_visible_par_cm, déjà utilisée
-- pour clubs_cm_select) ou lead/responsable ou admin peuvent lire et faire évoluer le statut —
-- jamais un CM d'un autre club.
create policy "cw_cm_all" on coverage_wishes for all using (
  exists (
    select 1 from clubs c
    where c.id = coverage_wishes.club_id and c.portail_client_id is not null and (
      contenus_visible_par_cm(c.portail_client_id, auth.uid())
      or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
    )
  )
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
) with check (
  exists (
    select 1 from clubs c
    where c.id = coverage_wishes.club_id and c.portail_client_id is not null and (
      contenus_visible_par_cm(c.portail_client_id, auth.uid())
      or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
    )
  )
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- RP (§26/42) : ne voit RIEN tant que le souhait n'est pas envoyé à Production — même en lecture.
-- Une fois sent_to_production/production_confirmed/completed, visible pour contexte (club/équipe/
-- date), jamais avant.
create policy "cw_prod_select" on coverage_wishes for select using (
  status in ('sent_to_production', 'production_confirmed', 'completed')
  and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'prod')
);

-- ── RPC : création (E24 unitaire = E25 bulk avec 1 élément, même route) ────────────────────────
create or replace function create_coverage_wishes(p_club_id uuid, p_items jsonb)
returns setof coverage_wishes
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item jsonb;
  v_match_id uuid;
  v_calendar_id uuid;
  v_row coverage_wishes;
  v_client_id uuid;
  v_cm_id uuid;
  v_label text;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;
  if not exists (
    select 1 from club_members cm
    where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'actif'
      and cm.role in ('admin', 'president', 'comm', 'directeur_sportif')
  ) then
    raise exception 'Non autorisé à signaler une présence souhaitée pour ce club.';
  end if;
  if not exists (
    select 1 from organization_entitlements oe
    where oe.organization_id = p_club_id and oe.module_key = 'presences' and oe.actif = true
      and (oe.expires_at is null or oe.expires_at > now())
  ) then
    raise exception 'Cette fonctionnalité n''est pas incluse dans votre offre actuelle.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_match_id := nullif(v_item->>'match_id', '')::uuid;
    v_calendar_id := nullif(v_item->>'calendar_event_id', '')::uuid;
    if (v_match_id is null) = (v_calendar_id is null) then
      raise exception 'Chaque souhait doit référencer exactement un événement (match ou calendrier).';
    end if;
    if v_match_id is not null and not exists (select 1 from club_matches where id = v_match_id and club_id = p_club_id) then
      raise exception 'Événement introuvable pour ce club.';
    end if;
    if v_calendar_id is not null and not exists (select 1 from club_calendar_events where id = v_calendar_id and club_id = p_club_id) then
      raise exception 'Événement introuvable pour ce club.';
    end if;

    -- ON CONFLICT ne peut cibler qu'UN arbitre par insert, et match_id/calendar_event_id
    -- s'excluent mutuellement (contrainte coverage_wishes_one_event) — deux branches distinctes,
    -- chacune avec l'index partiel qui la concerne réellement, plutôt qu'un double essai qui
    -- risquerait de créer une 2e ligne (exactement ce que §30/31 interdit).
    if v_match_id is not null then
      insert into coverage_wishes (club_id, match_id, calendar_event_id, requested_by_user_id, requested_coverage_type, priority, note)
      values (
        p_club_id, v_match_id, null, auth.uid(),
        coalesce(nullif(v_item->>'coverage_type', ''), 'photo_video'),
        coalesce(nullif(v_item->>'priority', ''), 'normale'),
        nullif(v_item->>'note', '')
      )
      on conflict (club_id, match_id) where status <> 'cancelled' and match_id is not null
      do update set updated_at = now()
      returning * into v_row;
    else
      insert into coverage_wishes (club_id, match_id, calendar_event_id, requested_by_user_id, requested_coverage_type, priority, note)
      values (
        p_club_id, null, v_calendar_id, auth.uid(),
        coalesce(nullif(v_item->>'coverage_type', ''), 'photo_video'),
        coalesce(nullif(v_item->>'priority', ''), 'normale'),
        nullif(v_item->>'note', '')
      )
      on conflict (club_id, calendar_event_id) where status <> 'cancelled' and calendar_event_id is not null
      do update set updated_at = now()
      returning * into v_row;
    end if;

    insert into audit_logs (acteur_id, action, cible_type, cible_id, details)
    values ((select id from profiles where id = auth.uid()), 'coverage_wish_created', 'coverage_wish', v_row.id, jsonb_build_object('club_id', p_club_id, 'acteur_reel', auth.uid()));

    return next v_row;
  end loop;

  -- Notification groupée (§17 : une notification utile, pas une par événement) au CM principal, ou
  -- fallback Admin/Responsable CM si aucun CM principal n'est affecté (§16 : la demande n'est
  -- jamais perdue).
  select portail_client_id into v_client_id from clubs where id = p_club_id;
  if v_client_id is not null then
    select cm_id, nom into v_cm_id, v_label from clients where id = v_client_id;
  end if;
  select c.nom into v_label from clubs c where c.id = p_club_id;
  if v_cm_id is not null then
    insert into notifications (type, titre, message, destinataire_id, lue, priorite, lien_client_id)
    values ('systeme', 'Nouveau souhait de présence', v_label || ' a signalé une présence SportVision souhaitée.', v_cm_id, false, 'normale', v_client_id);
  else
    perform notify_staff_by_role(array['admin'], 'Souhait de présence sans CM principal', v_label || ' a signalé une présence souhaitée, mais aucun CM principal n''est affecté à ce club.', 'haute', null, v_client_id);
  end if;
end;
$function$;

revoke all on function create_coverage_wishes(uuid, jsonb) from public;
grant execute on function create_coverage_wishes(uuid, jsonb) to authenticated;

-- ── RPC : le CM retient un souhait → crée la présence retenue (planned_presences), jamais de mission ──
create or replace function cm_select_coverage_wish(p_wish_id uuid)
returns coverage_wishes
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_wish coverage_wishes;
  v_client_id uuid;
  -- monthly_production_plans.mois est de type `date` (1er du mois), pas un texte "YYYY-MM" —
  -- trouvé en testant (pas en relisant le schéma) : to_char() produisait un text incomparable.
  v_mois date;
  v_plan monthly_production_plans;
  v_equipe text; v_adversaire text; v_lieu text; v_date date; v_heure time;
  v_presence planned_presences;
begin
  select * into v_wish from coverage_wishes where id = p_wish_id;
  if v_wish.id is null then raise exception 'Souhait introuvable.'; end if;
  if v_wish.status not in ('wished', 'reviewing') then raise exception 'Ce souhait a déjà été traité.'; end if;

  select portail_client_id into v_client_id from clubs where id = v_wish.club_id;
  if v_client_id is null then raise exception 'Club sans fiche client — action impossible.'; end if;

  if v_wish.match_id is not null then
    select team, opponent, lieu, match_date into v_equipe, v_adversaire, v_lieu, v_date from club_matches where id = v_wish.match_id;
  else
    select team, null, location, event_date, event_time into v_equipe, v_adversaire, v_lieu, v_date, v_heure from club_calendar_events where id = v_wish.calendar_event_id;
  end if;

  v_mois := date_trunc('month', coalesce(v_date, current_date))::date;
  select * into v_plan from monthly_production_plans where client_id = v_client_id and mois = v_mois and cm_id = auth.uid();
  if v_plan.id is null then
    insert into monthly_production_plans (client_id, cm_id, mois) values (v_client_id, auth.uid(), v_mois)
    on conflict (client_id, mois) do update set mois = excluded.mois
    returning * into v_plan;
  end if;

  insert into planned_presences (plan_id, equipe, date_presence, heure_debut, lieu, adversaire, type_couverture, statut, match_id, calendar_event_id, source)
  values (
    v_plan.id, v_equipe, coalesce(v_date, current_date), v_heure, v_lieu, v_adversaire,
    case v_wish.requested_coverage_type when 'interview' then 'photo_video' when 'autre' then 'photo_video' else v_wish.requested_coverage_type end,
    'prevu', v_wish.match_id, v_wish.calendar_event_id, 'club_request'
  )
  returning * into v_presence;

  update coverage_wishes set status = 'selected', reviewed_by = auth.uid(), reviewed_at = now(), planned_presence_id = v_presence.id
  where id = p_wish_id returning * into v_wish;

  insert into audit_logs (acteur_id, action, cible_type, cible_id, details)
  values ((select id from profiles where id = auth.uid()), 'coverage_wish_selected', 'coverage_wish', p_wish_id, jsonb_build_object('planned_presence_id', v_presence.id, 'acteur_reel', auth.uid()));

  return v_wish;
end;
$function$;

revoke all on function cm_select_coverage_wish(uuid) from public;
grant execute on function cm_select_coverage_wish(uuid) to authenticated;

create or replace function cm_reject_coverage_wish(p_wish_id uuid, p_reason text default null)
returns coverage_wishes
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_wish coverage_wishes;
begin
  select * into v_wish from coverage_wishes where id = p_wish_id;
  if v_wish.id is null then raise exception 'Souhait introuvable.'; end if;
  if v_wish.status not in ('wished', 'reviewing') then raise exception 'Ce souhait a déjà été traité.'; end if;

  update coverage_wishes set status = 'not_selected', not_selected_reason = p_reason, reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_wish_id returning * into v_wish;

  insert into audit_logs (acteur_id, action, cible_type, cible_id, details)
  values ((select id from profiles where id = auth.uid()), 'coverage_wish_not_selected', 'coverage_wish', p_wish_id, jsonb_build_object('reason', p_reason, 'acteur_reel', auth.uid()));

  return v_wish;
end;
$function$;

revoke all on function cm_reject_coverage_wish(uuid, text) from public;
grant execute on function cm_reject_coverage_wish(uuid, text) to authenticated;

-- ── Annulation côté club (§33/34) : jamais de suppression physique, jamais une mission supprimée
-- silencieusement — seulement une alerte quand une décision existait déjà.
create or replace function cancel_coverage_wish(p_wish_id uuid)
returns coverage_wishes
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_wish coverage_wishes;
  v_client_id uuid;
begin
  select * into v_wish from coverage_wishes where id = p_wish_id;
  if v_wish.id is null then raise exception 'Souhait introuvable.'; end if;
  if not exists (
    select 1 from club_members cm
    where cm.club_id = v_wish.club_id and cm.user_id = auth.uid() and cm.status = 'actif'
      and cm.role in ('admin', 'president', 'comm', 'directeur_sportif')
  ) then
    raise exception 'Non autorisé.';
  end if;
  if v_wish.status in ('completed', 'cancelled') then raise exception 'Ce souhait ne peut plus être annulé.'; end if;

  select portail_client_id into v_client_id from clubs where id = v_wish.club_id;

  if v_wish.status = 'selected' and v_wish.planned_presence_id is not null then
    update planned_presences set statut = 'annule' where id = v_wish.planned_presence_id and statut = 'prevu';
    if exists (select 1 from clients where id = v_client_id and cm_id is not null) then
      insert into notifications (type, titre, message, destinataire_id, lue, priorite, lien_client_id)
      select 'systeme', 'Souhait de présence annulé par le club', 'Une présence que vous aviez retenue a été annulée par le club.', cm_id, false, 'normale', v_client_id
      from clients where id = v_client_id;
    end if;
  elsif v_wish.status in ('sent_to_production', 'production_confirmed') then
    if exists (select 1 from clients where id = v_client_id and cm_id is not null) then
      insert into notifications (type, titre, message, destinataire_id, lue, priorite, lien_client_id)
      select 'systeme', 'Souhait de présence annulé — déjà envoyé Production', 'Le club a annulé un souhait déjà transmis à la Production. Vérifiez la mission associée.', cm_id, false, 'haute', v_client_id
      from clients where id = v_client_id;
    end if;
    perform notify_staff_by_role(array['prod'], 'Souhait de présence annulé — vérifier la mission', 'Un club a annulé un souhait déjà envoyé à Production.', 'haute', null, v_client_id);
  end if;

  update coverage_wishes set status = 'cancelled' where id = p_wish_id returning * into v_wish;

  insert into audit_logs (acteur_id, action, cible_type, cible_id, details)
  values ((select id from profiles where id = auth.uid()), 'coverage_wish_cancelled', 'coverage_wish', p_wish_id, jsonb_build_object('acteur_reel', auth.uid()));

  return v_wish;
end;
$function$;

revoke all on function cancel_coverage_wish(uuid) from public;
grant execute on function cancel_coverage_wish(uuid) to authenticated;

-- ── Propagation automatique "envoyé à Production" (§25/26) : generate_missions_from_plan() (déjà
-- existant, déjà testé cette session) fait passer planned_presences.statut à 'mission_creee' — ce
-- trigger propage l'info au souhait lié sans jamais dupliquer l'écriture "envoi production" côté
-- coverage_wishes. Le RP continue de ne recevoir QUE ce qui a été réellement envoyé (cw_prod_select).
create or replace function propagate_presence_sent_to_production()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.statut = 'mission_creee' and old.statut is distinct from 'mission_creee' then
    update coverage_wishes set status = 'sent_to_production' where planned_presence_id = new.id and status = 'selected';
  end if;
  return new;
end;
$function$;
create trigger trg_propagate_presence_sent_to_production after update on planned_presences
  for each row execute function propagate_presence_sent_to_production();
