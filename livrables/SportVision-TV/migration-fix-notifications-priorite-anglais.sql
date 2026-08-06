-- ============================================================
-- SPORTVISION — corrige les valeurs anglaises de notifications.priorite
--
-- Bug trouvé le 2026-08-06 en testant en réel le nouveau parcours d'achat
-- de la vitrine (pas causé par lui — même famille de bug que le défaut
-- invalide de organizations.statut, corrigé juste avant dans
-- migration-connect-v8). La colonne notifications.priorite a été créée
-- avec un défaut anglais ('medium', migration-notifications-fix.sql),
-- puis une contrainte CHECK n'acceptant que des valeurs françaises a été
-- ajoutée plus tard sans que personne ne revienne corriger les appelants
-- (migration-phase3-4-5.sql : 'faible','normale','haute','urgente').
--
-- Toute insertion utilisant l'ancien vocabulaire anglais échoue depuis en
-- violation de contrainte :
--   "new row for relation notifications violates check constraint
--    notifications_priorite_check"
--
-- Effet concret : la notification interne au staff d'une nouvelle demande
-- (trg_notify_nouvelle_demande, déclenché sur toute prestation créée par
-- un visiteur — Portail ET vitrine) échouait à CHAQUE fois, ce qui faisait
-- échouer toute la transaction d'insertion de la prestation elle-même.
-- Même chose pour les notifications de message client, de demande de
-- rendez-vous, et les rappels automatiques de prestation du lendemain.
--
-- Recherche exhaustive faite sur tout le dossier : seuls ces 5 points
-- utilisaient encore l'ancien vocabulaire anglais (grep sur 'low'/'medium'/
-- 'high'/'urgent' dans un contexte priorite/notifications, tout le reste
-- du code utilise déjà correctement le vocabulaire français).
-- ============================================================

alter table notifications
  alter column priorite set default 'normale';

-- Rattrape les lignes déjà en base insérées avec l'ancien défaut anglais
-- avant que la contrainte n'existe (si la contrainte a été ajoutée après
-- coup sur une table déjà peuplée, ces lignes auraient été acceptées).
update notifications set priorite = 'normale' where priorite = 'medium';
update notifications set priorite = 'haute' where priorite = 'high';
update notifications set priorite = 'faible' where priorite = 'low';
update notifications set priorite = 'urgente' where priorite = 'urgent';

-- 1. Nouvelle demande reçue (Portail + vitrine) — 'high' → 'haute'
create or replace function trg_notify_nouvelle_demande()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.statut = 'demande_reçue' and new.created_by is null then
    perform notify_staff_by_role(
      array['admin','sec'],
      'Nouvelle demande reçue' || case when new.reference is not null then ' — ' || new.reference else '' end,
      coalesce(new.type_prestation, 'Prestation') || ' — à qualifier depuis Demandes entrantes.',
      'haute',
      new.id,
      new.client_id
    );
  end if;
  return new;
end;
$$;

-- 2. Nouveau message client — 'medium' → 'normale'
create or replace function trg_notify_message_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nom_client text;
begin
  if new.auteur_type = 'client' then
    select nom into v_nom_client from clients where id = new.client_id;
    perform notify_staff_by_role(
      array['admin','sec','prod'],
      'Nouveau message — ' || coalesce(v_nom_client, 'client'),
      left(new.contenu, 140),
      'normale',
      new.prestation_id,
      new.client_id
    );
  end if;
  return new;
end;
$$;

-- 3. Demande de rendez-vous — 'medium' → 'normale'
create or replace function trg_notify_rdv_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform notify_staff_by_role(
    array['admin','sec'],
    'Demande de rendez-vous',
    coalesce(new.objet, case when new.type_rdv = 'appel' then 'Appel téléphonique' else 'Rendez-vous physique' end) || ' — à confirmer.',
    'normale',
    new.prestation_id,
    new.client_id
  );
  return new;
end;
$$;

-- 4. Rappels automatiques de prestation du lendemain — 'medium' → 'normale'
create or replace function send_prestation_reminders()
returns void language plpgsql security definer as $$
begin
  insert into notifications (destinataire_id, type, titre, message, lien_prestation_id, lue, priorite, source_type, source_id)
  select
    pe.collaborateur_id,
    'rappel_prestation',
    'Rappel — prestation demain',
    'Vous intervenez demain sur '||coalesce(p.reference,'une prestation')||
      coalesce(' à '||to_char(p.heure_debut,'HH24:MI'),'')||
      coalesce(' — '||p.lieu,'')||'.',
    p.id,
    false,
    'normale',
    'prestations',
    p.id
  from prestations p
  join prestations_equipe pe on pe.prestation_id = p.id and pe.statut = 'acceptée'
  join profiles prof on prof.id = pe.collaborateur_id
  where p.date_prestation = (current_date + interval '1 day')::date
    and p.statut not in ('annulée','refusée','clôturée','livrée')
    and coalesce(prof.notification_prefs->>'rappels','true') != 'false'
    and not exists (
      select 1 from notifications n
      where n.type = 'rappel_prestation' and n.lien_prestation_id = p.id and n.destinataire_id = pe.collaborateur_id
    );
end;
$$;

-- ============================================================
-- NOTE — vérification recommandée après exécution
--
-- select conname, pg_get_constraintdef(oid) from pg_constraint
-- where conrelid = 'notifications'::regclass and conname = 'notifications_priorite_check';
--
-- Test manuel : insérer une nouvelle demande de devis (email jamais vu),
-- via le Portail ou la vitrine, doit maintenant réussir (HTTP 200,
-- reference renvoyée) au lieu d'échouer en 500.
-- ============================================================
