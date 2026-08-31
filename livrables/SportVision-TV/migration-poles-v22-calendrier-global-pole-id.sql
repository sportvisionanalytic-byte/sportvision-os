-- ============================================================================
-- migration-poles-v22-calendrier-global-pole-id.sql
-- Fouka : "pareil le calendrier basket ne doit voir que le basket" / "calendrier
-- general et calendrier foot" (31/08/2026). v_calendar_global (migration-
-- calendrier-global-v1.sql) n'exposait aucune colonne pole_id — sa colonne
-- `pole` (renommée `departement` par migration-poles-v0 justement pour éviter
-- la confusion) désigne un département fonctionnel interne (production,
-- communication, commercial...), pas le pôle sportif Football/Basket.
--
-- Ajoute pole_id en dernière colonne (contrainte CREATE OR REPLACE VIEW :
-- impossible d'insérer une colonne au milieu, seulement en ajouter une à la
-- fin — déjà rencontré cette nuit sur v_rentabilite_missions), dérivé
-- différemment selon la branche du UNION ALL :
--   - mission (prestations)        -> p.pole_id (direct, jamais NULL)
--   - presence_fullcom             -> cl.pole_id (via monthly_production_plans -> clients)
--   - rendez_vous (commercial)     -> c2.pole_id (via clients)
--   - agenda_sec                   -> c3.pole_id (via clients, NULL si tâche sans client = Général)
--   - contrat (échéance)           -> c4.pole_id (via clients)
--   - formation_session            -> NULL (catalogue de formation commun aux pôles, Général)
--   - disponibilite (collaborateur) -> premier pôle d'affectation du collaborateur (approximation
--                                       raisonnable pour un affichage calendrier ; NULL si aucune
--                                       affectation, ex. rôle rh)
-- NULL = Général (aucun filtre ne doit le faire disparaître à tort, même
-- sémantique que expenses/frais cette nuit) — traité côté front comme un
-- événement "commun", toujours visible quel que soit le pôle actif.
-- ============================================================================

create or replace view public.v_calendar_global as
select
  source_type, source_id, starts_at, ends_at, display_type, statut, titre,
  club_nom, sport, pole as departement, responsible_user_id, responsible_nom,
  pole_id
from (
  select 'prestation'::text as source_type,
    p.id as source_id,
    ((p.date_prestation + coalesce(p.heure_debut, p.heure_rdv, '00:00:00'::time)) at time zone 'Europe/Paris') as starts_at,
    case when p.heure_fin is not null then ((p.date_prestation + p.heure_fin) at time zone 'Europe/Paris') else null::timestamptz end as ends_at,
    'mission'::text as display_type,
    p.statut::text as statut,
    coalesce(p.reference, p.type_prestation, 'Prestation'::text) as titre,
    c.nom as club_nom,
    p.sport,
    'production'::text as pole,
    p.responsable_prod_id as responsible_user_id,
    trim(coalesce(pr.prenom, '') || ' ' || coalesce(pr.nom, '')) as responsible_nom,
    p.pole_id
  from prestations p
    left join clients c on c.id = p.client_id
    left join profiles pr on pr.id = p.responsable_prod_id
  where p.date_prestation is not null and (p.statut <> all (array['annulée'::statut_prestation, 'refusée'::statut_prestation]))

  union all
  select 'presence_fullcom'::text,
    pp.id,
    ((pp.date_presence + coalesce(pp.heure_debut, '00:00:00'::time)) at time zone 'Europe/Paris'),
    null::timestamptz,
    'presence'::text,
    pp.statut,
    coalesce(pp.equipe, 'Présence'::text) || case when pp.adversaire is not null and pp.adversaire <> '' then ' vs ' || pp.adversaire else '' end,
    cl.nom,
    null::text,
    'communication'::text,
    mpp.cm_id,
    trim(coalesce(pr2.prenom, '') || ' ' || coalesce(pr2.nom, '')),
    cl.pole_id
  from planned_presences pp
    join monthly_production_plans mpp on mpp.id = pp.plan_id
    left join clients cl on cl.id = mpp.client_id
    left join profiles pr2 on pr2.id = mpp.cm_id
  where pp.statut is distinct from 'mission_creee'::text

  union all
  select 'rendez_vous'::text,
    r.id,
    ((r.date_demandee + coalesce(r.heure_demandee, '00:00:00'::time)) at time zone 'Europe/Paris'),
    null::timestamptz,
    'rdv_commercial'::text,
    r.statut,
    coalesce(r.objet, case when r.type_rdv = 'appel'::text then 'Appel client'::text else 'RDV client'::text end),
    c2.nom,
    c2.sport,
    'commercial'::text,
    r.confirme_par,
    trim(coalesce(pr3.prenom, '') || ' ' || coalesce(pr3.nom, '')),
    c2.pole_id
  from rendez_vous r
    left join clients c2 on c2.id = r.client_id
    left join profiles pr3 on pr3.id = r.confirme_par
  where r.date_demandee is not null and r.statut <> 'annule'::text

  union all
  select 'agenda_sec'::text,
    e.id,
    e.date_heure,
    null::timestamptz,
    case e.type
      when 'rdv_client'::text then 'rdv_interne'::text
      when 'appel_candidat'::text then 'recrutement'::text
      when 'relance_devis'::text then 'relance'::text
      when 'relance_paiement'::text then 'relance'::text
      when 'signature'::text then 'echeance_admin'::text
      when 'renouvellement'::text then 'echeance_admin'::text
      when 'echeance_document'::text then 'echeance_admin'::text
      else 'rappel'::text
    end,
    e.statut,
    e.titre,
    c3.nom,
    null::text,
    case e.type when 'appel_candidat'::text then 'recrutement'::text else 'secretariat'::text end,
    e.assigned_to,
    trim(coalesce(pr4.prenom, '') || ' ' || coalesce(pr4.nom, '')),
    c3.pole_id
  from secretariat_agenda_events e
    left join clients c3 on c3.id = e.client_id
    left join profiles pr4 on pr4.id = e.assigned_to

  union all
  select 'contrat'::text,
    ct.id,
    (ct.date_fin::timestamp at time zone 'Europe/Paris'),
    null::timestamptz,
    'echeance_contrat'::text,
    ct.statut,
    'Échéance contrat — ' || coalesce(ct.type_contrat, 'contrat'::text),
    c4.nom,
    c4.sport,
    'clients'::text,
    ct.created_by,
    trim(coalesce(pr5.prenom, '') || ' ' || coalesce(pr5.nom, '')),
    c4.pole_id
  from contrats ct
    left join clients c4 on c4.id = ct.client_id
    left join profiles pr5 on pr5.id = ct.created_by
  where ct.date_fin is not null and ct.statut = 'actif'::text

  union all
  select 'formation_session'::text,
    s.id,
    s.date_session,
    s.date_session + ((coalesce(s.duree_minutes, 120) || ' minutes'::text)::interval),
    'formation'::text,
    s.statut,
    coalesce(s.titre, 'Session de formation'::text),
    null::text,
    null::text,
    'formation'::text,
    s.formateur_id,
    trim(coalesce(pr6.prenom, '') || ' ' || coalesce(pr6.nom, '')),
    null::uuid
  from formation_sessions s
    left join profiles pr6 on pr6.id = s.formateur_id
  where s.statut is distinct from 'annulee'::text

  union all
  select 'disponibilite'::text,
    d.id,
    (d.date::timestamp at time zone 'Europe/Paris'),
    ((d.date + 1)::timestamp at time zone 'Europe/Paris'),
    'indisponibilite'::text,
    d.statut,
    case d.statut when 'indisponible'::text then 'Indisponible'::text else 'Disponibilité sous conditions'::text end,
    null::text,
    null::text,
    'rh'::text,
    d.collaborateur_id,
    trim(coalesce(pr7.prenom, '') || ' ' || coalesce(pr7.nom, '')),
    (select pa.pole_id from pole_affectations pa where pa.user_id = d.collaborateur_id limit 1)
  from disponibilites d
    left join profiles pr7 on pr7.id = d.collaborateur_id
  where d.statut = any (array['indisponible'::text, 'sous_conditions'::text])
) feed
where get_my_role() = 'admin'::text;

-- ROLLBACK : recréer la vue sans la colonne pole_id (voir migration-calendrier-
-- global-v1.sql pour le corps exact pré-v22).
