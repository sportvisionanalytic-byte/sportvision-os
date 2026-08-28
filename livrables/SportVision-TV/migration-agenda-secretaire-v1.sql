-- ============================================================================
-- migration-agenda-secretaire-v1.sql
-- ============================================================================
-- Module "Agenda" du Secrétariat (refonte interface Secrétaire, 28/08/2026).
--
-- Contexte : la spec cible demande un agenda ADMINISTRATIF pour le rôle
-- 'sec', distinct du calendrier de missions/production. Contenu attendu :
-- appels candidats planifiés, rendez-vous clients, relances devis, relances
-- paiements, signatures à suivre, renouvellements, échéances de documents,
-- rappels internes. Actions attendues : + Rendez-vous, + Rappel, marquer
-- terminé, reporter, associer à un client/candidat/devis/document.
--
-- Contrainte explicite de la spec : "l'Agenda Secrétaire ne doit pas devenir
-- le calendrier des matchs" — les missions n'y apparaissent qu'EN CONTEXTE
-- (lien optionnel vers une prestation), jamais comme flux principal.
--
-- ─── Audit préalable (vérifié dans ce dépôt avant d'écrire quoi que ce
-- soit, pour ne rien dupliquer) ────────────────────────────────────────────
--
-- 1. Aucune table d'agenda/rappels administratifs générique n'existe déjà.
--    Les tables candidates trouvées par grep sont toutes hors sujet :
--      - `calendar_events` (migration-connect-v3-coach-academie-requests.sql)
--        est scopée organization_id, alimentée par SportVision pour les
--        ESPACES CONNECT (club/coach/académie) — pas un outil interne staff.
--      - `club_calendar_events` (migration-clubplus-v4.sql) est le calendrier
--        d'un club (matchs/événements) — c'est justement CE calendrier que
--        la spec interdit de dupliquer en agenda secrétariat.
--      - `connect_manual_calendar_events` (migration-connect-v57) est un
--        calendrier manuel côté agent/parent Connect pour un athlète suivi —
--        rien à voir avec le back-office SportVision.
--      - `disponibilites` (migration-disponibilites.sql) suit la disponibilité
--        des collaborateurs (dispo/indispo par jour), pas des rendez-vous.
--    → aucune de ces tables ne convient : ce fichier crée la table qui
--      manque réellement, `secretariat_agenda_events`, plutôt que de
--      réutiliser une table dont c'est déjà pas le rôle.
--    Nom volontairement DIFFÉRENT de `calendar_events`/`club_calendar_events`
--    pour ne jamais laisser croire que c'est le même flux.
--
-- 2. Mécanisme de tâches/rappels déjà en place : `_TACHES_AUTO_CFG` +
--    `creerTachesAuto(eventType, data)` (SportVision-OS-Full.html, ~L12932)
--    déclenche, sur quelques événements métier (devis.envoye, devis.accepted,
--    prestation.confirmed, prestation.completed), la création d'une ligne
--    dans `notifications` (via creerNotifSiActive) pour chaque profil d'un
--    rôle donné. Côté base, l'équivalent serveur existe déjà :
--    `notify_staff_by_role(p_roles, p_titre, p_message, p_priorite,
--    p_prestation_id, p_client_id, ...)` (migration-portail-v10.sql, étendu
--    par migration-connect-v44 et migration-connect-v78), appelé par des
--    triggers DB (ex. trg_notify_nouvelle_demande).
--    CE MÉCANISME N'EST PAS DUPLIQUÉ ICI : `notifications` reste le fil
--    d'ALERTES éphémères (lue/non lue, pas de date d'échéance, pas de statut
--    à_faire/reporté/terminé, pas de "marquer terminé" ni "reporter").
--    Il n'a jamais été conçu comme une liste d'actions planifiables — c'est
--    exactement le trou que l'Agenda Secrétaire doit combler. Les deux
--    mécanismes sont donc COMPLÉMENTAIRES : `secretariat_agenda_events` est
--    la liste actionnable et persistante (RDV, rappels, échéances) ;
--    `notifications`/`notify_staff_by_role` reste le fil d'alerte temps réel.
--    Partie 4 de ce fichier RÉUTILISE `notify_staff_by_role` telle quelle
--    (aucune nouvelle fonction de notification créée) pour deux nouveaux
--    déclencheurs temporels (cf. plus bas).
--
-- 3. Tables réellement référencées pour les liens optionnels (vérifiées
--    dans supabase-schema.sql / supabase-schema-v2.sql / migrations) :
--      - clients(id)                    — devis.client_id, contrats.client_id
--      - recruitment_applications(id)   — statut inclut déjà 'a_appeler'
--        depuis migration-equipe-rh-refonte-28-08.sql (pipeline candidats),
--        donc "appel candidat planifié" a un ancrage réel côté recrutement.
--      - devis(id)                      — a bien date_expiration/date_envoi
--      - contrats(id)                   — a bien date_fin/renouvellement_auto
--      - collaborateur_documents(id)    — migration-equipe-rh-refonte-28-08.sql,
--        table de suivi documents administratifs collaborateurs (contrat/RIB/
--        justificatif). PAS de colonne de date d'expiration à ce jour (juste
--        statut present/manquant) : voir remarque §4 sur document.expire_bientot.
--      - prestations(id)                — lien de CONTEXTE uniquement (voir
--        contrainte ci-dessus), jamais la source du flux principal.
--
-- 4. eventType supplémentaires (partie 4) : seuls deux triggers temporels
--    sont ajoutés, tous deux appuyés sur une vraie colonne de date déjà en
--    base :
--      - `sales.devis_expiration_proche` (J-3 avant devis.date_expiration,
--        devis 'envoyé' sans réponse) → crée un `secretariat_agenda_events`
--        (type 'relance_devis') + notify_staff_by_role (alerte immédiate).
--      - `finance.contrat_renouvellement_proche` (J-14 avant contrats.date_fin,
--        contrat 'actif' à renouvellement_auto=false) → agenda_events (type
--        'renouvellement') + notify_staff_by_role.
--    `document.expire_bientot` (mentionné dans le brief) N'EST PAS implémenté
--    ici : `collaborateur_documents` n'a aucune colonne de date d'expiration
--    (uniquement present/manquant), et cette table appartient au chantier
--    RH séparé du 28/08 (migration-equipe-rh-refonte-28-08.sql). Ajouter une
--    colonne d'échéance là-dedans est hors périmètre de cette migration —
--    channel réservé pour une migration future une fois la colonne ajoutée
--    par le chantier RH (le type 'echeance_document' existe déjà côté
--    `secretariat_agenda_events` pour un usage MANUEL dès aujourd'hui : le
--    secrétariat peut créer la ligne à la main, seule l'auto-génération par
--    échéance réelle manque).
--
-- 5. RLS : le brief suggère explicitement `contrats_acces` (admin/sec/com/
--    compta, accès large) comme référence. Choix retenu : lecture ET écriture
--    partagées entre admin/sec/com/compta (même équipe back-office que
--    contrats/avoirs/document_events), PLUS le créateur systématiquement
--    (cas d'un rôle hors back-office qui se crée un rappel personnel — rare
--    mais explicitement demandé : "un rappel est visible par son créateur").
--    Suppression volontairement plus stricte (admin + créateur uniquement)
--    pour éviter qu'un rappel d'un collègue soit supprimé par erreur — le
--    flux normal de fin de tâche est "marquer terminé" (UPDATE), pas DELETE.
--
-- Idempotente (create table/policy if not exists, drop policy if exists
-- avant chaque create policy). À exécuter dans Supabase → SQL Editor.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────
-- 1. Table secretariat_agenda_events
-- ────────────────────────────────────────────────────────────────────────

create table if not exists secretariat_agenda_events (
  id                uuid default gen_random_uuid() primary key,

  type              text not null check (type in (
                      'appel_candidat','rdv_client','relance_devis',
                      'relance_paiement','signature','renouvellement',
                      'echeance_document','rappel_interne'
                    )),

  titre             text not null,
  description       text,

  date_heure        timestamptz not null,

  statut            text not null default 'a_faire'
                      check (statut in ('a_faire','termine','reporte')),

  -- Historique simple de report : la date d'origine avant le premier report
  -- (permet d'afficher "reporté depuis le 03/09" sans table d'historique
  -- séparée — cohérent avec le reste du schéma qui évite les tables
  -- d'audit dédiées pour des besoins aussi simples, ex. disponibilites).
  date_heure_initiale timestamptz,

  created_by        uuid references profiles(id) on delete set null,
  -- Optionnel : à qui le rappel/RDV est confié (défaut : le créateur).
  -- Permet de filtrer "mes tâches" côté UI sans complexifier la RLS
  -- (visibilité reste équipe back-office + créateur, cf. §5 ci-dessus).
  assigned_to       uuid references profiles(id) on delete set null,

  -- Liens optionnels — un événement d'agenda peut n'être rattaché à rien
  -- (rappel interne libre) ou à une seule de ces entités selon son type.
  client_id         uuid references clients(id) on delete set null,
  candidat_id       uuid references recruitment_applications(id) on delete set null,
  devis_id          uuid references devis(id) on delete set null,
  contrat_id        uuid references contrats(id) on delete set null,
  document_id       uuid references collaborateur_documents(id) on delete set null,

  -- Lien de CONTEXTE uniquement vers une prestation (ex. "relance paiement"
  -- concerne telle mission) — jamais la source du flux principal de
  -- l'Agenda, conformément à la contrainte explicite de la spec.
  prestation_id     uuid references prestations(id) on delete set null,

  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

comment on table secretariat_agenda_events is
  'Agenda administratif du Secrétariat (RDV, rappels, relances, échéances). '
  'Distinct de calendar_events/club_calendar_events (calendrier de missions) '
  '— les prestations n''y apparaissent qu''en contexte via prestation_id, '
  'jamais comme flux principal.';

alter table secretariat_agenda_events enable row level security;

-- Index pour les vues courantes : liste à venir triée par date, filtre par
-- statut, et retrouver rapidement les événements liés à une entité donnée.
create index if not exists idx_agenda_sec_date        on secretariat_agenda_events(date_heure);
create index if not exists idx_agenda_sec_statut_date  on secretariat_agenda_events(statut, date_heure);
create index if not exists idx_agenda_sec_created_by   on secretariat_agenda_events(created_by);
create index if not exists idx_agenda_sec_assigned_to  on secretariat_agenda_events(assigned_to);
create index if not exists idx_agenda_sec_client        on secretariat_agenda_events(client_id) where client_id is not null;
create index if not exists idx_agenda_sec_candidat      on secretariat_agenda_events(candidat_id) where candidat_id is not null;
create index if not exists idx_agenda_sec_devis         on secretariat_agenda_events(devis_id) where devis_id is not null;
create index if not exists idx_agenda_sec_contrat       on secretariat_agenda_events(contrat_id) where contrat_id is not null;


-- ────────────────────────────────────────────────────────────────────────
-- 2. Trigger updated_at (fonction dédiée, même patron que
--    update_dispo_updated_at dans migration-disponibilites.sql, pour ne pas
--    dépendre de l'ordre d'exécution avec migration-contrats.sql)
-- ────────────────────────────────────────────────────────────────────────

create or replace function update_agenda_sec_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_agenda_sec_updated_at on secretariat_agenda_events;
create trigger trg_agenda_sec_updated_at
  before update on secretariat_agenda_events
  for each row execute function update_agenda_sec_updated_at();


-- ────────────────────────────────────────────────────────────────────────
-- 3. RLS — équipe back-office (admin/sec/com/compta, même périmètre que
--    contrats_acces) + créateur systématiquement (cf. §5 en tête de fichier)
-- ────────────────────────────────────────────────────────────────────────

drop policy if exists "agenda_sec_select" on secretariat_agenda_events;
create policy "agenda_sec_select" on secretariat_agenda_events for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','com','compta'))
  or created_by = auth.uid()
);

drop policy if exists "agenda_sec_insert" on secretariat_agenda_events;
create policy "agenda_sec_insert" on secretariat_agenda_events for insert with check (
  created_by = auth.uid()
  and exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','com','compta'))
);

-- UPDATE couvre "marquer terminé", "reporter" (nouvelle date_heure +
-- statut='reporte' + date_heure_initiale renseignée côté appelant) et
-- "associer à un client/candidat/devis/document" après coup.
drop policy if exists "agenda_sec_update" on secretariat_agenda_events;
create policy "agenda_sec_update" on secretariat_agenda_events for update using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','com','compta'))
  or created_by = auth.uid()
);

-- DELETE volontairement plus strict que SELECT/UPDATE (cf. §5) : admin ou
-- créateur uniquement. Le flux normal de fin de tâche reste "marquer
-- terminé" (UPDATE), pas une suppression.
drop policy if exists "agenda_sec_delete" on secretariat_agenda_events;
create policy "agenda_sec_delete" on secretariat_agenda_events for delete using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  or created_by = auth.uid()
);


-- ────────────────────────────────────────────────────────────────────────
-- 4. Extension du mécanisme existant : deux nouveaux déclencheurs temporels
--    qui RÉUTILISENT notify_staff_by_role() (déjà en base depuis
--    migration-portail-v10.sql, signature actuelle à 7 arguments posée par
--    migration-connect-v78-signup-unifie-clubplus.sql) — aucune nouvelle
--    fonction de notification n'est créée. Même patron que
--    check_devis_sans_reponse()/check_factures_en_retard()
--    (migration-finance-relances-auto.sql) : boucle quotidienne pg_cron,
--    correspondance exacte sur un nombre de jours pour ne déclencher qu'une
--    seule fois par échéance.
-- ────────────────────────────────────────────────────────────────────────

-- 4a. Devis envoyé dont la date d'expiration approche (J-3), sans réponse.
create or replace function check_devis_expiration_proche()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_devis record;
begin
  for v_devis in
    select id, numero, client_id, total_ttc, date_expiration
    from devis
    where statut = 'envoyé'
      and date_expiration is not null
      and date_acceptation is null
      and date_expiration - current_date = 3
  loop
    -- Idempotence : n'insère l'événement d'agenda que s'il n'existe pas déjà
    -- pour ce devis (une seule ligne 'relance_devis' active par devis).
    if not exists (
      select 1 from secretariat_agenda_events
      where devis_id = v_devis.id and type = 'relance_devis' and statut != 'termine'
    ) then
      insert into secretariat_agenda_events (
        type, titre, description, date_heure, statut, client_id, devis_id
      ) values (
        'relance_devis',
        'Devis ' || coalesce(v_devis.numero, '') || ' — expire bientôt',
        'Ce devis expire dans 3 jours et n''a pas encore été accepté. Relancer le client.',
        v_devis.date_expiration::timestamptz,
        'a_faire',
        v_devis.client_id,
        v_devis.id
      );
    end if;

    perform notify_staff_by_role(
      array['admin','sec'],
      'Devis ' || coalesce(v_devis.numero, '') || ' — expire dans 3 jours',
      'Aucune réponse reçue. Une relance a été ajoutée à l''Agenda Secrétaire.',
      'normale',
      null,
      v_devis.client_id
    );
  end loop;
end;
$$;

-- 4b. Contrat actif sans renouvellement automatique dont la fin approche (J-14).
create or replace function check_contrats_renouvellement_proche()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_contrat record;
begin
  for v_contrat in
    select id, client_id, type_contrat, date_fin
    from contrats
    where statut = 'actif'
      and renouvellement_auto = false
      and date_fin is not null
      and date_fin - current_date = 14
  loop
    if not exists (
      select 1 from secretariat_agenda_events
      where contrat_id = v_contrat.id and type = 'renouvellement' and statut != 'termine'
    ) then
      insert into secretariat_agenda_events (
        type, titre, description, date_heure, statut, client_id, contrat_id
      ) values (
        'renouvellement',
        'Contrat ' || coalesce(v_contrat.type_contrat, '') || ' — échéance dans 14 jours',
        'Contrat sans renouvellement automatique : préparer la reconduction ou la fin de relation.',
        v_contrat.date_fin::timestamptz,
        'a_faire',
        v_contrat.client_id,
        v_contrat.id
      );
    end if;

    perform notify_staff_by_role(
      array['admin','sec'],
      'Contrat — échéance dans 14 jours',
      'Renouvellement manuel à préparer. Un rappel a été ajouté à l''Agenda Secrétaire.',
      'normale',
      null,
      v_contrat.client_id
    );
  end loop;
end;
$$;

-- Même prudence que notify_staff_by_role (migration-securite-notify-staff-by-role.sql) :
-- ces fonctions ne doivent pas être appelables directement en RPC public
-- (elles n'ont aucun paramètre arbitraire exploitable pour du spam, mais on
-- garde le principe "pas d'exécution PostgREST par défaut" pour toute
-- fonction security definer qui écrit en base).
revoke execute on function check_devis_expiration_proche() from public, anon, authenticated;
revoke execute on function check_contrats_renouvellement_proche() from public, anon, authenticated;

-- Planification quotidienne (7h40, juste après les relances finance de
-- migration-finance-relances-auto.sql à 7h30/7h35, pour rester dans le même
-- créneau que le reste des tâches planifiées de nuit/matin).
create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'sportvision-check-devis-expiration-proche';
select cron.schedule(
  'sportvision-check-devis-expiration-proche',
  '40 7 * * *',
  $$select check_devis_expiration_proche();$$
);

select cron.unschedule(jobid) from cron.job where jobname = 'sportvision-check-contrats-renouvellement-proche';
select cron.schedule(
  'sportvision-check-contrats-renouvellement-proche',
  '45 7 * * *',
  $$select check_contrats_renouvellement_proche();$$
);
