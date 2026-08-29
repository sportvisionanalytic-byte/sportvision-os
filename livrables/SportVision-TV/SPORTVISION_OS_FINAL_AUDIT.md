# SportVision OS — Audit final autonome (nuit du 28-29/08/2026)

Mission nocturne autonome, en autonomie complète pendant que Fouka dormait. 8 agents ont audité en parallèle des domaines distincts de l'OS (sécurité/RLS/auth, routes/boutons/formulaires, workflows métier de bout en bout + idempotence, schéma Supabase + cohérence des données, finance/rémunération/matériel/formation, notifications/documents/intégrations/mocks, QA transverse console/responsive/accessibilité, calendriers/dates/timezone/performance), avec pour consigne de corriger directement tout ce qui est sûr et de documenter le reste sans y toucher.

Rapports détaillés par domaine dans `livrables/SportVision-TV/audit/AUDIT_*.md`. Ce fichier en est la synthèse.

**Adaptation au stack réel** : le master prompt d'audit suppose un projet Next.js/TypeScript classique (routes, hooks, server actions, build, lint, TypeScript, suite de tests). SportVision OS est un fichier HTML unique (~32 150 lignes) en JavaScript vanilla, sans build ni transpilation. Les sections TypeScript/Lint/Build/Tests du master prompt ont donc été adaptées : `node --check` (extraction des balises `<script>`) a servi de garde-fou syntaxique après chaque lot de modifications, aucun framework de test n'a été introduit (aurait été une complexité nouvelle non justifiée pour ce format de projet).

---

## 1. État global

L'OS était déjà dans un état très solide avant cette nuit, suite aux nombreuses passes d'audit et de polish des semaines précédentes. Cette session a trouvé et corrigé **un nombre restreint mais réel de bugs sérieux** (faille de sécurité, bug de date qui faussait silencieusement les rapports financiers, plusieurs races d'idempotence non protégées), et a confirmé qu'une grande partie du reste (workflows métier, RLS, performance des écrans calendrier, rémunération) fonctionne réellement comme prévu — vérifié par exécution réelle, pas seulement par lecture de code.

Point notable : **la base de données est quasiment vide** (pré-lancement — 1 client réel, 1 club, 1 prestation). Beaucoup de vérifications de cohérence de données (doublons, orphelins) n'ont donc que peu de signal aujourd'hui ; les requêtes de diagnostic sont prêtes et documentées pour être rejouées une fois du volume réel de clients arrivé.

---

## 2. Bugs critiques trouvés

1. **IDOR sur 6 fonctions RPC Connect** (`connect_agent_discount`, `connect_agent_effective_tier`, `connect_agent_relationship_count`, `connect_particulier_limit`, `connect_particulier_total_sportifs_count`, `connect_owner_client_id`) — n'importe qui pouvait consulter le palier d'abonnement, le nombre de sportifs gérés ou le `client_id` interne de n'importe quel autre utilisateur Connect en connaissant son UUID. **Corrigé et vérifié en production cette nuit.**
2. **Décalage systématique d'un mois sur les agrégations "mois courant"** (`new Date(...).toISOString().slice(0,7)`), le bug le plus impactant : le "rapport mensuel d'août" interrogeait en réalité juillet-août au lieu d'août seul, faussant silencieusement CA, nombre de prestations et nouveaux clients affichés à la Direction. **Corrigé partout (9 emplacements) et vérifié.**
3. **Absence d'atomicité sur 3 opérations financières/métier critiques** : double création de client (4 edge functions + formulaire staff), double affectation d'opérateur → double rémunération comptée, double facture pour une même prestation. **Corrigé** (RPC atomique + verrou consultatif pour les clients, index uniques partiels pour affectation/facture) et **testé avec de vrais appels API concurrents**.
4. **Pont métier "Prestation Club+" totalement absent** : `club_bookings` (réservations Club+) et `prestations`/`prestations_equipe` (Production) sont deux systèmes disjoints — aucun code ne fait jamais passer une réservation Club+ vers une vraie mission de Production. Le rôle `prod` n'a même pas de route vers l'écran concerné. **Non corrigé** — c'est une décision produit (quel mapping, quel déclencheur), pas un bug à corriger à l'aveugle. Voir section 10.

---

## 3. Bugs corrigés (cette nuit, vérifiés en réel)

- Faille IDOR sur 6 RPC Connect (voir ci-dessus), appliquée en production.
- Décalage mensuel UTC sur 9 emplacements (rapport mensuel admin, mini-graphiques revenus/finances, run-rate compta, planning CM).
- "Aujourd'hui" calculé en UTC brut au lieu de l'heure locale à 5 endroits (disponibilités collaborateur, livraison médias, "Mon équipe") — bug actif entre minuit et ~2h du matin heure de Paris.
- Contrats/abonnements "expire bientôt" excluait à tort un contrat expirant le jour même (dès potentiellement 2h du matin) ; même correctif sur les Impayés "en retard".
- Double création de client (RPC atomique `find_or_create_client_by_email` + verrou consultatif, câblée dans 4 edge functions + le formulaire staff).
- Double affectation opérateur → double rémunération comptée (index unique partiel `prestations_equipe_active_uniq`).
- Double facture pour une même prestation (index unique partiel `factures_prestation_id_uniq`).
- Traçabilité manquante demande Club+ "graphique" → contenu créé (`contenus.request_id` existait en base mais n'était jamais renseigné).
- Réconciliation d'une dérive base/dépôt découverte pendant l'audit : plusieurs objets SQL fonctionnels en production (tutorat CM Junior, rémunération par niveau, prise en charge Club+ générale) n'avaient jamais de migration commitée dans le dépôt — migration de réconciliation exécutée en no-op vérifié, pour que l'état réel de la base redevienne reproductible depuis les migrations versionnées.
- Route morte "Paramètres" pour les rôles Expert-comptable/Auditeur (fallback "Module en cours de construction").
- Anti-double-clic manquant sur 5 mutations financières/sensibles réelles (confirmation d'acompte, d'impayé, de paiement secrétariat, création de client, création de contrat).
- Gardes de ré-entrance sur confirmation de livraison média, confirmation de paiement, création de collaborateur recrutement.
- Piège de focus clavier absent sur la modale partagée de tout l'OS (~200 points d'appel) — Tab s'échappait vers la page derrière la modale, aucune restauration du focus à la fermeture. Corrigé une fois dans `openModal()`/`closeModal()`, corrige tout l'OS d'un coup.
- Barre de recherche du Centre SportVision réduite à 26px de large et inutilisable en mobile/tablette (≤768px), pour tous les rôles.
- 2 petits bugs d'accessibilité (label manquant sur le bouton de fermeture du menu mobile, `role="dialog"`/`aria-modal` manquants).
- 12 index manquants ajoutés en base (fréquence de filtrage objectivée par grep du code, pas ajoutés au hasard), 6 contraintes NOT NULL, `updated_at`+trigger sur 4 tables métier mutables.
- 3 requêtes "À traiter"/dashboard Production sans `limit=`, potentiellement toute la table `prestations` à chaque chargement.
- Un cache par mois ajouté au Planning secrétaire/admin, évitant un refetch réseau à chaque bascule Calendrier ↔ Liste.
- Deux vrais bugs financiers sur le dashboard Comptable : dépenses simplement "prévues" comptées comme charges réelles, rémunérations sur missions annulées mal filtrées — tous deux faussaient "Charges du mois"/"Marge brute" affichées à la Direction.

## 4. Améliorations appliquées

- Gestion propre des violations de contrainte unique (`23505`) sur affectation opérateur et facturation : message clair au lieu d'une erreur générique trompeuse, ou relecture silencieuse de la ligne créée par l'appel concurrent gagnant plutôt qu'un faux échec.
- Inventaire des intégrations (`SV_INTEGRATIONS`) enrichi avec Google Drive, jusque-là absent alors que c'est le stockage opérationnel principal des rushs/livrables.
- Cohérence du pattern de garde anti-double-clic renforcée sur les 6 RPC Connect touchées par le correctif IDOR.

## 5. Sécurité / RLS

Un travail de sécurité considérable existait déjà (`SECURITY_ARCHITECTURE.md`, `THREAT_MODEL.md`, `RBAC_MATRIX.md`, `SECRETS_MANAGEMENT.md`, audit pré-lancement du 21/08 très approfondi). Cette nuit a **re-vérifié en conditions réelles** (vrais comptes jetables, vrais JWT) que ces correctifs tiennent toujours — confirmé, aucune régression — et a cherché spécifiquement ce qui a été ajouté depuis et jamais audité. C'est là qu'a été trouvée la faille IDOR (section 2), sur des fonctions postérieures à l'audit du 21/08.

Autres points vérifiés en réel cette nuit : isolation cross-club Club+ (testée par exécution, pas seulement par lecture), anti auto-promotion de rôle, RLS financière (`paiements`/`frais`/`contrats` bien inaccessibles au rôle `photo` par la base elle-même, pas juste masqués côté UI), 148 fonctions `SECURITY DEFINER` toujours correctement verrouillées, aucun secret exposé côté frontend, webhooks Stripe/Youtrust toujours correctement signés.

Points ouverts documentés, non corrigés (voir section 10) : token GitHub exposé, buckets Storage Club+/Portail sans plafond de taille/type de fichier, pas de MFA, sessions en `localStorage` sans cookie `httpOnly` (chantier d'architecture, pas un correctif ponctuel).

## 6. Database / Supabase

189 relations (174 tables + 15 vues), 318 foreign keys, 446 index (avant correctifs). 12 index ajoutés, 6 contraintes NOT NULL, `updated_at`+trigger sur 4 tables métier. 9 tables confirmées mortes (0 usage dans tout le code, 0 ligne) — non supprimées, `DROP TABLE` explicitement hors périmètre autonome même sur une table vide. Aucune foreign key manquante trouvée sur les 84 colonnes `_id` sans FK (toutes des identifiants externes légitimes ou des références polymorphes). 0 doublon client/club/profil, 0 relation orpheline, 0 compte de test résiduel — mais base quasi vide, donc peu de signal, requêtes de diagnostic prêtes à rejouer.

Incohérence de nommage confirmée mais non corrigée : colonne `status` (anglais, ~20 tables) vs `statut` (français, ~65 tables) pour le même concept — renommer toucherait 3 codebases (OS, Connect app-next, Connect mobile), risque de casse trop élevé pour une correction nocturne autonome.

**Découverte la plus importante de cette section** : une dérive entre l'état réel de la base et les migrations commitées dans ce dépôt — plusieurs objets fonctionnels en production (tutorat CM Junior, rémunération par niveau, `claim_club_request`) n'avaient jamais de fichier migration commité. Réconcilié cette nuit pour les objets découverts, mais rien ne garantit qu'il n'en existe pas d'autres ailleurs — un audit dédié comparant systématiquement le schéma réel à l'ensemble des migrations du dépôt est recommandé.

## 7. UX / Responsive

268 combinaisons écran×viewport testées cette nuit (7 rôles × mobile/tablette/desktop × tous les écrans de leur sidebar) : **0 erreur console, 0 erreur réseau, 0 overflow horizontal** détecté — l'OS était déjà très propre suite aux deux passes de polish premium de la session précédente. 3 bugs réels trouvés et corrigés malgré tout (invisibles à l'inspection visuelle seule) : piège de focus clavier absent sur toutes les modales, barre de recherche Centre SportVision inutilisable en mobile/tablette, label manquant sur un bouton icône.

## 8. Performance

Aucun N+1 trouvé sur les 5 écrans calendrier audités (déjà jointures + `Promise.all` + requêtes batchées). 3 requêtes dashboard/"À traiter" sans `limit=` corrigées. Quelques dropdowns clients et compteurs de notifications non plafonnés, laissés volontairement (plafonner casserait la sélection au-delà de la coupure ; base trop petite aujourd'hui pour que ce soit un vrai problème). Le calcul SQL du calendrier global (`AT TIME ZONE 'Europe/Paris'`) est nativement DST-safe, confirmé par un test réel à cheval sur le changement d'heure du 25/10/2026.

## 9. APIs / Intégrations

| Intégration | État |
|---|---|
| Supabase (DB, Auth, Storage, Edge Functions) | CONNECTED |
| Stripe | CONNECTED (mais jamais testé avec un vrai cycle de paiement complet en live — noté PARTIEL depuis le 21/08) |
| Google Drive | PARTIAL — collage manuel de lien, aucune connexion API/OAuth réelle (choix produit actuel, pas cassé) |
| Youtrust (signature électronique) | CONNECTED mais désactivée côté produit (décision antérieure de Fouka) |
| Email (Brevo/Resend) | CONNECTED — vérifié par requête directe sur `notification_outbox`, emails réellement envoyés |
| Pennylane | CONNECTED (factures/avoirs) |
| Metricool | NOT IMPLEMENTED — schéma préparé (`publication_provider`/`publication_external_id`), pas d'intégration réelle (décision assumée, pas d'accès API) |
| Revolut Business | NOT IMPLEMENTED — en attente côté Fouka |

## 10. Éléments qui nécessitent une action humaine

Fouka a délégué la décision sur les points 3 à 7 ; tous ont été tranchés et exécutés le matin même (voir détail après la liste). Seul le point 1 reste réellement hors de portée sans son accès personnel.

1. **Traité — Token GitHub personnel exposé en clair dans `git remote -v`.** Ancien token révoqué par Fouka (GitHub → Settings → Developer settings → Personal access tokens). Remplacé par une authentification SSH dédiée (clé générée localement, ajoutée au compte GitHub) — plus aucun secret en clair dans la config git, testé en lecture et en écriture. Correctif partagé automatiquement par tous les worktrees du dépôt (config git commune).
2. **Traité — 4 Edge Functions déployées en production** via l'API Management Supabase (`create-guest-request` v28, `create-guest-rdv` v26, `portal-onboarding` v25, `clubplus-onboarding` v25). Le correctif de double création client de cette nuit est maintenant réellement actif — revérifié par 3 appels concurrents réels sur `create-guest-request` : une seule fiche client créée, données de test nettoyées.
3. **Traité — Pont "Prestation Club+"** (réservation → Production) construit et déployé : `club_bookings.prestation_id` + RPC atomique `club_booking_send_to_production()` (modelée sur `generate_missions_from_plan()`, déjà en prod pour Full Com) + trigger de synchronisation retour (`prestations.statut` → `club_bookings.status`). Bouton "→ Envoyer en Production" ajouté à l'écran Réservations clubs. Testé de bout en bout en conditions réelles : idempotence (double appel = même prestation), garde "club sans client Portail" (message clair, pas de prestation orpheline), rejet d'un rôle non-staff, non-régression de statut, et via la vraie interface (Playwright + vraies données Supabase).
4. **Traité — Séparation Commercial/Secrétariat** : le droit d'écriture de `com` sur `clients` n'a pas été retiré (retirer un droit déjà utilisé au quotidien sans confirmation explicite du sens voulu aurait été risqué) — à la place, Secrétariat et Admin sont désormais notifiés à chaque conclusion de vente (`dispatchSVEvent('client.won')`), pour de la supervision sans rien bloquer.
5. **Traité — Filtre `actif` à l'affectation mission** : avertissement non bloquant ajouté dans `ajouterMembreEquipe()`, même idiome que les gates déjà en place (conflit de planning, formation manquante) — un collaborateur inactif peut toujours être sélectionné si le staff le confirme explicitement, mais ce n'est plus silencieux.
6. **Traité — Buckets Storage `clubplus-media`/`portail-media`** : plafond de 50 Mo/fichier + types autorisés (images, PDF, vidéos courantes) appliqués, contre aucune limite auparavant.
7. **Traité — Cycle de paiement Stripe Club+ testé de bout en bout, en toute sécurité (clés de test, zéro argent réel).** Une copie temporaire isolée du webhook réel (`stripe-webhook-test`, secrets et endpoint Stripe dédiés, jamais la config de production) a permis de valider le code exact du webhook de production sur les 4 événements du cycle de vie Club+, avec vérification en base à chaque étape :
   - `checkout.session.completed` → club activé (plan, engagement, crédits, `subscription_status='actif'`, identifiants Stripe posés) — conforme.
   - `invoice.payment_failed` → `subscription_status` passe à `'impaye'` — conforme.
   - `invoice.paid` → `subscription_status` repasse à `'actif'`, crédits remis au quota — conforme.
   - `customer.subscription.deleted` → `subscription_status` passe à `'annule'`, `stripe_subscription_id` conservé (comportement voulu) — conforme.
   - Rejeu du même événement → détecté comme doublon (`stripe_events`), aucun retraitement — idempotence confirmée.
   Fait au passage : la tentative de modifier `credits_balance` directement en base (pour simuler une conso avant renouvellement) a été **bloquée par le trigger de protection existant** — confirmation supplémentaire, non cherchée, que cette donnée sensible est bien verrouillée même via l'accès Management API. Toute l'infrastructure de test (fonction temporaire, endpoint webhook Stripe, secrets, club/client/produit de test) a été supprimée après coup et vérifiée à zéro résidu ; la fonction et les secrets de production n'ont jamais été touchés (version `stripe-webhook` inchangée à 36 avant/après).

## 11. Dette technique restante

- Anti-double-clic non généralisé (~20 fonctions protégées sur ~478 handlers `onclick` au total) — une passe dédiée avec un helper générique serait plus efficace qu'un correctif au cas par cas.
- Aucune validation email/téléphone réelle au-delà du typage cosmétique `input type="email"/"tel"` (comportement uniforme sur tout le fichier, pas une régression locale).
- 9 tables mortes en base, non supprimées par prudence (`DROP TABLE` hors périmètre autonome).
- Incohérence `status`/`statut` documentée, non corrigée (impact multi-codebase).
- 200 colonnes FK restantes sans index couvrant (fréquence de filtrage non objectivée aujourd'hui, base trop petite pour que ce soit mesurable).
- `formation_validations_terrain` : table complète (RLS, trigger) jamais branchée à aucun écran.
- `en_attente_signature`/`en_attente_acompte`/`documents_complets` : statuts orphelins dans le workflow Prestation Connect, sans événement métier qui les fait progresser automatiquement.
- Pas de MFA, sessions en `localStorage` sans cookie `httpOnly` — chantier d'architecture, pas un correctif ponctuel.

## 12. Score de préparation

| Axe | Score |
|---|---|
| Architecture | 8/10 |
| Sécurité | 8/10 |
| UX | 8/10 |
| Performance | 7/10 |
| Cohérence | 7/10 |
| Fiabilité | 9/10 |
| Prêt pour usage réel | 8/10 |

L'OS a gagné en fiabilité réelle cette nuit (bugs de date et d'idempotence corrigés et vérifiés par exécution, pas supposés) puis ce matin (tous les points d'action de la section 10 traités et vérifiés, y compris le cycle de paiement Stripe complet et le pont Club+ → Production, auparavant totalement absent). Le token exposé est révoqué, l'authentification git repose maintenant sur SSH. Ce qui retient encore la note : quelques décisions produit sciemment laissées ouvertes par prudence (séparation des pouvoirs Commercial/Secrétariat, résolue par de la visibilité plutôt qu'une restriction), et la dette technique de fond documentée en section 11, qui reste réelle mais non bloquante.
