-- ============================================================
-- SPORTVISION CONNECT — Migration v6
-- Corrige un défaut trouvé en recette de l'espace Joueur & Famille
-- (2026-08-06) : `clubs` n'a que deux policies SELECT, `clubs_member_select`
-- (is_club_member, réservée au staff/dirigeants du club) et
-- `clubs_staff_all` (staff SportVision) — aucune n'autorise un joueur ou
-- un parent confirmé à lire les informations de base du club de son
-- enfant (nom, ville, discipline, saison, logo). Conséquence vérifiée en
-- live : l'embed `clubs(...)` de joueur-espace.js/famille-espace.js
-- renvoie systématiquement `null`, donc "Club non renseigné" pour tout
-- joueur réel, même correctement rattaché.
--
-- Fix : policy additive, purement lecture, scopée au club du joueur
-- concerné (via player_profiles.club_id) — n'accorde accès à AUCUNE
-- colonne sensible que `clubs_member_select` ne donnait déjà pas
-- (crédits, plan, abonnement Stripe restent protégés par le trigger
-- protect_sensitive_club_fields, qui ne dépend pas des policies SELECT).
--
-- Idempotente. À exécuter après migration-clubplus-v13.sql (définit
-- is_confirmed_parent_of) et migration-connect-v1b-securite-hardening-
-- backlog.sql (sans dépendance directe, juste postérieure dans le temps).
-- ============================================================

drop policy if exists "clubs_player_family_select" on clubs;
create policy "clubs_player_family_select" on clubs for select using (
  exists (
    select 1 from player_profiles pp
    where pp.club_id = clubs.id
      and (pp.user_id = auth.uid() or is_confirmed_parent_of(pp.id))
  )
);
