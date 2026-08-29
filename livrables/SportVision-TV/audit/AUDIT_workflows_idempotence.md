# Audit final autonome — Workflows métier & idempotence (29/08/2026, nuit)

Mission : tracer dans le code réel (JS + SQL + edge functions) les 6 chaînes métier bout-en-bout (A à F) et vérifier/corriger l'idempotence des actions critiques, avec de vrais appels API doublés (pas en théorie).

**Méthode.** Cinq agents de recherche ont tracé chaque chaîne indépendamment dans `SportVision-OS-Full.html` (32 141 lignes) et les migrations `.sql`. Leurs conclusions ont ensuite été **vérifiées une par une contre la base réelle** (Supabase Management API — `information_schema`, `pg_proc`, `pg_trigger`, `pg_constraint`, `pg_policy`) avant d'être retenues, car plusieurs conclusions initiales de "maillon cassé" se sont révélées être des **faux positifs** : les agents ne pouvaient voir que les fichiers `migration-*.sql` commités dans ce dépôt, alors que plusieurs objets (fonctions, colonnes, table, trigger) existent bel et bien en production, appliqués directement sans jamais laisser de fichier migration commité. Ce rapport corrige ces faux positifs et ne retient que les écarts confirmés en base réelle.

Toutes les corrections d'idempotence ci-dessous ont été **testées avec de vrais appels API doublés/concurrents** (curl en parallèle contre l'API REST Supabase, ou requêtes SQL simulant deux transactions concurrentes), pas seulement relues.

---

## Corrigé

### 1. Double création de client — 5 points d'entrée, tous corrigés
**Risque confirmé et testé en réel.** `clients.email` n'a aucune contrainte d'unicité (choix assumé, documenté ci-dessous) et 4 edge functions (`create-guest-request`, `create-guest-rdv`, `portal-onboarding`, `clubplus-onboarding`) + le formulaire staff `creerClient()` faisaient toutes un `SELECT` puis `INSERT` séparés — deux requêtes concurrentes pouvaient lire "absent" avant que l'une des deux n'écrive.

- Nouvelle RPC atomique **`find_or_create_client_by_email`** (`migration-audit-final-find-or-create-client.sql`) : verrou consultatif Postgres (`pg_advisory_xact_lock` scopé au hash de l'e-mail) puis recherche-ou-création dans la même transaction. Retourne la ligne `clients` + un indicateur `_created`.
- Les 4 edge functions (`supabase/functions/{create-guest-request,create-guest-rdv,portal-onboarding,clubplus-onboarding}/index.ts`) appellent désormais cette RPC au lieu de leur ancien motif `select().maybeSingle()` puis `insert()`. Pour `portal-onboarding`/`clubplus-onboarding`, la RPC n'est appelée **que** dans la branche `email_confirmed_at` déjà existante — le comportement sécurité "jamais de rattachement à un client existant sur un e-mail non confirmé" (correctif du 10/08/2026) est strictement préservé, non touché.
- `creerClient()` (OS, `SportVision-OS-Full.html` ~L4382) : ajout d'une garde de ré-entrance (`window._fcCreating`, bouton `#fc-submit-btn` désactivé pendant l'appel) — la vérification anti-doublon existante (floue, nom+ville, contournable via "Créer quand même") reste inchangée, seul le risque de double-clic est fermé.
- **Test réel** : 3 appels concurrents à `find_or_create_client_by_email` avec le même e-mail via `curl` en parallèle → une seule ligne `clients` créée, les 3 réponses portent le même `id` (un seul `_created:true`, les autres `_created:false`). Ligne de test supprimée après vérification.

⚠️ **Action externe requise pour que ces 4 correctifs prennent effet en prod** — voir section dédiée plus bas : ces edge functions ne se déploient pas automatiquement depuis le dépôt.

### 2. Double affectation opérateur → double rémunération
**Risque confirmé par 3 agents indépendamment (workflows A, C, F) et documenté dans le code lui-même** (`ajouterMembreEquipe()`, commentaire en ligne) : garde applicative "lecture puis écriture" (pas de transaction), sans contrainte en base.
- Nouvel index unique partiel `prestations_equipe_active_uniq` sur `(prestation_id, collaborateur_id)` pour les statuts actifs (`invitation_envoyée`, `en_attente`, `acceptée`) — exclut `refusée`/`remplacée`/`annulée` pour ne pas bloquer une réaffectation légitime après refus. Vérifié : 0 ligne en base au moment de la création (aucun risque de migration bloquante), `prestations_equipe` totalement vide en prod à ce jour.
- `ajouterMembreEquipe()` (`SportVision-OS-Full.html` ~L12651) : gère désormais une violation `23505` sans erreur générique trompeuse ("Ce collaborateur est déjà affecté...").
- Migration : `migration-audit-final-idempotence-guards.sql`.

### 3. Double facture pour une même prestation
**Risque confirmé** : `getOrCreateFacture()` fait le même motif lecture-puis-écriture non atomique, appelé à la fois automatiquement (`avancerStatutPrestation` sur `production_terminée`) et manuellement (bouton "Émettre"/`emettreFacture()`).
- Nouvel index unique partiel `factures_prestation_id_uniq` sur `factures(prestation_id) WHERE prestation_id IS NOT NULL`. Vérifié safe : un seul `type_facture` ('totalite') existe dans tout le code, l'UI masque déjà le bouton "Émettre" dès qu'une facture existe — la règle "une facture par prestation" est déjà la règle produit en vigueur, seulement pas garantie en base. 0 ligne en base au moment de la création.
- `getOrCreateFacture()` (`SportVision-OS-Full.html` ~L15538) : en cas de violation `23505` (course gagnée par un appel concurrent), relit la facture qui vient d'être créée au lieu de renvoyer `null` (faux échec).
- Migration : `migration-audit-final-idempotence-guards.sql`.

### 4. Traçabilité demande Club+ "graphique" → contenu créé
**Maillon manquant confirmé (workflow B).** `contenus.request_id` existe en base depuis `migration-clubplus-v37` spécifiquement pour relier un contenu à la demande Club+ dont il découle ("exploitable plus tard sans nouvelle migration", commentaire d'origine) — mais `creerContenuDepuisDemande()` → `creerContenu()` ne le renseignait jamais.
- `creerContenuDepuisDemande(clientId, titre, requestId)` : signature étendue, l'`id` de la demande (`d.id`) est désormais transmis depuis le bouton "+ Contenu" (`SportVision-OS-Full.html` ~L19855).
- `modalNouveauContenu()`/`creerContenu()` : le `request_id` transite via `window._ctRequestId` (remis à `null` à chaque ouverture de modale et après création) et est persisté dans l'`INSERT contenus`.
- Aucun changement de règle métier : le champ existait déjà pour cet usage précis, seule la plomberie manquait.

### 5. Réconciliation schéma base ↔ dépôt (dérive découverte pendant l'audit)
**Découverte majeure de cet audit** : plusieurs objets que les agents de traçage cherchaient dans les migrations versionnées — et que le prompt d'audit lui-même citait comme "bon pattern de référence" (`claim_club_request`, `protect_junior_content_publication`) — **existent bel et bien en base de production**, correctement configurés et fonctionnels, mais **n'apparaissent dans AUCUN fichier `migration-*.sql` de ce dépôt** (recherche exhaustive `grep -rl` sur tout `livrables/SportVision-TV/`, y compris le sous-dossier `supabase/migrations/`). Ces objets ont été créés directement en base (SQL Editor ou script non committé) lors de sessions précédentes.

Vérifié un par un contre la base réelle avant d'écrire ce constat (pour ne pas répéter l'erreur des agents de traçage) :
- Fonction `claim_club_request` — présente, code identique au pattern atomique attendu (`UPDATE ... WHERE taken_by IS NULL RETURNING`). **Testé en réel** : deux appels concurrents sur la même demande → un seul réussit, l'autre reçoit explicitement "Demande introuvable ou deja prise en charge."
- Fonction + trigger `protect_junior_content_publication` — présents et attachés à `contenus` (`BEFORE INSERT OR UPDATE`).
- Colonne `profiles.cm_niveau_autonomie` + contrainte CHECK (`junior`/`autonome`/`responsable`) — présente.
- Table `cm_tutorships` + RLS + policies (`cm_tutorships_read`/`cm_tutorships_write`) — présente.
- `contenus.statut` CHECK constraint incluant `pret`/`a_valider_tuteur` — présent.
- Fonction `contenus_valider_transition_statut()` autorisant les transitions `brouillon→pret`, `brouillon→a_valider_tuteur`, etc. — présente et **vérifiée conforme** (contredit directement la conclusion initiale "CASSÉ" d'un des agents de traçage, qui n'avait pas accès à la base réelle).
- Colonnes `profiles.niveau_operateur` (+ CHECK 1-5), `prestations.format_mission` (+ CHECK), `prestations_equipe.{niveau_snapshot,base_rate_snapshot,multiplier_snapshot,override_reason}` — toutes présentes.

**Correction apportée** : `migration-audit-final-schema-reconciliation.sql` réplique fidèlement l'état actuel de ces objets (colonnes en `ADD COLUMN IF NOT EXISTS`, contraintes en `DO $$ ... IF NOT EXISTS ... $$`, fonctions en `CREATE OR REPLACE`, policies en `DO $$ ... IF NOT EXISTS ... $$`). **Exécutée en base et vérifiée strictement no-op** (aucune ligne modifiée, tous les objets identiques avant/après) — son seul effet réel est de rendre l'état actuel de la base reproductible depuis les migrations versionnées de ce dépôt, ce qui n'était plus le cas. Sans ce correctif, toute reconstruction de la base depuis les migrations du dépôt aurait silencieusement cassé Club+ (prise en charge pool), le tutorat CM Junior et le moteur de rémunération.

### 6. Gardes de ré-entrance manquantes (double-clic)
Ajoutées, même idiome que le reste du code (`if(btn.disabled)return;btn.disabled=true;...finally{btn.disabled=false}`) :
- `confirmerLivraison()` (`SportVision-OS-Full.html` ~L10612) : aucune protection n'existait — un double-clic pouvait créer deux lignes `media_livraisons` (donc un double e-mail envoyé au client) et un double brouillon `contenus`/notification CM.
- `secConfirmerPaye()` (~L24656) : un double-clic dupliquait l'écriture `logFinancialAudit` (double entrée d'audit financier pour le même encaissement).
- `recrutCreerCollaborateur()` (~L6925) : un double-clic renvoyait un 2ᵉ e-mail d'invitation pour rien (le doublon de compte lui-même était déjà empêché par l'unicité native de `auth.users.email`, mais rien n'empêchait le gaspillage réseau/e-mail).

---

## Amélioré

- **`ajouterMembreEquipe()` et `getOrCreateFacture()`** : au-delà de la contrainte DB (section Corrigé), gèrent maintenant explicitement le cas `23505` pour transformer un "faux échec" (l'autre appel concurrent a réussi) en message clair ou en relecture silencieuse, plutôt qu'un message d'erreur générique trompeur.
- **`find_or_create_client_by_email`** retourne un indicateur `_created` exploité par `portal-onboarding` pour préserver exactement le comportement existant de la bannière promo "-10% offerts" (affichée seulement pour une fiche réellement neuve).

---

## Verdict par workflow (état réel vérifié en base, pas déduit)

### A. Prestation Connect
**PARTIELLEMENT CASSÉ.** La colonne vertébrale (machine à états `prestations.statut` verrouillée par trigger, RPC `validate_production` finale) est solide et **testée idempotente en réel** (voir plus bas). Deux vrais défauts subsistent, non corrigés (décision produit requise, voir "Non modifié volontairement") :
- `en_attente_signature`/`en_attente_acompte`/`documents_complets` sont des statuts orphelins : rien ne les fait progresser automatiquement (ni signature reçue, ni acompte encaissé détectés), seul un clic manuel sur la flèche générique les avance — contrairement au reste de la chaîne qui est largement automatisé.
- La "livraison" au client Connect repose sur deux machines à état indépendantes (`prestations.statut` vs `media_livrables.statut`) qui peuvent diverger ; un correctif du 28/08 avertit après coup mais ne bloque pas — un client peut recevoir une notification "livré" avec un espace Connect vide.

### B. Club+ — deux chaînes distinctes
**Prestation Club+ (réservation → Secrétaire → Production) : CASSÉ.** `club_bookings` (réservations) et `prestations`/`prestations_equipe` (Production) sont deux systèmes totalement disjoints — aucun code ne crée de `prestations` depuis un `club_bookings`, et le rôle `prod` n'a même pas de route vers l'écran "Réservations clubs" (`'prod.reservationsclubs'` n'existe pas, seulement `sec`/`admin`/`com`). Les statuts `operateur_affecte`/`mission_realisee`/`livree` de `club_bookings` sont des libellés sans réalité opérationnelle en Production. **Non corrigé** : construire ce pont est une décision produit (quel mapping de champs, quel déclencheur) — voir "Non modifié volontairement".

**Graphique Club+ (demande → CM → création → livraison) : PARTIELLEMENT CASSÉ.** La prise en charge (`claim_club_request`) fonctionne réellement et est testée atomique (section Corrigé) — la conclusion initiale d'un agent de traçage ("RPC inexistante, deadlock total pour la file générale") était un faux positif dû à la dérive base/dépôt, maintenant documentée et corrigée (section Corrigé §5). En revanche, deux défauts réels subsistent : la traçabilité demande→contenu vient d'être corrigée (section Corrigé §4) ; **il n'existe toujours aucun mécanisme de "livraison" visible côté portail Club+ pour un contenu** (contrairement à `club_media_livrables`, qui existe pour les livrables photo/vidéo issus de `prestations`) — non corrigé, nécessite une décision produit sur ce que "livraison d'un graphique" doit signifier côté Club+.

### C. Full Communication
**INTACT** (conclusion corrigée après vérification en base réelle — l'un des agents de traçage avait initialement conclu "CASSÉ" sur l'étape 7, validation/édition du contenu par le CM, en se basant uniquement sur les fichiers migration commités, qui ne reflètent pas l'état réel de la base). Toute la chaîne club → CM affilié → planning mensuel (`monthly_production_plans`/`planned_presences`) → `generate_missions_from_plan()` (idempotent, filtre `statut='prevu' AND created_prestation_id IS NULL`) → mission → opérateur → média → pont CM (`confirmerLivraison`) → contenu → **validation par transitions strictement vérifiées côté serveur** (`contenus_valider_transition_statut`, y compris les transitions `pret`/`a_valider_tuteur` du tutorat CM Junior) → publication → `contenu_stats` (upsert propre, `on_conflict=contenu_id`) → `monthly_reports` (upsert propre, `on_conflict=client_id,mois`) — fonctionne réellement de bout en bout. Point mineur non corrigé : `confirmerLivraison()` notifie toujours le CM "un brouillon a été préparé" même si l'`INSERT contenus` a échoué silencieusement (`catch(e){}` sans effet sur la notification qui suit) — voir "À surveiller".

### D. Recrutement
**PARTIELLEMENT CASSÉ.** Le tronc "candidat → qualification → retenu → collaborateur → compte OS" est solide (idempotence par e-mail native de `auth.users`, renforcée cette nuit par une garde de ré-entrance côté bouton). En revanche, la seconde moitié ("onboarding → formation → validation terrain → actif → mission") est rompue à deux endroits, non corrigés (décisions produit) :
- `formation_validations_terrain` est une table morte : créée en base (RLS, trigger), jamais lue ni écrite par aucun code JS.
- `profiles.actif` n'est vérifié nulle part au moment d'affecter un collaborateur à une mission réelle (`modalEquipePrestation`) : un candidat "retenu" dont l'onboarding n'a jamais été clôturé peut être sélectionné et affecté comme n'importe quel collaborateur actif.

### E. Commercial
**CASSÉ.** La mécanique technique (prospect → `client_contacts` → RDV → devis → trigger `sync_clients_statut`) fonctionne et est bien tracée. Mais l'étape de gouvernance explicitement demandée par la mission — "client brouillon → Secrétaire/Admin → client actif" — **n'a aucune traduction technique** : `avancerPipeline()` permet à n'importe quel rôle `com` de faire passer un prospect en `'partenaire'` d'un clic, sans validation Secrétaire/Admin ; la RLS `clients_write_acces` confirme que `com` a exactement le même niveau d'écriture que `admin`/`sec` sur `clients`. Non corrigé : c'est un changement de règle métier/RBAC, pas un bug — voir "Non modifié volontairement". Le risque de double création de client identifié dans cette chaîne (4 edge functions + formulaire staff) **est corrigé** (section Corrigé §1).

### F. Rémunération opérateur
**INTACT.** Grades (45/50/55/65/80 €) et coefficients (×1/×1,25/×1,6) conformes au code réel (`OPERATOR_BASE_RATES`, `MISSION_MULTIPLIERS`, L11073-11075), frais de déplacement bien séparés (jamais additionnés à `remuneration` nulle part dans le code). Le montant est figé au moment de la **proposition** (`ajouterMembreEquipe`, écriture des colonnes `*_snapshot`) et jamais recalculé ensuite — `repondreInvitation()` (acceptation) ne touche ni `remuneration` ni les colonnes snapshot, et tous les affichages avals (Prod, Compta, "Mes revenus") lisent uniquement `remuneration`/les snapshots, jamais `niveau_operateur` en direct. Nuance mineure documentée par l'agent de traçage (non un bug) : le gel intervient à la proposition, pas exactement au clic "Accepter" — sans conséquence pratique puisque rien ne recalcule entre les deux. Le seul vrai risque d'idempotence de cette chaîne (double affectation → double rémunération comptée) **est corrigé** (section Corrigé §2) et **testé en réel** : `validate_production()` appelée deux fois de suite sur la même prestation via de vrais appels RPC concurrents → la 2ᵉ réponse porte `"deja_clôturee_avant_appel":true` et `"payables_operateur_valides":0`, aucune ligne dupliquée.

---

## Tests d'idempotence réels effectués (pas en théorie)

Toutes les données de test ont été créées puis supprimées après vérification — aucune trace résiduelle en base.

| Test | Méthode | Résultat |
|---|---|---|
| Double `find_or_create_client_by_email` (même e-mail) | 3 appels `curl` en parallèle (`&` + `wait`) | 1 seule ligne `clients` créée, même `id` dans les 3 réponses |
| Double `claim_club_request` (même demande) | 2 appels concurrents (requêtes SQL simulant 2 sessions via `request.jwt.claims`) | 1 succès, 1 échec explicite "déjà prise en charge" — aucune double prise en charge silencieuse |
| Double `validate_production` (même prestation, "double-clic Valider") | 2 appels RPC successifs sur la même prestation de test (statut `livrée`, 1 `prestations_equipe` en attente de paiement) | 1ʳᵉ passe : transition + 1 payable validé. 2ᵉ passe : `deja_clôturee_avant_appel:true`, 0 payable retouché, 0 ligne dupliquée — **confirme qu'un double-clic "Valider prestation"/"double validation Production" ne crée ni deuxième mission ni deuxième rémunération** |
| `prestations_equipe_active_uniq` / `factures_prestation_id_uniq` | Vérification pré-création : `SELECT ... GROUP BY ... HAVING COUNT(*)>1` sur les deux tables | 0 ligne en violation avant création des index — migration non bloquante confirmée |
| Double webhook paiement Stripe | Relecture de code (`stripe-webhook/index.ts`) + vérification schéma, pas de simulation live (clé Stripe live, hors périmètre sûr d'un test destructif) | Confirmé déjà protégé : insert atomique sur PK `stripe_events.id` (violation `23505` = doublon silencieusement ignoré) **et** contrainte `UNIQUE(paiements.stripe_payment_intent_id)` en base — double garde-fou déjà en place, aucune action nécessaire |

---

## À surveiller

- **`en_attente_signature`/`en_attente_acompte`/`documents_complets`** (workflow A) : statuts sans événement métier réel qui les fait progresser — le pipeline peut rester bloqué silencieusement si le staff oublie de cliquer la flèche manuelle. Pas de garde/alerte pour détecter un blocage prolongé.
- **`confirmerLivraison()`** (workflow C, `SportVision-OS-Full.html` ~L10664) : la notification CM "un brouillon a été préparé" part inconditionnellement même si l'`INSERT contenus` juste avant a échoué silencieusement (`catch(e){}`). Rare en pratique, mais peut notifier un brouillon qui n'existe pas.
- **`formation_validations_terrain`** (workflow D) : table complète (RLS, trigger) créée mais jamais utilisée par aucun écran — soit une fonctionnalité prévue jamais branchée, soit une table à documenter comme abandonnée.
- **`profiles.actif` non vérifié à l'affectation mission** (workflow D, `modalEquipePrestation`, liste chargée sans filtre `actif=eq.true`) : un collaborateur en onboarding non finalisé peut être sélectionné pour une mission réelle. Non corrigé cette nuit par prudence (choix entre avertissement non bloquant, dans le même esprit que les gates déjà en place pour conflit de planning/formation manquante dans `ajouterMembreEquipe`, ou filtre dur — décision produit à trancher plutôt qu'à deviner).
- **Dérive base/dépôt** (section Corrigé §5) : la réconciliation de cette nuit couvre les objets découverts pendant cet audit précis (rémunération, tutorat CM, `claim_club_request`). Rien ne garantit qu'il n'existe pas d'autres objets créés directement en base sans migration commitée ailleurs dans le projet — recommandé : un audit dédié comparant systématiquement `pg_proc`/`information_schema.columns` à l'ensemble des `migration-*.sql` du dépôt.
- **RPC `client_decide_devis`** : fait un `SELECT` (sans `FOR UPDATE`) puis un `UPDATE` sans clause `WHERE statut = ...` sur le statut lu — un double-clic rapide sur "Accepter" peut écrire deux fois la même valeur et insérer deux entrées dans `document_events` (audit dupliqué, pas de corruption de données). Risque mineur, non corrigé cette nuit (fonction sensible — acceptation de CGV/formation de contrat — préférence pour ne pas la modifier sans confirmation).

## Action externe nécessaire

- **Redéploiement manuel des 4 edge functions modifiées** : `create-guest-request`, `create-guest-rdv`, `portal-onboarding`, `clubplus-onboarding`. Ces fichiers portent chacun l'avertissement d'origine *"Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo"* — le correctif de double création de client (section Corrigé §1) est en place dans le dépôt mais **ne protège pas encore la production tant que Fouka n'a pas collé le code de chaque fonction dans Supabase Dashboard → Edge Functions → Deploy**, comme indiqué en tête de chacun de ces 4 fichiers.
- **Aucun credential manquant** cette nuit : toutes les corrections base de données ont pu être exécutées directement via l'API Management avec le token déjà fourni.

## Non modifié volontairement

- **Contrainte UNIQUE globale sur `clients.email`** : envisagée puis écartée. Une organisation (club/association/entreprise) peut légitimement partager un contact avec une autre fiche existante selon le contexte commercial — l'imposer serait un changement de règle métier, pas un correctif d'idempotence. La véritable race condition (dédoublonnage accidentel sur un même appel concurrent) est fermée autrement (section Corrigé §1) sans toucher à cette règle.
- **Pont `club_bookings` → `prestations`/Production** (workflow B, chaîne "Prestation Club+") : construire ce pont exige une décision produit (quels champs mapper, quel événement déclenche la création de mission, qui en est notifié) — non inventé cette nuit.
- **Séparation des pouvoirs Commercial/Secrétariat** (workflow E) : le rôle `com` a aujourd'hui le même niveau d'écriture que `admin`/`sec` sur `clients`, sans étape de validation intermédiaire. Restreindre ce droit est un changement de RBAC avec impact direct sur le travail quotidien du rôle `com` — nécessite confirmation explicite avant toute modification de policy RLS.
- **Filtre `actif`/formation à l'affectation mission** (workflow D) : voir "À surveiller" — décision entre avertissement et blocage dur à trancher par Fouka, pas devinée cette nuit.
- **`client_decide_devis`** : fonction sensible (acceptation CGV/formation de contrat) au check-then-act non atomique mineur — laissée telle quelle par prudence, documentée dans "À surveiller" plutôt que modifiée sans confirmation.

---

## Fichiers modifiés / créés cette nuit

- `livrables/SportVision-TV/SportVision-OS-Full.html` — `creerClient()`, `recrutCreerCollaborateur()`, `ajouterMembreEquipe()`, `getOrCreateFacture()`, `confirmerLivraison()`, `secConfirmerPaye()`, `creerContenuDepuisDemande()`/`modalNouveauContenu()`/`creerContenu()` (syntaxe vérifiée `node --check`).
- `livrables/SportVision-TV/supabase/functions/create-guest-request/index.ts`
- `livrables/SportVision-TV/supabase/functions/create-guest-rdv/index.ts`
- `livrables/SportVision-TV/supabase/functions/portal-onboarding/index.ts`
- `livrables/SportVision-TV/supabase/functions/clubplus-onboarding/index.ts`
- `livrables/SportVision-TV/migration-audit-final-schema-reconciliation.sql` (exécutée, vérifiée no-op)
- `livrables/SportVision-TV/migration-audit-final-idempotence-guards.sql` (exécutée, vérifiée)
- `livrables/SportVision-TV/migration-audit-final-find-or-create-client.sql` (exécutée, vérifiée + testée en réel)
