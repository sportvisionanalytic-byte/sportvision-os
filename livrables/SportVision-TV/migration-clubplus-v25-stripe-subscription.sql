-- Abonnement Club+ récurrent (Stripe Subscriptions) — 2026-08-06
--
-- Jusqu'ici, l'abonnement Club+ était entièrement simulé : `clubs.plan`,
-- `clubs.engagement` et les crédits mensuels existaient en base, mais aucun
-- paiement récurrent n'y était rattaché (l'écran "Abonnement & crédits" de
-- app.html affichait des valeurs codées en dur, carte "•••• 4242" comprise).
-- Cette migration ajoute le lien vers Stripe :
--   * stripe_customer_id      — le client Stripe du club (créé une fois, réutilisé)
--   * stripe_subscription_id  — l'abonnement Stripe actif du club
--   * subscription_status     — miroir simplifié du statut Stripe, alimenté
--                               UNIQUEMENT par le webhook (edge function
--                               stripe-webhook, clé service_role) :
--                                 'actif'  ← subscription.status = active/trialing
--                                 'impaye' ← past_due / unpaid / incomplete
--                                 'annule' ← canceled / abonnement supprimé
--                               null = club sans abonnement Stripe (pilote,
--                               club créé avant cette migration, ou jamais payé).
--
-- Ces 3 colonnes sont ajoutées à la liste protégée par le trigger
-- trg_protect_sensitive_club_fields (migration-clubplus-v24) : sans ça, un
-- admin de club pouvait écrire lui-même son propre stripe_subscription_id /
-- subscription_status = 'actif' par un simple PATCH REST et se déclarer
-- abonné sans jamais payer — exactement la faille que v24 vient de fermer
-- pour plan/engagement/credits_*. Le trigger laisse passer la clé
-- service_role (auth.uid() est alors null, donc is_os_staff = false, mais le
-- webhook n'est pas soumis au RLS et le trigger ne bloque que les colonnes
-- listées pour les non-staff — vérifié empiriquement sur le projet réel :
-- les écritures service_role passent).
--
-- Le corps de protect_sensitive_club_fields() ci-dessous est celui de la v24,
-- inchangé, avec seulement les 3 nouvelles colonnes ajoutées. Le trigger
-- lui-même n'est pas recréé (déjà en place depuis la v24) : un
-- `create or replace function` suffit à mettre à jour la logique en place.
--
-- Idempotente. À exécuter dans Supabase → SQL Editor, après la v24.

alter table clubs add column if not exists stripe_customer_id text;
alter table clubs add column if not exists stripe_subscription_id text;
alter table clubs add column if not exists subscription_status text check (subscription_status in ('actif','impaye','annule')) default null;

-- Le webhook Stripe retrouve le club par son abonnement (customer.subscription.*,
-- invoice.paid, invoice.payment_failed) : sans index, chaque événement fait un
-- seq scan sur `clubs`.
create index if not exists idx_clubs_stripe_subscription_id on clubs (stripe_subscription_id);
create index if not exists idx_clubs_stripe_customer_id on clubs (stripe_customer_id);

create or replace function protect_sensitive_club_fields()
returns trigger language plpgsql security definer as $$
declare
  is_os_staff boolean;
begin
  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin', 'com', 'sec', 'compta')
  ) into is_os_staff;

  if is_os_staff then
    return new;
  end if;

  if new.plan is distinct from old.plan
     or new.engagement is distinct from old.engagement
     or new.pilot_mode is distinct from old.pilot_mode
     or new.credits_balance is distinct from old.credits_balance
     or new.credits_monthly is distinct from old.credits_monthly
     or new.credits_reserved is distinct from old.credits_reserved
     or new.portail_client_id is distinct from old.portail_client_id
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.subscription_status is distinct from old.subscription_status
  then
    raise exception 'Modification non autorisée : formule, engagement, crédits, rattachement Portail et abonnement Stripe sont réservés au staff SportVision.';
  end if;

  return new;
end;
$$;
