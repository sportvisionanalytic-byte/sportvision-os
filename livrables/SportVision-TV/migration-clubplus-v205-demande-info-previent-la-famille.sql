-- v205 — « Demander un complément » prévient réellement la famille (12/09/2026).
--
-- CE QUI N'ALLAIT PAS. Sur une demande d'adhésion, le club dispose d'un bouton « Envoyer la
-- demande d'info », et l'écran répond « Demande d'info envoyée ». `request_membership_info` se
-- contentait d'insérer une ligne dans `membership_request_events`. Et un `grep` sur tout le dépôt
-- ne trouve AUCUN lecteur de cette table : la note (« il manque l'autorisation parentale signée »)
-- n'était relue nulle part, ni par le club, ni par la famille, ni par le CM.
--
-- Le président demandait le certificat médical manquant, l'écran confirmait, il attendait. La
-- famille n'avait jamais rien reçu, et au rechargement la demande était exactement dans l'état
-- d'avant.
--
-- CE QUE FAIT CETTE MIGRATION. La note part à celui qui a fait la demande, en notification
-- Connect, avec le texte du club. La trace dans `membership_request_events` est conservée : elle
-- devient l'historique, plus le seul effet.
-- Idempotente.

create or replace function public.request_membership_info(p_request_id uuid, p_note text default null)
returns membership_requests
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_req membership_requests;
  v_club text;
begin
  select * into v_req from membership_requests where id = p_request_id;
  if v_req.id is null then raise exception 'Demande introuvable'; end if;
  if v_req.statut in ('validee', 'refusee') then raise exception 'Cette demande a déjà été traitée'; end if;
  if not (
    (v_req.team_id is not null and is_team_educateur(v_req.team_id))
    or is_club_admin(v_req.club_id)
  ) then
    raise exception 'Non autorisé';
  end if;
  if p_note is null or trim(p_note) = '' then
    raise exception 'Précisez ce qui manque avant d''envoyer la demande.';
  end if;

  insert into membership_request_events (request_id, event_type, acted_by, note)
  values (p_request_id, 'info_demandee', auth.uid(), p_note);

  -- La note arrive chez celui qui a fait la demande.
  select nom into v_club from clubs where id = v_req.club_id;
  if v_req.requested_by_user_id is not null then
    insert into member_notifications (user_id, category, title, body, target_href)
    values (
      v_req.requested_by_user_id,
      'users',
      coalesce(v_club, 'Votre club') || ' a besoin d''un complément',
      trim(p_note),
      '/mes-invitations'
    );
  end if;

  return v_req;
end;
$function$;
