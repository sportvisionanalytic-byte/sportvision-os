-- migration-poles-v2-backfill-football.sql
--
-- Migration multi-pôles (Football + Basket), Lot 2 — Migration Football.
-- À exécuter APRÈS migration-poles-v1-fondations.sql.
--
-- Contenu :
--   1. Backfill INCONDITIONNEL de clients.pole_id / prestations.pole_id
--      vers le pôle Football sur toute ligne où pole_id est encore NULL.
--      Inconditionnel et volontaire : l'entreprise étant 100% Football
--      avant cette migration, toute ligne préexistante EST Football par
--      définition, indépendamment de ce que contient (ou pas) la colonne
--      texte libre `sport` — un matching `WHERE sport ILIKE 'football'`
--      serait plus fragile (prestations.sport est souvent NULL, vérifié
--      lors de l'audit préalable).
--   2. Fonction pole_football_id() + DEFAULT sur les deux colonnes : filet
--      de sécurité pour toute création qui omettrait pole_id pendant la
--      période où l'UI de sélection de pôle n'existe pas encore (Lot 4).
--   3. Bascule NOT NULL (après vérification intégrée que le backfill a
--      bien tout couvert — la migration s'arrête en erreur sinon, voir le
--      bloc DO ci-dessous).
--   4. Index sur les deux colonnes.
--   5. Trigger sync_prestation_pole_id : dérive automatiquement
--      prestations.pole_id depuis clients.pole_id à l'insert/update du
--      client_id — permet de NE PAS toucher aux ~85 points d'appel
--      `prestations?select=...`/`insert` de SportVision-OS-Full.html dans
--      cette tranche : le serveur déduit toujours le pôle depuis le
--      client, qui est de toute façon obligatoire sur toute prestation.
--
-- Idempotente : update ... where pole_id is null (sans effet si déjà
-- backfillé), create or replace function, alter column default (sans
-- effet si déjà posé), create trigger précédé d'un drop if exists.
--
-- ROLLBACK :
--   drop trigger if exists trg_sync_prestation_pole_id on prestations;
--   drop function if exists sync_prestation_pole_id();
--   alter table clients alter column pole_id drop not null;
--   alter table prestations alter column pole_id drop not null;
--   alter table clients alter column pole_id drop default;
--   alter table prestations alter column pole_id drop default;
--   drop function if exists pole_football_id();
--   -- Les valeurs déjà backfillées ne sont PAS supprimées par ce rollback :
--   -- elles restent correctes et inoffensives même si la fonctionnalité
--   -- pôle devait être abandonnée (clients/prestations gardent pole_id
--   -- nullable, pointant toujours vers le pôle Football réel).

-- ── 1. Backfill inconditionnel ───────────────────────────────────────────
update clients
set pole_id = (select id from poles where slug = 'football')
where pole_id is null;

update prestations
set pole_id = (select id from poles where slug = 'football')
where pole_id is null;

-- ── 2. Fonction pole_football_id() + DEFAULT ────────────────────────────
create or replace function pole_football_id()
returns uuid
language sql
stable
as $$
  select id from poles where slug = 'football' limit 1;
$$;

alter table clients alter column pole_id set default pole_football_id();
alter table prestations alter column pole_id set default pole_football_id();

-- ── 3. Vérification intégrée avant bascule NOT NULL ─────────────────────
do $$
declare
  v_clients_null int;
  v_prestations_null int;
begin
  select count(*) into v_clients_null from clients where pole_id is null;
  select count(*) into v_prestations_null from prestations where pole_id is null;
  if v_clients_null > 0 or v_prestations_null > 0 then
    raise exception 'Backfill incomplet : % clients et % prestations ont encore pole_id NULL — migration interrompue avant la bascule NOT NULL.', v_clients_null, v_prestations_null;
  end if;
end $$;

alter table clients alter column pole_id set not null;
alter table prestations alter column pole_id set not null;

-- ── 4. Index ──────────────────────────────────────────────────────────
create index if not exists idx_clients_pole_id on clients(pole_id);
create index if not exists idx_prestations_pole_id on prestations(pole_id);

-- ── 5. Trigger de dérivation automatique sur prestations ────────────────
create or replace function sync_prestation_pole_id()
returns trigger
language plpgsql
as $$
begin
  if new.client_id is not null then
    select pole_id into new.pole_id from clients where id = new.client_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_prestation_pole_id on prestations;
create trigger trg_sync_prestation_pole_id
  before insert or update of client_id on prestations
  for each row execute function sync_prestation_pole_id();
