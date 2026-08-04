-- ============================================================
-- SPORTVISION CLUB+ — Migration v9
-- Suite de migration-clubplus-v1 à v8.sql. Idempotente.
--
-- Portée : permet à un admin de club de modifier l'identité de SON club
-- (nom, ville, discipline, saison) depuis Paramètres. Jusqu'ici seule la
-- lecture (clubs_member_select) et la gestion staff SportVision
-- (clubs_staff_all) existaient sur `clubs` — aucune policy ne permettait
-- à un club de modifier sa propre fiche.
--
-- Restreint aux colonnes d'identité par choix côté application (le
-- client n'envoie jamais plan/engagement/pilot_mode/credits_* dans cette
-- requête) ; RLS ne filtre pas par colonne, donc cette policy autorise
-- techniquement la modification de n'importe quelle colonne par un admin
-- de club — même limite déjà documentée pour club_requests.comments
-- (migration-clubplus-v4.sql). À durcir avec un trigger si nécessaire.
-- ============================================================

drop policy if exists "clubs_admin_update" on clubs;
create policy "clubs_admin_update" on clubs for update using (is_club_admin(id));
