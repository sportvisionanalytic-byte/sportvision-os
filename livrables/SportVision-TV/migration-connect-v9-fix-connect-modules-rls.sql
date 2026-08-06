-- Fix sécurité : connect_modules avait des policies RLS définies
-- (migration-connect-v2-organizations-entitlements.sql lignes 266-272 :
-- "modules_public_select" et "modules_staff_write") mais RLS n'a jamais été
-- activé sur la table elle-même — contrairement à organization_entitlements,
-- juste à côté dans le même fichier, qui a bien son "enable row level
-- security" (ligne 116). Sans cette activation, Postgres/PostgREST ignorent
-- purement et simplement les policies : n'importe quel appelant avec la clé
-- anon (publique, embarquée dans le front) pouvait insérer/modifier/
-- supprimer des lignes du catalogue de modules qui pilote les entitlements
-- Connect. Découvert lors de l'audit du 2026-08-06, aucune exploitation
-- connue à ce jour.

alter table connect_modules enable row level security;
