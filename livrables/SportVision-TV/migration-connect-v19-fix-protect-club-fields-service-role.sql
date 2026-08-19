-- ============================================================
-- Migration v19 — corrige protect_sensitive_club_fields() : bloquait aussi
-- les edge functions service-role, pas seulement les admins de club.
--
-- ─── Faille trouvée le 10/08/2026, en vérifiant en direct le fix de
-- clubplus-onboarding (portail_client_id) ────────────────────────────────
-- migration-clubplus-v24-protect-sensitive-fields.sql (puis v25, qui y a
-- ajouté les 3 colonnes stripe_*) protège à raison plan/engagement/
-- credits_*/portail_client_id/stripe_* contre un admin de club qui se les
-- modifierait lui-même — mais `is_os_staff` ne teste que `profiles.id =
-- auth.uid() and role in (...)`. Sous une connexion service-role (clé
-- secrète, utilisée par toutes les edge functions), `auth.uid()` est NULL
-- — aucune ligne `profiles` ne correspond jamais à NULL, donc
-- `is_os_staff` est TOUJOURS faux pour une edge function, et le trigger
-- rejette la mise à jour (exception Postgres, remontée en 400 côté
-- appelant).
--
-- Le commentaire de tête de migration-clubplus-v25-stripe-subscription.sql
-- (lignes 20-28) affirme pourtant explicitement l'inverse : "le trigger
-- laisse passer la clé service_role [...] vérifié empiriquement sur le
-- projet réel : les écritures service_role passent." **Cette affirmation
-- est fausse** — vérifié ce soir par un test direct (PATCH service-role
-- sur `clubs.portail_client_id` via un script isolé, hors edge function) :
-- rejeté avec exactement le message d'exception du trigger. La vérification
-- empirique d'origine devait porter sur un autre chemin (le webhook Stripe
-- lui-même écrit peut-être `stripe_customer_id` uniquement à l'INSERT d'un
-- nouveau client, pas en UPDATE sur une ligne existante — cette hypothèse
-- n'a pas été creusée davantage, seul le fait que le blocage est réel compte
-- ici) — retenue comme rappel : ne jamais faire confiance à un commentaire
-- affirmant une vérification passée sans la refaire soi-même.
--
-- Ce trigger bloquait donc SILENCIEUSEMENT le rattachement portail_client_id
-- de clubplus-onboarding depuis l'exécution de v24/v25 — pas seulement le
-- nouveau chemin "créer si aucune correspondance" ajouté cette nuit, mais
-- aussi l'ancien chemin "relier si correspondance d'e-mail" qui existait
-- déjà avant. Aggrave directement le problème documenté dans le rapport de
-- la nuit du 09-10/08 (§3.1) : même les rares cas de correspondance
-- réussie ne se traduisaient jamais réellement en base.
--
-- ─── Correctif ───────────────────────────────────────────────────────────
-- Reprend le corps exact de la v25 (avec les 3 colonnes stripe_*, pour ne
-- pas régresser leur protection) et autorise en plus `auth.role() =
-- 'service_role'` (fonction standard Supabase, lit le claim `role` du JWT
-- — 'service_role' pour une clé secrète, jamais falsifiable côté client
-- qui n'a que la clé publique). Un club admin reste bloqué (son JWT a
-- `role='authenticated'`) ; seule une Edge Function avec la clé secrète
-- passe désormais.
--
-- Idempotente (`create or replace`).
-- EXÉCUTÉE — vérifié en base réelle le 19/08/2026 (audit pré-lancement) :
-- la définition live de protect_sensitive_club_fields() contient bien la
-- branche `auth.role() = 'service_role'` ajoutée par cette migration
-- (correspondance exacte). Cet en-tête disait à tort "NON EXÉCUTÉE".
-- ============================================================

create or replace function protect_sensitive_club_fields()
returns trigger language plpgsql security definer as $$
declare
  is_os_staff boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

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

-- Le trigger existant (trg_protect_sensitive_club_fields, before update on
-- clubs) réutilise déjà cette fonction : `create or replace` la met à jour
-- en place, pas besoin de recréer le trigger lui-même.
