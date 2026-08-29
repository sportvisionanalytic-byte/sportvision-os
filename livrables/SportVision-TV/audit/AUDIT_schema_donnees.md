# Audit final autonome — Schéma Supabase, cohérence des données, indexes

Date : 29/08/2026 (nuit, autonome)
Périmètre : base Supabase réelle (project ref `lulgezzpvrlbftbykzrc`), interrogée en direct via l'API Management (`POST /v1/projects/<ref>/database/query`), pas seulement les fichiers de migration historiques.
Méthode indexes : fréquence de filtrage objectivée par grep des patterns `?xxx_id=eq.` / `&statut=eq.` dans les appels `sbFetch()` de `SportVision-OS-Full.html` (pas d'index ajouté par intuition).
Méthode "table obsolète" : recherche du nom de table en 3 passes — (1) `SportVision-OS-Full.html`, (2) tout le repo (Connect app Next.js, Connect mobile, edge functions, scripts), (3) définitions SQL des fonctions/RPC Postgres (`information_schema.routines`), car plusieurs tables ne sont jamais appelées en REST direct mais uniquement via `rpc()`.

Photo de la base au moment de l'audit : **189 relations** (174 tables + 15 vues), **318 foreign keys**, **446 indexes**. Données réelles quasi vides (pré-lancement) : `clients`=1, `clubs`=1, `prestations`=1, `contrats`=1, `club_members`=1, `client_affiliations`=1, `organizations`=23, `profiles`=19, `devis`/`factures`/`paiements`/`prestations_equipe`=0.

---

## Corrigé

### Indexes manquants (12 créés, exécutés et vérifiés en réel)
Colonnes filtrées fréquemment côté application (`?xxx=eq.` compté dans le code) et sans index couvrant. Migration `migration-audit-final-indexes.sql`, exécutée sur la base réelle, présence des 12 index reconfirmée après coup via `pg_indexes` :

| Table | Colonne | Filtrages comptés dans le code |
|---|---|---|
| `prestations_equipe` | `collaborateur_id` | 16 (vue `prestations_equipe_display` + table directe) |
| `prestations_equipe` | `prestation_id` | 7 |
| `clubs` | `portail_client_id` | 7 (chargement de l'espace club — seule colonne de `clubs` sans index avant, hors Stripe) |
| `plannings_hebdo` | `statut` | 4 |
| `prestations` | `client_id` | 3 (table centrale, FK jamais indexée) |
| `kit_reservations` | `prestation_id` | 3 |
| `kit_reservations` | `kit_id` | 3 |
| `devis` | `client_id` | 3 |
| `contenus` | `statut` | 3 |
| `prestations` | `statut` | 2 |
| `kit_reservations` | `collaborateur_id` | 2 |
| `client_affiliations` | `status` | 2 |

Volontairement **pas** d'index ajouté au-delà de cette liste : le reste des 212 colonnes FK sans index (voir section "Amélioré") a une fréquence de filtrage nulle ou non mesurée dans le code actuel — les ajouter aurait été "indexer au hasard", explicitement exclu par la mission.

### Colonnes NOT NULL manquantes (6 contraintes sur 4 tables, exécutées et vérifiées)
Migration `migration-audit-final-nullable-timestamps.sql` (partie A), avec vérification défensive (`DO $$ ... RAISE EXCEPTION ...`) qu'aucune ligne NULL n'existait avant d'appliquer la contrainte :

- `prestations_equipe.prestation_id` et `.collaborateur_id` : une affectation d'équipe sans mission ni collaborateur n'a pas de sens métier. Seul point d'insertion du code (`SportVision-OS-Full.html` ~L12623) fournit toujours les deux. 0 ligne NULL en base.
- `prestations_equipe.statut`, `factures.statut`, `media_livrables.statut`, `paiements.statut` : les 4 colonnes ont déjà un `DEFAULT` en base (`'invitation_envoyée'`, `'brouillon'`, `'a_preparer'`, `'en_attente'`), donc NOT NULL est sans risque pour les futurs inserts — 0 ligne NULL constatée.

Vérifié après coup via `information_schema.columns` : les 6 colonnes affichent `is_nullable = NO`.

### `updated_at` manquant sur tables métier mutables (4 tables, exécuté et vérifié)
Migration `migration-audit-final-nullable-timestamps.sql` (partie B). Colonne ajoutée + trigger réutilisant la fonction déjà existante en base `update_updated_at_generic()` (déjà utilisée par `contrats`, `centre_ressources`, `studio_templates`, etc.) :
- `profiles` (19 lignes — rôles/contacts modifiés régulièrement)
- `client_affiliations`
- `kit_reservations`
- `prestations_equipe`

Vérifié après coup : colonne présente sur les 4 tables + trigger `trg_<table>_updated_at` actif sur chacune.

---

## Amélioré

- **212 colonnes FK sans index couvrant** identifiées sur l'ensemble du schéma (requête anti-jointure sur `pg_index`/`information_schema.key_column_usage`). 12 ont été indexées (voir "Corrigé") car objectivement fréquentes dans le code ; les 200 restantes sont très majoritairement des colonnes d'audit peu filtrées (`created_by`, `valide_par`, `acteur_id`, `responsable_id`, etc.) — non indexées pour ne pas "indexer au hasard", à réévaluer si le volume de données grossit et que ces filtres deviennent réellement utilisés.
- **84 colonnes `_id` sans FK du tout** passées en revue une à une. Aucune n'est un oubli : ce sont soit des identifiants externes (`stripe_customer_id`, `pennylane_invoice_id`, `youtrust_signature_request_id`, `gmail_history_id`...), soit des références à `auth.users` (convention constante et volontaire dans ce schéma : **0 FK** vers `auth.users` sur l'ensemble des 318 FK existantes — donc cohérent, pas une faille isolée), soit des références polymorphes (`entity_id`, `cible_id`, `source_id`, `media_ref_id` pointent vers des tables différentes selon un discriminant `type`), soit `formation_id` qui référence un catalogue codé en dur côté JS (`FORMATIONS_CATALOG`, confirmé par grep) et non une table. **Aucune FK manquante à ajouter.**
- **83 tables potentiellement "orphelines"** repérées en ne cherchant que dans `SportVision-OS-Full.html` (consigne de départ). Recherche étendue à tout le repo (Connect app Next.js/app-next, Connect mobile, edge functions Supabase) : 59 en fait utilisées ailleurs. Recherche étendue encore aux fonctions RPC Postgres (`information_schema.routines`) : 15 supplémentaires utilisées uniquement via `rpc()` (ex. `user_groups`/`user_group_members` via `create_user_group`/`join_user_group`, `authorization_events` via `submit_parental_authorization`, `connect_manual_calendar_events` via `connect_add_manual_calendar_event`...). Au final **9 tables réellement mortes** (voir "À surveiller").
- **États/statuts** : les colonnes `statut` critiques sont des `ENUM` Postgres typés (`statut_prestation`, `statut_devis`, `statut_facture`... — 6 enums), tous nommés en français, sans synonymes concurrents pour un même concept (`payée`/`annulée` réutilisés à l'identique entre `statut_prestation` et `statut_facture` là où c'est bien le même concept). **Rien à fusionner**, le typage enum empêche déjà la dérive de valeurs.

---

## À surveiller

- **9 tables base sans aucune référence de code trouvée nulle part** (app OS, Connect app, Connect mobile, edge functions, scripts, fonctions RPC) et **0 ligne de données** : `calendar_connections`, `calendar_sync_channels`, `email_connections`, `favorite_collections`, `formation_validations_terrain`, `media_validations`, `webhook_events`, `whatsapp_opt_ins`, et la vue `clubs_safe` (non référencée non plus). `webhook_events` en particulier semble avoir été remplacé par les tables dédiées `stripe_events` / `youtrust_events` (confirmé dans `stripe-webhook/index.ts` et `youtrust-webhook/index.ts`), donc probablement un résidu d'une itération antérieure du schéma d'idempotence webhook. **Non supprimées** : DROP TABLE explicitement interdit par la mission même sur une table vide. À valider avec toi avant un éventuel `DROP TABLE` — elles ne coûtent rien en l'état (0 ligne) mais polluent le schéma pour la lecture.
- **Incohérence de nommage `status` (anglais) vs `statut` (français)** sur la colonne d'état : ~20 tables utilisent `status`, le reste (~65) utilise `statut`, pour représenter exactement le même concept. Détecté avec certitude, **non corrigé** : renommer une colonne impacte tout code qui la lit/écrit dans 3 codebases différentes (OS, Connect app-next, Connect mobile) et les edge functions — risque de casse trop élevé pour une correction autonome nocturne. Recommandation : normaliser vers `statut` uniquement lors d'une refonte volontaire et testée d'une table à la fois, jamais en masse.
- **73 tables ont `created_at` mais pas `updated_at`**. La grande majorité sont des tables de logs/événements immuables où ça n'a pas de sens (`activity_log`, `notifications`, `historique`, `xp_events`, `audit_logs`, `communication_audit_logs`...) — volontairement non touchées. 4 tables clairement mutables ont été corrigées ce soir (voir "Corrigé"). Le reste (~69 tables) n'a pas été passé en revue une par une faute de temps ; si tu identifies des tables métier mutables qui manqueraient d'un suivi de modification, dis-le et je les ajoute au prochain passage.
- **17 tables sans `created_at` du tout** (`authorization_types`, `connect_modules`, `formation_quiz_questions`, `pcg_mapping`, `organization_role_catalog`, `kit_compositions`, `retractation_demandes`, etc.) — la plupart sont des tables de catalogue/référence statiques où ce n'est pas critique. Non corrigées, à faible enjeu.

## Action externe nécessaire

Aucune. Toutes les corrections identifiées comme sûres ont pu être appliquées directement via l'API Management (migrations SQL non destructives, `CREATE INDEX IF NOT EXISTS`, `ALTER COLUMN ... SET NOT NULL` avec vérification préalable, `ADD COLUMN IF NOT EXISTS`). Aucune clé/accès manquant, aucune action tierce (Stripe, Pennylane, DNS...) requise.

## Non modifié volontairement

- **Doublons clients/clubs/profils/organizations** : recherche effectuée (nom+email+téléphone pour clients, nom pour clubs, email pour profiles, nom+type pour organizations) — **0 doublon trouvé**. La base est en réalité quasi vide à ce stade (1 client, 1 club, 1 prestation réels ; 19 profils staff, 23 organizations), donc peu de signal à ce stade ; les requêtes de diagnostic sont prêtes et pourront être rejouées telles quelles quand le volume de clients réels augmentera (objectif : 5 clubs partenaires).
- **Relations orphelines** (mission sans prestation, prestation sans client, livrable sans mission, paiement sans facture/source, affiliation CM vers structure inexistante, membre de club sans club) : toutes vérifiées, **0 orphelin**. Une seule anomalie apparente — une `prestation` (`SV-2026-0069`, `demande_reçue`, `source=interne`) avec `client_id` NULL — confirmée conforme au fonctionnement normal (une demande peut être créée avant qu'un client soit rattaché, cf. `create-guest-request/index.ts`). **Pas un bug, non touché.**
- **Aucun compte de test / QA détecté** (`email ilike 'qa-%'` ou `'test-%'` ou `%@test.%'` → 0 résultat) : rien à nettoyer côté données de test.
- **Renommage `status`/`statut`** et **ajout d'`updated_at` sur ~69 tables restantes** : documentés ci-dessus dans "À surveiller", volontairement non exécutés — impact multi-codebase ou valeur ajoutée trop faible pour agir sans validation.
- **Suppression des 9 tables mortes / de la vue `clubs_safe`** : documenté ci-dessus dans "À surveiller" — `DROP TABLE`/`DROP VIEW` explicitement hors périmètre d'une correction autonome, même sur une table à 0 ligne.
- **200 colonnes FK sans index restantes** (sur les 212 identifiées) : non indexées, fréquence de filtrage non objectivée dans le code actuel — voir "Amélioré".

---

## Fichiers produits

- `livrables/SportVision-TV/migration-audit-final-indexes.sql` — 12 `CREATE INDEX IF NOT EXISTS`, exécutée et vérifiée en réel.
- `livrables/SportVision-TV/migration-audit-final-nullable-timestamps.sql` — 6 `NOT NULL` (avec garde-fou anti-NULL) + 4 `updated_at`/trigger, exécutée et vérifiée en réel.
- `livrables/SportVision-TV/audit/AUDIT_schema_donnees.md` — ce rapport.
