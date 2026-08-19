-- migration-clubplus-v46-affiliation-demande-info.sql
-- EXÉCUTÉE le 19/08/2026 (audit Club+ du 19/08 : "Il faut, au minimum sur une demande...
-- Demander une information" — vérifié avant construction : confirm_request_educateur/
-- validate_team_membership/reject_team_membership existent déjà et couvrent confirmer/valider/
-- refuser, mais aucune action "demander une info complémentaire" n'existe — confirmé par lecture
-- du code réel et par le commentaire de migration-clubplus-v14.sql qui écartait alors
-- explicitement ce besoin. Construit ici en suivant exactement le même patron que
-- reject_team_membership (même vérification d'autorisation, mêmes conventions).
--
-- Décision volontairement minimale : n'ajoute AUCUN nouveau statut à membership_requests (la
-- demande reste dans son statut courant) — juste un événement horodaté + une note, visible dans
-- l'historique de la demande (membership_request_events, déjà utilisé par confirmer/valider/
-- refuser). Pas de notification automatique construite ici (aucun canal de message existant pour
-- le demandeur d'une affiliation, à la différence des messages_client staff↔client) : le staff/
-- dirigeant transmet l'information par le canal qu'il utilise déjà (téléphone, e-mail).
--
-- Risque à l'exécution : nul — nouvelle fonction pure, ne modifie aucune donnée existante.

create or replace function public.request_membership_info(p_request_id uuid, p_note text default null::text)
 returns membership_requests
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_req membership_requests;
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

  insert into membership_request_events (request_id, event_type, acted_by, note) values (p_request_id, 'info_demandee', auth.uid(), p_note);
  return v_req;
end;
$function$;
