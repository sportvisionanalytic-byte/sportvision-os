-- Migration : Calendrier global transversal (Admin) — vue d'agrégation
-- À exécuter dans Supabase → SQL Editor.
-- EXÉCUTÉE — appliquée en base réelle le 29/08/2026 (worktree isolé, création de
-- vue idempotente et non destructive). Vérifiée : structure des 12 colonnes
-- conforme, requêtée en RLS réelle avec un compte admin jetable (3 lignes
-- réelles remontées : 1 disponibilité, 1 prestation, 1 contrat, cohérent avec
-- le contenu actuel de la base) et un compte 'prod' jetable (0 ligne, comme
-- attendu — restriction role=admin confirmée), comptes supprimés après test.
--
-- Spec (§22-27, Calendrier global) : "une vue Direction qui AGRÈGE, pas un
-- nouveau calendrier métier". Choix d'architecture : VUE PostgreSQL (recalculée
-- à chaque lecture), pas une table `calendar_feed_item` alimentée par triggers —
-- même philosophie que v_mission_prete (migration-mission-prete-badge.sql) :
-- jamais désynchronisée de sa source, le source_id reste la seule vérité (§27
-- "utiliser des références, pas copier les événements"). Une table + triggers
-- aurait ajouté un risque de désync (oubli d'un trigger sur une table source,
-- écriture manuelle en base qui contourne le trigger) pour un gain de perf non
-- justifié vu le volume de données actuel de SportVision.
--
-- ── Sources agrégées (§22), résultat de l'audit du schéma avant écriture ──
--   1. Missions Production      → prestations (date_prestation + heure_debut/fin)
--   2. Présences Full Com       → planned_presences (via monthly_production_plans),
--                                  EXCLUT statut='mission_creee' : une fois la
--                                  présence transformée en mission, la ligne
--                                  `prestations` correspondante (liée par
--                                  prestations.planned_presence_id) devient la
--                                  seule source affichée — sinon le même
--                                  événement apparaîtrait deux fois au calendrier.
--   3. RDV commerciaux/clients  → rendez_vous (demandes de RDV côté portail
--                                  client, gérées en admin/sec via l'écran
--                                  "Rendez-vous clients"). EXCLUT statut='annule'.
--   4. Rappels Secrétaire       → secretariat_agenda_events (types
--                                  appel_candidat/relance_devis/relance_paiement/
--                                  signature/renouvellement/echeance_document/
--                                  rappel_interne/rdv_client — ce dernier est un
--                                  rappel interne libre, PAS le même objet que la
--                                  table `rendez_vous` ci-dessus, d'où un
--                                  display_type distinct 'rdv_interne' pour ne
--                                  pas les confondre dans les filtres).
--   5. Échéances contrats       → contrats.date_fin, uniquement statut='actif'
--                                  (un contrat résilié n'a plus d'échéance à
--                                  surveiller).
--   6. Événements formation     → formation_sessions.date_session, EXCLUT
--                                  statut='annulee'.
--   7. Indisponibilités         → disponibilites, UNIQUEMENT statut IN
--                                  ('indisponible','sous_conditions') — afficher
--                                  chaque jour "disponible" de chaque
--                                  collaborateur aurait noyé le calendrier sous
--                                  du bruit sans valeur (spec §22 "si utiles").
--
-- Non trouvé en base / hors périmètre de cette vue (honnêteté sur les limites,
-- à ne pas inventer) :
--   - Aucune table "opportunités"/"leads" avec une date planifiable : la
--     prospection (clients.statut='prospect'/'qualifié') n'a pas de date propre,
--     seul un vrai rendez-vous pris (table rendez_vous) a une date. Le pipeline
--     de prospection reste donc hors de ce calendrier (il vit dans son propre
--     écran 'pipeline').
--   - "Événements internes" hors formation (ex. réunion d'équipe sans table
--     dédiée) : rien en base ne les modélise aujourd'hui, non inclus.
--
-- Fuseau horaire : les colonnes source (date_prestation+heure_*, date_presence,
-- date_fin, date) sont stockées sans fuseau (l'app est mono-fuseau, staff basé
-- en France) — converties explicitement en timestamptz via
-- "AT TIME ZONE 'Europe/Paris'" pour uniformiser avec secretariat_agenda_events.
-- date_heure et formation_sessions.date_session qui sont déjà timestamptz.
--
-- Sécurité : suit le même patron que v_mission_prete (filtre d'autorisation
-- ajouté manuellement dans la vue) car une vue Postgres standard n'hérite PAS
-- automatiquement des policies RLS des tables sources quand son propriétaire
-- bypass RLS (rôle postgres). Restreint à role='admin' uniquement (get_my_role()),
-- plus strict que is_staff() : c'est explicitement "le calendrier Agrégat global"
-- de la Direction (§26), les autres rôles gardent leurs calendriers spécialisés
-- existants (agendasec pour Secrétaire, planning CM, planning Production...).

create or replace view v_calendar_global as
select * from (
  -- 1. Missions Production
  select
    'prestation'::text as source_type,
    p.id as source_id,
    (p.date_prestation + coalesce(p.heure_debut, p.heure_rdv, '00:00:00'::time)) at time zone 'Europe/Paris' as starts_at,
    case when p.heure_fin is not null
      then (p.date_prestation + p.heure_fin) at time zone 'Europe/Paris'
      else null end as ends_at,
    'mission'::text as display_type,
    p.statut::text as statut,
    coalesce(p.reference, p.type_prestation, 'Prestation') as titre,
    c.nom as club_nom,
    p.sport as sport,
    'production'::text as pole,
    p.responsable_prod_id as responsible_user_id,
    trim(coalesce(pr.prenom,'') || ' ' || coalesce(pr.nom,'')) as responsible_nom
  from prestations p
  left join clients c on c.id = p.client_id
  left join profiles pr on pr.id = p.responsable_prod_id
  where p.date_prestation is not null
    and p.statut not in ('annulée','refusée')

  union all

  -- 2. Présences Full Communication (planning éditorial CM)
  select
    'presence_fullcom'::text,
    pp.id,
    (pp.date_presence + coalesce(pp.heure_debut, '00:00:00'::time)) at time zone 'Europe/Paris',
    null::timestamptz,
    'presence'::text,
    pp.statut,
    coalesce(pp.equipe, 'Présence') || case when pp.adversaire is not null and pp.adversaire <> '' then ' vs ' || pp.adversaire else '' end,
    cl.nom,
    null::text,
    'communication'::text,
    mpp.cm_id,
    trim(coalesce(pr2.prenom,'') || ' ' || coalesce(pr2.nom,''))
  from planned_presences pp
  join monthly_production_plans mpp on mpp.id = pp.plan_id
  left join clients cl on cl.id = mpp.client_id
  left join profiles pr2 on pr2.id = mpp.cm_id
  where pp.statut is distinct from 'mission_creee'

  union all

  -- 3. RDV commerciaux / clients (portail → écran "Rendez-vous clients")
  select
    'rendez_vous'::text,
    r.id,
    (r.date_demandee + coalesce(r.heure_demandee, '00:00:00'::time)) at time zone 'Europe/Paris',
    null::timestamptz,
    'rdv_commercial'::text,
    r.statut,
    coalesce(r.objet, case when r.type_rdv='appel' then 'Appel client' else 'RDV client' end),
    c2.nom,
    c2.sport,
    'commercial'::text,
    r.confirme_par,
    trim(coalesce(pr3.prenom,'') || ' ' || coalesce(pr3.nom,''))
  from rendez_vous r
  left join clients c2 on c2.id = r.client_id
  left join profiles pr3 on pr3.id = r.confirme_par
  where r.date_demandee is not null
    and r.statut <> 'annule'

  union all

  -- 4. Rappels / relances Secrétariat (+ appels candidats, échéances documents)
  select
    'agenda_sec'::text,
    e.id,
    e.date_heure,
    null::timestamptz,
    case e.type
      when 'rdv_client' then 'rdv_interne'
      when 'appel_candidat' then 'recrutement'
      when 'relance_devis' then 'relance'
      when 'relance_paiement' then 'relance'
      when 'signature' then 'echeance_admin'
      when 'renouvellement' then 'echeance_admin'
      when 'echeance_document' then 'echeance_admin'
      else 'rappel'
    end,
    e.statut,
    e.titre,
    c3.nom,
    null::text,
    case e.type when 'appel_candidat' then 'recrutement' else 'secretariat' end,
    e.assigned_to,
    trim(coalesce(pr4.prenom,'') || ' ' || coalesce(pr4.nom,''))
  from secretariat_agenda_events e
  left join clients c3 on c3.id = e.client_id
  left join profiles pr4 on pr4.id = e.assigned_to

  union all

  -- 5. Échéances de contrats actifs
  select
    'contrat'::text,
    ct.id,
    ct.date_fin::timestamp at time zone 'Europe/Paris',
    null::timestamptz,
    'echeance_contrat'::text,
    ct.statut,
    'Échéance contrat — ' || coalesce(ct.type_contrat, 'contrat'),
    c4.nom,
    c4.sport,
    'clients'::text,
    ct.created_by,
    trim(coalesce(pr5.prenom,'') || ' ' || coalesce(pr5.nom,''))
  from contrats ct
  left join clients c4 on c4.id = ct.client_id
  left join profiles pr5 on pr5.id = ct.created_by
  where ct.date_fin is not null
    and ct.statut = 'actif'

  union all

  -- 6. Sessions de formation (événements internes programmés)
  select
    'formation_session'::text,
    s.id,
    s.date_session,
    s.date_session + (coalesce(s.duree_minutes, 120) || ' minutes')::interval,
    'formation'::text,
    s.statut,
    coalesce(s.titre, 'Session de formation'),
    null::text,
    null::text,
    'formation'::text,
    s.formateur_id,
    trim(coalesce(pr6.prenom,'') || ' ' || coalesce(pr6.nom,''))
  from formation_sessions s
  left join profiles pr6 on pr6.id = s.formateur_id
  where s.statut is distinct from 'annulee'

  union all

  -- 7. Indisponibilités collaborateurs (uniquement les exceptions, pas les jours "disponible")
  select
    'disponibilite'::text,
    d.id,
    d.date::timestamp at time zone 'Europe/Paris',
    (d.date + 1)::timestamp at time zone 'Europe/Paris',
    'indisponibilite'::text,
    d.statut,
    case d.statut when 'indisponible' then 'Indisponible' else 'Disponibilité sous conditions' end,
    null::text,
    null::text,
    'rh'::text,
    d.collaborateur_id,
    trim(coalesce(pr7.prenom,'') || ' ' || coalesce(pr7.nom,''))
  from disponibilites d
  left join profiles pr7 on pr7.id = d.collaborateur_id
  where d.statut in ('indisponible', 'sous_conditions')
) feed
where get_my_role() = 'admin';

comment on view public.v_calendar_global is
  'Calendrier global agrégé (Direction, §22-27) : UNION en lecture seule de 7 sources (prestations, planned_presences, rendez_vous, secretariat_agenda_events, contrats, formation_sessions, disponibilites). Référence uniquement (source_type+source_id), aucune donnée copiée. Restreint à role=admin. Voir migration-calendrier-global-v1.sql pour le détail des exclusions par source.';

revoke insert, update, delete, truncate on public.v_calendar_global from authenticated, anon;
grant select on public.v_calendar_global to authenticated;

-- Vérification (à exécuter manuellement après migration) :
-- select source_type, count(*) from v_calendar_global group by source_type order by source_type;
-- select * from v_calendar_global order by starts_at asc limit 20;
