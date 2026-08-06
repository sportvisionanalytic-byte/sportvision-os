# Lot 0 — Audit de l'existant avant refonte SportVision Connect

Date : 2026-08-06
Périmètre : audit en lecture seule de l'écosystème existant (Portail, Club+, SportVision OS, modèle de données, appli mobile), conformément au cahier des charges *SportVision Connect* (v1.0, 5 août 2026) et à sa règle de prudence : aucune suppression avant audit, sauvegarde et validation écrite.

Ce document synthétise 3 audits menés en parallèle : modèle de données, frontend client (Portail/Club+/mobile), SportVision OS interne. Il constitue le critère de sortie du **Lot 0** : "Rapport validé, sauvegardes et architecture cible approuvée".

---

## 1. Résumé exécutif

Le constat central est rassurant sur le fond et préoccupant sur la forme.

**Sur le fond** : la donnée métier est déjà largement centralisée sur un seul projet Supabase (confirmé explicitement en commentaire de code : *« même projet que SportVision OS, pas de duplication de données »*), la couverture RLS est quasi complète (102/102 tables auditées), et une brique d'intégration Connect↔OS a déjà commencé à être construite (edge functions `invite-collaborateur`, `request-password-reset`, `dispatch-notifications` + `notification_outbox`). Le module Club+ / Joueur & Famille est mature (13 phases livrées, architecture et revue de sécurité déjà documentées).

**Sur la forme** : ce sont aujourd'hui **trois produits distincts, trois codebases séparées**, chacune en un unique fichier HTML monolithique (Portail 162 Ko, Club+ landing 85 Ko + Club+ app 271 Ko, SportVision OS 1,86 Mo / ~19 800 lignes), sans framework, sans build, sans couche de code partagée. Chaque fichier réimplémente son propre client Supabase REST, son propre design system CSS, et dans le cas Portail/Club+, deux systèmes d'authentification parallèles sans SSO. SportVision OS évolue à un rythme très élevé (250 commits en 9 jours), ce qui en fait une cible mouvante à ne pas refondre en parallèle du chantier Connect.

**Verdict Lot 0** : l'architecture cible du cahier des charges (backend partagé, `packages/domain` commun, une seule identité utilisateur) est faisable sans réécriture, mais elle demande d'abord une phase d'**extraction d'une couche domaine commune** avant toute fusion visuelle des trois frontends. Fusionner les interfaces avant d'unifier l'auth et les entités dupliquées (organisations, commandes, médias, notifications) reproduirait la fragmentation actuelle sous un nouveau nom.

---

## 2. Cartographie de l'existant

| Produit | Fichier(s) principal(aux) | Taille | Rôle réel aujourd'hui |
|---|---|---|---|
| Portail | `SportVision-Portail/SportVision-Portail.html` | 162 Ko | Site public + espace client ponctuel (devis, factures, contrats, livrables) |
| Club+ landing | `SportVision-Club-Plus/SportVision-Club-Plus.html` | 85 Ko | Page marketing Club+ |
| Club+ app | `SportVision-Club-Plus/app.html` | 271 Ko | Espace club connecté : équipes, matchs, Newsroom, sponsors, Espace Joueur & Famille |
| App mobile | `SportVision-Portail-App/` (Capacitor) | — | Wrapper natif iOS/Android, embarque **uniquement** le Portail |
| SportVision OS | `SportVision-TV/SportVision-OS-Full.html` | 1,86 Mo | Outil interne staff : CRM, devis/contrats, missions/planning, kits/matériel, médias/livrables, finance, formation RH, communication interne |
| Base de données | Un seul projet Supabase, ~102 tables réparties sur 83 fichiers `migration-*.sql` | — | Partagée entre Portail/Club+/OS mais sans schéma consolidé unique |

Techniquement, aucune de ces applications n'utilise le SDK `supabase-js` : chacune réimplémente un client REST maison (`sbFetch`/`sbRpc`) avec sa propre gestion de token (`localStorage`), dupliquée à l'identique entre Portail et Club+ avec des clés différentes.

### Chevauchement réel Portail ↔ Club+
Seulement 4 tables communes sur ~30 côté Club+ (`catalogue_offres`, `client_devis`, `client_factures`, `client_contrats`). Le reste est un domaine propre à chaque produit. Aujourd'hui Club+ n'apparaît sur le Portail public que comme argumentaire marketing, sans lien fonctionnel réel — ce sont deux apps séparées avec deux logins séparés, pas un module au sens du cahier des charges.

### Le pont Connect ↔ OS a déjà commencé
`invite-collaborateur` et `request-password-reset` sont déjà en production et appelées par OS. `dispatch-notifications` + la table `notification_outbox` (transactionnelle, avec retries et audit) forment la meilleure base architecturale du repo actuel pour construire les futurs flux bidirectionnels — un gabarit à généraliser plutôt qu'à réinventer. Attention cependant : ce nouveau Communication Hub coexiste avec **2 autres circuits d'email actifs en parallèle** (Resend legacy, appels directs `send-devis-email`/`send-facture-email`), fragmentation à résorber avant d'exposer davantage de flux à Connect.

---

## 3. Tableau consolidé — conserver / corriger / fusionner / développer / supprimer plus tard

Vue transverse, croisant les 3 audits. Détail complet par domaine dans les rapports sources (§8).

| Domaine (cahier des charges) | Statut | Élément(s) concerné(s) | Priorité |
|---|---|---|---|
| **Identité utilisateur unique** | À DÉVELOPPER | 4 univers d'identité étanches aujourd'hui : `profiles` (staff), `client_users` (Portail), `club_members` (Club+ dirigeants), `player_profiles`/`parent_profiles` (Joueur/Famille). Chacun a ses propres fonctions `is_*` non partagées. | **Bloquante** — préalable à toute fusion d'interface |
| **Organisations** | FUSIONNER | `clubs` (Club+) et `clients` (Portail/OS) : pas de FK stricte confirmée, lien informel via un champ mentionné mais non vérifié dans le schéma actuel | Haute |
| **Sélecteur d'espace / SSO** | À DÉVELOPPER | Absent. Un utilisateur avec accès Portail + Club+ doit se reconnecter séparément aujourd'hui | Haute |
| **Commandes de service** | FUSIONNER | `club_bookings` (Club+, staff-driven) vs `prestations` (Portail/OS, devis-driven) : même concept métier, deux pipelines parallèles, déjà signalé en interne comme "décision assumée, pas un bug" | Haute |
| **Crédits Club+ visibles côté OS** | À DÉVELOPPER | 0 occurrence "crédits" dans OS ; le système existe uniquement côté Club+. OS n'a aujourd'hui aucune visibilité sur les soldes clients | Haute |
| **Médias** | FUSIONNER | 3 mondes distincts sans passerelle formelle : `club_media`/`club_creations` (Club+), `media_bibliotheque` (interne), pipeline `media_liens`→`media_versions`→`media_livrables` (production) | Moyenne (fusion progressive, pas un blocage day-1) |
| **Notifications** | FUSIONNER | 4 générations coexistantes : `notifications` (staff) → `messages` → `family_notifications` (jamais construite) → `notification_outbox`/`notification_attempts` (nouveau, à généraliser) | Moyenne — le nouveau système est la bonne cible, il reste à y migrer les 3 anciens |
| **Audit trail** | FUSIONNER | 4 patrons différents pour la même intention : `audit_logs`, `historique`, `communication_audit_logs`, une demi-douzaine de tables `*_events` | Basse (pas bloquant, mais à consolider avant que la liste ne s'allonge encore) |
| **Rôles CM affilié / Lead CM / Direction** | À DÉVELOPPER | Absents d'OS : rôle `cm` unique et plat aujourd'hui (7 rôles sans hiérarchie ni matrice de permissions appliquée) | Haute pour Lot 4 (Full Communication), pas pour Lot 1 |
| **Académie** (programmes, groupes, stages) | À DÉVELOPPER intégralement | `formation_*` existe mais concerne la formation RH interne des collaborateurs, pas une académie sportive pour joueurs — piège de nommage à anticiper | Basse (Lot 5) |
| **Projet / Événement** (éditions, campagnes) | À DÉVELOPPER intégralement | Rien de réutilisable ; `club_calendar_events` n'est qu'une ligne de calendrier par club | Basse (Lot 5) |
| **Newsroom / Match Center (côté OS)** | À DÉVELOPPER | Concepts propres à Club+, absents côté OS — cohérent si Club+ garde ces modules, mais aucune visibilité OS dessus aujourd'hui | Moyenne |
| **Coque commune Connect** (splash, sélecteur d'espace, recherche globale) | À DÉVELOPPER | Absents des 3 produits actuels | Haute (Lot 1) |
| **PWA / manifest / service worker** | CONSERVER | `manifest.json`, stratégie "no-cache volontaire", séparation `IS_APP`/`APP_ALLOWED_PUBLIC_VIEWS` déjà propres et réutilisables | — |
| **Wrapper Capacitor** | CORRIGER | N'embarque que le Portail ; à étendre une fois Club+ fusionné. Dérive de build déjà détectée (`www/index.html` en retard sur la source) | Moyenne |
| **Chantier natif iOS en cours** | CONSERVER, ne pas écraser | Signature Apple Development Team ajoutée récemment dans `project.pbxproj` — travail réel en cours à préserver pendant la refonte web | — |
| **RLS globale** | CONSERVER | 102/102 tables couvertes. Bon niveau de base. | — |
| **Pattern de faille RLS colonne** (auto-promotion de rôle) | CORRIGER, à généraliser | Faille déjà trouvée et corrigée 4 fois séparément (`profiles`, puis 3 fois en phase 13 Club+) sans vérification systématique du reste du schéma | **Haute — sécurité** |
| **`role_permissions` (Club+)** | CORRIGER ou clarifier | Colonne jsonb persistée mais jamais appliquée — risque d'illusion de sécurité pour un club qui croit l'avoir configurée | Moyenne |
| **`SportVision OS Dashboard.dc.html`** | SUPPRIMER (après validation écrite) | Maquette statique obsolète, aucune donnée réelle, 0 appel Supabase | Basse |
| **`email_templates` (ancien) vs `communication_templates` (nouveau)** | À VÉRIFIER avant décision | Doublon probable, usage réel de l'ancien à confirmer avant d'y toucher | Basse |

---

## 4. Alertes sécurité prioritaires

1. **Généraliser la vérification "faille RLS colonne"** (contournement de rôle/statut via `PATCH` REST sur une colonne non protégée par trigger). Motif déjà trouvé et corrigé isolément 4 fois (`profiles.role`, puis 3 cas en phase 13 : `player_profiles`, `team_projects`/`club_bookings`, `media_reports`). Recommandation : passer les ~102 tables au crible de ce pattern spécifique avant tout branchement Connect, pas seulement celles déjà touchées.
2. **Bucket de stockage `clubplus-media` public en lecture**, y compris documents d'autorisation parentale — confidentialité reposant uniquement sur des chemins non devinables, pas sur un contrôle d'accès réel côté storage.
3. **Retrait d'une autorisation parentale ne suspend rien automatiquement** (`team_memberships`/statut de compte restent actifs) — gap fonctionnel avec un impact potentiel RGPD, à traiter avant d'exposer plus largement l'Espace Famille dans Connect.
4. **Aucune stratégie d'archivage/rétention au niveau du stockage physique des médias** (uniquement de la visibilité applicative via RLS). Un média "retiré" reste stocké indéfiniment. Point à trancher avant la refonte, en particulier pour les médias impliquant des mineurs identifiés.

Ces points sont documentés en détail dans `CLUBPLUS_PLAYER_FAMILY_SECURITY_REVIEW.md` (déjà existant) pour tout ce qui concerne Joueur & Famille ; les points 1 et 4 ci-dessus s'appliquent au reste du schéma, non couvert par cette revue.

---

## 5. Dette technique majeure (classée par risque)

1. **Trois fichiers HTML monolithiques sans build ni framework** (Portail, Club+, OS), chacun avec son propre design system CSS et son propre client Supabase REST dupliqué. C'est le risque n°1 pour tenir l'objectif "backend partagé, interfaces cohérentes" du cahier des charges.
2. **SportVision OS à très haute vélocité de commits** (250 en 9 jours) : fichier unique de 1,86 Mo, donc point de contention Git quasi garanti si un chantier Connect touche au même fichier en parallèle du travail courant. Recommandation explicite des 3 audits : ne pas refondre le frontend OS en même temps que la construction du pont Connect↔OS — stabiliser d'abord une API/domaine partagée, brancher Connect dessus, traiter OS ensuite (ou le laisser tel quel, conformément à sa nature "strictement interne").
3. **83 migrations SQL incrémentales sans schéma consolidé unique** — `supabase-schema.sql`/`-v2.sql` sont déjà obsolètes par rapport à l'état réel. Aucun outil de migration versionné (pas de dossier `supabase/migrations/` daté).
4. **3 systèmes d'email actifs en parallèle** (Resend legacy, appels directs `send-*-email`, nouveau Communication Hub Brevo) — à consolider vers le Hub avant d'y brancher Connect, sinon la fragmentation se propage.
5. **Aucune couche `packages/domain` partagée** : chaque univers réimplémente ses propres fonctions de contrôle d'accès (`is_club_member`, `is_own_player`, etc.) sans abstraction commune.
6. **Aucun test automatisé** sur l'ensemble du périmètre (confirmé aussi dans la revue de sécurité existante) — toute refonte progressive devra s'appuyer sur une QA manuelle renforcée faute d'outillage.

---

## 6. Réponses aux questions d'audit (cahier des charges, section 35.2)

| Question | Constat / hypothèse de travail |
|---|---|
| Quelles parties de Club+, du Portail et d'OS sont déjà réutilisables ? | La couche donnée (Supabase, RLS) et les 3 edge functions du Communication Hub. Les 3 frontends sont fonctionnellement riches mais pas réutilisables tels quels (pas de composants, pas de design system commun). |
| Quelle est la source de vérité actuelle pour clients, contrats et prestations ? | `clients`/`devis`/`contrats`/`prestations` côté OS pour la relation commerciale ; `clubs`/`club_bookings` côté Club+ pour l'usage courant du club. Lien entre `clients` et `clubs` informel, à vérifier explicitement (1:1 ? 1:N ? clubs sans client facturé ?) avant de concevoir l'entité `organizations` cible. |
| L'authentification existante permet-elle le multi-organisations et les invitations ? | Non aujourd'hui : 4 univers d'identité séparés, pas de SSO Portail↔Club+. Les mécanismes d'invitation existent (`player_invitations`, `parent_invitations`, `team_invite_codes`, `invite-collaborateur`) mais un par domaine, pas transverses. |
| Les politiques RLS couvrent-elles toutes les tables ? | Oui formellement (102/102), mais le pattern de faille "colonne non protégée" trouvé 4 fois n'a pas été vérifié systématiquement ailleurs — à auditer avant refonte. |
| Comment synchroniser Connect et OS sans boucles ni doublons ? | Généraliser le pattern outbox déjà amorcé (`notification_outbox` + audit + retries) plutôt que d'inventer un mécanisme par flux. Éviter une synchronisation entre deux modèles séparés : consolider `club_bookings`/`prestations` en une seule entité `service_orders` avec type discriminant plutôt que maintenir deux vérités à synchroniser. |
| Comment migrer les anciens comptes et URLs ? | Non traité dans cet audit (hors périmètre technique de la donnée/frontend actuels) — à cadrer avec un plan de redirection dédié en Lot 1/2, conformément à la règle du cahier des charges de ne jamais casser les liens d'invitation, favoris ou e-mails déjà envoyés. |
| Quel volume de médias est supportable et quelle stratégie d'archivage utiliser ? | Aucune stratégie d'archivage physique n'existe aujourd'hui, seulement de la visibilité applicative. Point à trancher avant Connect (cf. alerte sécurité §4.4). |
| Quelles fonctions peuvent être livrées en PWA avant les stores ? | Le socle PWA existant (manifest, service worker, séparation app/web dans le Portail) est réutilisable et déjà pensé pour cette distinction — bonne base pour la Phase 1 du cahier des charges. |
| Quels coûts techniques récurrents selon 10/50/100/500 organisations ? | Non évalué dans cet audit (nécessite des données d'usage/coûts Supabase actuelles, hors périmètre code). |
| Quels points juridiques ou métier nécessitent une validation avant implémentation définitive ? | Textes juridiques des autorisations parentales encore provisoires (déjà signalé dans la revue de sécurité existante) ; suspension d'accès non automatique au retrait d'autorisation ; rétention/archivage des médias impliquant des mineurs. |

---

## 7. Plan de migration proposé — priorités, risques, dépendances

Le cahier des charges (section 33) prévoit 8 lots. Sur la base de cet audit, voici l'ajustement recommandé pour le **Lot 1 — Fondations**, qui conditionne tout le reste :

### Étape 1 — Extraire une couche domaine minimale (préalable, avant toute fusion visuelle)
- Définir formellement les 5-6 objets qui doivent circuler entre Connect et OS : identité, organisation, commande de service, devis/contrat, média/livrable, notification.
- Généraliser le pattern outbox du Communication Hub à ces flux plutôt que de réinventer un mécanisme par domaine.
- **Risque si sauté** : reproduire la fragmentation actuelle (4 systèmes de notifications, 3 circuits d'email) sous un nouveau nom.
- **Dépendance** : aucune — peut démarrer immédiatement, en parallèle du travail courant sur OS, sans y toucher.

### Étape 2 — Unifier l'identité et les organisations
- Réconcilier les 4 univers d'identité (`profiles`, `client_users`, `club_members`, `player_profiles`/`parent_profiles`) vers le modèle `users` + `memberships` cible.
- Clarifier et fusionner la relation `clients` ↔ `clubs` en `organizations`.
- **Risque si sauté** : le "sélecteur d'espace" et le SSO Portail↔Club+ (fonctionnalités structurantes du cahier des charges) restent impossibles à construire proprement.
- **Dépendance** : nécessite d'abord de trancher la question ouverte sur la relation `clients`/`clubs` (§6) avec le fondateur.

### Étape 3 — Consolider les commandes de service et les crédits
- Fusionner `club_bookings`/`prestations` en une entité unique, exposer les crédits Club+ à OS.
- **Risque si sauté** : OS continue à piloter la rentabilité sans visibilité sur une partie réelle de l'activité (crédits, commandes Club+).
- **Dépendance** : Étape 2 (organisations unifiées).

### Étape 4 — Généraliser l'audit de sécurité "colonne non protégée"
- À mener en parallèle des étapes précédentes, avant d'exposer davantage de surface à un frontend Connect unifié.
- **Risque si sauté** : la même faille déjà trouvée 4 fois se reproduira sur une 5e table au moment où Connect y donnera un accès plus large.

### Ce qui peut être conservé tel quel sans risque, dès maintenant
- Le socle PWA (manifest, service worker, séparation app/web).
- Le chantier de signature iOS natif en cours (ne pas écraser).
- Les modules déjà matures de Club+ (Espace Joueur & Famille, autorisations, médias) : à faire migrer vers Connect progressivement, pas à réécrire.

### Recommandation de méthode
Ne pas fusionner les interfaces Portail/Club+/OS avant d'avoir traité les étapes 1 et 2 côté données. Une fusion visuelle prématurée obligerait à choisir entre dupliquer encore la logique d'auth, ou geler le développement pendant la réconciliation — l'ordre inverse (données d'abord) permet de livrer par lots testables sans casser l'existant, conformément à la règle de prudence du cahier des charges.

---

## 8. Rapports source détaillés

Les 3 audits complets (tableaux entité par entité, preuves de code, fichiers de référence) ont été produits par des agents dédiés et sont disponibles dans l'historique de cette conversation si un niveau de détail supplémentaire est nécessaire pour trancher une décision (ex. avant de valider par écrit une suppression). Ils couvrent respectivement :
- Le modèle de données complet (12 domaines du cahier des charges, section 28).
- Le frontend Portail/Club+/mobile (coque commune, section 13 ; stratégie mobile, section 26).
- SportVision OS (répartition des responsabilités, section 23 ; architecture technique, section 29).

À la demande, ils peuvent être extraits dans des fichiers séparés (`AUDIT-DONNEES.md`, `AUDIT-FRONTEND.md`, `AUDIT-OS.md`) pour archivage permanent dans ce dossier.
