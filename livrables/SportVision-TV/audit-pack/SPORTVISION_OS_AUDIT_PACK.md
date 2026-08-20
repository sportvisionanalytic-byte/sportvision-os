# SportVision OS — Audit Pack

Document technique + produit + métier, préparé pour un audit externe strict. Pas de discours marketing : chaque affirmation est sourcée (fichier:ligne quand c'est pertinent) et classée selon un niveau de confiance (voir § Légende). Ce document est **en cours de construction** — voir l'avancement en tête de chaque section.

## Légende — niveau de confiance

- **CONFIRMÉ** : vérifié en lisant le code source réel et/ou en interrogeant la base de données réelle.
- **PARTIELLEMENT CONFIRMÉ** : le code existe et fait ce qui est décrit, mais une dépendance (migration non exécutée, edge function jamais redéployée, contrat/donnée réelle absente) limite ou empêche son fonctionnement en production actuelle.
- **À TESTER** : le code semble exister mais n'a pas été exercé en conditions réelles pendant la préparation de ce pack.
- **NON IMPLÉMENTÉ** : décrit dans un document de cadrage (master doc, cahier des charges) mais absent du code.

---

## 0. Périmètre de ce document

SportVision est un écosystème de 4 applications réelles (+ 2 legacy encore déployées, voir § 5.2) qui partagent **un seul projet Supabase** (réf. `lulgezzpvrlbftbykzrc`) — une seule base Postgres, un seul service Auth, un seul Storage, un seul jeu d'edge functions :

1. **Vitrine publique** (`livrables/SportVision`) — pages HTML statiques, domaine `sportvision-an.fr`.
2. **Connect** (`livrables/SportVision-Connect/app-connect`) — Next.js, espace personnel joueur/particulier.
3. **Club+** (`livrables/SportVision-Connect/app-next`) — Next.js, espace club/organisation professionnel. Historiquement appelé "Connect" tout court dans certains commentaires plus anciens du code — les deux ont été séparés le 12/08/2026.
4. **SportVision OS** (`livrables/SportVision-TV/SportVision-OS-Full.html`) — backoffice interne staff, fichier HTML/JS vanilla unique (~24 900 lignes, aucun framework, aucun build step).

**Full Communication n'est pas une 5ᵉ application.** C'est un contrat commercial (`type_contrat='full_communication'` dans la table `contrats`, exposée en lecture via la vue `client_contrats`) qui, une fois actif pour un club, change dynamiquement son `planCode` dans Club+ et débloque un dashboard dédié (`FullCommunicationDashboard.tsx`). Voir § 5.3 pour le détail exact du mécanisme — **CONFIRMÉ**, ce n'est jamais un champ statique sur `clubs`.

---

## 5. Architecture globale — CONFIRMÉ

### 5.1 Stack technique par application

| Application | Frontend | Build/déploiement | Domaine |
|---|---|---|---|
| Vitrine | HTML/CSS/JS statique | Netlify — `publish=.` (dossier `livrables/SportVision`), redirects 1:1 explicites par page | `sportvision-an.fr` |
| Connect | Next.js | Netlify — `base=livrables/SportVision-Connect/app-connect`, `publish=.next`, plugin `@netlify/plugin-nextjs` explicite | non documenté dans le repo (probable `connect.sportvision-an.fr`, voir § 5.2) |
| Club+ | Next.js | Netlify — `base=livrables/SportVision-Connect/app-next`, `publish=.next`, même plugin explicite | non documenté dans le repo |
| SportVision OS | HTML/JS vanilla, un seul fichier | Netlify — `publish=livrables/SportVision-TV` **à la racine du repo**, redirect catch-all `/` → `/SportVision-OS-Full.html` | non documenté dans le repo (déploiement observé : `sportvision-os.netlify.app`) |

**Backend commun aux 4 apps** : Supabase (réf. `lulgezzpvrlbftbykzrc`) — Postgres (RLS activée table par table, voir § 58), Auth (email/password + magic links), Storage (buckets publics/privés, voir § 34), 37 Edge Functions Deno (voir § 6 du rapport d'architecture, repris ci-dessous en § 17-19).

**Paiements** : Stripe (checkout sessions créées par edge functions dédiées : `create-checkout-session`, `create-clubplus-subscription-checkout`, `create-agent-subscription-checkout`, `create-funding-contribution-checkout`, `create-guest-payment-checkout`, `create-team-contribution-checkout`), webhook centralisé `stripe-webhook`.

**Emails transactionnels** : edge functions dédiées par type de document (`send-devis-email`, `send-facture-email`, `send-facture-pennylane`, `send-signature-request`, `notify-account-change`).

**Signature électronique** : Youtrust (**pas Yousign**, malgré un cahier des charges d'origine qui citait Yousign — corrigé et documenté explicitement dans `ARCHITECTURE-CONNECT.md:224` pour éviter toute confusion future).

**Comptabilité** : intégration Pennylane (`send-facture-pennylane`).

**Cron/jobs** : `dispatch-notifications` (worker du "Communication Hub"), appelée uniquement par pg_cron avec un secret partagé vérifié côté serveur.

**SB_URL codé en dur** dans plusieurs fronts statiques (ex. `reserver.html:686` : `https://lulgezzpvrlbftbykzrc.supabase.co`) — pas de variable d'environnement pour la vitrine (fichiers HTML statiques, pas de build step qui permettrait l'injection).

### 5.2 Note importante — déploiements legacy encore présents dans le repo

Deux applications supplémentaires ont un `netlify.toml` actif dans le repo :

- `livrables/SportVision-Club-Plus/netlify.toml` — ancienne app Club+ en HTML unique (`SportVision-Club-Plus.html`). D'après les commentaires du code actuel (`session.ts` Club+ et `clubplus-invite`), cette app a été **absorbée par l'actuel Club+ (app-next)**.
- `livrables/SportVision-Connect/app/netlify.toml` — ancienne app Connect vanilla (`index.html` + `modules/*.js`), citée comme ancêtre historique dans les commentaires de app-next.

**PARTIELLEMENT CONFIRMÉ** : le code source de ces deux legacy est toujours présent et leur `netlify.toml` toujours actif, ce qui signifie qu'ils **peuvent encore être déployés et servir du trafic réel** si le site Netlify correspondant existe toujours côté hébergeur — ce pack ne peut pas confirmer depuis le code seul si ces sites sont encore en ligne ou ont été désactivés côté Netlify. **Point à vérifier manuellement par Fouka dans le dashboard Netlify avant tout audit de sécurité qui suppose une seule version active par app.**

### 5.3 Mécanisme Full Communication (précision demandée explicitement)

Full Communication n'existe **jamais** comme un plan stocké sur `clubs.plan` ni comme un booléen dédié. Le mécanisme réel (`session.ts` Club+, fonction `buildClubActiveContext`) :

1. Le club a une colonne `clubs.portail_client_id` qui, si renseignée, le relie à un `client_id` côté portail/OS (le "compte client" historique, distinct du compte Club+).
2. À chaque chargement de contexte, Club+ interroge la vue `client_contrats` (jamais la table `contrats` directement — elle n'a de policy RLS que pour le staff) filtrée sur `client_id = clubs.portail_client_id AND type_contrat='full_communication' AND statut='actif'`.
3. Si une ligne existe : `ctx.subscription.planCode` devient `"full_communication"` au lieu du plan dérivé de `clubs.plan` (free/start/performance), et l'interface bascule sur `FullCommunicationDashboard.tsx`.
4. Si le club n'a jamais été relié à un `portail_client_id`, ou n'a pas de contrat actif de ce type, il retombe silencieusement sur son plan Club+ normal.

**PARTIELLEMENT CONFIRMÉ avec historique de bug documenté** : le commentaire du code (`session.ts:238-250`) rapporte explicitement qu'un audit UI/UX à 5 agents le 11/08/2026 a établi qu'**aucun club Full Communication réel n'avait jamais pu obtenir `isFullCommunication=true`** avant correction (mauvais dashboard affiché, mauvaise navigation) — le bug est corrigé dans le code actuel, mais ceci illustre que "le composant existe" et "le workflow a déjà fonctionné en production" sont deux affirmations différentes, à vérifier séparément pour chaque zone du produit (voir § 89 du prompt d'origine — principe appliqué dans tout ce document).

### 5.4 Schéma textuel (architecture réelle, pas idéalisée)

```
                     Vitrine (sportvision-an.fr, HTML statique)
                            │  fetch direct (SB_URL en dur)
                            ▼
                  Edge Functions (Supabase, Deno)
        create-guest-request · create-guest-rdv · check-disponibilite
                            │
                            ▼
                    Postgres (RLS) + Auth + Storage
                    ▲                          ▲
                    │                          │
      ┌─────────────┴──────────┐   ┌───────────┴─────────────┐
      │   Connect (app-connect)│   │      Club+ (app-next)   │
      │ Espace joueur/         │   │ Espace club/organisation│
      │ particulier            │   │  (7 types génériques +  │
      │                        │   │   type "club" avec plan)│
      └─────────────┬──────────┘   └───────────┬──────────────┘
                     │  edge functions dédiées (onboarding, invite,
                     │  activation par token) — jamais d'écriture
                     │  directe organizations/memberships sans
                     │  validation staff
                     ▼
              SportVision OS (backoffice staff, seul point qui
              valide/active réellement une organisation, gère
              production/finances/RH interne)
                     │
                     ▼
        Full Communication = contrat (`contrats`/`client_contrats`)
        rattaché à un club existant via `portail_client_id`,
        jamais une app séparée
```

Ce schéma diffère du schéma "idéal" à 5 branches suggéré dans le prompt d'audit : dans le code réel, **aucune structure/organisation Connect ou Club+ n'est jamais créée sans passer par une validation staff côté OS** (via un token d'activation généré après revue), sauf le plan gratuit self-service (`clubplus-onboarding`). Le flux "Vitrine → OS direct" existe aussi en parallèle pour les demandes ponctuelles (réservation sans compte).

---

---

## 56-57. Base de données — CONFIRMÉ (interrogation directe du schéma réel)

**Vue d'ensemble** : un seul projet Supabase (réf. `lulgezzpvrlbftbykzrc`) partagé par les 4 applications. **168 tables**, **1976 colonnes**, **393 policies RLS actives sur 158 tables**, **270 foreign keys**, **173 fonctions Postgres définies par l'utilisateur**, **3 buckets Storage** (tous publics — voir § 34).

**Volumétrie réelle** (mise à jour 20/08 après nettoyage, voir INC-028 dans `SPORTVISION_KNOWN_INCONSISTENCIES.md`) : `clients`, `organizations`, `clubs`, `memberships`, `club_members` ont été vidées de leurs données de test le 20/08 (les 18/31/2/4/4 lignes précédemment comptées ici étaient à 100% des artefacts QA — "Test Automatise" ×7, doublons "Club Test SportVision", etc., aucune ne correspondait à un vrai prospect/client). Base actuellement **à zéro ligne réelle sur le pivot CRM/Club+** — cohérent avec le statut produit (bêta interne, pas encore en usage CRM quotidien réel). `catalogue_offres` (13) et `profiles` (11, effectif interne SportVision) restent peuplées normalement (données de configuration, pas de CRM). `notifications` conserve un volume plus ancien mais contient elle aussi en grande partie des notifications liées aux comptes de test désormais supprimés.

### Constat structurel majeur : coexistence de deux modèles de données

Le schéma réel révèle une **migration en cours, non terminée**, entre deux représentations d'un même concept :

- **Modèle historique** : `clients` (27 col., pivot CRM/commercial) et `clubs` (27 col., pivot Club+) — ce sont ENCORE les tables les plus richement connectées par foreign key (`clients` : ~20 tables la référencent ; `clubs` : ~25 tables la référencent).
- **Modèle cible** : `organizations` (13 col., type générique unifié : club/académie/coach/sponsor/tournoi/stage/cm_agency/etc.) — connectée à ~13 tables, avec des colonnes explicites `legacy_client_id`/`legacy_club_id` qui pontent vers l'ancien modèle.
- Des triggers de synchronisation existent (`sync_club_to_organization`, `sync_client_to_organization`, `sync_club_member_to_membership`) pour maintenir les deux modèles cohérents en parallèle.
- **Conséquence pour l'audit** : toute vérification de cohérence de données doit tester les DEUX chemins (`clients`/`clubs` ET `organizations`/`memberships`) pour une même entité métier — un bug de synchronisation entre les deux serait invisible en ne regardant qu'un seul des deux modèles.

### Tables centrales par domaine (détail complet dans l'annexe de schéma, voir fichier séparé si besoin d'un export colonne par colonne)

| Domaine | Tables clés |
|---|---|
| CRM / commercial | `clients`, `organizations`, `catalogue_offres`, `client_affiliations`, `client_contacts` |
| Devis / contrats / factures | `devis`, `contrats`, `factures`, `avoirs`, `paiements`, et leurs miroirs côté client : `client_devis`, `client_contrats`, `client_factures` |
| Prestations (mission) | `prestations` (52 colonnes — la table la plus riche du schéma), `prestations_equipe` |
| Club+ | `clubs`, `club_members`, `club_teams`, `club_bookings`, `club_matches`, `club_media`, `club_creations`, `club_requests`, `club_sponsors`, `team_invite_codes`, `team_memberships`, `membership_requests`, `memberships`, `team_projects` |
| Connect (joueur/particulier) | `player_profiles`, `parent_profiles`, `connect_access_relationships`, `connect_clubplus_signup_requests`, `connect_declared_clubs`, `connect_declared_club_players`, `connect_modules` |
| Finance / RH interne | `employee_costs`, `expenses`, `xp_events`, `formation_inscriptions`, `organization_entitlements` |
| Financement participatif | `group_fundings`, `funding_contributions`, `team_project_contributions` |
| Événements | `event_editions`, `event_sessions`, `event_checklist_items` |
| Matériel / production | `kits`, `materiels`, `kit_reservations`, `kit_controles`, `materiel_incidents`, `materiel_maintenances` |
| Médias / livrables | `media_liens`, `media_livrables`, `media_versions`, `media_postproductions`, `media_corrections`, `media_access_rules` |
| Staff interne | `profiles` (staff SportVision, rôle/grade/xp), `messages`, `notifications` |

### Relations (foreign keys) — les 3 vrais pivots du schéma

1. **`prestations`** (id central de production) — référencée par ~24 tables : avis clients, avoirs, commissions, contrats, devis, dépenses, factures, frais, cagnottes, incidents, contrôles/réservations de kit, historique/liens/livrables/livraisons/postproductions/validations/versions média, messages client, notifications, paiements, équipe affectée, RDV, rétractations.
2. **`clients`** (pivot commercial historique) — référencée par ~20 tables, dont `clubs.portail_client_id` (le pont qui permet à un club Club+ d'avoir un compte client OS, condition du mécanisme Full Communication — voir § 5.3), `player_profiles.client_id`.
3. **`clubs`** (pivot Club+ historique) — référencée par ~25 tables (tout le module Club+).

### RLS — 393 policies, patterns dominants (CONFIRMÉ, voir § 58 pour le détail complet)

Voir section 58 dédiée ci-dessous.

### Fonctions `SECURITY DEFINER` critiques (8 auditées en détail)

`accept_club_invitation`, `client_decide_devis`, `client_sign_contrat` (**désactivée intentionnellement** — lève toujours une exception depuis que la signature de contrat passe exclusivement par le webhook Youtrust automatique), `contribute_funding_especes`, `credit_organization` (réservée `role in ('admin','sec')`), `renew_season_membership`, `validate_team_membership` (gère la double validation éducateur→admin), `verify_parental_authorization`. Toutes vérifient explicitement l'autorisation de l'appelant en première ligne de leur corps — nécessaire puisque `SECURITY DEFINER` contourne le RLS de l'appelant par construction.

---

## 58. RLS — CONFIRMÉ (393 policies sur 158 tables, résumé par famille de pattern)

**Tables staff/finance interne** (`accounting_periods`, `avoirs`, `client_contacts`, `client_users`, `commissions`, `contrats`, `devis`, `factures`, `expenses`, `employee_costs`, `tax_reserves`, `forecast_scenarios`, `pcg_mapping`, `fec_exports`, `financial_audit_log`, `cost_allocations`, `vendors`, `materiels`...) : pattern dominant `manage[ALL]` réservé à un sous-ensemble de rôles staff (admin, parfois +compta/+sec/+com selon la table), `read[SELECT]` souvent élargi à `expert_comptable`/`auditeur`. Bien cloisonnées.

**`catalogue_offres`** : écriture staff (admin/com/sec), lecture publique explicite sur `actif=true` — cohérent avec son usage par la vitrine non authentifiée.

**Tables club/Connect** (le plus gros volume de policies) : quatre fonctions d'autorisation reviennent constamment — `is_club_admin(club_id)`, `is_club_member(club_id)`, `is_team_educateur(team_id)`, `is_confirmed_parent_of(player_id)`, `is_own_player(player_id)`, `is_family_of_team(team_id)`. Schéma récurrent sur une douzaine de tables (`club_calendar_events`, `club_matches`, `club_media`, `club_creations`, `club_newsroom_items`, `club_sponsors`, `club_teams`...) : admin supprime, membre du club (restreint à l'éducateur si un `team_id` est renseigné) crée/lit/modifie, famille de l'équipe lit, staff SportVision (ou CM avec accès délégué via `portail_client_id`) lit.

**`membership_requests`** : 5 policies SELECT distinctes selon le rôle de l'observateur (admin club / éducateur / parent confirmé / joueur lui-même / demandeur d'origine) — chacun ne voit que sa ligne selon son rôle réel, pas un flag stocké.

**Tables Connect self-service** (`connect_access_relationships`, `connect_profile_settings`, `notification_preferences`, `favorite_collections`, `managed_athlete_profiles`...) : accès strictement `user_id = auth.uid()` — self-service pur.

**Tables notification/communication** (`communication_audit_logs`, `notification_outbox`, `webhook_events`, `whatsapp_opt_ins`...) : **aucune policy INSERT/UPDATE visible côté utilisateur** — écriture faite via `service_role` depuis les edge functions, en dehors du RLS.

### 4 points relevés pour un audit de sécurité approfondi (à re-tester, pas de simple confiance dans le commentaire)

1. **`parent_invitations`/`player_invitations`** comparent `email = auth.email()` directement (pas via une table de vérification tierce) pour reconnaître le destinataire d'une invitation — à tester : un changement d'email côté compte Auth peut-il permettre de "récupérer" une invitation destinée à quelqu'un d'autre ?
2. Plusieurs tables d'audit/notification n'ont aucune policy d'écriture visible → écriture exclusivement `service_role` (edge functions) → l'isolation des clés `service_role` devient le seul rempart pour ces tables, à vérifier séparément (rotation, exposition dans les repos/CI, etc.).
3. **`messages_client`** cumule **6 chemins d'accès différents** (client_users, membre de club lié via `portail_client_id`, joueur avec accès, propriétaire du client, `connect_access_relationships.right_voir` accepté, `managed_athlete_profiles`) — complexité élevée, risque réel qu'une future modification oublie un chemin et laisse une policy trop permissive ou trop restrictive sans que personne ne le remarque.
4. **`devis`** n'a qu'**une seule policy `ALL`** réservée au staff dans `pg_policies` — aucune policy client directe visible ; la lecture client passe vraisemblablement uniquement par la table miroir `client_devis` ou par la fonction RPC `client_decide_devis`, jamais par un accès RLS direct à `devis`. À confirmer que `client_devis` a bien ses propres policies cohérentes (non auditées en détail dans cette passe).

**Storage** : les 3 buckets (`club-logos`, `clubplus-media`, `portail-media`) sont **tous publics**. Point à vérifier : si un document sensible (justificatif, autorisation parentale scannée, facture PDF) transitait par l'un de ces buckets, son URL suffirait à y accéder sans authentification — à confirmer qu'aucun flux actuel n'y dépose ce type de document.

---

---

## 6-7. Routes / Modules — CONFIRMÉ

SportVision OS n'a **pas de routeur d'URL** — c'est une page unique (`SportVision-OS-Full.html`) où la navigation se fait par deux variables JavaScript internes (`S.role`, `S.view`). Il n'existe donc pas de « table de routes » au sens classique. La table ci-dessous est l'équivalent réel : le **dispatch de chargement de données** (`loadViewData(role,view)`, fichier ligne 3610-3733), qui fait le même travail qu'un routeur — décider quel écran charge quelles données pour quel rôle.

**88 branches de dispatch au total**, réparties sur 9 rôles. Le détail complet (rôle → écran → fonction `loadXxx()` → tables Supabase lues) est trop long pour ce document principal — voir l'inventaire exhaustif en annexe interne (disponible sur demande, extrait lors de la préparation de ce pack). Points structurants à retenir :

- **Duplication assumée et documentée** : les écrans financiers détaillés (factures, acomptes, impayés, avoirs, encaissements, dépenses, frais, rémunérations, rentabilité, clôtures, résultat, commissions, budgets, TVA, FEC, audit, immobilisations) sont dispatchés **deux fois** dans le code — une fois pour `_isComptaLike` (compta/expert_comptable/auditeur), une fois pour `admin`, avec un commentaire explicite expliquant que c'est volontaire pour ne pas dupliquer les dispatches `dash`/`docs` déjà gérés séparément pour admin. Ce n'est pas un bug, mais une source de risque de maintenance (une modification faite d'un côté peut être oubliée de l'autre).
- **Anomalie relevée** : l'écran `msgclients` existe dans le menu du rôle `cm` (« Messages clients ») mais n'a **aucune branche dédiée** dans `loadViewData` — à vérifier si son contenu est chargé autrement (inline, ou partagé avec `loadMsg`) ou s'il s'agit d'un écran de menu sans fonction de chargement réellement branchée.
- **8 appels RPC** (`connect_os_accounts_list`, `connect_os_account_detail`, `credit_organization`, `rpc_complete_formation`, `rpc_get_custom_quiz`, `rpc_submit_quiz`, `seed_event_checklist`, `staff_update_club_request_status`) et **10 edge functions** appelées directement (`invite-collaborateur`, `clubplus-generate-activation`, `connect-staff-create-org`, `connect-club-signup-review`, `notify-account-change`, `send-facture-pennylane`, `send-devis-email`, `send-facture-email`, `request-password-reset`, `admin-delete-portal-account`) — toutes bloquées en mode démo par un garde explicite avant l'appel.

Pour la matrice complète module × rôle × action, voir `SPORTVISION_OS_ROLE_MATRIX.md`.

---

## 12. Statuts — CONFIRMÉ

### Prestations (le cycle le plus complexe, 32 statuts)

État séquentiel géré par une state machine explicite (`_NEXT_ST`) — chaque prestation avance d'un statut au suivant dans un ordre linéaire fixe, jamais de saut libre côté UI standard (un saut reste possible par écriture directe en base, hors du bouton "Étape suivante") :

```
demande_reçue → à_qualifier → offre_en_préparation → devis_envoyé → en_attente_réponse
→ devis_accepté → en_attente_signature → en_attente_acompte → documents_complets
→ à_valider_production → confirmée → à_planifier → planifiée → équipe_affectée → prête
→ équipe_en_route → arrivée_sur_place → production_démarrée → production_terminée
→ médias_à_transférer → médias_complets → à_monter → montage_en_cours → prêt_validation
→ à_valider_client → prête_à_livrer → livrée → facturée → partiellement_payée → payée
→ clôturée
```
(+ 2 statuts terminaux hors séquence : `annulée`, `refusée`)

Note produit : le statut `à_valider_production` a été réintroduit dans la séquence après avoir été « invisible » un temps — il existait dans l'enum avec libellé/couleur/écran de validation prod déjà construits, mais la chaîne « avancer » sautait par-dessus lui jusqu'à correction. Illustre un risque réel de ce type de state machine codée en dur : un statut peut exister « à moitié » (défini mais jamais atteint) sans qu'aucune erreur ne le signale.

Le passage au statut `production_terminée` déclenche automatiquement la génération de la facture associée (idempotent). Trois transitions déclenchent un événement métier (`prestation.confirmed`, `prestation.completed`, `payment.confirmed`) qui alimente un système de tâches automatiques.

**Statut financier** (indépendant du statut prestation) : `non_facturée`, `en_préparation`, `facturée`, `partiellement_payée`, `en_retard`, `payée`.

### Autres cycles de statuts confirmés

| Domaine | Statuts |
|---|---|
| Devis | brouillon → envoyé → en_attente → accepté / refusé / expiré |
| Contrats | brouillon → actif → suspendu / résilié / expiré / en_attente |
| Factures | non_facturée → facturée → partiellement_payée → payée / en_retard |
| Avoirs | emis → comptabilise → rembourse |
| Rétractation (légal) | en_attente → acceptee / refusee |
| Réservations clubs (`club_bookings`) | recue → qualifiee → confirmee → operateur_affecte → mission_realisee → livree / annulee |
| Demandes CM (`club_requests`) | recues → (en_traitement / info_manquante) → prete_a_creer → terminee / refusee |
| Contenus club (`club_creations`) | brouillon → a_valider → valide → publie |
| Newsroom club | recu → a_verifier → (pret_a_transformer / infos_manquantes) → en_creation → programme → publie → archive |
| Cotisations (`group_fundings`) | ouverte → objectif_atteint / expiree / annulee |
| Contribution cotisation | en_attente → paye / rembourse / echoue |
| Contenu éditorial CM | brouillon → a_valider_interne → a_valider_client → corrections → valide → programme → publie → archive |
| Lien média | a_verifier → valide / acces_limite / autorisation_requise / mdp_requis → expirant → expire → inaccessible / remplace / archive |
| Postproduction | a_attribuer → attribuee → a_commencer → en_cours → en_attente_elements → premiere_version_prep → version_prete → a_valider_interne → corrections_demandees/en_cours → prete_nouvelle_validation → validee_interne → a_valider_client → validee_client → prete_a_livrer → livree → archivee / annulee |
| Livrables | a_preparer → en_preparation → a_valider → valide → pret_a_livrer → livre → consulte → lien_expirant → lien_expire → remplace / archive |
| Membership request (Club+, cf. schéma DB § 56) | a_verifier → autorisation_manquante / en_attente_parent / pret_a_valider → validee / refusee / doublon_signale / transferee_admin |

---

## Mode démo — CONFIRMÉ (couverture réelle exacte, corrigée)

**Correction importante par rapport à une estimation communiquée plus tôt dans la soirée** : le mode démo couvre davantage que « juste les écrans comptables manquants » — l'écart réel est plus large. Voici l'état exact après analyse ligne à ligne de chaque écran contre les données factices disponibles.

### Fonctionnement technique
`?demo=1` active `DEMO_MODE`, qui intercepte la fonction centrale `sbFetch()` avant tout appel réseau : les lectures passent par un petit moteur de requêtes PostgREST-compatible (select, filtres eq/neq/in/not.in/gte/lte/is.null, order, limit, résolution d'embeds relationnels via une table de correspondance `DEMO_FK`), les écritures (POST/PATCH/DELETE) mutent les données factices en mémoire (perdues au rechargement), les 8 appels RPC ont un cas dédié chacun, et les 10 actions qui appellent une edge function réelle (envoi d'email, invitation, suppression de compte...) sont bloquées en amont avec un message explicite. **Aucun appel réseau réel n'est jamais fait en mode démo.**

### Écrans avec données factices fonctionnelles (cœur opérationnel)
Prestations (liste + fiche + équipe/consignes/rémunération), Planning, Clients, Devis, Contrats, Kanban, Équipes (production), Incidents, Réservations clubs, Paiement collectif, Comptes Club+/Connect, Collaborateurs, Utilisateurs, Paramètres, Paiements équipe, Tâches, Messagerie (fil d'équipe), Tableau de bord (tous rôles, y compris les KPI dépenses du mois), Documents (partiel), Objectifs commercial, Dashboard commercial.

### Écrans partiellement vides (une table sur plusieurs est absente, pas d'erreur affichée grâce aux gardes `.catch()` existants dans le code — juste des sections vides)
Mon équipe en direct (disponibilités absentes), Agences CM (`organizations` absente), Pipeline commercial (historique de contacts absent), Budget/rapport production (frais absents), Grades & XP (recommandations de grade absentes), Centre de formation (inscriptions absentes).

### Écrans intégralement vides en mode démo (aucune donnée factice ne les couvre)
- **Tout le module Finance détaillé** (confirmé, comme annoncé initialement) : Compte de résultat, Rentabilité, Commissions, Immobilisations, Budgets & prévisions, TVA & provisions, Rapprochement, Acomptes, Impayés, Encaissements Stripe, Clôtures mensuelles, Export FEC, Journal d'audit. Les Avoirs et Factures/Dépenses sont partiellement mieux lotis car ils réutilisent en partie la table `prestations`/`expenses` déjà peuplée.
- **Presque tout le module Community Manager** : Contenus, Analytics, Charge de travail, Publications, Calendrier éditorial (partiel). **Point notable** : l'écran « Demandes » du CM lit une table (`club_requests`) différente de celle peuplée en démo (`connect_clubplus_signup_requests`) — les deux se ressemblent par leur nom mais ne sont pas la même donnée, ce qui rend cet écran vide alors qu'une table à la structure proche existe bien dans les données factices.
- **Presque tout le module Médias/Postproduction/Matériel détaillé** côté production et photographe : liens médias, postproduction, livrables, réservations de kits détaillées, contrôles matériel.
- Le dashboard dédié de l'Expert-comptable (`loadExpertComptableDash`) est quasi entièrement vide (toutes ses tables sont des tables financières détaillées non couvertes).

### Conséquence pratique pour un auditeur
Les rôles **admin, sec, prod, com** et, dans une moindre mesure, **photo** offrent une démo substantiellement représentative. Les rôles **compta, expert_comptable, auditeur et cm** offriront, au-delà du tableau de bord, une expérience très majoritairement vide. **Recommandation** : soit étendre les données factices à ces modules avant un audit qui doit spécifiquement évaluer ces écrans, soit prévenir explicitement l'auditeur externe que ces zones précises ne sont pas démontrables via `?demo=1` et nécessitent une revue de code directe (ce que ce pack fournit déjà en partie, voir § 56-58).

---

*(Sections restantes du plan d'audit d'origine — screenshots, exécution lint/typecheck/build, tests E2E, performance/responsive/accessibilité — non couvertes par ce pack : l'OS n'a pas de build/lint/test configuré (fichier HTML/JS vanilla sans tooling), et la prise de captures d'écran/exécution de tests E2E réels n'a pas été effectuée pendant la préparation de ce document. Voir `SPORTVISION_KNOWN_INCONSISTENCIES.md` pour la dette technique complète, `SPORTVISION_OS_ROLE_MATRIX.md` pour le détail RBAC, `SPORTVISION_ECOSYSTEM_DATA_MATRIX.md` pour la source de vérité par entité, `SPORTVISION_OS_DEMO_URLS.md` pour les URLs.)*

---

## Résumé exécutif

**Architecture générale** : écosystème de 4 applications actives (Vitrine, Connect, Club+, SportVision OS) + 2 déploiements legacy à statut incertain, partageant un seul projet Supabase (168 tables, 393 policies RLS, 270 relations, 173 fonctions). L'OS lui-même est un fichier HTML/JS vanilla unique de ~25 000 lignes sans build ni routeur — architecture volontairement simple, qui a pour contrepartie une dette de maintenabilité réelle (logique dupliquée entre branches de dispatch, pas de test automatisé possible).

**Modules disponibles (opérationnels, avec données réelles)** : cycle de vie complet d'une prestation (32 statuts, state machine explicite), planning, CRM/clients, devis, contrats de base, gestion d'équipe/collaborateurs, RH interne (formation, XP, grades), club+ (équipes, affiliations à double validation, réservations, sponsors), messagerie interne, système de notifications.

**Modules partiellement implémentés** : finance détaillée (les écrans existent et lisent de vraies tables, mais plusieurs dépendent de migrations dont le statut réel en production n'a pas pu être confirmé depuis le code seul — factures, commissions, dépenses, contrats), réservations clubs et cotisations (dépendance RLS explicitement documentée comme non résolue au moment du dernier commentaire trouvé dans le code), Full Communication (mécanisme fonctionnel mais a eu un historique de bug documenté qui l'a rendu inopérant en prod pendant un temps).

**Modules simulés/mockés au sens strict** : aucun mock de données trouvé dans le code de production lui-même (l'OS lit toujours de vraies tables) — la seule vraie couche de simulation est le **mode démo** ajouté ce soir (`?demo=1`), qui est lui-même explicitement un environnement séparé, jamais mélangé avec la production.

**Risques sécurité** : `SECURITY DEFINER` largement utilisé (173 fonctions au total, dont au moins 8 fonctions métier critiques auditées une à une — toutes vérifient l'autorisation en interne, ce qui est le pattern correct mais reporte 100% de la charge de preuve sur chaque fonction individuellement) ; buckets Storage tous publics (à vérifier qu'aucun document sensible n'y transite) ; comparaison d'email brute (`auth.email()`) utilisée pour reconnaître le destinataire d'une invitation sur 2 tables ; complexité d'accès élevée sur `messages_client` (6 chemins cumulés) ; risque résiduel documenté par le code lui-même sur l'accès `sec` à la colonne rémunération via appel API direct.

**Risques finance** : aucune intégration bancaire (Qonto/Revolut) détectée dans les edge functions ni dans le schéma — le "rapprochement" affiché dans l'OS n'est, à ce stade de la recherche, pas confirmé comme un vrai rapprochement transactionnel banque↔comptabilité (voir avertissement dans `SPORTVISION_ECOSYSTEM_DATA_MATRIX.md`). Plusieurs migrations finance (Lot 0) ont un statut d'exécution en production non confirmable depuis le code seul.

**Risques cross-app** : coexistence non résolue de deux modèles de données (`clients`/`clubs` legacy vs `organizations`/`memberships` cible) — toute vérification de cohérence doit tester les deux chemins. Deux applications legacy potentiellement encore déployées. Vocabulaire non unifié (adhésion/affiliation/cotisation).

**Risques lancement** : le mode démo, bien qu'utile pour un premier tour d'audit, laisse plusieurs modules entiers invisibles (finance détaillée, CM, médias/postproduction) — un audit qui se limiterait à naviguer `?demo=1` sans lire aussi ce pack et le code source manquerait une part significative du produit réel.

## Niveau de confiance par grande zone

| Zone | Niveau |
|---|---|
| Architecture technique globale (déploiement, stack, backend partagé) | **CONFIRMÉ** |
| Schéma de base de données (tables, colonnes, foreign keys) | **CONFIRMÉ** (interrogation directe du schéma réel) |
| Policies RLS (existence et contenu) | **CONFIRMÉ** (lues directement en base) — leur *efficacité réelle* contre un scénario d'attaque précis reste **À TESTER** |
| Cycle de vie prestation (statuts, state machine) | **CONFIRMÉ** |
| RBAC frontend (gardes de rôle dans l'OS) | **CONFIRMÉ** pour leur existence — **À TESTER** pour vérifier qu'aucun contournement UI n'est possible |
| Full Communication (mécanisme de résolution dynamique) | **PARTIELLEMENT CONFIRMÉ** — le mécanisme actuel est correct et documenté comme corrigé, mais a eu un historique de panne totale en prod ; à re-tester en conditions réelles avant de le considérer acquis |
| Réservations clubs, Cotisations | **PARTIELLEMENT CONFIRMÉ** — dépendance RLS documentée comme non résolue à un moment donné, statut actuel non re-vérifié dans cette passe |
| Rapprochement bancaire réel | **NON CONFIRMÉ** — aucune preuve d'intégration bancaire trouvée ; ce que l'écran fait exactement reste à lire dans le code (`loadRapprochement`) avant toute conclusion |
| Mode démo (couverture) | **CONFIRMÉ** avec le détail exact des écrans couverts/vides ci-dessus |
| Applications legacy (actives ou non) | **NON CONFIRMÉ** — nécessite une vérification manuelle du dashboard Netlify, hors de portée de ce pack |
| Migrations "Lot 0 Finance" et quelques autres (formations custom, contrats v3) | **À TESTER** — le code documente leur dépendance mais leur statut réel en production n'a pas été re-vérifié dans cette passe |

---

## POUR L'AUDIT CHATGPT, FOURNIR :

1. URL démo principale : `https://sportvision-os.netlify.app/?demo=1`
2. URLs démo des modules : voir `SPORTVISION_OS_DEMO_URLS.md` (liste complète des 9 rôles × leurs écrans)
3. `SPORTVISION_OS_AUDIT_PACK.md` (ce document)
4. `SPORTVISION_OS_AUDIT_DATA.json`
5. `SPORTVISION_OS_ROLE_MATRIX.md`
6. `SPORTVISION_ECOSYSTEM_DATA_MATRIX.md`
7. `SPORTVISION_KNOWN_INCONSISTENCIES.md`
8. Screenshots : **non produits** dans cette passe (aucun outil de capture d'écran disponible) — l'auditeur devra naviguer lui-même les URLs démo listées en (2).
9. Résultats lint/typecheck/tests/build : **non applicable à SportVision OS** (fichier HTML/JS vanilla sans tooling de build) ; Connect et Club+ (Next.js) ont un tooling standard mais n'ont pas été exécutés dans cette passe — à faire séparément si l'audit doit couvrir ces deux apps en détail.
