-- Fix sécurité : la policy "clubs_admin_update" (migration-clubplus-v9.sql)
-- autorise un admin de club à modifier N'IMPORTE QUELLE colonne de sa propre
-- fiche `clubs` — la migration v9 le documentait déjà elle-même comme une
-- limite connue ("le client n'envoie jamais plan/engagement/pilot_mode/
-- credits_* dans cette requête [...] À durcir avec un trigger si
-- nécessaire"), jamais faite depuis. En pratique, un admin de club pouvait
-- se donner des crédits illimités (credits_balance), changer son propre
-- plan sans payer, ou désactiver pilot_mode, par un simple PATCH direct à
-- l'API REST Supabase (clé publishable déjà visible dans le HTML + son
-- propre jeton de session). Découvert le 2026-08-06, avant la mise en place
-- de la facturation Stripe récurrente — condition préalable pour que cette
-- dernière ne soit pas contournable.
--
-- Colonnes protégées (staff SportVision ou déplacement automatique via
-- edge function service-role uniquement) : plan, engagement, pilot_mode,
-- credits_balance, credits_monthly, credits_reserved, portail_client_id,
-- et toute colonne stripe_* ajoutée par la migration facturation.
-- Restent modifiables par l'admin de club : nom, ville, discipline, saison,
-- logo_url, ecusson_url, role_permissions, membership_validation_mode —
-- son identité et ses préférences, pas sa facturation.
--
-- Idempotente. À exécuter dans Supabase → SQL Editor.

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
  then
    raise exception 'Modification non autorisée : formule, engagement, crédits et rattachement Portail sont réservés au staff SportVision.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_sensitive_club_fields on clubs;
create trigger trg_protect_sensitive_club_fields
  before update on clubs
  for each row execute function protect_sensitive_club_fields();
