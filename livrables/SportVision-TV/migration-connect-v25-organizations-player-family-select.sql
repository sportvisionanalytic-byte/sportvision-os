-- ============================================================
-- SPORTVISION CONNECT — Migration v25
-- Corrige le même défaut que migration-connect-v7-clubs-player-family-
-- select.sql, mais sur `organizations` cette fois (pas `clubs`).
--
-- ── Découverte (audit nuit 10-11/08, vérifiée en direct) ─────────────
-- `organizations` n'a qu'une policy SELECT réelle, "org_member_select"
-- (migration-connect-v2-organizations-entitlements.sql) :
--   is_org_member(id) or is_staff()
-- `is_org_member(p_org_id)` ne teste qu'une ligne `memberships` réelle
-- pour CETTE organisation précise. Or un espace Joueur Connect n'a
-- JAMAIS de ligne `memberships` pour l'organisation de son club : son
-- propre `ActiveContext.organization` est synthétique, construit
-- directement depuis `player_profiles` (voir session.ts §
-- buildPlayerActiveContext), pas depuis une ligne `organizations` à lui.
-- `is_org_member(club_id)` est donc toujours faux pour un joueur, alors
-- même que `player_profiles.club_id` = `organizations.id` du club
-- (organizations.id réutilise clubs.id pour un club — voir
-- migration-connect-v2-organizations-entitlements.sql § peuplement).
--
-- Conséquence vérifiée en direct avec un compte joueur affilié jetable :
-- PersonaDashboard.tsx (badge "CLUB ABONNÉ") et sponsors/page.tsx
-- (AffiliatedPlayerNotice) font tous deux
--   supabase.from("organizations").select("nom").eq("id", parentOrganizationId)
-- où parentOrganizationId = player_profiles.club_id. La policy bloque
-- silencieusement la lecture (RLS filtre la ligne, PostgREST répond 200
-- avec un tableau vide, .maybeSingle() renvoie null) — le badge affiche
-- donc littéralement "CLUB ABONNÉ · …" au lieu du vrai nom du club.
--
-- Exactement le même bug, sur une table différente, que celui corrigé
-- le 06/08 par migration-connect-v7-clubs-player-family-select.sql sur
-- `clubs` (utilisée par le legacy joueur-espace.js/famille-espace.js) —
-- cette fois côté `organizations` (utilisée par app-next/Connect).
--
-- ── Correctif ──────────────────────────────────────────────────────
-- Policy additive, purement lecture, même condition que
-- clubs_player_family_select : le joueur lui-même OU un parent CONFIRMÉ
-- de ce joueur (is_confirmed_parent_of, migration-clubplus-v13.sql),
-- scopée au club de CE joueur précis (pp.club_id = organizations.id) —
-- jamais un accès large à toutes les organisations. N'accorde accès à
-- aucune colonne sensible que org_member_select ne donnait déjà pas à
-- un membre réel : `organizations` n'expose que id/type/nom/ville/statut
-- et des colonnes legacy_*, RLS reste row-level ici (pas de colonne à
-- masquer), même raisonnement que pour clubs_player_family_select.
--
-- Idempotente (DROP POLICY IF EXISTS avant CREATE, rejouable sans effet
-- de bord). Dépend de is_confirmed_parent_of (migration-clubplus-
-- v13.sql) et de organizations/org_member_select (migration-connect-
-- v2-organizations-entitlements.sql), déjà en place.
--
-- À exécuter manuellement par Fouka dans Supabase → SQL Editor, après
-- relecture. Jamais exécutée automatiquement par un agent.
-- ============================================================

drop policy if exists "organizations_player_family_select" on organizations;
create policy "organizations_player_family_select" on organizations for select using (
  exists (
    select 1 from player_profiles pp
    where pp.club_id = organizations.id
      and (pp.user_id = auth.uid() or is_confirmed_parent_of(pp.id))
  )
);
