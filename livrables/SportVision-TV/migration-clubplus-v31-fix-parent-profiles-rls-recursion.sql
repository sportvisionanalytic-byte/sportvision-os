-- ============================================================
-- Fix : récursion infinie RLS sur parent_profiles (erreur Postgres 42P17)
-- ============================================================
-- Trouvé en test navigateur réel le 2026-08-07 (pas en relecture de code) :
-- TOUTE lecture de parent_profiles échouait en 500 pour TOUT utilisateur,
-- ce qui rend l'Espace Famille inutilisable (le frontend encaisse l'échec
-- silencieusement, cf. bootAfterLogin() dans index.html, donc c'était
-- invisible sans un vrai test).
--
-- Cause : cycle entre deux policies (migration-clubplus-v13.sql) qui font
-- toutes les deux une sous-requête brute (pas via fonction security definer)
-- vers l'autre table :
--   parent_profiles.parp_club_admin_select  → lit parent_player_relationships
--   parent_player_relationships.ppr_parent_select → lit parent_profiles
-- Postgres réévalue la RLS de chaque table traversée, donc ce cycle boucle
-- à l'infini. Même précaution déjà appliquée à is_club_admin()/is_club_member()
-- (migration-clubplus-v1/v2) : passer par une fonction SECURITY DEFINER casse
-- la boucle, car les lectures internes à une fonction SECURITY DEFINER ne
-- redéclenchent pas la RLS.

create or replace function parent_visible_to_club_admin(target_parent_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from parent_player_relationships ppr
    join player_profiles p on p.id = ppr.player_id
    where ppr.parent_id = target_parent_id and is_club_admin(p.club_id)
  );
$$;

drop policy if exists "parp_club_admin_select" on parent_profiles;
create policy "parp_club_admin_select" on parent_profiles for select using (
  parent_visible_to_club_admin(id)
);
