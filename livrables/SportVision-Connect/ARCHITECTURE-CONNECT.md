# Architecture définitive — SportVision OS / SportVision Connect

Date : 2026-08-06
Statut : architecture cible validée par le fondateur (message de cadrage du 06/08). Ce document la traduit en éléments concrets — tables réelles, fichiers réels, rôles réels — à partir de l'audit Lot 0. Il remplace le raisonnement "fusionner 3 plateformes" de l'audit initial par le bon raisonnement : **Connect n'a jamais été censé être 3 produits, c'est un seul produit qu'il faut construire comme tel dès maintenant.**

## Principe directeur (rappel)

- **SportVision OS** : outil interne uniquement (direction, secrétariat, comptabilité, production, CM, commerciaux, collaborateurs). Gère toute la donnée de gestion.
- **SportVision Connect** : unique plateforme externe. Une connexion, une base, une expérience, plusieurs espaces selon profil/contrat/abonnement.
- **Club+** : une famille d'offres et de droits fonctionnels dans Connect, pas un site.
- **Portail** : le niveau d'accès de base de Connect, pas un outil séparé.
- Aucun nouveau site séparé sans validation explicite.

---

## 1. Ce qui existe aujourd'hui vs l'architecture cible

| Aujourd'hui | Rôle réel actuel | Devient dans l'architecture cible |
|---|---|---|
| `SportVision-Portail/SportVision-Portail.html` | Site public + espace client ponctuel, seul produit packagé en app mobile | Le "niveau d'accès standard/limité" de Connect (§5) — plus un produit à part |
| `SportVision-Club-Plus/SportVision-Club-Plus.html` | Landing marketing Club+ | Une page d'offre à l'intérieur du site public Connect (`/offres/club-plus`), pas un site séparé |
| `SportVision-Club-Plus/app.html` | App connectée club (équipes, matchs, Newsroom, sponsors, Espace Joueur & Famille) | Le module **Espace Club** de Connect (§3) — le plus mature fonctionnellement, à absorber en premier |
| `SportVision-Portail-App/` (Capacitor) | Wrapper mobile du Portail seul | Wrapper mobile de Connect entier (un seul point d'entrée natif) |
| `SportVision-OS-Full.html` | Outil interne | Reste OS, inchangé dans sa nature, mais doit exposer/consommer les mêmes entités que Connect (§9) |

**Conséquence concrète immédiate** : il ne faut plus écrire de nouveau code dans `SportVision-Club-Plus/app.html` ou `SportVision-Portail.html` comme s'ils allaient rester séparés. Tout développement neuf se fait désormais dans un frontend unique `SportVision-Connect/`, en importurant progressivement les écrans de Club+ (le plus abouti) comme premier espace fonctionnel, puis le Portail comme niveau d'accès de base.

---

## 2. Identité et organisations — le socle technique qui manque

C'est le préalable absolu : sans ça, "une seule connexion, plusieurs espaces" est impossible.

### Constat (audit Lot 0)
4 univers d'identité étanches aujourd'hui, chacun avec ses propres fonctions d'accès :
- `profiles` (staff OS)
- `client_users` (Portail)
- `club_members` (Club+ dirigeants/éducateurs)
- `player_profiles` / `parent_profiles` (Joueur & Famille)

### Cible
```
users                 -- auth.users (Supabase natif), inchangé
organizations         -- fusion de clients (OS) + clubs (Club+) + futures académies/projets
organization_types    -- 'club' | 'academie' | 'coach' | 'projet' | 'sponsor'
memberships           -- user_id + organization_id + role + statut, remplace club_members/client_users
roles                 -- catalogue de rôles PAR TYPE d'organisation (voir §4)
entitlements          -- ce qu'une organisation a le droit de faire (voir §3)
```

**Ce qui NE bouge PAS tout de suite** : `player_profiles`/`parent_profiles` restent des tables à part (un joueur mineur n'a pas forcément de compte de connexion — c'est une règle métier volontaire, pas une dette). Elles se rattachent à `organizations` via `club_id` renommé/réutilisé.

**Migration recommandée** (non destructive, réversible) :
1. Créer `organizations` avec une colonne `legacy_client_id` et `legacy_club_id` nullable, le temps de la transition.
2. `INSERT INTO organizations SELECT ... FROM clients` et `INSERT INTO organizations SELECT ... FROM clubs` — sans supprimer `clients`/`clubs`, qui restent la source pour OS jusqu'à ce qu'OS lui-même lise `organizations`.
3. Vue `organizations_clients_compat` / `organizations_clubs_compat` pour qu'OS continue à fonctionner sans réécriture immédiate pendant la transition.
4. Une fois OS basculé sur `organizations` (voir §9), supprimer les vues de compat — jamais avant validation écrite, conformément à la règle de prudence.

---

## 3. Modèle d'entitlements (plan → abonnement → module → quota)

C'est la structure qui évite les conditions codées en dur partout dans l'interface — exactement ce que tu demandes au §7 de ton message.

```sql
-- Catalogue des modules activables (statique, peu de lignes)
create table connect_modules (
  key text primary key,              -- 'equipes','newsroom','match_center','demandes_visuels',
                                      -- 'sponsors','planning_editorial','statistiques','stages',
                                      -- 'inscriptions','joueurs','support', ...
  label text not null,
  espace text not null                -- 'club','coach','academie','joueur','sponsor','projet','commun'
);

-- Ce qu'une organisation a le droit d'utiliser, dérivé du contrat OS
create table organization_entitlements (
  organization_id uuid references organizations(id) on delete cascade,
  module_key text references connect_modules(key),
  actif boolean default true,
  quota_credits integer,              -- null = illimité / non applicable
  quota_utilisateurs integer,
  reduction_pct numeric(4,2) default 0,
  priorite text default 'standard',   -- 'standard' | 'prioritaire'
  source_contrat_id uuid references contrats(id),
  activated_at timestamptz default now(),
  expires_at timestamptz,
  primary key (organization_id, module_key)
);
```

**Logique d'activation** (ton exemple du §16, rendu concret) :
```
Contrat "Full Communication" signé (Youtrust) dans OS
  + moyen de paiement Stripe enregistré
  + date de démarrage atteinte
  → OS insère dans organization_entitlements : club_plus_performance + cm_affilie
    + planning_editorial + demandes_visuels + statistiques + support_prioritaire,
    quota_credits = 20/mois
  → Connect lit organization_entitlements pour afficher/masquer les modules
```

Aucune interface Connect ne doit contenir `if (offre === 'full_communication')`. Elle doit contenir `if (hasModule(org, 'planning_editorial'))`. C'est la seule façon de rajouter une offre commerciale sans toucher au frontend.

### Correspondance offres actuelles → entitlements

| Offre (référence catalogue interne existant, cahier des charges §12.3) | Modules activés | Quota crédits | Réduction |
|---|---|---|---|
| Club+ Start (= "Club+" actuel, 49€/59€) | equipes, match_center, newsroom, demandes_visuels, sponsors, support | 5/mois | 5% |
| Club+ Performance (129€/149€) | + priorite='prioritaire', statistiques, workflow_validation | 20/mois | 10% |
| Full Communication | + cm_affilie, planning_editorial, presences, bibliotheque_contenus, reporting | selon contrat | 10% |
| Accompagnement Coach | espace_coach : joueurs_suivis, seances, planning, demandes_tournage | selon contrat | — |
| Accompagnement Académie | espace_academie : groupes, stages, inscriptions, campagnes | selon contrat | — |
| Espace Projet / client ponctuel | prestation, devis, paiement, livrables (= Portail actuel) | — | — |

Les tables `clubs.plan` et `club_credit_transactions` existantes sont réutilisables comme base de `organization_entitlements` — ce n'est pas à réécrire de zéro, juste à généraliser au-delà du seul domaine Club.

---

## 4. Rôles et permissions

### Côté SportVision OS (interne) — état actuel + écarts à combler
Rôles existants dans `profiles.role` : `admin, sec, prod, photo, cm, compta, com` (7 rôles, plats, sans hiérarchie).

Écarts par rapport à l'architecture cible :
| Rôle attendu | Existe ? | Action |
|---|---|---|
| Direction / Super Admin | `admin` en tient lieu de facto | Conserver, envisager un rôle `direction` distinct seulement si `admin` doit aussi désigner un rôle technique/support plus tard |
| CM affilié vs CM Studio | Non distingué (`cm` unique) | Ajouter `cm_type` ('affilie' \| 'studio') sur `profiles`, ou un `entitlement` côté organisation plutôt qu'un rôle staff — **le CM affilié est une relation organisation↔collaborateur (qui suit quel club), pas un rôle système différent** |
| Lead CM | Absent | Rôle futur, à ajouter à `profiles.role` quand le volume de CM le justifie (cahier des charges : "création vers 4-5 CM") |

### Côté SportVision Connect (externe) — par type d'organisation
```sql
create table organization_role_catalog (
  organization_type text,   -- 'club' | 'academie' | 'coach' | 'projet' | 'sponsor'
  role_key text,
  label text,
  primary key (organization_type, role_key)
);
```
| Organisation | Rôles |
|---|---|
| Club | admin (président/dirigeant), secretaire, resp_communication, educateur, manager_equipe, sponsor_manager, tresorier, lecture_seule |
| Coach | proprietaire, assistant, resp_communication, collaborateur_limite |
| Académie | admin, secretaire, coach, resp_programme, resp_communication, lecture_seule |
| Projet | organisateur, chef_projet, communication, partenaire, intervenant, lecture_seule |
| Joueur & Famille | joueur_majeur, joueur_14_17_autorise, parent, lecture_accompagnee — **restent des `player_profiles`/`parent_profiles`, pas des `memberships` classiques** (cf. §2) |

**Règle non négociable, déjà bien respectée par le code Club+ existant** : chaque table métier a une politique RLS scopée à `organization_id` (ou `club_id` aujourd'hui) — aucune donnée ne doit être lisible hors appartenance. La migration de sécurité livrée aujourd'hui (`migration-connect-v1-securite-hardening.sql`) renforce cette base avant d'ouvrir plus large.

---

## 5. Les espaces dans Connect — état réel par espace

| Espace | Table(s) déjà utilisables (à absorber, pas à recréer) | À construire de zéro |
|---|---|---|
| **Club** | `clubs`→`organizations`, `club_members`→`memberships`, `club_teams`, `club_matches`, `club_media`, `club_creations`, `club_sponsors`, `club_calendar_events`, `club_newsroom_items`, `club_requests`, `club_bookings`, `club_support_tickets` | Rien de majeur — c'est l'espace le plus complet aujourd'hui |
| **Joueur & Famille** | `player_profiles`, `parent_profiles`, `parent_player_relationships`, `player_invitations`, `parent_invitations`, `parental_authorizations`, `media_access_rules`, `player_favorites`, `membership_requests` | Rien de majeur — module déjà audité et sécurisé (phase 13) |
| **Projet / client ponctuel** | `client_devis`, `client_factures`, `client_contrats`, `client_media_livrables`, `catalogue_offres`, `prestations` (lecture via bridge) | Le "sélecteur d'espace" et le compte unique — aujourd'hui c'est un compte Portail séparé |
| **Coach** | Rien côté client — seule `formation_*` existe, mais c'est la formation RH INTERNE des collaborateurs SportVision, pas un espace coach externe. Ne pas réutiliser ces tables, risque de confusion de domaine. | Tout : profil coach, joueurs suivis, séances, planning, demandes de tournage |
| **Académie** | Rien | Tout : programmes, groupes, stages, inscriptions, campagnes |
| **Sponsor / Partenaire** | `club_sponsors` (fiches sponsor vues côté club) | Tout le côté "espace sponsor autonome" : login sponsor, ses propres livrables/statistiques |

**Priorité de développement qui en découle** : Coach et Académie sont à 0% aujourd'hui — ce sont les plus gros chantiers neufs. Club et Joueur & Famille sont à absorber (changer le contenant, pas le contenu). C'est cohérent avec la feuille de route métier du cahier des charges (Phase 1 = football/clubs d'abord).

---

## 6. Navigation par profil (affinée sur la base réelle)

Reprend ta proposition (§14), ajustée pour coller aux entitlements plutôt qu'à des menus fixes :

```
Navigation commune (toujours visible)
  Accueil · Notifications · Mes documents · Mon abonnement · Paramètres · Support

Espace Club (si organization_type='club')
  Tableau de bord · Équipes · Planning · Demandes · Visuels · Prestations
  Contenus · Communication [si module planning_editorial] · Sponsors [si module sponsors]
  Contrats · Factures · Utilisateurs [si role admin/secretaire]

Espace Coach (si organization_type='coach')
  Tableau de bord · Joueurs · Séances · Planning · Contenus · Demandes
  Communication · Contrats · Factures

Espace Académie (si organization_type='academie')
  Tableau de bord · Groupes · Stages · Inscriptions · Coachs · Contenus · Demandes
  Contrats · Factures · Utilisateurs

Espace Projet / ponctuel (accès Connect standard, ex-Portail)
  Aperçu · Prestation · Planning · Documents · Paiement · Livrables · Messages

Espace Joueur (si player_profiles existe pour cet utilisateur)
  Accueil · Calendrier · Médias · Favoris · Services personnels · Droits à l'image

Espace Famille (si parent_profiles existe pour cet utilisateur)
  Sélecteur enfants · Autorisations · Livrables · Paiements
```

Un item de menu n'apparaît que si `hasModule(organization, module_key)` est vrai — jamais par rôle codé en dur.

---

## 7. Synchronisation OS ↔ Connect

### Ce qui existe déjà et sert de gabarit (à généraliser, pas à réinventer)
`notification_outbox` + `dispatch-notifications` + `communication_audit_logs` (migration-communication-hub.sql) : c'est déjà exactement le pattern "action dans Connect → traitement asynchrone fiable → trace d'audit" qu'il faut répliquer pour les autres flux.

### Flux à construire sur ce même modèle
```
Demande client dans Connect
  → INSERT dans requests (nouvelle table transverse, ou réutilisation élargie de club_requests)
  → trigger : entrée dans une "os_sync_outbox" (même pattern que notification_outbox)
  → OS lit l'outbox (ou webhook), attribue un responsable, traite
  → UPDATE status côté OS déclenche une notification via dispatch-notifications existant
  → Connect affiche le nouveau statut (lecture directe de la table partagée, RLS scoped organization_id)
```

Comme la base est déjà unique (confirmé dans le code : "même projet que SportVision OS"), il n'y a pas besoin d'un connecteur externe complexe — le vrai travail est de définir clairement quelles tables sont "propriété d'OS" (écriture) vs "propriété de Connect" (écriture), et quelles vues croisées chaque côté peut lire. Recommandation : `requests`, `service_orders` (fusion `club_bookings`/`prestations`), `organization_entitlements` sont écrites par OS (ou par RPC `security definer` appelées depuis Connect, jamais en UPDATE direct) ; Connect les lit toujours en lecture seule via RLS.

---

## 8. Paiements, contrats, signature

- **Stripe** : déjà en place (`create-checkout-session`, `stripe-webhook`, `create-team-contribution-checkout`). À étendre : le webhook doit, en plus de créer un paiement, insérer/mettre à jour `organization_entitlements` directement (paiement réussi → module activé), pas seulement changer un statut de facture.
- **Signature électronique** : le code réel utilise **Youtrust** (`youtrust-webhook`, `send-signature-request`), pas Yousign — les deux existent sur le marché, je corrige juste la référence pour éviter toute confusion dans le cahier des charges ou les specs futures. Déjà intégré et déployé (voir mémoire projet du 03/08). Le principe que tu décris (contrat signé + paiement configuré → activation automatique) est déjà partiellement câblé, à vérifier lors du chantier entitlements.
- **Facturation** : Pennylane déjà intégré (mémoire projet). Cohérent avec "les factures visibles dans Connect" — Connect doit lire, pas dupliquer, les factures Pennylane/OS.

---

## 9. Sécurité et authentification

- RLS déjà quasi complète (102/102 tables), renforcée aujourd'hui par `migration-connect-v1-securite-hardening.sql`.
- Le vrai manque : SSO entre les univers (§2). Tant que `organizations`/`memberships` n'existent pas, un sélecteur d'organisation multi-espace n'est pas possible proprement.
- MFA : à activer en priorité pour les rôles admin/direction/comptabilité côté OS (déjà recommandé par le cahier des charges d'origine), pas urgent côté Connect au lancement.
- Bucket storage `clubplus-media` public en lecture (trouvé dans l'audit) : à corriger avant d'exposer plus largement Connect — c'est un vrai trou pour la confidentialité des médias, y compris ceux des mineurs.

---

## 10. Éléments à supprimer, fusionner, renommer

### À renommer (terminologie, pas de code cassé)
| Ancien terme | Nouveau terme |
|---|---|
| "Site Club+" / "App Club+" | "Offre Club+ dans SportVision Connect" |
| "Espace Club+" | "Espace Club dans SportVision Connect" |
| "Portail SportVision" | "Accès Connect standard ou limité" |
| "SportVision-Club-Plus/app.html" (nom de fichier) | À terme : `SportVision-Connect/espace-club` dans la nouvelle arborescence |

### À fusionner (cf. §2, non destructif dans un premier temps)
- `clients` + `clubs` → `organizations`
- `client_users` + `club_members` → `memberships`
- `club_bookings` + `prestations` → `service_orders` (un seul pipeline de commande)

### À supprimer, après validation écrite (règle de prudence du cahier des charges)
- `SportVision OS Dashboard.dc.html` — maquette statique obsolète, 0 donnée réelle, 0 appel Supabase. Aucune perte d'information si supprimé.
- `email_templates` (ancien) — probablement remplacé par `communication_templates`/`communication_template_versions`, à confirmer avant suppression (vérifier qu'aucune fonction ne l'appelle plus).

### États de compte à implémenter (cf. §5 de ton message)
```
connect_actif_premium | connect_actif_standard | connect_limite_fin_contrat
| connect_suspendu_impaye | connect_archive | connect_desactive
```
À porter sur `organizations.statut` (nouvelle colonne), piloté depuis OS, lu par Connect pour activer/désactiver l'accès aux modules premium sans jamais supprimer le compte.

---

## 11. Plan de migration priorisé

Reprend et affine le plan de l'audit Lot 0 à la lumière de cette architecture :

| Étape | Contenu | Pourquoi cet ordre |
|---|---|---|
| **0 — fait** | Audit + migration de sécurité RLS | Prérequis sécurité avant d'exposer plus de surface |
| **1** | Créer `organizations`, `memberships`, `connect_modules`, `organization_entitlements` (non destructif, vues de compat vers `clients`/`clubs`) | Sans ça, aucun sélecteur d'espace ni logique de module n'est possible |
| **2** | Construire le frontend Connect unique (nouveau dossier, pas une réécriture de `app.html` sur place) en important d'abord l'Espace Club (le plus mature) comme premier espace fonctionnel, connecté aux nouvelles tables | Livrer un espace complet et testable avant d'en ajouter d'autres |
| **3** | Basculer le Portail : ses écrans deviennent le "Connect standard/limité" (mêmes tables `client_*`, nouvelle coque commune) | Réutilise du code existant, pas une reconstruction |
| **4** | Importer l'Espace Joueur & Famille (déjà mature et sécurisé) dans la même coque | Faible risque, haute valeur (mineurs déjà bien traités) |
| **5** | Construire Coach et Académie de zéro sur le modèle entitlements | Nouveaux chantiers, mais méthode déjà rodée par les étapes précédentes |
| **6** | Basculer OS pour lire/écrire `organizations`/`entitlements`/`service_orders` au lieu de `clients`/`clubs`/`prestations` directement, puis supprimer les vues de compat | Dernier, car c'est le fichier le plus volumineux et le plus actif (250 commits/9 jours) — à ne pas toucher tant que le reste n'est pas stabilisé |
| **7** | Espace Sponsor/Partenaire, automatisations avancées, PWA/app stores | Conforme à la roadmap métier (Phase 1 football d'abord) |

---

## 12. Ce qui reste à trancher avec toi avant de coder l'étape 1

1. **`update_club_request_status`** (corrigé aujourd'hui dans la migration de sécurité) : j'ai posé l'hypothèse qu'un club peut annuler une demande non prise en charge, jamais une demande en cours. À confirmer.
2. **Nom de la nouvelle arborescence frontend** : je pars sur un nouveau dossier `livrables/SportVision-Connect/app/` pour le futur code Connect (pour ne pas modifier `SportVision-Club-Plus/` ni `SportVision-Portail/` en place tant que la bascule n'est pas prête) — à valider, ou tu préfères que je transforme `SportVision-Club-Plus/app.html` directement sur place ?
3. **Priorité réelle** : je pars sur "Espace Club d'abord" parce que c'est le plus mature et le plus proche de générer du revenu récurrent (Club+ Performance / Full Communication). Si Coach ou Académie ont des clients signés avant Club+, dis-le-moi, ça change l'ordre du plan §11.
