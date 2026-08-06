-- ============================================================
-- SPORTVISION CONNECT — v7 : synchronisation continue client_users → memberships
--
-- Contexte (2026-08-06) : la vitrine SportVision gagne un vrai parcours
-- d'achat (demande → création de compte → paiement Stripe), calqué sur
-- celui du Portail. Ce parcours suppose qu'un compte fraîchement créé via
-- portal-onboarding obtient IMMÉDIATEMENT accès à son espace "projet" dans
-- Connect (pour y voir sa prestation et payer l'acompte) — or ce n'était
-- pas le cas : v2 §3.4 avait inséré les memberships depuis client_users en
-- UNE SEULE FOIS (insert...select), pour l'état existant au moment de la
-- migration. Tout compte créé après v2 (donc tous les comptes réels)
-- n'obtenait aucun membership, et atterrissait sur "Aucun espace n'est
-- encore rattaché à ce compte" malgré une prestation bien enregistrée.
--
-- Comme v5 l'a fait pour clubs/clients → organizations, cette migration
-- transforme cette synchronisation en trigger continu.
--
-- Reprend exactement la même règle de résolution qu'en v2 §3.4 : si le
-- client est rattaché à un club (clubs.portail_client_id), l'appartenance
-- pointe vers l'organisation DU CLUB (même entité réelle) plutôt que vers
-- une organisation "projet" fantôme keyed sur clients.id.
-- ============================================================

create or replace function sync_client_user_to_membership()
returns trigger language plpgsql security definer as $$
declare
  target_org_id uuid;
begin
  select c.id into target_org_id from clubs c where c.portail_client_id = new.client_id limit 1;
  if target_org_id is null then
    target_org_id := new.client_id;
  end if;

  insert into memberships (user_id, organization_id, role, status, source)
  values (new.id, target_org_id, 'client', 'actif', 'client_users')
  on conflict (user_id, organization_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_sync_client_user_to_membership on client_users;
create trigger trg_sync_client_user_to_membership
  after insert on client_users
  for each row execute function sync_client_user_to_membership();

-- ============================================================
-- NOTE — vérification recommandée après exécution
--
-- Aucune ligne existante n'est modifiée (le trigger ne joue que sur les
-- futurs inserts). Pour les comptes déjà créés avant cette migration et
-- qui n'auraient toujours aucun membership malgré un client_users existant,
-- relancer ponctuellement l'insert de v2 §3.4 suffit à les rattraper :
--
-- insert into memberships (user_id, organization_id, role, status, source)
-- select cu.id,
--   coalesce((select c.id from clubs c where c.portail_client_id = cu.client_id limit 1), cu.client_id),
--   'client', 'actif', 'client_users'
-- from client_users cu
-- on conflict (user_id, organization_id) do nothing;
-- ============================================================
