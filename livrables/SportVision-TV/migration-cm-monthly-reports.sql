-- ============================================================
-- Migration : monthly_reports — reporting mensuel automatique
-- (spec Refonte CM §41-42 : "L'OS prépare le rapport, le CM le relit puis
-- l'envoie.").
--
-- ─── Contexte ────────────────────────────────────────────────────────────
-- genererRapportClient() (SportVision-OS-Full.html, vue cm.rapports)
-- construit déjà un résumé texte à partir des vraies données `contenus`
-- du mois (publications, en cours, en retard) — mais ne le sauvegardait
-- jamais : le résultat vivait uniquement dans la variable JS
-- _rapportTexteActuel, perdu au rechargement, sans aucune trace de ce qui
-- a été envoyé à quel client et quand. Audité avant création : aucune
-- table `monthly_reports`/`*rapport*`/`*report*` existante ne couvre ce
-- besoin (seule `media_reports` existe, signalements de médias, sans
-- rapport avec le reporting client) — nouvelle table légitime.
--
-- ─── Workflow (§42) ────────────────────────────────────────────────────
-- À générer (aucune ligne) -> Brouillon (généré, à relire) -> Prêt
-- (relu par le CM) -> Envoyé (transmis au club, horodaté). Le statut
-- "à générer" n'a pas de représentation en base : c'est simplement
-- l'absence de ligne (client_id, mois). Une régénération (bouton
-- "Générer" réutilisé sur un mois déjà rapporté) fait upsert sur
-- (client_id, mois) et repart de "brouillon" — le contenu a changé,
-- il doit être re-relu avant un nouvel envoi, même si l'ancien avait déjà
-- été envoyé (envoye_at/envoye_par sont alors explicitement remis à
-- null par l'appelant plutôt que par un DEFAULT, pour ne pas dépendre de
-- l'ordre des colonnes dans le payload d'upsert PostgREST).
--
-- ─── RLS ─────────────────────────────────────────────────────────────────
-- Lecture/écriture : CM propriétaire (cm_id = auth.uid()) sur ses propres
-- rapports, + admin, + niveau Responsable (profiles.cm_niveau_autonomie =
-- 'responsable', pattern repris de contenus_responsable_all dans
-- migration-cm-tiers.sql) qui doivent voir tous les rapports de l'équipe
-- pour le KPI "Rapports à envoyer" du Pilotage CM (§43). Écriture CM
-- propriétaire limitée à select/insert/update (jamais delete — un
-- historique envoyé ne doit pas pouvoir disparaître sous un CM standard,
-- seuls admin/Responsable le peuvent via leurs policies "for all").
--
-- envoye_par/envoye_at ne sont jamais pris tels quels du payload client :
-- un trigger les pose côté serveur au moment où statut passe à 'envoye',
-- même pattern que set_contenu_stats_saisi() (migration-cm-contenu-
-- stats.sql) — évite qu'un CM attribue un envoi à quelqu'un d'autre ou
-- falsifie la date.
--
-- Additive, idempotente (create table if not exists, drop policy/trigger
-- if exists avant chaque create). Réutilise update_updated_at_generic(),
-- déjà créée par migration-clubplus-v1.sql.
--
-- EXÉCUTÉE et vérifiée en base réelle le 29/08/2026 : table, policies et
-- triggers créés (Management API) ; RLS testée avec 3 vrais comptes CM
-- (owner/autre CM/Responsable, JWT réels, pas la clé service) — un CM
-- tiers ne voit pas le rapport, ne peut pas spoofer cm_id à l'insert ni
-- envoye_par/envoye_at au passage à 'envoye' (écrasés par le trigger),
-- le Responsable voit tout, l'upsert par (client_id, mois) repart bien de
-- 'brouillon' avec envoye_at/envoye_par remis à null. Comptes et données
-- de test supprimés après vérification.
-- ============================================================

-- ─── 1. Table ────────────────────────────────────────────────────────────
create table if not exists monthly_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade not null,
  cm_id uuid references profiles(id) not null,
  mois text not null,
  statut text not null default 'brouillon' check (statut in ('brouillon','pret','envoye')),
  contenu_texte text,
  genere_at timestamptz not null default now(),
  envoye_at timestamptz,
  envoye_par uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(client_id, mois)
);
create index if not exists idx_monthly_reports_client on monthly_reports(client_id, mois desc);
create index if not exists idx_monthly_reports_cm on monthly_reports(cm_id);
create index if not exists idx_monthly_reports_statut on monthly_reports(statut);

alter table monthly_reports enable row level security;

-- ─── 2. Triggers ─────────────────────────────────────────────────────────
create or replace function set_monthly_report_envoi()
returns trigger language plpgsql as $$
begin
  if new.statut = 'envoye' and old.statut is distinct from 'envoye' then
    new.envoye_par = auth.uid();
    new.envoye_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_monthly_report_envoi on monthly_reports;
create trigger trg_monthly_report_envoi
  before update on monthly_reports
  for each row execute function set_monthly_report_envoi();

create or replace function update_updated_at_generic()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_monthly_reports_upd on monthly_reports;
create trigger trg_monthly_reports_upd
  before update on monthly_reports
  for each row execute procedure update_updated_at_generic();

-- ─── 3. Policies ─────────────────────────────────────────────────────────
drop policy if exists "monthly_reports_admin_all" on monthly_reports;
create policy "monthly_reports_admin_all" on monthly_reports for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
) with check (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

drop policy if exists "monthly_reports_responsable_all" on monthly_reports;
create policy "monthly_reports_responsable_all" on monthly_reports for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.cm_niveau_autonomie = 'responsable')
) with check (
  exists (select 1 from profiles p where p.id = auth.uid() and p.cm_niveau_autonomie = 'responsable')
);

drop policy if exists "monthly_reports_owner_select" on monthly_reports;
create policy "monthly_reports_owner_select" on monthly_reports for select using (
  cm_id = auth.uid()
);

drop policy if exists "monthly_reports_owner_insert" on monthly_reports;
create policy "monthly_reports_owner_insert" on monthly_reports for insert with check (
  cm_id = auth.uid()
);

drop policy if exists "monthly_reports_owner_update" on monthly_reports;
create policy "monthly_reports_owner_update" on monthly_reports for update using (
  cm_id = auth.uid()
) with check (
  cm_id = auth.uid()
);
