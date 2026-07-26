-- Migration: fix messagerie équipe
-- À exécuter dans Supabase → SQL Editor
-- Permet à tous les utilisateurs authentifiés de lire les messages d'équipe

create policy "notifs_messages_broadcast" on notifications
  for select using (
    type = 'message'
    and exists (select 1 from profiles where id = auth.uid())
  );
