-- ============================================================
-- SPORTVISION PORTAIL — Migration v8
-- Corrige une collision découverte à l'audit : le Portail (migration-portail-v2/v3)
-- avait ajouté ses propres colonnes de signature (statut_signature, signataire_nom,
-- signe_at) sur `contrats`, sans savoir qu'un système de signature plus complet
-- existait déjà côté OS (migration-phase3-4-5.sql, colonnes signature_statut /
-- signature_demandee_at / signature_confirmee_at, utilisé aussi sur `devis`,
-- avec son propre workflow "✉ Demander signature" → "✓ Confirmer").
--
-- Résultat avant ce correctif : un client qui signe un contrat depuis le Portail
-- écrit dans des colonnes que l'OS ne lit jamais. Le staff ne voit rien.
--
-- Ce correctif fait du système de l'OS la seule source de vérité :
-- 1. Migre les données existantes (au cas où un contrat aurait déjà été "signé"
--    via l'ancien système du Portail)
-- 2. Remplace la vue et la fonction du Portail pour lire/écrire signature_statut
-- Idempotente. À exécuter après migration-portail-v7.sql.
-- ============================================================

-- 1. Migration des données existantes (no-op si aucun contrat n'a encore été signé via le Portail)
update contrats
set signature_statut = 'signee',
    signature_confirmee_at = coalesce(signature_confirmee_at, signe_at, now())
where statut_signature = 'signe' and (signature_statut is null or signature_statut = 'non_demandee');

-- 2. Vue client_contrats : expose signature_statut (le vrai champ lu par l'OS)
drop view if exists client_contrats;
create view client_contrats as
select
  c.id, c.type_contrat, c.statut,
  c.signature_statut, c.signature_demandee_at, c.signature_confirmee_at,
  c.client_id, c.prestation_id, c.montant_mensuel, c.frequence, c.date_debut, c.date_fin,
  c.created_at, c.updated_at
from contrats c
where exists (
  select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = c.client_id
);

-- 3. Signature côté client : ne s'applique que si le staff a explicitement demandé
-- la signature (signature_statut = 'demandee'), comme le veut le workflow de l'OS.
create or replace function client_sign_contrat(p_contrat_id uuid, p_signataire_nom text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_signature_statut text;
begin
  select client_id, signature_statut into v_client_id, v_signature_statut from contrats where id = p_contrat_id;

  if v_client_id is null then
    raise exception 'Contrat introuvable';
  end if;

  if not exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = v_client_id) then
    raise exception 'Non autorisé';
  end if;

  if v_signature_statut is distinct from 'demandee' then
    raise exception 'Ce contrat n''est pas en attente de signature';
  end if;

  if p_signataire_nom is null or length(trim(p_signataire_nom)) < 2 then
    raise exception 'Merci de renseigner le nom du signataire';
  end if;

  update contrats
  set signature_statut = 'signee', signature_confirmee_at = now(), signataire_nom = p_signataire_nom, updated_at = now()
  where id = p_contrat_id;

  insert into document_events (event_type, document_ref, document_type, description)
  values ('signature', p_contrat_id::text, 'contrat', 'Contrat signé par le client (signature simulée) : ' || p_signataire_nom);
end;
$$;

revoke all on function client_sign_contrat(uuid, text) from public;
grant execute on function client_sign_contrat(uuid, text) to authenticated;

-- Les anciennes colonnes statut_signature / signe_at ne sont plus utilisées par personne
-- (le Portail lit désormais signature_statut). On les laisse en place plutôt que de les
-- supprimer, pour ne rien casser si un ancien rapport ou export y fait encore référence.
