-- Calendrier central (04/09/2026, prompt #6 backlog Club+ V2) — étend le lien déjà posé côté
-- Communication (contenus.match_id/calendar_event_id, migration-contenus-match-event-link.sql ;
-- planned_presences.match_id, migration-planned-presences-match-link.sql) jusqu'à la MISSION
-- PRODUCTION elle-même : quand un planning CM lié à un match réel (bouton "📅 Depuis un match",
-- Communication Hub) est envoyé en production (generate_missions_from_plan), la prestations
-- générée ne portait jusqu'ici aucune trace du match d'origine — un match Club+, sa présence CM
-- planifiée et la mission SportVision qui en découle étaient 3 lignes sans lien entre elles au
-- bout de la chaîne. Seul match_id est ajouté (pas calendar_event_id : planned_presences n'a pas
-- cette colonne, donc aucun chemin réel ne l'alimenterait — voir la règle "pas de colonne sans
-- écrivain réel", déjà appliquée cette nuit pour contenus.categorie/club_sponsors).

alter table prestations add column if not exists match_id uuid references club_matches(id) on delete set null;

comment on column prestations.match_id is 'Match Club+ d''origine si cette prestation vient d''une présence CM liée à un match (planned_presences.match_id) — voir generate_missions_from_plan.';

create or replace function generate_missions_from_plan(p_plan_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_plan monthly_production_plans%rowtype;
  v_is_admin boolean;
  v_presence record;
  v_prestation_id uuid;
  v_created_count int := 0;
begin
  select * into v_plan from monthly_production_plans where id = p_plan_id;
  if not found then
    raise exception 'Plan de production introuvable.';
  end if;

  select exists(select 1 from profiles where id = auth.uid() and role = 'admin') into v_is_admin;

  if not (v_is_admin or auth.uid() = v_plan.cm_id) then
    raise exception 'Seul le CM créateur du plan (ou un administrateur) peut envoyer ce planning à la production.';
  end if;

  for v_presence in
    select * from planned_presences
    where plan_id = p_plan_id
      and statut = 'prevu'
      and created_prestation_id is null
  loop
    insert into prestations (
      client_id, date_prestation, heure_debut, lieu, equipes,
      type_prestation, statut, source, planned_presence_id, match_id, notes_internes
    ) values (
      v_plan.client_id, v_presence.date_presence, v_presence.heure_debut,
      v_presence.lieu, v_presence.equipe,
      'match', 'planifiée', 'planning_mensuel_cm', v_presence.id, v_presence.match_id,
      'Générée automatiquement depuis le planning mensuel CM ('
        || to_char(v_plan.mois, 'MM/YYYY') || ', plan ' || v_plan.id || ').'
    )
    returning id into v_prestation_id;

    update planned_presences
    set statut = 'mission_creee', created_prestation_id = v_prestation_id
    where id = v_presence.id;

    v_created_count := v_created_count + 1;
  end loop;

  if v_plan.statut <> 'envoyé' then
    update monthly_production_plans
    set statut = 'envoyé', envoye_at = now()
    where id = p_plan_id;
  end if;

  return v_created_count;
end;
$$;
