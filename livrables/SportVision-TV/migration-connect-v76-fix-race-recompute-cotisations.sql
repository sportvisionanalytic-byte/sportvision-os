-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v76
-- Corrige une race condition (perte de mise à jour) dans le recalcul automatique du montant
-- collecté des cotisations collectives (group_fundings/funding_contributions, migration-connect-
-- v50) ET des projets collectifs Club+ (team_projects/team_project_contributions, migration-
-- clubplus-v21, même schéma).
--
-- Contexte (audit paiements du 16/08/2026, point "cas limites concrets d'une cotisation
-- collective") : recompute_group_funding_amount() / recompute_team_project_amount() sont des
-- triggers AFTER INSERT OR UPDATE OR DELETE qui, à chaque changement d'une contribution,
-- RECALCULENT le total à partir de zéro (SELECT SUM(...) puis UPDATE de la ligne parente) plutôt
-- que d'incrémenter. Ce patron est sûr pour une écriture isolée, mais PAS pour deux écritures
-- concurrentes sur la même cotisation/le même projet : si stripe-webhook traite quasi
-- simultanément deux paiements Stripe pour deux contributions DIFFÉRENTES d'une même cotisation
-- (deux contributeurs qui paient au même instant — le cas explicitement demandé par l'audit),
-- les deux triggers peuvent s'exécuter en parallèle dans deux transactions distinctes :
--   1. Transaction A (paiement de X) calcule v_total = somme des lignes 'paye' déjà commitées,
--      qui n'inclut PAS encore le paiement de Y (transaction B, pas encore commitée).
--   2. Transaction B calcule symétriquement un v_total qui n'inclut pas le paiement de X.
--   3. Les deux UPDATE sur la ligne parente (group_fundings / team_projects) se sérialisent
--      naturellement via le verrou de ligne Postgres (la seconde attend que la première committe)
--      — MAIS la valeur écrite par la seconde n'est PAS recalculée après avoir attendu : c'est le
--      v_total figé à l'étape 1/2, qui ignore le paiement de l'autre transaction. Résultat :
--      montant_collecte reflète UN SEUL des deux paiements après coup — perte silencieuse d'une
--      contribution pourtant bien enregistrée en base (la ligne funding_contributions/
--      team_project_contributions, elle, est correcte ; seul le total agrégé est faux), avec pour
--      conséquence possible qu'une cotisation n'atteigne jamais son statut 'objectif_atteint'
--      malgré un montant réellement collecté suffisant.
--
-- Fix : verrouiller explicitement (SELECT ... FOR UPDATE) la ligne parente AVANT de calculer la
-- somme, dans les deux triggers. La deuxième transaction concurrente attend alors AVANT son
-- propre SELECT SUM (pas seulement avant l'UPDATE final) — une fois le verrou obtenu, elle relit
-- forcément un état qui inclut déjà le commit de la première. Aucune logique métier changée
-- (mêmes colonnes écrites, même condition de bascule de statut), uniquement l'ordre des
-- opérations à l'intérieur de la transaction. `perform` (pas `select ... into`) : on ne veut que
-- l'effet de verrouillage, pas la valeur.
--
-- NON EXÉCUTÉE — à relire puis exécuter par Fouka dans Supabase → SQL Editor. Idempotente
-- (create or replace function, redéfinit les 2 triggers déjà en place sans les recréer). Aucun
-- redéploiement d'Edge Function nécessaire (stripe-webhook déclenche ces triggers via une simple
-- UPDATE, son code n'a pas besoin de changer pour ce point précis).
-- ============================================================

create or replace function recompute_group_funding_amount()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_funding_id uuid := coalesce(new.funding_id, old.funding_id);
  v_total numeric(10,2);
  v_target numeric(10,2);
  v_statut text;
begin
  -- Verrou de ligne AVANT le calcul (cf. commentaire de migration ci-dessus) : sérialise les
  -- exécutions concurrentes de ce trigger pour la même cotisation, pour que chacune relise un
  -- état à jour plutôt que d'écraser le travail de l'autre.
  perform 1 from group_fundings where id = v_funding_id for update;

  select coalesce(sum(montant), 0) into v_total from funding_contributions where funding_id = v_funding_id and statut = 'paye';
  select montant_cible, statut into v_target, v_statut from group_fundings where id = v_funding_id;

  update group_fundings
  set montant_collecte = v_total,
      statut = case
        when v_statut = 'ouverte' and v_target is not null and v_total >= v_target then 'objectif_atteint'
        when v_statut = 'objectif_atteint' and v_target is not null and v_total < v_target then 'ouverte'
        else v_statut
      end
  where id = v_funding_id;

  return coalesce(new, old);
end;
$$;

create or replace function recompute_team_project_amount()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_project_id uuid := coalesce(new.project_id, old.project_id);
  v_total numeric(10,2);
  v_target numeric(10,2);
  v_statut text;
begin
  -- Même fix, même raisonnement que recompute_group_funding_amount() ci-dessus (migration-
  -- clubplus-v21) : deux contributions payées quasi simultanément sur le même projet pouvaient
  -- se faire écraser l'une l'autre dans team_projects.montant_collecte.
  perform 1 from team_projects where id = v_project_id for update;

  select coalesce(sum(montant), 0) into v_total from team_project_contributions where project_id = v_project_id and statut = 'paye';
  select montant_cible, statut into v_target, v_statut from team_projects where id = v_project_id;

  update team_projects
  set montant_collecte = v_total,
      statut = case when v_statut = 'ouvert' and v_target is not null and v_total >= v_target then 'objectif_atteint' else statut end
  where id = v_project_id;

  return coalesce(new, old);
end;
$$;
