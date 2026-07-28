-- Migration : Messagerie privée et équipe
-- Remplace l'usage de la table notifications pour les messages
-- Idempotente — exécuter dans Supabase → SQL Editor

-- 1. Table messages (conversations privées + messages équipe)
create table if not exists messages (
  id            uuid default gen_random_uuid() primary key,
  expediteur_id uuid not null references profiles(id) on delete cascade,
  destinataire_id uuid references profiles(id) on delete cascade, -- null = message équipe broadcast
  contenu       text not null,
  lue           boolean default false,
  created_at    timestamptz default now()
);

alter table messages enable row level security;

drop policy if exists "msg_select"  on messages;
drop policy if exists "msg_insert"  on messages;
drop policy if exists "msg_update"  on messages;

-- Lecture : je vois mes messages envoyés ET reçus, et les messages équipe (destinataire_id IS NULL)
create policy "msg_select" on messages for select using (
  auth.uid() = expediteur_id
  or auth.uid() = destinataire_id
  or (destinataire_id is null and exists (select 1 from profiles where id = auth.uid()))
);

-- Envoi : n'importe quel utilisateur authentifié peut envoyer
create policy "msg_insert" on messages for insert with check (
  auth.uid() = expediteur_id
);

-- Marquer comme lu : le destinataire peut mettre à jour lue
create policy "msg_update" on messages for update using (
  auth.uid() = destinataire_id
  or (destinataire_id is null and exists (select 1 from profiles where id = auth.uid()))
);

-- Index pour les requêtes de conversation
create index if not exists idx_msg_destinataire on messages(destinataire_id, created_at desc);
create index if not exists idx_msg_expediteur   on messages(expediteur_id, created_at desc);
create index if not exists idx_msg_equipe       on messages(created_at desc) where destinataire_id is null;

-- 2. Corriger les anciennes politiques RLS de notifications pour les messages
--    (garder notifications pour les vraies notifs système, pas les messages)
drop policy if exists "notif_send_message"    on notifications;
drop policy if exists "notifs_messages_broadcast" on notifications;

-- Les vraies politiques sur notifications (notifs système uniquement)
drop policy if exists "notifs_own_select" on notifications;
drop policy if exists "notifs_own_insert" on notifications;
drop policy if exists "notifs_own_update" on notifications;

create policy "notifs_own_select" on notifications for select using (
  auth.uid() = destinataire_id
);

create policy "notifs_own_insert" on notifications for insert with check (
  auth.uid() is not null
);

create policy "notifs_own_update" on notifications for update using (
  auth.uid() = destinataire_id
);
