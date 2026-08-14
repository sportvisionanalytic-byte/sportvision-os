-- ============================================================
-- Migration v46 - client_mark_message_read reconnait le compte Joueur
--
-- Contexte : chantier "Messages" de l'Espace Joueur (agent app-connect, 14/08). La RPC
-- client_mark_message_read (migration-portail-v4.sql) ne verifie l'appelant que via
-- client_users :
--   if not exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = v_client_id)
--     then raise exception 'Non autorise';
-- Un compte Joueur n'a jamais de ligne client_users (voir migration-connect-v43-espace-joueur.sql
-- section 2, qui a rattache player_profiles a clients directement, pas a client_users). Resultat :
-- un joueur qui ouvre Messages ne peut jamais marquer un message du staff comme lu - la RPC echoue
-- systematiquement avec "Non autorise" pour lui. Le code Connect (MessagesThread.tsx) appelle deja
-- cette RPC en best-effort (erreurs avalees, aucun impact visible tant que ce correctif n'est pas
-- applique a part le badge non-lu qui ne se dissipe jamais) - ce correctif le debloque
-- explicitement en reutilisant player_has_client_access(), deja utilisee sur messages_client.
--
-- NON EXECUTEE PAR L'AGENT qui l'a ecrite. A relire puis executer par Fouka dans Supabase -> SQL
-- Editor. Idempotente (create or replace function).
-- ============================================================

create or replace function client_mark_message_read(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
begin
  select client_id into v_client_id from messages_client where id = p_message_id and auteur_type = 'staff';

  if v_client_id is null then
    return;
  end if;

  if not (
    exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = v_client_id)
    or player_has_client_access(v_client_id)
  ) then
    raise exception 'Non autorise';
  end if;

  update messages_client set lu = true where id = p_message_id;
end;
$$;

revoke all on function client_mark_message_read(uuid) from public;
grant execute on function client_mark_message_read(uuid) to authenticated;
