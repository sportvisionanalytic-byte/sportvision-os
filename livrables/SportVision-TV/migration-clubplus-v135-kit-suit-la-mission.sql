-- Un kit s'attribue à la mission ; il revient à son opérateur (10/09/2026, première mission réelle).
--
-- Dans la fiche mission, « Attribuer un kit » demandait un opérateur, mais ne proposait que ceux
-- qui avaient déjà ACCEPTÉ : au moment où la Production prépare la mission, la liste était vide et
-- aucun kit ne s'attribuait. Fouka : « enlever sélection opérateur, laisser juste kit ».
--
-- L'écran n'a plus qu'un choix, le kit ; il le rattache à l'opérateur de la mission s'il n'y en a
-- qu'un. Ici, la base tient ce rattachement à jour, parce que l'opérateur ne voit le jour J que les
-- kits réservés à SON nom :
--   • un kit attribué avant l'opérateur (collaborateur_id vide) lui revient dès qu'il est le seul
--     opérateur invité ou confirmé de la mission ;
--   • un opérateur qui refuse, est remplacé ou retiré rend ses kits de la mission à la mission.
-- Plusieurs opérateurs : le kit reste à la mission, la Production le voit ainsi dans la fiche.

begin;

CREATE OR REPLACE FUNCTION public.protect_sensitive_kit_reservation_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  is_privileged boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  -- Le rattachement automatique d'un kit à l'opérateur de la mission (v135) s'exécute au nom de
  -- celui qui accepte ou refuse : marqueur posé seulement par rattacher_kits_mission.
  if current_setting('sv.ecriture_systeme', true) = 'kits_mission' then
    return new;
  end if;

  select exists(select 1 from profiles where id = auth.uid() and role in ('admin','prod')) into is_privileged;
  if is_privileged then
    return new;
  end if;
  if new.kit_id is distinct from old.kit_id
     or new.prestation_id is distinct from old.prestation_id
     or new.collaborateur_id is distinct from old.collaborateur_id
     or new.responsable_id is distinct from old.responsable_id
  then
    raise exception 'Modification non autorisée : le rattachement d''une réservation (kit, prestation, collaborateur) est réservé à l''administration/production.';
  end if;
  return new;
end;
$function$;

create or replace function public.rattacher_kits_mission()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_mission uuid := coalesce(new.prestation_id, old.prestation_id);
  v_seul uuid;
begin
  perform set_config('sv.ecriture_systeme', 'kits_mission', true);
  -- Celui qui quitte la mission rend ses kits à la mission.
  if tg_op = 'UPDATE' and new.statut in ('refusée', 'annulée', 'remplacée') and old.statut is distinct from new.statut then
    update kit_reservations set collaborateur_id = null
     where prestation_id = v_mission and collaborateur_id = new.collaborateur_id and statut <> 'retourné';
  end if;

  -- Un seul opérateur actif : les kits sans titulaire lui reviennent.
  select case when count(distinct collaborateur_id) = 1 then (array_agg(collaborateur_id))[1] end into v_seul
    from prestations_equipe
   where prestation_id = v_mission and statut in ('invitation_envoyée', 'en_attente', 'acceptée');
  if v_seul is not null then
    update kit_reservations set collaborateur_id = v_seul
     where prestation_id = v_mission and collaborateur_id is null and statut <> 'retourné';
  end if;
  perform set_config('sv.ecriture_systeme', '', true);
  return null;
end;
$$;
revoke execute on function public.rattacher_kits_mission() from public, anon, authenticated;

drop trigger if exists trg_rattacher_kits_mission on public.prestations_equipe;
create trigger trg_rattacher_kits_mission
  after insert or update of statut, collaborateur_id on public.prestations_equipe
  for each row execute function rattacher_kits_mission();

commit;
