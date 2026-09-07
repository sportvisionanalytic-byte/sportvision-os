-- Migration : un envoi « tout de suite » ne doit pas échouer en silence
-- À exécuter APRÈS migration-galeries-v10-jetons-url.sql.
--
-- ── Le défaut, trouvé sur un vrai paiement ──
-- `enqueue_notification` a un DEFAULT `now()` sur p_scheduled_at, mais un DEFAULT ne s'applique
-- que si l'argument est OMIS. L'appelant qui passe explicitement `null` — pour dire « envoie
-- maintenant » — écrit donc null dans `notification_outbox.scheduled_at`, qui est NOT NULL.
-- L'insert échoue.
--
-- C'est exactement ce que faisait le webhook Stripe pour l'e-mail de commande galerie, depuis la
-- v5. Comme cet appel est enveloppé dans un try/catch (volontairement : un paiement encaissé ne
-- doit jamais faire échouer le webhook, sinon Stripe rejoue), l'erreur était avalée. Résultat :
-- l'e-mail « vos photos sont prêtes » n'est JAMAIS parti, et rien ne le signalait. Découvert le
-- 07/09 sur un paiement réel de 4 €, pas en relecture.
--
-- ── La correction ──
-- On corrige les deux bouts, et pas seulement l'appelant :
--
--   1. Ici : `coalesce(p_scheduled_at, now())`. Un null n'a qu'une seule lecture sensée — « pas de
--      date de programmation », donc maintenant. Le refuser était un piège, pas une protection.
--      Tout appelant présent ou futur qui passe null est réparé du même coup.
--   2. Dans le webhook : il cesse de passer null.
--
-- Corriger seulement l'appelant aurait laissé la mine en place pour le prochain.

begin;

create or replace function enqueue_notification(
  p_event_type text,
  p_template_key text,
  p_channel text,
  p_idempotency_key text,
  p_recipient_email text default null,
  p_recipient_phone text default null,
  p_recipient_user_id uuid default null,
  p_recipient_client_id uuid default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_scheduled_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  -- Un DEFAULT ne couvre pas le cas d'un null passé explicitement. `scheduled_at` étant NOT NULL,
  -- il faut retomber sur now() ici, sinon l'insert échoue pour un appelant qui voulait simplement
  -- dire « tout de suite ».
  v_quand timestamptz := coalesce(p_scheduled_at, now());
begin
  insert into notification_outbox (
    event_type, template_key, channel, idempotency_key,
    recipient_email, recipient_phone_e164, recipient_user_id, recipient_client_id,
    entity_type, entity_id, payload_json, scheduled_at, next_attempt_at
  ) values (
    p_event_type, p_template_key, p_channel, p_idempotency_key,
    p_recipient_email, p_recipient_phone, p_recipient_user_id, p_recipient_client_id,
    p_entity_type, p_entity_id, p_payload, v_quand, v_quand
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  return v_id; -- null si déjà existant (comportement voulu, pas une erreur)
end;
$$;

commit;
