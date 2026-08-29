-- ============================================================================
-- Pont "Prestation Club+" — réservation (club_bookings) → mission réelle (prestations)
-- ============================================================================
-- Décision produit tranchée (audit final 29/08/2026, action humaine §10.3,
-- Fouka a délégué la décision) : jusqu'ici club_bookings et prestations/
-- prestations_equipe (Production) étaient deux systèmes totalement disjoints.
-- Les statuts operateur_affecte/mission_realisee/livree de club_bookings
-- existaient dans la contrainte CHECK et l'UI (CBK_STEPS) mais ne
-- correspondaient à rien d'opérationnel — aucun code ne créait jamais de
-- prestations depuis une réservation Club+, et le rôle prod n'a même pas
-- de route vers l'écran "Réservations clubs".
--
-- Choix de conception (mêmes conventions déjà en place dans le projet) :
--   - Modelé sur generate_missions_from_plan() (pont Full Com déjà en prod,
--     planned_presences → prestations) : même schéma "colonne de liaison +
--     RPC SECURITY DEFINER explicite déclenchée par une action staff",
--     pas un trigger automatique magique sur un changement de statut.
--   - Déclencheur : action staff explicite "Envoyer en Production" quand la
--     réservation est déjà au statut 'confirmee' (le sens du mot est déjà
--     exactement le bon : le club a confirmé, prêt pour la Production) —
--     pas un nouveau statut inventé.
--   - À partir de la liaison, club_bookings.status n'est plus modifié à la
--     main par le staff pour operateur_affecte/mission_realisee/livree :
--     un trigger de synchronisation (même pattern que sync_clients_statut
--     déjà utilisé ailleurs dans ce schéma) répercute automatiquement la
--     progression réelle de prestations.statut, pour que ces libellés
--     redeviennent vrais au lieu d'être de simples clics manuels.
--   - Le pont exige que clubs.portail_client_id soit déjà renseigné (lien
--     déjà posé par clubplus-onboarding) : sans client Portail associé, la
--     RPC refuse explicitement plutôt que de créer une prestation orpheline
--     sans client_id.
-- ============================================================================

-- 1. Colonne de liaison, nullable, non destructive.
alter table public.club_bookings
  add column if not exists prestation_id uuid references public.prestations(id) on delete set null;

create index if not exists idx_club_bookings_prestation_id on public.club_bookings(prestation_id) where prestation_id is not null;

-- 2. RPC explicite, appelée par le staff (admin/com/sec — mêmes rôles que
-- cbk_staff_update) depuis le bouton "Envoyer en Production" de la modale
-- Réservation club, uniquement visible quand status='confirmee' et
-- prestation_id IS NULL.
create or replace function public.club_booking_send_to_production(p_booking_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_booking club_bookings%rowtype;
  v_club_client_id uuid;
  v_type_prestation text;
  v_heure time;
  v_prestation_id uuid;
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and role = any(array['admin','com','sec'])
  ) then
    raise exception 'Accès réservé au staff (admin/commercial/secrétariat).';
  end if;

  select * into v_booking from club_bookings where id = p_booking_id;
  if not found then
    raise exception 'Réservation introuvable.';
  end if;
  if v_booking.status <> 'confirmee' then
    raise exception 'Cette réservation doit être au statut "Confirmée" avant d''être envoyée en Production.';
  end if;
  if v_booking.prestation_id is not null then
    -- Idempotent : déjà envoyée (double-clic, ou deux membres du staff en
    -- parallèle) — renvoie la prestation existante plutôt que d'échouer ou
    -- d'en créer une seconde.
    return v_booking.prestation_id;
  end if;

  select portail_client_id into v_club_client_id from clubs where id = v_booking.club_id;
  if v_club_client_id is null then
    raise exception 'Ce club n''a pas encore de fiche client Portail associée (clubs.portail_client_id manquant) — impossible de créer la prestation sans client. Vérifiez le rattachement du club côté Documents/Portail avant de réessayer.';
  end if;

  -- Mapping best-effort du libellé de service vers le domaine fixe de
  -- type_prestation déjà utilisé partout ailleurs dans l'OS (même liste que
  -- OFFRE_SLUG_TO_TYPE_PRESTATION côté create-guest-request) — reste sur
  -- 'autre' si aucune correspondance évidente, jamais une valeur inventée.
  v_type_prestation := case
    when v_booking.service_label ilike '%match%' then 'match'
    when v_booking.service_label ilike '%tournoi%' then 'tournoi'
    when v_booking.service_label ilike '%entraînement%' or v_booking.service_label ilike '%entrainement%' or v_booking.service_label ilike '%stage%' then 'entraînement'
    when v_booking.service_label ilike '%portrait%' or v_booking.service_label ilike '%shooting%' then 'portrait'
    when v_booking.service_label ilike '%événement%' or v_booking.service_label ilike '%evenement%' then 'événement'
    else 'autre'
  end;

  -- club_bookings.heure est un text libre (pas garanti au format HH:MM) —
  -- conversion best-effort, jamais bloquante : une valeur non parsable laisse
  -- heure_debut à NULL plutôt que de faire échouer tout l'envoi en Production.
  begin
    v_heure := v_booking.heure::time;
  exception when others then
    v_heure := null;
  end;

  insert into prestations (
    client_id, date_prestation, heure_debut, lieu, adresse_complete, equipes,
    type_prestation, statut, source, notes_internes
  ) values (
    v_club_client_id, v_booking.event_date, v_heure, v_booking.adresse, v_booking.adresse, v_booking.team,
    v_type_prestation, 'confirmée', 'clubplus',
    'Générée automatiquement depuis une réservation Club+ (' || v_booking.service_label || ', réservation ' || v_booking.id || ').'
      || case when v_booking.objectif is not null then E'\nObjectif : ' || v_booking.objectif else '' end
  )
  returning id into v_prestation_id;

  update club_bookings set prestation_id = v_prestation_id where id = p_booking_id;

  return v_prestation_id;
end;
$function$;

revoke all on function public.club_booking_send_to_production(uuid) from public;
grant execute on function public.club_booking_send_to_production(uuid) to authenticated;

-- 3. Synchronisation retour prestations.statut → club_bookings.status, pour
-- que operateur_affecte/mission_realisee/livree redeviennent des libellés
-- réels au lieu de rester de simples clics manuels une fois la réservation
-- liée à une vraie prestation. Ne régresse jamais un statut déjà avancé
-- (ex: repasser une prestation en amont par erreur ne fait pas reculer une
-- réservation déjà marquée livrée) — mapping strictement croissant selon
-- l'ordre réel de statut_prestation.
create or replace function public.sync_club_booking_status_from_prestation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_mapped text;
  v_rank_new int;
  v_rank_current int;
  v_rank_map jsonb := '{"recue":0,"qualifiee":1,"confirmee":2,"operateur_affecte":3,"mission_realisee":4,"livree":5,"annulee":6}'::jsonb;
begin
  if new.statut is distinct from old.statut then
    v_mapped := case new.statut::text
      when 'équipe_affectée' then 'operateur_affecte'
      when 'prête' then 'operateur_affecte'
      when 'équipe_en_route' then 'operateur_affecte'
      when 'arrivée_sur_place' then 'operateur_affecte'
      when 'production_démarrée' then 'operateur_affecte'
      when 'production_terminée' then 'mission_realisee'
      when 'médias_à_transférer' then 'mission_realisee'
      when 'médias_complets' then 'mission_realisee'
      when 'à_monter' then 'mission_realisee'
      when 'montage_en_cours' then 'mission_realisee'
      when 'prêt_validation' then 'mission_realisee'
      when 'à_valider_client' then 'mission_realisee'
      when 'prête_à_livrer' then 'mission_realisee'
      when 'livrée' then 'livree'
      when 'facturée' then 'livree'
      when 'partiellement_payée' then 'livree'
      when 'payée' then 'livree'
      when 'clôturée' then 'livree'
      when 'annulée' then 'annulee'
      when 'refusée' then 'annulee'
      else null
    end;

    if v_mapped is not null then
      update club_bookings cb
      set status = v_mapped, updated_at = now()
      where cb.prestation_id = new.id
        and coalesce((v_rank_map->>cb.status)::int, -1) < (v_rank_map->>v_mapped)::int;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_sync_club_booking_status on public.prestations;
create trigger trg_sync_club_booking_status
  after update of statut on public.prestations
  for each row
  execute function public.sync_club_booking_status_from_prestation();
