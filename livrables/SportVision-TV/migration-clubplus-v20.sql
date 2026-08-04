-- ============================================================
-- SPORTVISION CLUB+ — Migration v20
-- Suite de migration-clubplus-v1 à v19.sql. Idempotente.
--
-- Portée : Phase 10 du module « Espace Joueur & Famille »
-- (cf. CLUBPLUS_PLAYER_FAMILY_ARCHITECTURE.md, §9.1) — commande de
-- prestation personnelle. Décision actée avec l'utilisateur : réutilise
-- club_bookings existant (migration-clubplus-v6.sql, pipeline
-- recue→qualifiee→confirmee→operateur_affecte→mission_realisee→livree
-- déjà piloté par SportVision), simplement ouvert aux joueurs/parents
-- comme demandeurs en plus des dirigeants — PAS un nouveau flux Portail.
--
-- Règle d'âge appliquée ici aussi, pas seulement côté UI : un joueur
-- mineur ne peut pas commander lui-même (cf. sv_age_bracket, v13) —
-- seul le parent confirmé peut le faire pour lui. Un joueur majeur peut
-- commander seul. Cohérent avec authorization_types.commandes_paiements
-- ("Autorise le parent à commander et payer des prestations SportVision
-- pour le compte du mineur", seedé en v15).
-- ============================================================

alter table club_bookings add column if not exists player_id uuid references player_profiles(id) on delete set null;

create index if not exists idx_cbk_player on club_bookings(player_id);

drop policy if exists "cbk_family_select" on club_bookings;
create policy "cbk_family_select" on club_bookings for select using (
  player_id is not null and (is_own_player(player_id) or is_confirmed_parent_of(player_id))
);

drop policy if exists "cbk_family_insert" on club_bookings;
create policy "cbk_family_insert" on club_bookings for insert with check (
  player_id is not null and (
    (
      is_own_player(player_id)
      and exists (select 1 from player_profiles p where p.id = player_id and sv_age_bracket(p.date_naissance) = 'majeur')
    )
    or is_confirmed_parent_of(player_id)
  )
);
