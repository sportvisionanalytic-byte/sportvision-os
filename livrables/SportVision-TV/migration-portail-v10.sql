-- ============================================================
-- SPORTVISION PORTAIL — Migration v10
-- Notifie activement le staff (cloche de notifications déjà existante dans
-- l'OS, alimentée par dispatchSVEvent côté navigateur) quand un événement
-- vient du Portail. Comme mes Edge Functions ne peuvent pas appeler une
-- fonction JS qui vit dans le navigateur de quelqu'un d'autre, on obtient
-- le même résultat avec des triggers Postgres, qui se déclenchent quelle
-- que soit l'origine de l'écriture (Portail connecté, invité, webhook Stripe).
-- Reprend le même format que dispatchSVEvent (type='systeme', mêmes colonnes)
-- pour apparaître exactement comme les autres notifications dans l'OS.
-- Idempotente. À exécuter après migration-portail-v9.sql.
-- ============================================================

create or replace function notify_staff_by_role(p_roles text[], p_titre text, p_message text, p_priorite text, p_prestation_id uuid, p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (type, titre, message, destinataire_id, lue, priorite, lien_prestation_id, lien_client_id, created_at)
  select 'systeme', p_titre, p_message, pr.id, false, p_priorite, p_prestation_id, p_client_id, now()
  from profiles pr
  where pr.role = any(p_roles);
end;
$$;

-- 1. Nouvelle demande reçue depuis le Portail (client connecté ou invité)
create or replace function trg_notify_nouvelle_demande()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Ne notifie que les demandes venues du Portail (created_by nul : l'OS renseigne
  -- toujours created_by quand un membre du staff crée une prestation lui-même,
  -- sans quoi le staff serait notifié de ses propres créations).
  if new.statut = 'demande_reçue' and new.created_by is null then
    perform notify_staff_by_role(
      array['admin','sec'],
      'Nouvelle demande reçue' || case when new.reference is not null then ' — ' || new.reference else '' end,
      coalesce(new.type_prestation, 'Prestation') || ' — à qualifier depuis Demandes entrantes.',
      'high',
      new.id,
      new.client_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prestations_notify_demande on prestations;
create trigger trg_prestations_notify_demande
  after insert on prestations
  for each row execute procedure trg_notify_nouvelle_demande();

-- 2. Paiement confirmé via Stripe — PAS de trigger générique ici : un trigger sur
-- toute mise à jour de statut_financier se déclencherait aussi quand le staff
-- confirme lui-même un paiement manuel depuis l'OS (redondant, il le sait déjà).
-- À la place, stripe-webhook appelle directement notify_staff_by_role() après
-- confirmation, pour ne notifier que les vrais paiements en ligne. Les rôles
-- (sec + prod) reprennent le workflow payment.confirmed déjà existant côté OS.

-- 3. Nouveau message d'un client via la messagerie du Portail
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
      'medium',
      new.prestation_id,
      new.client_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_messages_client_notify on messages_client;
create trigger trg_messages_client_notify
  after insert on messages_client
  for each row execute procedure trg_notify_message_client();

-- 4. Nouvelle demande de rendez-vous depuis le Portail
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
    'medium',
    new.prestation_id,
    new.client_id
  );
  return new;
end;
$$;

drop trigger if exists trg_rdv_notify on rendez_vous;
create trigger trg_rdv_notify
  after insert on rendez_vous
  for each row execute procedure trg_notify_rdv_client();
