-- ============================================================
-- SPORTVISION CONNECT — Migration v23 : accès `contenus`/`contenu_stats`
-- pour les membres d'une organisation `event`. Plan Tier C § Phase 4
-- « Eventtimeline / Live ».
--
-- ── Pourquoi cette migration est nécessaire ──────────────────────────────
-- `/live` (app-next) doit afficher le fil des publications du jour et les
-- tuiles de stats d'un événement, en lisant `contenus` (planning éditorial)
-- filtré sur `organizations.legacy_client_id` — exactement le même lien que
-- Séances/Stages (Phase 1). Mais la policy réelle actuelle,
-- "contenus_client_select" (dernière définition :
-- migration-clubplus-v34-club-messages-contenus-access.sql), n'autorise
-- QUE deux chemins : le compte `client_users` d'origine, ou un membre de
-- club via club_member_has_client_access(). Aucun des deux ne couvre un
-- membre d'organisation `event` — sans cette migration, /live recevrait
-- silencieusement zéro ligne pour TOUT événement, RLS obligeant, quel que
-- soit le contenu réellement publié pour son client lié.
--
-- migration-connect-v21-client-cm-view.sql (§ note de fin) avait déjà
-- anticipé ce trou exact pour un autre besoin (MyCM) et l'avait
-- délibérément reporté : "Elle n'est PAS ajoutée ici [...] à ajouter dans
-- une migration ultérieure une fois la Phase 1 posée et legacy_client_id
-- réellement peuplé." C'est fait (Phase 1, connect-org-signup peuple
-- legacy_client_id) — cette migration est cette suite, mais scopée
-- strictement à `event` (pas coach/académie, qui n'ont aucun besoin de lire
-- `contenus` dans le plan actuel — pas de branche non testée/morte ajoutée
-- ici, même discipline que la note v21).
--
-- ── Ce qui change ─────────────────────────────────────────────────────────
-- 1. contenus_client_select : ajoute une 3e branche — un membre actif
--    (is_org_member) d'une organisation organization_type='event' dont
--    legacy_client_id pointe vers ce contenu peut le lire, aux mêmes
--    conditions que les deux autres branches (statut déjà visible côté
--    client, jamais brouillon/a_valider_interne).
-- 2. contenu_stats_select (migration-cm-contenu-stats.sql) : même branche
--    ajoutée, pour que les tuiles "Portée du jour"/"Interactions" de /live
--    (data/shared/contenu-stats.ts, réutilisé tel quel) fonctionnent pour
--    un événement.
--
-- Aucun droit d'écriture ajouté : un événement reste lecture seule sur
-- `contenus`/`contenu_stats`, comme tous les autres espaces Connect non-CM.
--
-- Additive, idempotente (drop policy if exists / create policy), aucun
-- changement de structure de table. À exécuter après
-- migration-connect-v20-event-cm-agency-org-types.sql (type 'event'),
-- migration-clubplus-v34-club-messages-contenus-access.sql (dernière
-- définition connue de contenus_client_select) et
-- migration-cm-contenu-stats.sql (contenu_stats_select).
--
-- EXÉCUTÉE — vérifié en base réelle le 19/08/2026 (audit pré-lancement) :
-- policies contenus_client_select et contenu_stats_select existent déjà
-- en base. Cet en-tête disait à tort "NON EXÉCUTÉE".
-- ============================================================

-- ─── 1. contenus ─────────────────────────────────────────────────────────
drop policy if exists "contenus_client_select" on contenus;
create policy "contenus_client_select" on contenus for select using (
  statut not in ('brouillon','a_valider_interne')
  and (
    exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = contenus.client_id)
    or club_member_has_client_access(contenus.client_id)
    or exists (
      select 1 from organizations o
      where o.legacy_client_id = contenus.client_id
        and o.organization_type = 'event'
        and is_org_member(o.id)
    )
  )
);

-- ─── 2. contenu_stats ────────────────────────────────────────────────────
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
          or exists (
            select 1 from organizations o
            where o.legacy_client_id = c.client_id
              and o.organization_type = 'event'
              and is_org_member(o.id)
          )
        )
      )
    )
  )
);
