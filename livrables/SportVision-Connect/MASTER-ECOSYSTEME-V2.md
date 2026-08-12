# MASTER PROMPT — NOUVEL ÉCOSYSTÈME SPORTVISION

## SportVision Connect + SportVision Club+ + SportVision OS

### Architecture fonctionnelle, utilisateurs, inscriptions, affiliations, prestations, cotisations collectives et migration de l'existant

**Document maître de référence produit, fourni par Fouka le 12/08/2026 au soir.** Remplace la position de `MASTER-CONNECT-V1.md` §63 sur Club+ ("Club+ est une offre dans SportVision Connect, pas une application séparée") — cette nouvelle architecture fait explicitement de Club+ une vraie application distincte. `MASTER-CONNECT-V1.md` reste pertinent pour tout le détail UX/permissions/modules qui, selon ce document (Partie V §94, "réutiliser les composants existants"), doit essentiellement devenir l'expérience **Club+** : la matrice de rôles Admin/Communication/Éducateur, les modules Prestations/Documents/Factures/Utilisateurs, les règles de sécurité multi-organisation, etc. restent la référence pour Club+. Ce nouveau document définit en plus : la séparation des trois environnements, l'identité utilisateur unique partagée, les affiliations joueur↔club (vérifiées ou déclarées), les groupes personnels, et la cotisation d'équipe (paiement collectif).

**Avant toute implémentation lourde, ce document demande explicitement (Partie XV) de produire un "RAPPORT DE MIGRATION CONNECT → CONNECT + CLUB+" — audit de l'existant, classification, risques, ordre — avant de commencer le code. C'est l'étape en cours.**

## 0. TA MISSION

Tu travailles sur l'écosystème numérique **SportVision**.

Une nouvelle architecture produit vient d'être décidée.

Avant de modifier le code, tu dois comprendre intégralement cette logique.

Cette architecture remplace l'idée précédente consistant à mettre clubs, dirigeants, joueurs, particuliers et futurs parents dans une seule application SportVision Connect.

Désormais, l'écosystème comporte trois environnements fonctionnels distincts mais profondément reliés :

**SPORTVISION OS** — Application interne utilisée par l'équipe SportVision.

**SPORTVISION CLUB+** — Application professionnelle destinée aux organisations sportives et à leurs responsables.

**SPORTVISION CONNECT** — Application personnelle destinée aux joueurs, sportifs, particuliers et, à terme, parents/familles.

Ces environnements ne doivent PAS devenir trois systèmes techniques isolés. Ils doivent fonctionner comme les trois interfaces d'un **même écosystème SportVision**.

## 1. Philosophie générale

- **SPORTVISION OS** : « Nous sommes SportVision et nous devons gérer l'activité. »
- **SPORTVISION CLUB+** : « Nous sommes une organisation et nous travaillons avec SportVision. »
- **SPORTVISION CONNECT** : « Je suis une personne et j'utilise SportVision. »

Cette distinction doit guider l'UX, les interfaces, les permissions, les menus, les inscriptions, les données, les fonctionnalités, les parcours. Ne jamais mélanger inutilement ces trois logiques.

## 2. SportVision OS

Outil interne (admin, secrétaire, commercial, responsable production, photographe, vidéaste, Community Manager, collaborateurs SportVision). Gère clients, organisations, utilisateurs, demandes, prestations, planning, collaborateurs, production, contrats, paiements, factures, abonnements, finances, Club+, Connect, affiliations, cotisations collectives, contenus, notifications, commissions, vision globale de l'écosystème. Console interne, jamais un portail client.

## 3. SportVision Club+

Devient l'environnement professionnel de toutes les organisations — une vraie application, pas un module de Connect. S'adresse aux clubs, académies, écoles de foot, stages, camps, organisateurs de tournois, coachs indépendants, préparateurs physiques, associations, structures sportives, organisateurs d'événements, structures de formation, autres organismes.

## 4. SportVision Connect

Devient l'application personnelle. S'adresse aux joueurs affiliés ou non, joueurs de clubs non partenaires, sportifs individuels, particuliers, clients individuels, futurs parents/responsables légaux. Connect suit la personne indépendamment de son club (elle change de club, garde son compte, son historique, ses prestations, ses groupes, ses contenus, son profil). **Le club ne possède jamais le compte personnel.**

## 5. Une seule identité utilisateur

Ne jamais créer `connect_users` et `clubplus_users` comme deux identités indépendantes. Une identité SportVision commune (`users` : id, email, first_name, last_name, auth data, profile data), puis des relations définissent les accès. Une même personne peut être utilisateur personnel Connect ET administrateur d'un club dans Club+ ET coach d'une académie dans Club+ — même identité, différents contextes.

## 6. Authentification commune

Une seule connexion SportVision (pas de mot de passe Connect différent du mot de passe Club+). La connexion récupère utilisateur, accès Connect, organisations Club+, rôles, permissions.

## 7-9. Cas d'usage selon le profil

- **Connect uniquement** (ex. Lucas, joueur, n'administre rien) → SportVision Connect directement après connexion.
- **Club+ uniquement** (dirigeant sans usage personnel) → SportVision Club+ directement.
- **Mixte** (ex. Christian, joueur/particulier sur Connect + président du FC Montereau + coach d'une académie sur Club+) → sélecteur d'espace après connexion : "Mon espace" (SportVision Connect) / "Mes organisations" (FC Montereau — Administrateur, Elite Academy — Coach).

## 10. Switcher d'espace

Sélecteur d'environnement dans le profil utilisateur. Chaque changement recharge menus, données, permissions, dashboard. Ne jamais mélanger des données de deux organisations sur un même écran.

## 11. URLs / routage

Domaines distincts, sous-domaines, ou routes distinctes (`connect.sportvision-an.fr` / `club.sportvision-an.fr`, ou `sportvision-an.fr/connect` / `/clubplus`) — décision technique libre respectant l'existant. L'important : l'utilisateur comprend immédiatement dans quel environnement il se trouve.

---

# PARTIE I — SPORTVISION CONNECT

## 12. Objectif Connect

Espace personnel simple : compte, profil, pratique sportive, rejoindre une organisation, déclarer un club non partenaire, affiliations, groupes personnels, prestation personnelle, prestation collective, cotisation d'équipe (créer/participer), contenus autorisés, calendrier, contact SportVision. Plus tard : enfants, albums, achats famille.

## 13. Inscription publique Connect

Compte personnel (pas une structure). Prénom, nom, email, mot de passe, confirmation, téléphone facultatif. Puis "Quel profil vous correspond le mieux ?" (Joueur/Joueuse, Sportif/Sportive, Parent/Responsable légal, Particulier, Autre) — **purement informatif, n'accorde aucune permission administrative.**

## 14. Onboarding Connect

Étape 1 Bienvenue. Étape 2 Profil sportif (sport, poste éventuel, catégorie, année de naissance si nécessaire, ville — ne pas trop demander). Étape 3 "Jouez-vous actuellement dans un club ou une structure ?" (Oui/Non/Plus tard) → si oui, rechercher son club.

## 15. Rechercher un club

Distingue organisation partenaire/Club+ ("FC Montereau — Partenaire SportVision ✓") de structure non partenaire ("US Exemple — Non affilié SportVision").

## 16-18. Affiliation à un club Club+

Le joueur sélectionne le club, renseigne équipe/catégorie/rôle sportif, envoie "Demander à rejoindre" → statut "Demande d'affiliation en attente". Le dirigeant/responsable autorisé reçoit la demande côté Club+ (nom, prénom, catégorie, équipe demandées) avec actions Accepter / Refuser / Modifier l'équipe avant validation. Une fois validée : Connect affiche "Mes affiliations — FC Montereau — U18 R2 — Joueur — Affilié ✓" ; Club+ affiche "Lucas Dupont — Connect actif ✓ — U18 R2 — Joueur".

## 19-20. Le club ne possède pas le compte

L'affiliation est une relation (`player_affiliations` : id, user_id, organization_id, team_id, role, status, requested_at, approved_at, ended_at), jamais un transfert de propriété du compte. L'organisation peut mettre fin à l'affiliation, ou le joueur peut quitter — l'affiliation passe à `inactive`/`ended`, le compte Connect reste actif.

## 21-23. Club non partenaire

Le joueur peut déclarer "Mon club n'est pas encore partenaire SportVision" (nom, ville, équipe/catégorie) → Connect affiche "Club déclaré — Non partenaire SportVision". **Ne jamais créer automatiquement un vrai compte Club+ administrable.** Ça permet aux joueurs d'utiliser Connect malgré tout, à SportVision de savoir où jouent ses utilisateurs, de recevoir des prestations de clubs non clients, et de détecter des opportunités commerciales B2B (ex. "US Exemple : 28 utilisateurs Connect, 4 prestations, 3 cotisations" → "Opportunité Club+ potentielle" côté OS, jamais un contact commercial automatisé sans validation).

## 24-25. Mes affiliations

Deux catégories : Affiliations vérifiées (FC Montereau ✓) et Affiliations déclarées (US Exemple, non partenaire). Plusieurs affiliations possibles, pas de limite arbitraire à une seule structure.

## 26-29. Mes équipes / groupes

Fonctionnalité séparée des affiliations officielles — un groupe n'est pas une organisation (ex. "Les Frères", "Five du vendredi", "U18 entre joueurs"). Créer un groupe (nom, image, description facultative) puis inviter des membres (lien, email, WhatsApp, QR code plus tard) — utilisateurs Connect ou non. Un groupe ne possède ni factures d'organisation, ni contrats de club, ni administration professionnelle — ne jamais mélanger avec Club+.

## 30. Navigation Connect V1

Accueil · Mon univers (Mes affiliations, Mes équipes) · SportVision (Prestations, Cotisations, Mes contenus, Calendrier, Messages) · Compte (Mon profil, Aide). Plus tard : Famille (Mes enfants, Albums).

## 31. Dashboard Connect

"Bonjour Lucas 👋" — Mon club (logo/nom/équipe/catégorie/affilié), Prochain événement, Nouveaux contenus, Cotisation en cours (avec montant/objectif), Ma prochaine prestation, Messages. Ne jamais afficher de cartes sans valeur.

## 32-33. Prestations Connect

Catalogue adapté aux personnes, pas toutes les offres B2B automatiquement. Prestations personnelles (shooting individuel, shooting pré-saison, suivi photo individuel, création de contenu joueur, prestation photo/vidéo individuelle sur un match, autres prestations B2C validées). Certaines prestations collectives restent accessibles (Match Photo, Match Vidéo, Pack Match, shooting équipe, contenu collectif) avec choix "Payer seul" / "Payer à plusieurs".

---

# PARTIE II — COTISATIONS COLLECTIVES

## 34-36. Objectif et règle absolue

Fonctionnalité signature : plusieurs joueurs financent ensemble une prestation SportVision (transforme le bricolage WhatsApp existant en parcours fluide). Nom : "Cotisation d'équipe" ou "Paiement collectif", CTA "Payer à plusieurs". **INTERDIT : créer une cagnotte libre non liée à une prestation SportVision réelle** (pas de "Anniversaire — 500€"). Une cotisation existe uniquement pour financer une vraie prestation.

## 37-41. Parcours de création

Choisir la prestation ("Pack Match Complet — 160€") → "Comment souhaitez-vous payer ?" (Payer seul / Payer à plusieurs) → écran de création (prestation, total, date, événement, club/groupe concerné) → mode de répartition :
- **Mode 1 — Parts égales** : total ÷ nombre de participants (ex. 160€/10 = 16€/personne).
- **Mode 2 — Participation libre** : chacun choisit son montant vers un objectif commun.

Le créateur nomme la cotisation, choisit l'événement, le groupe, la répartition, peut contribuer immédiatement, partage le lien, voit la progression.

## 42-43. Lien public et partage

`connect.sportvision-an.fr/cotisation/[token]` — page "Cotisation SportVision" (prestation, événement, "112€ collectés sur 160€", barre de progression, CTA Participer). Actions : copier le lien, partager, WhatsApp (partage natif/lien, pas besoin d'API WhatsApp complexe).

## 44-45. Participation

**Connecté** : montant conseillé, montant restant, bouton participer, paiement Stripe. **Non connecté** : réduire la friction — prénom + email + montant suffisent avant paiement (à valider avec les contraintes Stripe/juridiques/comptables réelles). Après paiement : "Participation enregistrée" + CTA "Créer gratuitement mon compte SportVision Connect" (levier d'acquisition).

## 46. Règle financière absolue

**Les joueurs ne s'envoient jamais l'argent entre eux.** Chaque contribution part directement vers SportVision (Lucas → SportVision : 30€, Noah → SportVision : 20€, etc.). **Le créateur de la cotisation ne reçoit jamais les fonds.**

## 47-49. Modèle de données conceptuel

`group_fundings` (id, service_request_id, creator_user_id, group_id nullable, target_amount, collected_amount, distribution_mode, target_participants, status, deadline, created_at). `funding_contributions` (id, funding_id, user_id nullable, contributor_email, contributor_name, amount, stripe_payment_intent, status, paid_at, refunded_at). Statuts cotisation : draft, active, funded, expired, cancelled, refunded.

## 50-54. Progression, solde, deadline

Le créateur voit objectif/collecté/reste/nombre de participants et le détail par personne (respecter la confidentialité si le lien est très partagé — prénom + initiale envisageable). "Payer le reste" permet de finir de financer sans bloquer pour 8-10€ — **le système calcule un montant maximum payable pour ne jamais dépasser l'objectif.** Chaque cotisation a une deadline liée à la prestation, aucun paiement accepté après.

## 55-56. Objectif non atteint / remboursement

À expiration sans objectif atteint : proposer au créateur de payer le reste, contacter SportVision, ou annuler selon les conditions de la réservation/CGV. **Chaque contribution étant individualisée, le remboursement doit toujours pouvoir restituer correctement chaque paiement — jamais traiter la cagnotte comme un paiement unique appartenant au créateur.**

## 57-58. Cotisations et Club+

Connect : "Mes cotisations" (créées par moi / mes participations / terminées). Si la cotisation concerne une organisation Club+, le responsable peut voir un niveau d'information raisonnable ("Une prestation a été initiée par des joueurs — Pack Match U18 — 112/160€") sans accès aux fonds.

---

# PARTIE III — SPORTVISION CLUB+

## 59-60. Objectif et types d'organisations

Espace professionnel pour centraliser la relation organisation ↔ SportVision. Types : Club, Académie, Stage/Camp, Organisateur de tournoi, Coach, Préparateur physique, Association, Structure sportive, Entreprise sportive, Autre.

## 61-68. Inscription publique Club+ — demande, jamais création immédiate

"Inscrire ma structure" crée une **"Demande d'ouverture Club+"**, jamais une organisation active immédiatement (cohérent avec le correctif de sécurité déjà fait cette nuit sur l'ancien Connect self-service). Étape 1 Structure (nom, type, ville, code postal, site, Instagram). Étape 2 Contact (prénom, nom, email pro, téléphone) + "Quelle est votre fonction ?" (liste déroulante : Président(e), Vice-président(e), Directeur/Directrice, Secrétaire, Trésorier/Trésorière, Responsable communication, Community Manager, Directeur sportif, Responsable sportif, Responsable administratif, Responsable partenariat/sponsoring, Coach, Éducateur/Éducatrice, Responsable d'équipe, Photographe/Vidéaste, Bénévole, Membre du bureau, Autre → champ "Précisez votre fonction").

**RÈGLE CRITIQUE (déjà appliquée cette nuit sur Connect) : `declared_function` ("Président") ne donne JAMAIS automatiquement `membership_role = organization_admin`. Les permissions sont accordées après validation humaine, séparément.**

## 67-70. Besoins, certification, traitement

Besoins multiples (Photo, Vidéo, Communication, Club+, Full Communication, Visuels, Tournois, Stages, Veo, Création de contenu, Découvrir SportVision, Autre). Case de certification obligatoire. OS reçoit "Nouvelle demande Club+" avec actions Valider / Demander des informations / Refuser. À la validation : organisation créée/activée, premier membership créé, rôle Club+ défini, invitation sécurisée envoyée (jamais de mot de passe créé au nom du client).

## 71-73. Invitation et rôles Club+

Email "Votre espace SportVision Club+ est disponible" → CTA "Activer mon accès" (création de mot de passe si nouvelle identité, ou "Ajouter Club+ à mon compte" si l'identité SportVision existe déjà). Rôles : Administrateur organisation, Responsable communication, Responsable sportif, Coach/Éducateur, Secrétaire/Administratif, Finance/Trésorier, + permissions personnalisées possibles. **Un joueur n'a généralement pas de dashboard Club+ — il est affilié via Connect, Club+ gère cette affiliation.**

## 74-75. Navigation et dashboard Club+

Accueil · SportVision (Prestations, Demandes, Contenus, Calendrier, Rendez-vous) · Communication (Demandes de visuels, Crédits, contenus) · Structure (Affiliations/Joueurs, Équipes/catégories, Utilisateurs responsables) · Administration (Documents, Devis, Contrats, Factures, Offre) · Échanges (Messages) · Compte (Paramètres, Aide) — adapté selon plan et rôle. Dashboard : à traiter (contrat/facture/demandes/affiliations), prochaine prestation, derniers contenus, demandes en cours, joueurs affiliés, offre/crédits.

## 76-79. Affiliations côté Club+

Page "Joueurs affiliés" (prénom, nom, équipe, catégorie, statut Connect, statut affiliation ; filtres actifs/demandes/invités/anciens). Club+ peut "Inviter un joueur" (prénom, nom, email, équipe, catégorie) → si le joueur a déjà Connect, notification à accepter/refuser ; sinon email d'invitation avec CTA "Créer mon compte", affiliation proposée automatiquement une fois le compte créé.

## 80-82. Prestations et contenus Club+

L'organisation consulte/demande des prestations (arrivent dans OS), récupère ses contenus, gère certains documents. Diffusion vers les joueurs : SportVision livre des contenus → Club+ les voit disponibles → action "Partager aux joueurs affiliés" → Connect des joueurs concernés reçoit "Nouveau contenu disponible" (crée les droits nécessaires côté Connect).

---

# PARTIE IV — LIEN AVEC SPORTVISION OS

## 83-84. Un seul objet métier

Jamais `connect_service_request` / `clubplus_service_request` / `os_service_request` séparées pour la même chose — une seule `service_requests` (requester_type, requester_user_id, organization_id nullable, source, status, service_type, etc.), différentes interfaces l'affichent. `source` (Club+, Connect individuel, Connect cotisation, OS manuel, vitrine) permet de mesurer l'acquisition.

## 85-88. Flux croisés

Connect → OS (commande individuelle ou cotisation financée). Club+ → OS (demande organisation). OS → Club+ (prestation confirmée, contenus livrés). OS → Connect (shooting terminé, contenu joueur disponible).

## 89-91. Paiements et signature

Réutiliser Stripe existant, ne jamais créer deux systèmes Stripe séparés (Connect vs Club+) — paiements toujours rattachés à commande/utilisateur/prestation/organisation/cotisation. Chaque contribution de cotisation porte des metadata Stripe (funding_id, service_request_id, contributor_user_id si connu, organization_id si concernée), webhook idempotent. Yousign réutilisé pour Club+ (contrats organisationnels) et ponctuellement Connect si nécessaire, même architecture.

---

# PARTIE V — MIGRATION DE L'ACTUEL CONNECT

## 92-95. Ne pas jeter le travail existant

L'actuel SportVision Connect (app-next) contient déjà énormément de fonctions qui appartiennent maintenant à Club+ (prestations organisation, demandes de visuels, crédits, documents, factures, contrats, utilisateurs, offre, paramètres organisation, rendez-vous B2B, contenus organisation, calendrier organisation) — **cartographier avant modification**, classer chaque page actuelle : CLUB+ / CONNECT / COMMUN / OS / SUPPRIMER-OBSOLÈTE, réutiliser les composants existants plutôt que reconstruire. Ce qui reste/s'adapte pour Connect : authentification, profil personnel, contenus personnels, calendrier personnel, messages, composants prestations — puis ajouter affiliations, groupes, cotisations.

## 96-98. Discipline de migration

Sauvegarde base + branche Git + migrations versionnées + rollback possible avant modifications importantes. Ne pas supprimer une table parce que son nom semble ancien — comprendre son usage d'abord. Ne pas refaire l'authentification si elle fonctionne. Ne pas dupliquer `organizations`/`users`/`services` s'ils existent déjà — adapter plutôt que dupliquer.

---

# PARTIE VI — MODÈLE DE DONNÉES CONCEPTUEL

`users` (id, email, profile, status, created_at) · `organizations` (id, name, type, status, partner_status, created_at) · `organization_memberships` (id, user_id, organization_id, role, declared_function, permissions, status) · `player_affiliations` (id, user_id, organization_id, team_id, player_role, status, requested_by, approved_by, start_date, end_date) · `teams` (id, organization_id, name, category) · `user_groups` (id, owner_user_id, name, status) · `user_group_members` (group_id, user_id, status, joined_at) · `service_requests` (id, requester_user_id, organization_id nullable, source, service_type, event_data, amount, payment_mode, status) · `group_fundings` / `funding_contributions` (voir Partie II) · `content_access` (content_id, user_id, organization_id, access_type).

---

# PARTIE VII — PERMISSIONS ET SÉCURITÉ

## 110-115

Connect : un utilisateur ne voit que son profil, ses affiliations, groupes, prestations, paiements, cotisations, contenus autorisés. Club+ : une organisation ne voit que ses propres données/utilisateurs/joueurs affiliés/prestations/contenus/documents — **Club A ne voit jamais Club B**. Un joueur ne peut pas s'auto-approuver dans un club partenaire (validation par l'organisation ou SportVision). Une déclaration de club non partenaire ne donne aucun pouvoir administratif sur ce club. Cotisations : vérifier côté serveur prestation/montant/solde/deadline/statut, **jamais confiance dans un montant venant du navigateur**. Paiements : le **webhook Stripe est la source de vérité**, jamais un `paid` posé après simple redirection frontend.

---

# PARTIE VIII-IX — INTERFACE, DESIGN, RESPONSIVE

Identité SportVision commune, personnalité fonctionnelle distincte par appli : Connect plus personnel/visuel/simple/mobile-first (contenus, affiliation, équipes, cotisations, prestations) ; Club+ plus professionnel/structuré (organisation, demandes, communication, prestations, joueurs affiliés, administration) ; OS plus dense (productivité interne). Connect : priorité mobile maximale, tester 375/390/430px. Club+ : responsive aussi, certaines fonctions complexes peuvent privilégier desktop/tablette.

---

# PARTIE X — PARCOURS COMPLETS À TESTER

A. Joueur non affilié (inscription → onboarding → aucun club → commande shooting → paiement → OS → prestation → contenus → Connect).
B. Joueur + club partenaire (inscription → recherche club → demande affiliation → Club+ reçoit → dirigeant accepte → Connect affiche affiliation).
C. Invitation par le club (Club+ invite → email → création Connect → acceptation → affiliation active).
D. Club non partenaire (déclare club → Connect affiche non partenaire → commande Pack Match → OS reçoit → SportVision sert la prestation même sans Club+).
E. Cotisation (choisit prestation → payer à plusieurs → crée groupe/équipe → objectif → partage lien → 7 contributions → objectif atteint → Stripe confirme chaque paiement → funded → OS reçoit prestation financée → planification).
F. Structure Club+ (formulaire → fonction déclarée → demande → OS valide → invitation → activation → Club+).
G. Utilisateur mixte (Christian a Connect, FC Montereau l'ajoute admin Club+, même compte, switcher Connect/Club+).
H. Contenu club vers joueurs (SportVision livre à Club+ → contenus autorisés aux U18 → Connect des joueurs U18 notifié).

---

# PARTIE XI — HORS SCOPE V2 (ne pas construire maintenant sauf instruction contraire)

Espace Famille (enfants, responsables légaux, albums individuels, achat album, rattachement parent/enfant — préparer l'architecture seulement). Reconnaissance faciale, scouting, réseau social, statistiques sportives complexes, marketplace, chat d'équipe, **cotisations libres hors prestations SportVision**, gestion licences, paiement cotisations club.

---

# PARTIE XII — ORDRE DE MIGRATION / IMPLÉMENTATION

**Phase 0 — Protection** : backup DB, branche Git, état du build, inventaire de l'existant.
**Phase 1 — Audit** : cartographier pages/composants/routes/tables/rôles/permissions/flux/Stripe/Yousign/OS. Produire un tableau Élément actuel → Destination.
**Phase 2 — Socle commun** : stabiliser users/auth/organizations/memberships/permissions, ne rien dupliquer.
**Phase 3 — Club+** : transformer en priorité les fonctionnalités B2B existantes de Connect en Club+, valider la communication OS.
**Phase 4 — Connect personnel** : dashboard, affiliations, équipes, prestations, contenus, calendrier, messages, profil.
**Phase 5 — Affiliations** Club+ ↔ Connect (recherche, demande, acceptation, refus, invitation, départ).
**Phase 6 — Groupes** personnels.
**Phase 7 — Cotisations** — paiement collectif, ne pas toucher Stripe sans tests rigoureux.
**Phase 8 — Intégration OS** — tester tous les flux.
**Phase 9 — QA** — permissions, cross-tenant, mobile, Stripe, régressions, build.

---

# PARTIE XIII — RÈGLES DE TRAVAIL SUR LE CODE

Ne pas reconstruire ce qui fonctionne. Ne pas tout renommer immédiatement si le risque est inutile. **À J-5 d'un lancement : STABILITÉ > REFACTOR ESTHÉTIQUE.**

**Corrections autonomes (pas besoin de demander)** : bugs, navigation, wording, responsive, erreurs de permissions évidentes, boutons morts, incohérences UX, erreurs console.

**Demander confirmation avant** : suppression importante de données, changement financier majeur, changement juridique, suppression d'une fonctionnalité business importante, migration irréversible.

---

# PARTIE XIV — OBJECTIF BUSINESS

Connect = acquisition B2C (un joueur peut acheter SportVision sans que son club soit client — ouvre SportVision à davantage de monde). Club+ = acquisition B2B (contractualisation directe organisation ↔ SportVision). Les deux se nourrissent (des joueurs d'un club utilisent Connect → SportVision détecte l'opportunité → le club rejoint Club+ → invite plus de joueurs → plus d'utilisateurs Connect). La cotisation réduit la friction prix (160€ semble cher pour un seul joueur, 10×16€ est facilement accessible) — doit augmenter conversion, nombre de prestations, acquisition joueurs, bouche-à-oreille.

---

# PARTIE XV — RAPPORT ATTENDU AVANT LES GROS CHANGEMENTS

Avant une refonte lourde, produire un **RAPPORT DE MIGRATION CONNECT → CONNECT + CLUB+** : (1) architecture actuelle, (2) ce qui doit devenir Club+, (3) ce qui doit rester Connect, (4) ce qui est commun, (5) tables réutilisées, (6) tables éventuellement nouvelles, (7) risques, (8) ordre des modifications, (9) estimation complexité, (10) points nécessitant validation. **Ensuite seulement, commencer l'implémentation phase par phase.**

---

# PARTIE XVI — CRITÈRES D'ACCEPTATION FINAUX

Le système est cohérent quand : un joueur peut créer Connect seul, sans club partenaire ; il peut rejoindre un club Club+ (Club+ accepte l'affiliation, ou invite directement) ; il peut déclarer un club non partenaire ; plusieurs affiliations sont possibles ; les groupes personnels fonctionnent ; une cotisation peut être créée, le lien partagé, plusieurs personnes payées, chaque paiement va directement à SportVision, l'objectif ne peut jamais être dépassé, Stripe confirme par webhook, une cotisation financée crée/met à jour la prestation ; OS reçoit correctement toutes les demandes ; un utilisateur mixte passe Connect ↔ Club+ facilement ; les dirigeants n'utilisent plus un faux espace joueur ; les joueurs ne voient jamais les finances du club ; Club A ne voit jamais Club B ; aucune donnée n'est perdue pendant la migration ; le build production est propre.

---

# Conclusion à retenir

```
SPORTVISION
   VITRINE          → attire et convertit
        ↓
   CONNECT          → personnes (joueurs, sportifs, particuliers, parents à terme)
        ↓
   CLUB+            → organisations (clubs, académies, coachs, tournois, stages, structures)
        ↓
   OS               → équipe interne SportVision, gère tout l'écosystème
```

**Le principe le plus important :**

**CONNECT = MOI · CLUB+ = MA STRUCTURE · OS = SPORTVISION**

Un même utilisateur peut appartenir aux deux premiers environnements. Les données doivent être reliées, les comptes ne doivent jamais être dupliqués. Le club ne possède jamais le compte personnel du joueur — l'affiliation crée simplement une relation entre le joueur et l'organisation. Les joueurs peuvent utiliser SportVision même si leur club n'est pas partenaire. Les organisations partenaires utilisent Club+. Les joueurs peuvent financer ensemble une prestation grâce à la cotisation collective — chaque contribution est payée directement à SportVision, jamais entre joueurs. SportVision OS reçoit et traite ensuite toutes les opérations. Avant chaque décision technique, revenir à cette logique.
