-- Migration : alerte "changement à examiner" quand une présence déjà transformée
-- en mission est modifiée dans le planning mensuel CM.
-- À exécuter dans Supabase → SQL Editor.
-- EXÉCUTÉE — appliquée en base réelle le 28/08/2026 (refonte interface Responsable
-- Production, audit de gap P0 #5).
--
-- Contexte : generate_missions_from_plan() (migration-planning-mensuel-cm.sql)
-- crée une `prestations` à partir d'une `planned_presences` et marque celle-ci
-- `statut='mission_creee'`. La RLS `pp_update` empêche déjà le CM de modifier une
-- présence une fois `mission_creee` (il ne reste que l'admin qui peut encore le
-- faire, ex. correction manuelle d'une erreur de saisie du CM). Mais rien
-- aujourd'hui ne relie ce changement à la mission déjà créée : si la date, l'heure
-- ou le lieu d'une présence sont modifiés après coup, la `prestations` liée reste
-- inchangée et personne côté Production n'est prévenu — désynchronisation
-- silencieuse entre le planning source et la mission réellement affichée aux
-- opérateurs. La spec de refonte Responsable Production (§16 "Changements venant
-- du CM") demande explicitement que ce cas déclenche une alerte "CHANGEMENT À
-- EXAMINER" pour que le Responsable Production vérifie l'impact (aucun impact →
-- valider ; impact opérateur → notifier/reconfirmer), jamais une propagation
-- automatique et silencieuse du changement.
--
-- Choix : ne PAS modifier prestations.statut (cycle à 32 valeurs déjà verrouillé
-- par validate_prestation_statut_transition, mieux vaut ne pas y ajouter une
-- branche supplémentaire pour un besoin qui est une alerte, pas un état métier).
-- On réutilise la table `notifications` existante (même mécanisme que
-- creerTachesAuto côté Secrétaire) : une notification type='changement_planning_cm'
-- est créée pour le Responsable Production assigné (prestations.responsable_prod_id)
-- si déjà affecté, sinon pour tous les profils actifs role='prod'.
--
-- Propriété : idempotente (drop/create trigger + fonction), ne modifie aucune
-- ligne existante (déclenchement uniquement sur les futurs UPDATE).

create or replace function notify_presence_change_after_mission_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed boolean;
  v_detail text := '';
  v_resp_prod uuid;
  v_prof record;
begin
  if old.created_prestation_id is null then
    return new;
  end if;

  v_changed :=
    old.date_presence is distinct from new.date_presence
    or old.heure_debut is distinct from new.heure_debut
    or old.lieu is distinct from new.lieu;

  if not v_changed then
    return new;
  end if;

  if old.date_presence is distinct from new.date_presence then
    v_detail := v_detail || format('Date : %s → %s. ', old.date_presence, new.date_presence);
  end if;
  if old.heure_debut is distinct from new.heure_debut then
    v_detail := v_detail || format('Heure : %s → %s. ', coalesce(old.heure_debut::text,'—'), coalesce(new.heure_debut::text,'—'));
  end if;
  if old.lieu is distinct from new.lieu then
    v_detail := v_detail || format('Lieu : %s → %s. ', coalesce(old.lieu,'—'), coalesce(new.lieu,'—'));
  end if;

  select responsable_prod_id into v_resp_prod
  from prestations where id = new.created_prestation_id;

  if v_resp_prod is not null then
    insert into notifications (destinataire_id, type, titre, message, prestation_id)
    values (v_resp_prod, 'changement_planning_cm', 'Changement à examiner (planning CM)', v_detail, new.created_prestation_id);
  else
    for v_prof in select id from profiles where role = 'prod' and actif = true loop
      insert into notifications (destinataire_id, type, titre, message, prestation_id)
      values (v_prof.id, 'changement_planning_cm', 'Changement à examiner (planning CM)', v_detail, new.created_prestation_id);
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_presence_change_after_mission_created on planned_presences;
create trigger trg_notify_presence_change_after_mission_created
  after update on planned_presences
  for each row execute procedure notify_presence_change_after_mission_created();

-- Vérification (à exécuter manuellement après migration) :
-- select count(*) from notifications where type='changement_planning_cm'; -- doit être 0 juste après la migration
