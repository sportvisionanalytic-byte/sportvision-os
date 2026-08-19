-- ============================================================
-- Migration : contenu_stats — statistiques de performance saisies
-- manuellement par le CM (remplace le stockage localStorage sv_an_stats
-- de l'écran cm.analytics — Phase 5 du plan Tier C, "Saisie manuelle de
-- statistiques (remplace Metricool pour l'instant)").
--
-- ─── Contexte ────────────────────────────────────────────────────────────
-- Décidé avec Fouka (10/08) : pas d'intégration Metricool réelle pour le
-- moment (nécessite le plan payant "Advanced" + un token, pas encore en
-- place). L'écran cm.analytics (SportVision-OS-Full.html) affichait déjà
-- 3 chiffres "saisis manuellement" (Instagram Reach / Facebook Portée /
-- YouTube Vues, badge "✍️ saisi manuellement") mais stockés en
-- localStorage côté navigateur du CM (clé sv_an_stats) — jamais en base,
-- jamais partagés entre CM, perdus au changement de poste ou de machine.
-- `contenus` (migration-contenus.sql) n'a par ailleurs AUCUNE colonne de
-- performance : portee/engagement/vues n'existent nulle part côté serveur,
-- ce qui bloquait aussi /publications et /reports côté app-next (mock
-- fabriqué, src/lib/mock/communication.ts).
--
-- ─── Changement de granularité assumé ────────────────────────────────────
-- Avant : 3 chiffres globaux, saisis "au doigt mouillé" une fois par mois
-- pour l'ensemble du portefeuille CM, sans lien avec un contenu précis.
-- Après : une ligne contenu_stats par CONTENU PUBLIÉ (contenu_id unique,
-- upsert), traçable jusqu'au post exact et à la personne qui a saisi la
-- donnée (saisi_par/saisi_le). Les tuiles "vue d'ensemble" de cm.analytics
-- sont recalculées par agrégation à l'affichage plutôt que d'être un champ
-- libre — plus précis, plus honnête (un contenu jamais renseigné n'entre
-- dans aucune agrégation, jamais compté comme 0), et directement
-- réutilisable par /publications et /reports côté app-next sans nouvelle
-- table.
--
-- ─── RLS ─────────────────────────────────────────────────────────────────
-- Écriture (insert/update/delete) : réservée au CM propriétaire du contenu
-- (contenus.cm_id = auth.uid()) ou au Lead CM (profiles.niveau_cm =
-- 'cm_lead', pattern repris de migration-cm-tiers.sql) — jamais par le
-- client, jamais par un CM tiers qui n'a que la visibilité du client sans
-- avoir la main sur ce contenu précis. Volontairement plus restrictif que
-- l'édition collaborative de `contenus` elle-même (contenus_update
-- accepte tout CM avec contenus_visible_par_cm) : la saisie de stats reste
-- au propriétaire/Lead pour éviter des écrasements accidentels par un CM
-- qui ne fait que consulter le client via son palier.
--
-- Lecture : CM avec accès au contenu — cm_id = auth.uid(), Lead CM, ou
-- contenus_visible_par_cm(client_id, uid) (migration-contenus.sql /
-- migration-client-affiliations.sql, choke point unique déjà utilisé
-- partout ailleurs pour le périmètre par palier CM) — + client avec accès
-- légitime au contenu. Cette seconde branche réutilise EXACTEMENT la
-- condition de "contenus_client_select"
-- (migration-clubplus-v34-club-messages-contenus-access.sql) : le contenu
-- doit être dans un statut déjà visible côté client (pas brouillon/
-- a_valider_interne) ET l'appelant doit être soit l'unique client_users
-- historique, soit un membre actif du club lié via
-- club_member_has_client_access() — non réinventée.
--
-- Additive, idempotente (create table if not exists, drop policy/trigger
-- if exists avant chaque create). À exécuter APRÈS migration-contenus.sql,
-- migration-cm-tiers.sql, migration-client-affiliations.sql et
-- migration-clubplus-v34-club-messages-contenus-access.sql (dont elle
-- réutilise contenus_visible_par_cm() et club_member_has_client_access()).
--
-- EXÉCUTÉE — vérifié en base réelle le 19/08/2026 (audit pré-lancement) :
-- table contenu_stats, fonctions set_contenu_stats_saisi/
-- update_updated_at_generic et policies contenu_stats_admin_all/select/
-- insert/update/delete existent déjà en base. Cet en-tête disait à tort
-- "NON EXÉCUTÉE".
-- ============================================================

-- ─── 1. Table ────────────────────────────────────────────────────────────
create table if not exists contenu_stats (
  id uuid primary key default gen_random_uuid(),
  contenu_id uuid references contenus(id) on delete cascade not null unique,
  portee integer,
  engagement integer,
  vues integer,
  saisi_par uuid references profiles(id),
  saisi_le timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_contenu_stats_contenu on contenu_stats(contenu_id);

alter table contenu_stats enable row level security;

-- ─── 2. Trigger : saisi_par/saisi_le posés côté serveur, jamais confiés au
-- payload client — évite qu'un CM (ou un bug côté OS) attribue une saisie
-- à quelqu'un d'autre ou falsifie la date de saisie. ────────────────────
create or replace function set_contenu_stats_saisi()
returns trigger language plpgsql as $$
begin
  new.saisi_par = auth.uid();
  new.saisi_le = now();
  return new;
end;
$$;

drop trigger if exists trg_contenu_stats_saisi on contenu_stats;
create trigger trg_contenu_stats_saisi
  before insert or update on contenu_stats
  for each row execute function set_contenu_stats_saisi();

-- updated_at générique : réutilise update_updated_at_generic(), déjà créée
-- par migration-clubplus-v1.sql (recréée par CREATE OR REPLACE, no-op si
-- déjà présente).
create or replace function update_updated_at_generic()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_contenu_stats_upd on contenu_stats;
create trigger trg_contenu_stats_upd
  before update on contenu_stats
  for each row execute procedure update_updated_at_generic();

-- ─── 3. Policies ─────────────────────────────────────────────────────────
drop policy if exists "contenu_stats_admin_all" on contenu_stats;
create policy "contenu_stats_admin_all" on contenu_stats for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- Lecture : CM avec accès au contenu (portefeuille/palier/Lead CM) OU
-- client avec accès légitime (même condition que contenus_client_select,
-- réutilisée telle quelle).
drop policy if exists "contenu_stats_select" on contenu_stats;
create policy "contenu_stats_select" on contenu_stats for select using (
  exists (
    select 1 from contenus c where c.id = contenu_stats.contenu_id and (
      c.cm_id = auth.uid()
      or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
      or contenus_visible_par_cm(c.client_id, auth.uid())
      or (
        c.statut not in ('brouillon','a_valider_interne')
        and (
          exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = c.client_id)
          or club_member_has_client_access(c.client_id)
        )
      )
    )
  )
);

-- Écriture : CM propriétaire du contenu ou Lead CM uniquement. Jamais le
-- client (aucune branche client_users/club_member_has_client_access ici,
-- volontairement absente contrairement à la policy select ci-dessus).
drop policy if exists "contenu_stats_insert" on contenu_stats;
create policy "contenu_stats_insert" on contenu_stats for insert with check (
  exists (
    select 1 from contenus c where c.id = contenu_stats.contenu_id and (
      c.cm_id = auth.uid()
      or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
    )
  )
);

drop policy if exists "contenu_stats_update" on contenu_stats;
create policy "contenu_stats_update" on contenu_stats for update using (
  exists (
    select 1 from contenus c where c.id = contenu_stats.contenu_id and (
      c.cm_id = auth.uid()
      or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
    )
  )
) with check (
  exists (
    select 1 from contenus c where c.id = contenu_stats.contenu_id and (
      c.cm_id = auth.uid()
      or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
    )
  )
);

drop policy if exists "contenu_stats_delete" on contenu_stats;
create policy "contenu_stats_delete" on contenu_stats for delete using (
  exists (
    select 1 from contenus c where c.id = contenu_stats.contenu_id and (
      c.cm_id = auth.uid()
      or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
    )
  )
);
