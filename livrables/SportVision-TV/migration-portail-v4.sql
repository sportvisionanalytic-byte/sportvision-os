-- ============================================================
-- SPORTVISION PORTAIL — Migration v4
-- Permet au client de marquer un message reçu du staff comme lu.
-- Fonction dédiée plutôt qu'une policy UPDATE large : une policy UPDATE sur
-- messages_client laisserait le client réécrire n'importe quelle colonne
-- (y compris `contenu`) sur un message qu'il n'a pas écrit lui-même.
-- Idempotente. À exécuter après migration-portail-v3.sql.
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

  if not exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = v_client_id) then
    raise exception 'Non autorisé';
  end if;

  update messages_client set lu = true where id = p_message_id;
end;
$$;

revoke all on function client_mark_message_read(uuid) from public;
grant execute on function client_mark_message_read(uuid) to authenticated;
