-- ============================================================
-- SPORTVISION PORTAIL — Migration v3
-- Signature simulée des contrats côté client (même principe que client_decide_devis :
-- une fonction dédiée qui ne touche que les colonnes de signature, jamais le reste du contrat).
-- Idempotente. À exécuter après migration-portail-v2.sql.
-- ============================================================

create or replace function client_sign_contrat(p_contrat_id uuid, p_signataire_nom text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_statut_signature text;
begin
  select client_id, statut_signature into v_client_id, v_statut_signature from contrats where id = p_contrat_id;

  if v_client_id is null then
    raise exception 'Contrat introuvable';
  end if;

  if not exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = v_client_id) then
    raise exception 'Non autorisé';
  end if;

  if v_statut_signature = 'signe' then
    raise exception 'Ce contrat est déjà signé';
  end if;

  if p_signataire_nom is null or length(trim(p_signataire_nom)) < 2 then
    raise exception 'Merci de renseigner le nom du signataire';
  end if;

  update contrats
  set statut_signature = 'signe', signataire_nom = p_signataire_nom, signe_at = now(), updated_at = now()
  where id = p_contrat_id;

  insert into document_events (event_type, document_ref, document_type, description)
  values ('signature', p_contrat_id::text, 'contrat', 'Contrat signé par le client (signature simulée) : ' || p_signataire_nom);
end;
$$;

revoke all on function client_sign_contrat(uuid, text) from public;
grant execute on function client_sign_contrat(uuid, text) to authenticated;
