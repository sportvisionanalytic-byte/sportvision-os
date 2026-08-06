# SportVision Connect

Point d'entrée technique du chantier Connect. Ce document est un résumé opérationnel : pour le détail des décisions et du raisonnement, voir `ARCHITECTURE-CONNECT.md` (architecture cible) et `AUDIT-LOT0.md` (audit de l'existant qui l'a précédé).

---

## Vue d'ensemble

SportVision Connect est censé devenir **l'unique plateforme cliente externe** de SportVision : une connexion, une base de données, une coque commune, mais plusieurs "espaces" affichés selon l'organisation ou le profil personnel de l'utilisateur connecté (Club, Coach, Académie, Projet, Sponsor, Joueur, Famille). Elle remplace à terme le Portail (`SportVision-Portail.html`) et Club+ (`SportVision-Club-Plus/app.html`), mais **progressivement et sans les couper** : les deux anciens sites restent en service, en lecture seule pour ce chantier, jusqu'à ce que chaque espace équivalent soit validé côté Connect. `SportVision OS` (l'outil interne staff) n'est pas concerné par cette bascule ; il doit à terme lire/écrire les mêmes entités (`organizations`, `entitlements`) mais son frontend n'est pas touché ici.

**Décision de nommage (postérieure à la construction des espaces ci-dessous)** : "Portail" disparaît comme nom de produit. Ce que le Portail faisait se scinde en deux : sa partie connectée devient l'espace "Projet" de Connect (déjà construit, voir tableau plus bas) ; sa partie publique (accueil, services, catalogue, réalisations, à propos, FAQ) devient le site vitrine **"SportVision"** (sans compte requis), livré séparément dans `livrables/SportVision/` — voir `livrables/SportVision/NOTES-VITRINE.md` pour son propre état d'avancement. Connect reste strictement la zone authentifiée ; SportVision (vitrine) est strictement la zone publique.

C'est un chantier très récent : la coque, les 4 migrations, les 11 modules d'espaces et le socle PWA ont été produits en une seule session, sans qu'aucun utilisateur réel n'ait encore ouvert l'application.

---

## État actuel

| Espace | Maturité | Base de données |
|---|---|---|
| **Club** | Mature — port fidèle de Club+ (le module fonctionnel le plus abouti de l'écosystème existant) | Tables `club_*` existantes, réutilisées telles quelles |
| **Joueur** | Mature — port fidèle d'une brique déjà auditée en sécurité (phase 13) | `player_profiles`, `media_access_rules`, `parental_authorizations`, etc. |
| **Famille** | Mature — même origine que Joueur, sujet le plus sensible (données de mineurs) | `parent_profiles`, `parent_player_relationships`, etc. |
| **Projet** | Mature — port fidèle du Portail existant (devis/contrats/factures + livrables/messagerie/RDV/compte) | Vues `client_devis`/`client_contrats`/`client_factures`, `client_prestations` |
| **Coach** | Neuf, socle minimal — aucun équivalent n'existait avant | `coach_players` + tables génériques `requests`/`calendar_events` (migration v3) |
| **Académie** | Neuf, socle minimal — aucun équivalent n'existait avant | `academie_groups`, `academie_participants` + `requests`/`calendar_events` (migration v3) |
| **Sponsor** | Neuf, socle minimal — aucun équivalent n'existait avant | `club_sponsors`/`club_creations` reliés à une organisation sponsor (migration v4) |

Aucun de ces modules n'a été testé en conditions réelles : aucune migration n'a encore de vrais utilisateurs Coach, Académie ou Sponsor dessus, et personne ne s'est connecté à l'app.

---

## Comment ça marche techniquement

Pas de build, pas de framework, dans la continuité volontaire du reste de l'écosystème (Portail, Club+, OS sont eux aussi des HTML monolithiques sans étape de compilation).

- `app/index.html` est la coque commune : écran de connexion (email/mot de passe via l'API Auth Supabase), sélecteur d'espace si l'utilisateur a accès à plusieurs, et une zone de navigation par onglets générique (`#workspace`).
- Chaque fichier `app/modules/*.js` est chargé directement via `<script src="modules/xxx.js">` **avant** le script principal, pour que son registre soit déjà peuplé au moment où la coque en a besoin. Un fichier de module absent serait traité comme "zéro module" sans erreur bloquante (mécanisme de tolérance, pas un état actuel : les 10 fichiers attendus sont tous présents).
- Chaque module est un IIFE qui s'enregistre dans un registre global (`window.ClubModules`, `window.ProjetModules`, `window.JoueurModules`, `window.FamilleModules`, `window.CoachModules`, `window.AcademieModules`, `window.SponsorModules`) sous forme d'entrées `{ label, espace, render }`.
- Contrat commun : `render(container, contextId, ctx)`. La coque appelle ce contrat de façon identique pour tous les modules, `ctx` porte au minimum `{ role }`.
- **Distinction cruciale : organisation vs profil personnel.** Un "espace" dans Connect est soit une organisation (Club, Coach, Académie, Projet, Sponsor — accès via la table `memberships`, `contextId` = `organizations.id`), soit un profil personnel (Joueur = `player_profiles.id`, Famille = `parent_profiles.id` — accès direct par `user_id`, **jamais** via `organizations`/`memberships`). Un joueur mineur peut exister sans jamais avoir de ligne dans `organizations` : c'est une règle métier volontaire, pas un oubli. Se tromper sur ce point (traiter un `player_profiles.id` comme un `organization_id` ou l'inverse) casse silencieusement la RLS et les filtres de requête — c'est l'erreur la plus probable pour quiconque reprend ce code sans avoir lu cette section.
- Table de correspondance espace → registre, définie dans `index.html` (`WORKSPACE_REGISTRY`) : `club→ClubModules`, `coach→CoachModules`, `academie→AcademieModules`, `projet→ProjetModules`, `joueur→JoueurModules`, `famille→FamilleModules`, `sponsor→SponsorModules`.
- Aucune interface ne doit coder une offre commerciale en dur (`if (offre === 'performance')`). Le modèle attendu est `hasModule(organization, 'planning_editorial')`, dérivé de `organization_entitlements` — pour les organisations uniquement, les espaces Joueur/Famille n'ont pas d'entitlements propres.

### Modules disponibles aujourd'hui

| Fichier | Registre | Clés exposées | Rôle |
|---|---|---|---|
| `club-equipes-matches.js` | `ClubModules` | `equipesMatches` | Équipes, éducateurs, Match Center (port de Club+) |
| `club-newsroom-communication.js` | `ClubModules` | `newsroomCommunication` | Newsroom + calendrier éditorial (port de Club+) |
| `club-demandes-medias-sponsors-admin.js` | `ClubModules` | `demandes`, `mediasLivrables`, `sponsors`, `administration` | Demandes de visuels, médias/livrables, fiches sponsors (côté club), gestion des membres |
| `projet-dashboard-devis-contrats-factures.js` | `ProjetModules` | `dashboard`, `devis`, `contrats`, `factures` | Vue d'ensemble + devis/contrats/factures (port du Portail) |
| `projet-demandes-livrables-messagerie-compte.js` | `ProjetModules` | `livrables`, `messagerie`, `rdv`, `compte`, `notifications` | Livrables, messagerie, RDV, compte, notifications (port du Portail) |
| `projet-configurateur.js` | `ProjetModules` | `nouvelleDemande` | Configurateur multi-étapes de commande (port fidèle du Portail, INSERT direct dans `prestations` via la policy `prestations_client_insert`) |
| `joueur-espace.js` | `JoueurModules` | `accueil`, `calendrier`, `medias`, `droits` | Espace Joueur (port de Club+, volet joueur uniquement) |
| `famille-espace.js` | `FamilleModules` | `enfants`, `autorisations`, `livrables`, `paiements` | Espace Famille (port de Club+, volet parent) |
| `coach-espace.js` | `CoachModules` | `accueil`, `joueurs`, `planning`, `demandes`, `administration` | Espace Coach, construit de zéro |
| `academie-espace.js` | `AcademieModules` | `accueil`, `groupes`, `participants`, `planning`, `demandes`, `administration` | Espace Académie, construit de zéro |
| `sponsor-espace.js` | `SponsorModules` | `accueil`, `fiches`, `creations`, `demandes` | Espace Sponsor, construit de zéro sur le socle v4 |

Tous les modules Club/Joueur/Famille/Projet précisent en commentaire d'en-tête qu'ils sont des ports **autonomes** des fichiers `SportVision-Club-Plus/app.html` et `SportVision-Portail.html` — ces deux fichiers de référence n'ont jamais été modifiés dans ce chantier.

---

## Ordre d'exécution des migrations SQL

Les 5 migrations vivent dans `SportVision-TV/` (pas dans ce dossier) et doivent être exécutées **dans Supabase → SQL Editor, dans cet ordre précis**, avant que l'app Connect soit fonctionnelle. Chacune dépend de la précédente.

1. **`migration-connect-v1-securite-hardening.sql`** — généralise à tout le schéma un défaut RLS déjà trouvé et corrigé isolément 4 fois ("colonne non protégée" : une policy `update` autorise les lignes mais pas les colonnes, donc un `PATCH` REST direct pouvait auto-valider un statut ou fabriquer une rémunération). Corrige 6 occurrences les plus graves (frais, prestations, affectations d'équipe, recommandations de grade, XP, demandes club) ; 11 occurrences de sévérité moindre restent en backlog documenté en fin de fichier. Contient une hypothèse métier explicitement signalée comme à confirmer : un club ne peut annuler que sa propre demande **pas encore prise en charge**, jamais une demande déjà en traitement.
2. **`migration-connect-v2-organizations-entitlements.sql`** — pose le socle d'identité qui manquait : `organizations`, `memberships`, `connect_modules`, `organization_entitlements`. Additive et non destructive : `clients`/`clubs`/`club_members`/`client_users` restent intacts et continuent de servir OS/Club+/Portail. `organizations.id` **réutilise** `clubs.id` ou `clients.id` (pas de nouvel UUID généré), pour permettre plus tard un simple renommage de colonne plutôt qu'une migration de données.
3. **`migration-connect-v3-coach-academie-requests.sql`** — crée le socle minimal mais fonctionnel de Coach et Académie (`coach_players`, `academie_groups`, `academie_participants`), plus deux tables génériques réutilisables par tout futur espace : `requests` (remplace le statut/crédits protégés par RPC, même correctif que `club_requests` en v1) et `calendar_events` (lecture seule côté organisation, alimenté par le staff). Dépend explicitement de v2 (référence `organizations.id`).
4. **`migration-connect-v4-sponsor.sql`** — relie `club_sponsors`/`club_creations` à une organisation de type `sponsor` via une colonne `sponsor_organization_id` nullable, pour qu'un sponsor puisse un jour se connecter et voir sa propre fiche. N'ajoute aucun entitlement dédié (volontaire, marqué "phase ultérieure" dans le cahier des charges d'origine).
5. **`migration-connect-v5-membership-invite.sql`** — deux ajouts : (a) une policy + un trigger `mb_self_activate`/`protect_sensitive_membership_fields` qui permettent à un utilisateur d'accepter sa propre invitation (`memberships.status` `'invitation'` → `'actif'`), strictement rien d'autre en self-service (rôle et organisation restent staff-only) ; (b) des triggers `sync_club_to_organization`/`sync_client_to_organization` sur `clients`/`clubs` qui créent ou mettent à jour automatiquement la ligne `organizations` correspondante à chaque écriture — la copie ponctuelle de v2 ne suffisait que pour l'état au moment de son exécution, ceci couvre tout ce qui est créé après.

**Déploiement supplémentaire requis (hors SQL)** : l'edge function `supabase/functions/org-invite/index.ts` doit être déployée séparément (Supabase dashboard → Edge Functions → New Function, nom `org-invite`) pour que les écrans "Administration" de Coach et Académie fonctionnent — voir section suivante.

---

## Invitation self-service (Coach, Académie)

Nouveau depuis cette vague : un propriétaire d'organisation Coach (rôle `proprietaire`) ou un admin d'Académie (rôle `admin`) peut inviter un nouveau membre directement depuis l'onglet "Administration" de son espace, sans passer par le staff SportVision. Mécanisme, mirroir de `clubplus-invite` (Club+) adapté à `organizations`/`memberships` :

1. L'admin remplit le formulaire (email, prénom, nom, rôle) → appel de l'edge function `org-invite`.
2. La fonction vérifie côté serveur (jamais côté client) que l'appelant a bien une adhésion `actif` avec un rôle admin pour CETTE organisation, crée le compte Supabase Auth (ou récupère le compte existant), et insère une ligne `memberships` en statut `'invitation'`.
3. L'invité reçoit l'e-mail Supabase standard, définit son mot de passe, puis peut faire passer sa propre ligne à `'actif'` (autorisé par `mb_self_activate`, migration v5) — aucune autre action self-service (changer de rôle, gérer un autre membre) n'est possible aujourd'hui.

**Sponsor est volontairement exclu** de `org-invite` : aucun catalogue de rôles n'a encore été défini pour ce type d'organisation nulle part dans le code — l'ajouter aurait exigé d'inventer des rôles, pas de simplement généraliser un pattern existant.

---

## Comment tester en local

`app/index.html` est un fichier statique : ouvrez-le directement dans un navigateur (double-clic, ou `open app/index.html`), aucun serveur n'est requis.

Prérequis pour voir autre chose qu'un écran vide :
- Un compte utilisateur **réel** existant dans Supabase Auth (même projet que le reste de l'écosystème, constantes `SB_URL`/`SB_KEY` en dur dans `index.html`).
- Ce compte doit avoir au moins une ligne dans l'une de ces tables : `memberships` (statut `actif`, pour un espace Club/Coach/Académie/Projet/Sponsor), `player_profiles` (espace Joueur) ou `parent_profiles` (espace Famille).
- Sans aucune de ces lignes, l'écran "Aucun espace n'est encore rattaché à ce compte" s'affiche (`pane-noorg`) — c'est le comportement attendu, pas un bug.
- Les 5 migrations SQL doivent avoir été exécutées au préalable (sinon les requêtes vers `memberships`/`organizations`/`organization_entitlements`/`requests`/`calendar_events` échoueront).

Il n'existe aujourd'hui aucun compte de test documenté ni jeu de données de démonstration pour Connect — à créer avant une première recette.

---

## PWA

`app/manifest.json`, `app/sw.js` et `app/netlify.toml` posent le socle PWA de Connect, sur le même modèle que celui du Portail (service worker minimal volontaire, ne met rien en cache côté API/données pour ne jamais servir d'information obsolète). Le manifest et l'enregistrement du service worker sont déjà reliés dans `index.html` (`<link rel="manifest">` + `navigator.serviceWorker.register`).

**Manque avant un vrai déploiement** : les fichiers image référencés par le manifest (`favicon-32.png`, `favicon-192.png`, `apple-touch-icon.png`, `icon-192-maskable.png`, `icon-512.png`, `og-image.png`) n'existent pas encore dans `app/` — à dupliquer depuis le Portail ou remplacer par de nouveaux visuels Connect, sinon l'invite d'installation PWA échouera ou affichera une icône par défaut.

---

## Limites connues / dette assumée

- **Sponsor n'a toujours pas de flux d'invitation self-service** (Coach et Académie si, depuis cette vague) : aucun catalogue de rôles n'existe pour ce type d'organisation, donc seul le staff SportVision peut créer une organisation + un membership sponsor, directement en base.
- **Gestion des AUTRES membres non construite** : un admin Coach/Académie peut inviter, mais ne peut pas encore changer le rôle ou suspendre un membre existant autre que lui-même (`memberships` ne l'autorise pas côté serveur) — resterait à construire un rôle "administrateur d'organisation" explicite, sur le modèle de `is_club_admin` pour Club.
- **Deux failles de sécurité serveur encore en backlog**, documentées dans `migration-connect-v1-securite-hardening.sql` : sponsors à montant libre (`club_sponsors`, un simple membre du club peut fabriquer un montant) et créations directement publiables sans validation (`club_creations`/`club_newsroom_items`). 11 occurrences au total du même pattern "colonne non protégée" restent non corrigées, classées par sévérité en fin de ce fichier.
- **Icônes PWA manquantes** (voir section PWA ci-dessus).
- Aucun module n'a été testé avec de vraies données Coach, Académie ou Sponsor ; aucun test automatisé n'existe sur ce périmètre, cohérent avec le reste de l'écosystème.

---

## Prochaines étapes suggérées

Reprises du plan de migration priorisé de `ARCHITECTURE-CONNECT.md` (§11) :

1. Basculer le Portail existant vers l'espace "Projet" de Connect (réutilise les tables `client_*`, change seulement le contenant).
2. Importer l'Espace Joueur & Famille (déjà mature et sécurisé) dans la coque Connect, en confirmant qu'il tourne sur les mêmes données que Club+.
3. Déployer l'edge function `org-invite` et exécuter la migration v5 (voir sections ci-dessus) pour que l'invitation self-service Coach/Académie soit réellement utilisable, pas seulement écrite.
4. Définir un catalogue de rôles pour Sponsor, puis étendre `org-invite` à ce type d'organisation.
5. Construire un rôle "administrateur d'organisation" habilité à gérer les AUTRES membres (rôle/statut), au-delà de la seule auto-activation.
6. Brancher OS pour lire/écrire `organizations`/`organization_entitlements`/`service_orders` au lieu de `clients`/`clubs`/`prestations` directement — en dernier, car OS est le fichier le plus volumineux et le plus actif de l'écosystème (250 commits en 9 jours), à ne pas toucher tant que le reste n'est pas stabilisé.
7. Fournir les icônes/visuels PWA manquants, puis tester l'installation sur iOS/Android.
8. Basculer chaque ancien site (Portail, Club+) une fois son espace équivalent validé côté Connect — jamais avant validation écrite, conformément à la règle de prudence du cahier des charges.
