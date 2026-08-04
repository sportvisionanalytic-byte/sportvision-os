-- ============================================================
-- SPORTVISION CLUB+ — Migration v12
-- Suite de migration-clubplus-v1 à v11.sql. Idempotente.
--
-- Portée : (1) le pont Documents ↔ Portail, (2) la persistance de la
-- matrice de rôles et permissions.
--
-- ── 1. PONT DOCUMENTS ↔ PORTAIL ──
-- Club+ NE duplique PAS les factures/devis/contrats : ce sont les mêmes
-- tables que SportVision Portail (migration-portail-v1.sql). Le pont
-- consiste à relier le club à un `clients` Portail (portail_client_id) ET
-- à donner à l'admin qui a créé le club une ligne `client_users` pointant
-- vers ce même client_id — il devient alors, pour la lecture des
-- documents, un client Portail comme un autre. Les vues client_devis /
-- client_factures / client_contrats (déjà créées par migration-portail-
-- v1.sql, filtrées via client_users) fonctionnent alors SANS aucune
-- modification côté Portail : aucune nouvelle vue, aucune nouvelle
-- policy sur factures/devis/contrats. Le lien lui-même (recherche du
-- client par e-mail + upsert client_users) est fait par l'Edge Function
-- clubplus-onboarding (service role), pas par une policy — cette
-- migration ne fait qu'ajouter la colonne de référence.

alter table clubs add column if not exists portail_client_id uuid references clients(id) on delete set null;

-- ── 2. MATRICE DE RÔLES ET PERMISSIONS (persistance uniquement) ──
-- Stockée en jsonb plutôt qu'en table à part : la matrice est toujours
-- lue/écrite d'un bloc (pas de requête par cellule), et sa taille reste
-- petite (quelques rôles × quelques permissions). Réutilise la policy
-- clubs_admin_update déjà créée par migration-clubplus-v9.sql — aucune
-- nouvelle policy nécessaire.
--
-- IMPORTANT — portée volontairement limitée : cette colonne PERSISTE la
-- matrice affichée dans Paramètres → Rôles et permissions, elle ne
-- L'APPLIQUE PAS. Aucune policy RLS existante (club_requests, club_media,
-- club_creations...) ne consulte cette colonne : faire respecter des
-- permissions personnalisées par rôle nécessiterait de réécrire toutes
-- les policies is_club_member existantes pour y injecter une vérification
-- par permission, un chantier à part qui n'est pas couvert ici.

alter table clubs add column if not exists role_permissions jsonb default '{}';
