-- v187 : « je suis arrivé » prévient la Production (12/09/2026).
--
-- Demande de Fouka : quand un photographe ou un vidéaste arrive sur sa mission, il le déclare, et
-- le Responsable Production n'a plus à se demander si l'équipe est sur place.
--
-- Le bouton existait déjà dans le Mode Jour J (« 📍 Je suis arrivé », statut arrivée_sur_place).
-- Ce qui manquait, c'est TOUT le reste : l'heure d'arrivée n'était conservée nulle part, et
-- personne n'était prévenu. Le suivi se faisait donc par téléphone, ce que ce bouton était
-- précisément censé remplacer.
--
-- Ce que cette migration pose :
--   • arrivee_sur_place_at, l'heure réelle du premier passage à « arrivée sur place ». Elle ne
--     s'écrase jamais : une mission qu'on rouvre garde l'heure d'arrivée d'origine ;
--   • une notification à la Production DU PÔLE de la mission, avec qui est arrivé, à quelle heure,
--     et le retard sur l'heure de rendez-vous s'il y en a un. Une seule fois par mission.
--
-- Rien d'autre ne change : aucun statut nouveau, aucune transition nouvelle, aucun écran déplacé.
-- Test : tests/arrivee-sur-place.test.sql

alter table public.prestations add column if not exists arrivee_sur_place_at timestamptz;
comment on column public.prestations.arrivee_sur_place_at is
  'Heure réelle à laquelle l''équipe terrain a déclaré son arrivée (Mode Jour J). Posée une seule fois, jamais écrasée.';

create or replace function public.signaler_arrivee_sur_place()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_qui text;
  v_retard integer;
  v_heure text;
  v_message text;
begin
  if new.statut::text <> 'arrivée_sur_place' or coalesce(old.statut::text, '') = 'arrivée_sur_place' then
    return new;
  end if;

  -- Première arrivée seulement : rouvrir une mission ne réécrit pas l'heure, et ne renotifie pas.
  if new.arrivee_sur_place_at is not null then
    return new;
  end if;
  new.arrivee_sur_place_at := now();

  select coalesce(nullif(btrim(coalesce(pr.prenom, '') || ' ' || coalesce(pr.nom, '')), ''), 'L''équipe terrain')
    into v_qui from profiles pr where pr.id = auth.uid();
  v_qui := coalesce(v_qui, 'L''équipe terrain');

  v_heure := to_char(new.arrivee_sur_place_at at time zone 'Europe/Paris', 'HH24"h"MI');

  -- Le retard se compte sur l'heure de rendez-vous de la mission, quand elle est connue.
  if new.heure_rdv is not null and new.date_prestation is not null then
    v_retard := floor(extract(epoch from (
      (new.arrivee_sur_place_at at time zone 'Europe/Paris')
      - (new.date_prestation + new.heure_rdv)
    )) / 60)::integer;
  end if;

  v_message := v_qui || ' est arrivé sur place à ' || v_heure
    || coalesce(' (rendez-vous ' || to_char(new.heure_rdv, 'HH24"h"MI') || ')', '')
    || case
         when v_retard is null then '.'
         when v_retard > 10 then ', soit ' || v_retard || ' minutes après l''heure prévue.'
         when v_retard < -10 then ', en avance de ' || abs(v_retard) || ' minutes.'
         else ', à l''heure.'
       end;

  begin
    perform notify_staff_by_role(
      array['prod'],
      'Arrivée sur place : ' || coalesce(nullif(new.reference, ''), 'mission'),
      v_message,
      case when coalesce(v_retard, 0) > 15 then 'haute' else 'normale' end,
      new.id, new.client_id, null);
  exception when others then
    -- Une notification qui échoue ne doit jamais empêcher un opérateur de déclarer son arrivée.
    raise warning 'notification d''arrivée impossible : %', sqlerrm;
  end;

  return new;
end $$;

drop trigger if exists trg_signaler_arrivee_sur_place on public.prestations;
create trigger trg_signaler_arrivee_sur_place
  before update of statut on public.prestations
  for each row execute function public.signaler_arrivee_sur_place();
