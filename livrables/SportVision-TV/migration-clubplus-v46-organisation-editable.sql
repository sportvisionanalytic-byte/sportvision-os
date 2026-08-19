-- ============================================================
-- SPORTVISION CLUB+ — Migration v46
-- Suite de migration-clubplus-v1 à v45.sql. Idempotente.
--
-- Portée (19/08/2026, audit pré-lancement — settings/organization/page.tsx
-- était intégralement en lecture seule faute de colonnes réelles pour
-- adresse/Instagram/SIRET/couleurs, voir le commentaire "Pas de colonne
-- réelle... ni de policy d'écriture club-admin" dans ce fichier) :
--   1. clubs.adresse, clubs.instagram_handle, clubs.siret : texte libre.
--   2. clubs.couleur_primaire, clubs.couleur_secondaire : hex (#RRGGBB),
--      mêmes deux couleurs déjà affichées en dur (#4F7DFF / #A855F7)
--      côté page.tsx comme valeurs par défaut si non renseignées.
--
-- AUCUNE nouvelle policy RLS ni modification de protect_sensitive_club_
-- fields() nécessaire : clubs_admin_update (USING is_club_admin(id),
-- migration-clubplus-v2.sql) couvre déjà l'UPDATE de n'importe quelle
-- colonne non listée dans le trigger protect_sensitive_club_fields() —
-- vérifié en base réelle le 19/08/2026 (plan/engagement/crédits/stripe_*
-- seuls listés, ces 5 nouvelles colonnes n'y figurent pas). Un admin de
-- club peut donc déjà écrire ces colonnes via un simple PATCH REST dès
-- qu'elles existent — c'est bien l'absence de colonnes qui bloquait, pas
-- un manque de droit.
--
-- EXÉCUTÉE le 19/08/2026 (audit pré-lancement, agent autonome — voir note
-- de fin de fichier).
-- ============================================================

alter table clubs add column if not exists adresse text;
alter table clubs add column if not exists instagram_handle text;
alter table clubs add column if not exists siret text;
alter table clubs add column if not exists couleur_primaire text check (couleur_primaire is null or couleur_primaire ~ '^#[0-9A-Fa-f]{6}$');
alter table clubs add column if not exists couleur_secondaire text check (couleur_secondaire is null or couleur_secondaire ~ '^#[0-9A-Fa-f]{6}$');

-- ────────────────────────────────────────────────────────────────────────
-- Vérification post-migration (à exécuter manuellement, lecture seule)
-- ────────────────────────────────────────────────────────────────────────
-- select column_name from information_schema.columns where table_name='clubs'
--   and column_name in ('adresse','instagram_handle','siret','couleur_primaire','couleur_secondaire');
-- -- attendu : les 5 colonnes.
