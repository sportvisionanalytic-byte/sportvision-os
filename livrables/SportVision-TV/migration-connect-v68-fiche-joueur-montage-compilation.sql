-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v68
-- Ajoute des infos physiques/maillot au profil des sportifs (player_profiles et
-- managed_athlete_profiles), pour la prestation "Montage Compilation" (décidé par Fouka le 15/08,
-- scope volontairement limité à cette prestation, pas étendu à tout le catalogue).
--
-- ────────────────────────────────────────────────────────────────────────
-- CONTEXTE
-- ────────────────────────────────────────────────────────────────────────
--
-- Montage Compilation (v63/v64) ne nécessite AUCUN déplacement SportVision (le client envoie ses
-- rushs ou un lien) — le wizard de réservation demandait pourtant les mêmes champs "Adversaire" /
-- "Heure" / "Lieu" que toute prestation avec présence physique, sans utilité pour un montage.
-- Ce qui manque en revanche pour le monteur SportVision : identifier le joueur dans les rushs/le
-- match complet (numéro de maillot, couleur de maillot) et ses caractéristiques physiques utiles
-- au montage (taille, poids, poste) — ces dernières se pré-remplissent depuis le profil du
-- sportif une fois saisies une première fois, jamais redemandées si déjà connues.
--
-- ────────────────────────────────────────────────────────────────────────
-- CE QUE FAIT CETTE MIGRATION
-- ────────────────────────────────────────────────────────────────────────
--
-- 1. player_profiles : ajoute taille_cm, poids_kg, poste (numero_maillot EXISTE DÉJÀ depuis
--    migration-clubplus-v13, réutilisé tel quel comme valeur de pré-remplissage par défaut).
-- 2. managed_athlete_profiles : ajoute taille_cm, poids_kg, poste, numero_maillot (aucun des 4
--    n'existait encore sur cette table).
-- 3. prestations : ajoute numero_maillot, couleur_maillot — valeurs PROPRES À CETTE RÉSERVATION
--    (peuvent différer du profil : sélection nationale, maillot extérieur, etc.), pré-remplies
--    depuis le profil par le frontend mais toujours modifiables avant envoi, jamais lues depuis
--    le profil côté serveur (déclaratif, comme duree_rush_minutes/nombre_matchs_lien de v63/v64).
--
-- Toutes les colonnes sont nullable, additives, aucun impact sur les prestations/profils
-- existants. Le câblage frontend (formulaire, pré-remplissage, écriture retour sur le profil à la
-- première saisie) est un chantier séparé, pas dans ce fichier.
--
-- Idempotente
-- (add column if not exists).
--
-- EXÉCUTÉE — vérifié en base réelle le 19/08/2026 (audit pré-lancement) :
-- colonnes player_profiles.taille_cm/poids_kg/poste,
-- managed_athlete_profiles.taille_cm/poids_kg/poste/numero_maillot et
-- prestations.numero_maillot/couleur_maillot existent déjà en base. Cet
-- en-tête disait à tort "NON EXÉCUTÉE".
-- ============================================================

-- ─── 1. player_profiles ─────────────────────────────────────────────────
alter table player_profiles add column if not exists taille_cm integer;
alter table player_profiles add column if not exists poids_kg numeric(5,2);
alter table player_profiles add column if not exists poste text;

comment on column player_profiles.taille_cm is 'Taille du joueur en cm — saisie une fois, réutilisée en pré-remplissage (ex. Montage Compilation). Optionnel.';
comment on column player_profiles.poids_kg is 'Poids du joueur en kg — même principe que taille_cm.';
comment on column player_profiles.poste is 'Poste de jeu (texte libre, ex. "Attaquant", "Gardien") — même principe que taille_cm.';

-- ─── 2. managed_athlete_profiles ────────────────────────────────────────
alter table managed_athlete_profiles add column if not exists taille_cm integer;
alter table managed_athlete_profiles add column if not exists poids_kg numeric(5,2);
alter table managed_athlete_profiles add column if not exists poste text;
alter table managed_athlete_profiles add column if not exists numero_maillot text;

comment on column managed_athlete_profiles.taille_cm is 'Voir player_profiles.taille_cm — même principe, pour un sportif géré (sans compte Connect propre).';
comment on column managed_athlete_profiles.poids_kg is 'Voir player_profiles.poids_kg.';
comment on column managed_athlete_profiles.poste is 'Voir player_profiles.poste.';
comment on column managed_athlete_profiles.numero_maillot is 'Voir player_profiles.numero_maillot (migration-clubplus-v13) — absent jusqu''ici sur cette table.';

-- ─── 3. prestations (valeurs propres à CETTE réservation) ──────────────
alter table prestations add column if not exists numero_maillot text;
alter table prestations add column if not exists couleur_maillot text;

comment on column prestations.numero_maillot is 'Numéro de maillot pour CETTE prestation (Montage Compilation) — peut différer du profil (sélection, maillot extérieur...). Déclaratif, pré-rempli côté frontend depuis le profil mais jamais relu depuis le profil côté serveur.';
comment on column prestations.couleur_maillot is 'Couleur de maillot pour CETTE prestation — même principe que numero_maillot.';

-- ============================================================
-- FIN. Aucune action manuelle au-delà de l'exécution de ce fichier — le câblage frontend
-- (formulaire Montage Compilation, pré-remplissage, écriture retour sur le profil) est un
-- chantier séparé, aucune Edge Function n'est concernée par cette migration seule.
-- ============================================================
