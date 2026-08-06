-- Ajoute le suivi de l'avoir Pennylane créé automatiquement lors d'un
-- remboursement Stripe total (voir stripe-webhook, event charge.refunded).
-- Traçabilité uniquement — ne bloque jamais le remboursement lui-même si
-- la création de l'avoir échoue (best-effort, staff notifié en secours).

alter table factures add column if not exists pennylane_credit_note_id text;
