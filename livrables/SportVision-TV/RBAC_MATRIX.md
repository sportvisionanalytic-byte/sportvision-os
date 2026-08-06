# Matrice RBAC — SportVision OS & Connect

État réel du schéma (pas une cible). Les rôles sont des `check constraint` sur une colonne texte — il n'existe **aucune table `roles`/`role_permissions`** centralisant les permissions ; chaque policy RLS répète `role in (...)` indépendamment, ce qui est un risque de dérive (deux policies sur la même table peuvent finir par lister des rôles différents sans qu'on s'en aperçoive).

## 1. Côté OS interne (`profiles.role`) — un seul tenant, l'entreprise SportVision

`check (role in ('admin','sec','prod','photo','cm','compta','com'))` — `supabase-schema.sql:7`

| Rôle réel | Correspondance cahier des charges | Accès observé |
|---|---|---|
| `admin` | Administrateur (+ fait aussi office de Super Admin/Direction, non distingués) | Accès large : clients, prestations, contrats, finances, staff |
| `compta` | Finance/comptabilité | Factures, paiements, charges |
| `sec` | Secrétariat | Dossiers, contrats, calendrier |
| `prod` | Responsable Production | Planning, opérateurs, livraisons (couvre aussi vidéo, pas de rôle distinct) |
| `cm` | Community Manager | Clients attribués, contenus |
| `com` | Commercial | Prospects, offres, suivi |
| `photo` | Opérateur photo/vidéo | Missions attribuées |

**Écarts par rapport au cahier des charges** : pas de rôle **Super Admin** distinct d'`admin` (donc pas d'usage "exceptionnel" isolable), pas de rôle **Direction** distinct (vision globale sans droits techniques), pas de distinction photo/vidéo.

**Protection des colonnes sensibles** : `role`/`grade` protégés contre l'auto-modification par trigger (`migration-securite-profiles-rls.sql`).

## 2. Côté Club-Plus (`club_members.role`) — multi-tenant, clé `club_id`

`check (role in ('admin','president','secretaire','comm','cm_externe','coach','resp_equipe','sponsor_mgr','tresorier','membre_bureau','lecture_seule'))` — `migration-clubplus-v1.sql:59-62`

Seul `role = 'admin'` (pas `president`, malgré le nom) compte comme administrateur du club au sens RLS (`is_club_admin`, `migration-clubplus-v2.sql`) — c'est une décision produit existante, pas un bug, mais à garder en tête : un `president` n'a aujourd'hui aucun droit de gestion RLS sur les autres membres.

| Rôle réel | Correspondance cahier des charges |
|---|---|
| `admin` | Administrateur de club |
| `coach` | Éducateur |
| `president`, `secretaire`, `comm`, `cm_externe`, `resp_equipe`, `sponsor_mgr`, `tresorier`, `membre_bureau`, `lecture_seule` | Rôles internes au club, sans équivalent 1:1 dans le cahier (granularité plus fine côté club que côté OS) |

**Protection des colonnes sensibles** : `role`/`club_id`/`status` protégés contre l'auto-modification par trigger, ajouté cette session (`migration-securite-club-members-client-users-rls.sql`) — absent auparavant, c'était la faille critique #2 du threat model.

## 3. Côté Portail (`client_users`) — cloisonnement par `client_id`, pas de rôle

Pas de colonne rôle : un utilisateur Portail est simplement rattaché à un `client_id`. Le staff OS (`admin`/`sec`/`com`/`compta`) a un accès `for all` via `cu_staff_all`.

**Protection des colonnes sensibles** : `client_id` protégé contre l'auto-modification par trigger, ajouté cette session — absent auparavant (faille critique #3 du threat model, fuite inter-tenant).

## 4. `player_profiles` / `parent_profiles` (Club-Plus, module joueur/famille)

Non ré-audité ici en détail — couvert par `CLUBPLUS_PLAYER_FAMILY_SECURITY_REVIEW.md` (phase 13, 19/25 critères conformes). Se référer à ce document pour ce module spécifique plutôt que dupliquer.

## 5. Actions à double validation exigées par le cahier des charges

**Aucune trouvée dans le schéma actuel** : remboursement, suppression de club, changement de RIB, restauration de sauvegarde sont chacun des actions à un seul acteur (une policy RLS suffit à les déclencher). C'est un manque réel, à traiter en P0/P1 — nécessite une table `admin_approvals` ou équivalent, non construite à ce jour.
