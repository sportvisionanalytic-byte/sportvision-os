-- v194 — Une demande d'organisation non-club prévient le staff (12/09/2026).
--
-- CE QUI N'ALLAIT PAS. Club+ a deux circuits de demande. Celui d'un club, `club_requests`, est lu
-- partout dans l'OS : radar, cockpit CM, Inbox. Celui d'un coach, d'une académie, d'un sponsor,
-- d'un événement, d'une agence CM ou d'un espace Projet, `requests`, n'était lu par AUCUN écran
-- de l'OS et ne notifiait personne : `submit_request` insérait la ligne et retournait.
--
-- L'écran affichait « Demande envoyée », et chez SportVision personne ne l'apprenait. La table est
-- encore à 0 ligne, donc rien n'a été perdu — mais la chaîne était coupée par construction, et
-- c'est précisément le circuit des organisations qu'on cherche à signer.
--
-- Un déclencheur, pas un appel dans la fonction : `requests` peut aussi être écrite autrement, et
-- on vient de voir avec les autorisations parentales ce que coûte un appel qu'il faut penser à
-- écrire dans chaque appelant. Même modèle que `trg_prestations_notify_demande`.
-- Idempotente.

create or replace function public.notifier_demande_organisation()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  v_nom text;
  v_type text;
begin
  select nom, organization_type into v_nom, v_type from organizations where id = new.organization_id;

  perform notify_staff_by_role(
    array['admin', 'sec', 'com'],
    'Nouvelle demande — ' || coalesce(v_nom, 'organisation inconnue'),
    coalesce(v_nom, 'Une organisation') || ' (' || coalesce(v_type, 'type inconnu') || ') demande : '
      || coalesce(new.type, 'demande') || '. Urgence : ' || coalesce(new.urgency, 'normale') || '.',
    case when new.urgency = 'urgente' then 'haute' else 'normale' end,
    null, null
  );
  return new;
end $$;

drop trigger if exists trg_requests_notify_demande on requests;
create trigger trg_requests_notify_demande
  after insert on requests
  for each row execute function notifier_demande_organisation();
